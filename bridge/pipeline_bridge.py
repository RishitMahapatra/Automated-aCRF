"""
bridge/pipeline_bridge.py
=========================
Thin wrapper around the working extraction + annotation pipeline.

Exposes:
- run_full_pipeline(pdf_path, session_id)
- get_suggestions(raw_variable, domain_hint=None, top_n=4, min_score=0.10)

Also keeps PipelineBridge for backward compatibility.
"""

from __future__ import annotations

import traceback
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from config import get_annotation_json_path


def run_full_pipeline(pdf_path: str | Path, session_id: str) -> dict:
    """
    Run the full CRF pipeline:
      1. Extract components + match SDTM
      2. Draw annotations onto PDF

    Returns
    -------
    dict
        {
            "ok": bool,
            "resolved": int,
            "unresolved": int,
            "total": int,
            "linked": int,
            "annotator_ok": bool,
            "json_path": str,
            "error": str,      # only if failed
            "trace": str,      # only if failed
        }
    """
    try:
        from pipeline.crf_full_pipeline import run_pipeline
        from pipeline.crf_annotator import run_annotator

        pdf_path = Path(pdf_path)

        # Step 1 — Extraction + matching
        result = run_pipeline(
            pdf_path=pdf_path,
            session_id=session_id,
        )

        json_path = get_annotation_json_path(session_id)
        if not json_path.exists():
            return {"ok": False, "error": "Pipeline ran but JSON not created"}

        resolved = result.get("resolved", 0)
        unresolved = result.get("unresolved", 0)
        total = result.get("total", 0)
        linked = result.get("linked", 0)

        # Step 2 — Annotate PDF
        annotator_ok = True
        annotator_error = ""
        try:
            run_annotator(pdf_path=pdf_path, session_id=session_id)
        except Exception as e:
            annotator_ok = False
            annotator_error = str(e)
            print(f"[pipeline_bridge] Annotator warning: {e}")

        result_dict = {
            "ok": True,
            "resolved": resolved,
            "unresolved": unresolved,
            "total": total,
            "linked": linked,
            "annotator_ok": annotator_ok,
            "json_path": str(json_path),
        }
        if not annotator_ok:
            result_dict["warning"] = f"Annotator failed: {annotator_error}"
        return result_dict

    except Exception as e:
        return {
            "ok": False,
            "error": str(e),
            "trace": traceback.format_exc(),
        }


_cached_engine = None

def _get_engine():
    global _cached_engine
    if _cached_engine is None:
        from editor.confidence_engine import ConfidenceEngine
        from config import EXCEL_PATH
        _cached_engine = ConfidenceEngine()
        _cached_engine.build_from_excel(EXCEL_PATH)
    return _cached_engine


def get_suggestions(
    raw_variable: str,
    domain_hint: str | None = None,
    top_n: int = 4,
    min_score: float = 0.10,
) -> list[dict]:
    raw_variable = (raw_variable or "").strip()
    if not raw_variable:
        return []

    try:
        engine = _get_engine()

        candidates = engine.get_candidates(
            raw_variable=raw_variable,
            top_n=top_n,
            min_score=min_score,
            domain_hint=domain_hint,
        )
        return [c.to_dict() for c in candidates]

    except Exception as e:
        print(f"[pipeline_bridge] Suggestion error: {e}")
        return []


class PipelineBridge:
    """
    Backward-compatible wrapper class.
    Keeps existing api.py usage working with minimal change.
    """

    def run(self, pdf_path: Path, session_id: str) -> dict:
        return run_full_pipeline(pdf_path=pdf_path, session_id=session_id)