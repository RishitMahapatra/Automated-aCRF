"""
bridge/annotation_bridge.py
===========================
Simple JSON-backed annotation CRUD for the PyWebView editor.
Reads/writes annotation_data.json directly.
"""

from __future__ import annotations

import json
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from config import get_annotation_json_path


# =============================================================================
# INTERNAL HELPERS
# =============================================================================

def _load_records(session_id: str) -> list[dict]:
    json_path = get_annotation_json_path(session_id)
    if not json_path.exists():
        return []

    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    return data if isinstance(data, list) else []


def _save_records(session_id: str, records: list[dict]) -> None:
    json_path = get_annotation_json_path(session_id)
    json_path.parent.mkdir(parents=True, exist_ok=True)

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(records, f, indent=2, ensure_ascii=False)


def _normalise_record(rec: dict) -> dict:
    if not isinstance(rec, dict):
        rec = {}

    page = int(rec.get("page", 0) or 0)
    component = str(rec.get("component", "") or "")
    annotation_id = str(rec.get("annotation_id") or f"{page}_{component}")

    sdtm_dataset = str(rec.get("sdtm_dataset") or "").strip().upper()
    sdtm_variable = str(rec.get("sdtm_variable") or "").strip().upper()
    sdtm_label = str(rec.get("sdtm_label") or "").strip()
    raw_variable = str(rec.get("raw_variable") or "").strip()

    status = str(rec.get("status") or "").strip().upper()
    if not status:
        status = "RESOLVED" if sdtm_variable else "UNMAPPED"

    rec["page"] = page
    rec["component"] = component
    rec["annotation_id"] = annotation_id
    rec["sdtm_dataset"] = sdtm_dataset
    rec["sdtm_variable"] = sdtm_variable
    rec["sdtm_label"] = sdtm_label
    rec["raw_variable"] = raw_variable
    rec["status"] = status

    return rec


# =============================================================================
# READ
# =============================================================================

def get_annotations(session_id: str) -> list[dict]:
    records = _load_records(session_id)
    return [_normalise_record(rec) for rec in records]


def get_page_annotations(session_id: str, page_number: int) -> list[dict]:
    page_number = int(page_number)
    records = get_annotations(session_id)
    return [r for r in records if int(r.get("page", 0)) == page_number]


def get_annotation(session_id: str, annotation_id: str) -> dict | None:
    annotation_id = str(annotation_id or "").strip()
    if not annotation_id:
        return None

    records = get_annotations(session_id)
    for rec in records:
        if rec.get("annotation_id") == annotation_id:
            return rec
    return None


# =============================================================================
# UPDATE
# =============================================================================

def update_annotation(
    session_id: str,
    annotation_id: str,
    status: str,
    sdtm_dataset: str = "",
    sdtm_variable: str = "",
    sdtm_label: str = "",
) -> dict:
    annotation_id = str(annotation_id or "").strip()
    status = str(status or "").strip().upper()
    sdtm_dataset = str(sdtm_dataset or "").strip().upper()
    sdtm_variable = str(sdtm_variable or "").strip().upper()
    sdtm_label = str(sdtm_label or "").strip()

    if not annotation_id:
        return {"ok": False, "error": "Missing annotation_id"}

    if not status:
        status = "RESOLVED" if sdtm_variable else "UNMAPPED"

    records = get_annotations(session_id)

    found = False
    for rec in records:
        if rec.get("annotation_id") == annotation_id:
            rec["status"] = status
            rec["sdtm_dataset"] = sdtm_dataset
            rec["sdtm_variable"] = sdtm_variable
            rec["sdtm_label"] = sdtm_label
            found = True
            break

    if not found:
        return {"ok": False, "error": f"Not found: {annotation_id}"}

    _save_records(session_id, records)
    return {"ok": True, "annotation_id": annotation_id}


