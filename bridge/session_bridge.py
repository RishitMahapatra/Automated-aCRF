"""
bridge/session_bridge.py
========================
Save / Open / New session logic using .acrf files (ZIP archives).

An .acrf file bundles everything needed to restore a session:
    source.pdf            — the original CRF PDF
    annotations.json      — all annotation records
    editor_state.json     — undo/redo history
    dataset_colours.json  — colour assignments
    pipeline_summary.txt  — pipeline run log
    meta.json             — session name, timestamps, page count
"""

from __future__ import annotations

import json
import shutil
import sqlite3
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from config import (
    OUTPUTS_DIR,
    ROOT_DIR,
    get_annotation_json_path,
    get_components_dir,
    get_editor_state_path,
    get_session_dir,
    get_summary_path,
)

ACRF_EXTENSION = ".acrf"
RECENT_DB_PATH = ROOT_DIR / ".acrf_sessions.db"


# =============================================================================
# SQLite recent-sessions registry
# =============================================================================

def _ensure_db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(RECENT_DB_PATH))
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS recent_sessions (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id  TEXT NOT NULL,
            name        TEXT NOT NULL,
            path        TEXT NOT NULL UNIQUE,
            pdf_name    TEXT,
            page_count  INTEGER DEFAULT 0,
            annotation_count INTEGER DEFAULT 0,
            last_opened TEXT NOT NULL,
            created_at  TEXT NOT NULL
        )
        """
    )
    conn.commit()
    return conn


def _upsert_recent(
    session_id: str,
    name: str,
    path: str,
    pdf_name: str = "",
    page_count: int = 0,
    annotation_count: int = 0,
) -> None:
    now = datetime.now(timezone.utc).isoformat()
    conn = _ensure_db()
    try:
        conn.execute(
            """
            INSERT INTO recent_sessions
                (session_id, name, path, pdf_name, page_count, annotation_count, last_opened, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(path) DO UPDATE SET
                session_id       = excluded.session_id,
                name             = excluded.name,
                pdf_name         = excluded.pdf_name,
                page_count       = excluded.page_count,
                annotation_count = excluded.annotation_count,
                last_opened      = excluded.last_opened
            """,
            (session_id, name, path, pdf_name, page_count, annotation_count, now, now),
        )
        conn.commit()
    finally:
        conn.close()


def get_recent_sessions(limit: int = 10) -> list[dict]:
    conn = _ensure_db()
    try:
        rows = conn.execute(
            """
            SELECT session_id, name, path, pdf_name, page_count,
                   annotation_count, last_opened, created_at
            FROM recent_sessions
            ORDER BY last_opened DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return [
            {
                "session_id": r[0],
                "name": r[1],
                "path": r[2],
                "pdf_name": r[3],
                "page_count": r[4],
                "annotation_count": r[5],
                "last_opened": r[6],
                "created_at": r[7],
            }
            for r in rows
        ]
    finally:
        conn.close()


# =============================================================================
# SAVE
# =============================================================================

def save_session(
    save_path: str | Path,
    session_id: str,
    pdf_path: str | Path,
    editor_state: dict | None = None,
) -> dict:
    """
    Pack current session into an .acrf ZIP file.
    """
    save_path = Path(save_path)
    pdf_path = Path(pdf_path)
    session_id = str(session_id or "").strip()

    if not session_id:
        return {"ok": False, "error": "No session ID"}

    if not pdf_path.exists():
        return {"ok": False, "error": f"PDF not found: {pdf_path}"}

    if save_path.suffix.lower() != ACRF_EXTENSION:
        save_path = save_path.with_suffix(ACRF_EXTENSION)

    save_path.parent.mkdir(parents=True, exist_ok=True)

    annotation_json = get_annotation_json_path(session_id)
    editor_state_json = get_editor_state_path(session_id)
    summary_txt = get_summary_path(session_id)
    components_dir = get_components_dir(session_id)
    colours_json = components_dir / "dataset_colours.json"

    annotation_count = 0
    if annotation_json.exists():
        try:
            data = json.loads(annotation_json.read_text(encoding="utf-8"))
            annotation_count = len(data) if isinstance(data, list) else 0
        except Exception:
            pass

    page_count = 0
    try:
        import fitz
        doc = fitz.open(str(pdf_path))
        page_count = doc.page_count
        doc.close()
    except Exception:
        pass

    if editor_state:
        editor_state_json.parent.mkdir(parents=True, exist_ok=True)
        editor_state_json.write_text(
            json.dumps({"session_id": session_id, "version": 1, "state": editor_state}, indent=2),
            encoding="utf-8",
        )

    meta = {
        "version": 1,
        "session_id": session_id,
        "pdf_name": pdf_path.name,
        "page_count": page_count,
        "annotation_count": annotation_count,
        "saved_at": datetime.now(timezone.utc).isoformat(),
        "app": "CRF Annotation Editor",
    }

    with zipfile.ZipFile(save_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("meta.json", json.dumps(meta, indent=2, ensure_ascii=False))
        zf.write(pdf_path, "source.pdf")

        if annotation_json.exists():
            zf.write(annotation_json, "annotations.json")

        if editor_state_json.exists():
            zf.write(editor_state_json, "editor_state.json")

        if summary_txt.exists():
            zf.write(summary_txt, "pipeline_summary.txt")

        if colours_json.exists():
            zf.write(colours_json, "dataset_colours.json")

    _upsert_recent(
        session_id=session_id,
        name=save_path.stem,
        path=str(save_path),
        pdf_name=pdf_path.name,
        page_count=page_count,
        annotation_count=annotation_count,
    )

    return {"ok": True, "path": str(save_path), "meta": meta}


# =============================================================================
# OPEN
# =============================================================================

def open_session(acrf_path: str | Path) -> dict:
    """
    Unpack an .acrf file into the outputs directory and return session metadata.
    """
    acrf_path = Path(acrf_path)

    if not acrf_path.exists():
        return {"ok": False, "error": f"File not found: {acrf_path}"}

    if not zipfile.is_zipfile(acrf_path):
        return {"ok": False, "error": "Not a valid .acrf file"}

    with zipfile.ZipFile(acrf_path, "r") as zf:
        names = zf.namelist()

        if "meta.json" not in names:
            return {"ok": False, "error": "Invalid .acrf file: missing meta.json"}

        meta = json.loads(zf.read("meta.json").decode("utf-8"))
        session_id = meta.get("session_id", "")

        if not session_id:
            session_id = f"restored_{uuid.uuid4().hex[:8]}"
            meta["session_id"] = session_id

        session_dir = get_session_dir(session_id)
        components_dir = get_components_dir(session_id)

        if "source.pdf" in names:
            pdf_dest = session_dir / "source.pdf"
            pdf_dest.write_bytes(zf.read("source.pdf"))
        else:
            return {"ok": False, "error": "Invalid .acrf file: missing source.pdf"}

        if "annotations.json" in names:
            ann_dest = get_annotation_json_path(session_id)
            ann_dest.write_bytes(zf.read("annotations.json"))

        if "editor_state.json" in names:
            state_dest = get_editor_state_path(session_id)
            state_dest.write_bytes(zf.read("editor_state.json"))

        if "pipeline_summary.txt" in names:
            summary_dest = get_summary_path(session_id)
            summary_dest.write_bytes(zf.read("pipeline_summary.txt"))

        if "dataset_colours.json" in names:
            colours_dest = components_dir / "dataset_colours.json"
            colours_dest.write_bytes(zf.read("dataset_colours.json"))

    pdf_path = session_dir / "source.pdf"

    _upsert_recent(
        session_id=session_id,
        name=acrf_path.stem,
        path=str(acrf_path),
        pdf_name=meta.get("pdf_name", ""),
        page_count=meta.get("page_count", 0),
        annotation_count=meta.get("annotation_count", 0),
    )

    return {
        "ok": True,
        "session_id": session_id,
        "pdf_path": str(pdf_path),
        "pdf_name": meta.get("pdf_name", pdf_path.name),
        "page_count": meta.get("page_count", 0),
        "annotation_count": meta.get("annotation_count", 0),
        "meta": meta,
        "acrf_path": str(acrf_path),
    }