def update_dataset_mapping(
    session_id: str,
    form_code: str,
    old_dataset: str,
    new_dataset: str,
) -> dict:
    """
    Rename an SDTM dataset across all annotations within a form_code.
    Useful for bulk correction.
    """
    form_code = str(form_code or "").strip().upper()
    old_dataset = str(old_dataset or "").strip().upper()
    new_dataset = str(new_dataset or "").strip().upper()

    if not form_code or not old_dataset or not new_dataset:
        return {"ok": False, "error": "form_code, old_dataset, and new_dataset are required"}

    records = get_annotations(session_id)

    changed = 0
    for rec in records:
        rec_form = str(rec.get("form_code") or "").strip().upper()
        rec_ds = str(rec.get("sdtm_dataset") or "").strip().upper()

        if rec_form == form_code and rec_ds == old_dataset:
            rec["sdtm_dataset"] = new_dataset
            changed += 1

    _save_records(session_id, records)

    return {
        "ok": True,
        "form_code": form_code,
        "old_dataset": old_dataset,
        "new_dataset": new_dataset,
        "updated_count": changed,
    }


# =============================================================================
# STATS
# =============================================================================

def get_stats(session_id: str) -> dict:
    records = get_annotations(session_id)
    form_records = [r for r in records if (r.get("page_type") or "FORM") == "FORM"]

    total = len(form_records)

    user_corrected = sum(1 for r in form_records if r.get("status") == "USER_CORRECTED")
    not_submitted = sum(1 for r in form_records if r.get("status") == "NOT_SUBMITTED")
    removed = sum(1 for r in form_records if r.get("status") == "REMOVED")

    unmapped = sum(
        1 for r in form_records
        if not r.get("sdtm_variable")
        and r.get("status") not in ("NOT_SUBMITTED", "REMOVED", "USER_CORRECTED")
    )

    actually_resolved = sum(
        1 for r in form_records
        if r.get("sdtm_variable")
        and r.get("status") not in ("NOT_SUBMITTED", "REMOVED", "UNMAPPED")
    )

    active = total - removed
    resolution_pct = round((actually_resolved / active) * 100, 1) if active > 0 else 0.0

    return {
        "total": total,
        "active": active,
        "resolved": actually_resolved - user_corrected,
        "user_corrected": user_corrected,
        "unmapped": unmapped,
        "not_submitted": not_submitted,
        "removed": removed,
        "resolution_pct": resolution_pct,
    }


# =============================================================================
# SUGGESTIONS
# =============================================================================

def get_suggestions(session_id: str, annotation_id: str) -> list[dict]:
    """
    Get TF-IDF suggestions for a single annotation.
    """
    import re

    rec = get_annotation(session_id, annotation_id)
    if not rec:
        return []

    raw_var = str(rec.get("raw_variable") or "").strip()
    if not raw_var:
        return []

    try:
        from editor.confidence_engine import ConfidenceEngine
        from config import EXCEL_PATH

        engine = ConfidenceEngine()
        engine.build_from_excel(EXCEL_PATH)

        form_code = str(rec.get("form_code") or "").strip().upper()
        domain_hint = re.sub(r"\d+$", "", form_code)

        candidates = engine.get_candidates(
            raw_variable=raw_var,
            top_n=4,
            min_score=0.10,
            domain_hint=domain_hint,
        )
        return [c.to_dict() for c in candidates]

    except Exception as e:
        print(f"[annotation_bridge] suggestions error: {e}")
        return []


# =============================================================================
# DATASET COLOURS
# =============================================================================

def update_dataset_colour(
    session_id: str,
    form_code: str,
    sdtm_dataset: str,
    new_colour: str,
) -> dict:
    try:
        json_path = get_annotation_json_path(session_id)
        colour_path = json_path.parent / "dataset_colours.json"

        colours = {}
        if colour_path.exists():
            with open(colour_path, "r", encoding="utf-8") as f:
                colours = json.load(f)

        key = f"{str(form_code or '').strip().upper()}::{str(sdtm_dataset or '').strip().upper()}"
        colours[key] = str(new_colour or "").strip()

        with open(colour_path, "w", encoding="utf-8") as f:
            json.dump(colours, f, indent=2, ensure_ascii=False)

        return {"ok": True, "updated_key": key, "colour": new_colour}

    except Exception as e:
        return {"ok": False, "error": str(e)}


def get_dataset_colours(session_id: str) -> dict:
    try:
        json_path = get_annotation_json_path(session_id)
        colour_path = json_path.parent / "dataset_colours.json"

        if colour_path.exists():
            with open(colour_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data if isinstance(data, dict) else {}

        return {}

    except Exception:
        return {}