"""
editor/annotation_store.py
===========================
Module 2 — Annotation Store

In-memory store for all annotation records loaded from
the pipeline JSON output. Provides CRUD operations,
status management, and serialisation back to records list.

Statuses:
  RESOLVED       — auto-mapped by pipeline
  UNMAPPED       — pipeline could not map
  USER_CORRECTED — user manually corrected in editor
  NOT_SUBMITTED  — user marked as not submitted
                   (grey box, black border, black text)

Dependencies: none (pure Python dataclasses)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional
from collections import defaultdict


# =============================================================================
# ANNOTATION RECORD
# =============================================================================

@dataclass
class AnnotationRecord:
    """
    Single annotation component record.

    Attributes
    ----------
    annotation_id   : unique ID — f"{page}_{component}"
    page_number     : 1-based page number
    component       : component identifier e.g. component_03
    form_code       : CRF form code e.g. CM01
    page_type       : FORM or TABLE
    raw_variable    : raw variable name from pipeline
    field_number    : field number — None if ?
    text_preview    : first ~40 chars of field text
    sdtm_dataset    : SDTM domain e.g. CM, AE, LB
    sdtm_variable   : SDTM variable e.g. CMTRT
    sdtm_label      : SDTM variable label
    status          : RESOLVED | UNMAPPED |
                      USER_CORRECTED | NOT_SUBMITTED
    fitz_rect       : (x0, y0, x1, y1) in PDF points
                      y0==y1==0 means unplaced
    """
    annotation_id:   str
    page_number:     int
    component:       str
    form_code:       str
    page_type:       str
    raw_variable:    str
    field_number:    Optional[int]
    text_preview:    str
    sdtm_dataset:    str
    sdtm_variable:   str
    sdtm_label:      str
    status:          str
    fitz_rect:       tuple[float, float, float, float] = (
        0.0, 0.0, 0.0, 0.0
    )


# =============================================================================
# ANNOTATION STORE
# =============================================================================

class AnnotationStore:
    """
    In-memory store for all annotation records.

    Indexed by:
      - annotation_id (primary key)
      - page_number (secondary index)

    Usage
    -----
    store = AnnotationStore()
    store.load_from_pipeline_records(pipeline_data)
    rec = store.get("1_component_03")
    store.mark_corrected("1_component_03", "CM", "CMTRT", "Trt Name")
    records = store.to_records_list()
    """

    def __init__(self):
        # Primary store: annotation_id → AnnotationRecord
        self._records: dict[str, AnnotationRecord] = {}
        # Secondary index: page_number → list[annotation_id]
        self._page_index: dict[int, list[str]] = defaultdict(list)

    # =========================================================================
    # LOAD
    # =========================================================================

    def load_from_pipeline_records(
        self, pipeline_data: list[dict]
    ) -> int:
        """
        Load annotation records from pipeline JSON output.

        Parameters
        ----------
        pipeline_data : list of record dicts from
                        annotation_data.json

        Returns
        -------
        int — number of records loaded
        """
        self._records.clear()
        self._page_index.clear()

        for rec_dict in pipeline_data:
            rec = self._dict_to_record(rec_dict)
            self._records[rec.annotation_id] = rec
            self._page_index[rec.page_number].append(
                rec.annotation_id
            )

        return len(self._records)

    def _dict_to_record(self, d: dict) -> AnnotationRecord:
        """Convert a pipeline dict to an AnnotationRecord."""
        page      = int(d.get("page", 0))
        component = str(d.get("component", ""))
        ann_id    = f"{page}_{component}"

        # Determine status
        sdtm_var = str(d.get("sdtm_variable") or "").strip()
        status   = d.get("status", "")

        if not status:
            if sdtm_var:
                status = "RESOLVED"
            else:
                status = "UNMAPPED"

        # Parse fitz_rect
        raw_rect = d.get("fitz_rect")
        if raw_rect and len(raw_rect) == 4:
            fitz_rect = tuple(float(v) for v in raw_rect)
        else:
            y0 = float(d.get("y0_pts", 0.0))
            y1 = float(d.get("y1_pts", 0.0))
            fitz_rect = (0.0, y0, 1.0, y1)

        # Parse field_number
        fn_raw = d.get("field_number")
        try:
            field_number = int(fn_raw) if fn_raw not in (
                None, "", "?", "None"
            ) else None
        except (ValueError, TypeError):
            field_number = None

        return AnnotationRecord(
            annotation_id = ann_id,
            page_number   = page,
            component     = component,
            form_code     = str(d.get("form_code") or ""),
            page_type     = str(d.get("page_type") or "FORM"),
            raw_variable  = str(d.get("raw_variable") or ""),
            field_number  = field_number,
            text_preview  = str(d.get("text_preview") or "")[:60],
            sdtm_dataset  = str(d.get("sdtm_dataset") or "").strip().upper(),
            sdtm_variable = sdtm_var.upper(),
            sdtm_label    = str(d.get("sdtm_label") or "").strip(),
            status        = status,
            fitz_rect     = fitz_rect,
        )

    # =========================================================================
    # READ
    # =========================================================================

    def get(self, annotation_id: str) -> Optional[AnnotationRecord]:
        """Return record by annotation_id or None."""
        return self._records.get(annotation_id)

    def get_by_page(self, page_number: int) -> list[AnnotationRecord]:
        """Return all records for a given page number."""
        ids = self._page_index.get(page_number, [])
        return [
            self._records[aid]
            for aid in ids
            if aid in self._records
        ]

    def get_all(self) -> list[AnnotationRecord]:
        """Return all records in page order."""
        return sorted(
            self._records.values(),
            key = lambda r: (r.page_number, r.component),
        )

    def get_by_status(self, status: str) -> list[AnnotationRecord]:
        """Return all records with a given status."""
        return [
            r for r in self._records.values()
            if r.status == status
        ]

    def get_by_form(self, form_code: str) -> list[AnnotationRecord]:
        """Return all records for a given form code."""
        fc = form_code.strip().upper()
        return [
            r for r in self._records.values()
            if r.form_code.strip().upper() == fc
        ]

    # =========================================================================
    # UPDATE
    # =========================================================================

    def update(
        self,
        annotation_id: str,
        **kwargs,
    ) -> bool:
        """
        Update any fields on a record by annotation_id.

        Parameters
        ----------
        annotation_id : record to update
        **kwargs      : field=value pairs to update

        Returns
        -------
        bool — True if record found and updated
        """
        rec = self._records.get(annotation_id)
        if not rec:
            return False

        allowed = {
            "sdtm_dataset", "sdtm_variable", "sdtm_label",
            "status", "fitz_rect", "raw_variable",
            "text_preview", "form_code",
        }
        for k, v in kwargs.items():
            if k in allowed:
                setattr(rec, k, v)

        return True

    def mark_corrected(
        self,
        annotation_id: str,
        sdtm_dataset:  str,
        sdtm_variable: str,
        sdtm_label:    str = "",
    ) -> bool:
        """
        Mark a record as USER_CORRECTED with new SDTM mapping.

        Parameters
        ----------
        annotation_id : record to update
        sdtm_dataset  : new SDTM domain e.g. CM
        sdtm_variable : new SDTM variable e.g. CMTRT
        sdtm_label    : new SDTM label (optional)

        Returns
        -------
        bool — True if record found and updated
        """
        rec = self._records.get(annotation_id)
        if not rec:
            return False

        rec.sdtm_dataset  = sdtm_dataset.strip().upper()
        rec.sdtm_variable = sdtm_variable.strip().upper()
        rec.sdtm_label    = sdtm_label.strip()
        rec.status        = "USER_CORRECTED"
        return True

    def mark_not_submitted(self, annotation_id: str) -> bool:
        """
        Mark a record as NOT_SUBMITTED.
        Clears SDTM mapping — renders as grey box.

        Parameters
        ----------
        annotation_id : record to update

        Returns
        -------
        bool — True if record found and updated
        """
        rec = self._records.get(annotation_id)
        if not rec:
            return False

        rec.status        = "NOT_SUBMITTED"
        rec.sdtm_dataset  = ""
        rec.sdtm_variable = ""
        rec.sdtm_label    = "Not Submitted"
        return True

    def mark_unmapped(self, annotation_id: str) -> bool:
        """
        Reset a record back to UNMAPPED status.

        Parameters
        ----------
        annotation_id : record to reset

        Returns
        -------
        bool — True if record found and updated
        """
        rec = self._records.get(annotation_id)
        if not rec:
            return False

        rec.status        = "UNMAPPED"
        rec.sdtm_dataset  = ""
        rec.sdtm_variable = ""
        rec.sdtm_label    = ""
        return True

    # =========================================================================
    # SERIALISE
    # =========================================================================

    def to_records_list(self) -> list[dict]:
        """
        Serialise all records back to a list of dicts
        compatible with annotation_data.json format.

        Returns
        -------
        list[dict] — all records in page order
        """
        result = []
        for rec in self.get_all():
            result.append({
                "page":          rec.page_number,
                "component":     rec.component,
                "form_code":     rec.form_code,
                "page_type":     rec.page_type,
                "raw_variable":  rec.raw_variable,
                "field_number":  rec.field_number,
                "text_preview":  rec.text_preview,
                "sdtm_dataset":  rec.sdtm_dataset,
                "sdtm_variable": rec.sdtm_variable,
                "sdtm_label":    rec.sdtm_label,
                "status":        rec.status,
                "y0_pts":        rec.fitz_rect[1],
                "y1_pts":        rec.fitz_rect[3],
                "fitz_rect":     list(rec.fitz_rect),
                "annotation_id": rec.annotation_id,
            })
        return result

    # =========================================================================
    # STATS
    # =========================================================================

    def stats(self) -> dict:
        """
        Return summary statistics for the current store state.

        Returns
        -------
        dict with keys:
          total, resolved, unmapped,
          user_corrected, not_submitted,
          resolution_pct
        """
        all_recs      = list(self._records.values())
        total         = len(all_recs)
        resolved      = sum(
            1 for r in all_recs if r.status == "RESOLVED"
        )
        user_corrected = sum(
            1 for r in all_recs if r.status == "USER_CORRECTED"
        )
        unmapped      = sum(
            1 for r in all_recs if r.status == "UNMAPPED"
        )
        not_submitted = sum(
            1 for r in all_recs if r.status == "NOT_SUBMITTED"
        )
        mapped        = resolved + user_corrected
        res_pct       = round(mapped / total * 100, 1) if total else 0.0

        return {
            "total":          total,
            "resolved":       resolved,
            "user_corrected": user_corrected,
            "unmapped":       unmapped,
            "not_submitted":  not_submitted,
            "resolution_pct": res_pct,
        }

    # =========================================================================
    # UTILITY
    # =========================================================================

    def __len__(self) -> int:
        return len(self._records)

    def __repr__(self) -> str:
        s = self.stats()
        return (
            f"AnnotationStore("
            f"total={s['total']}, "
            f"resolved={s['resolved']}, "
            f"unmapped={s['unmapped']}, "
            f"user_corrected={s['user_corrected']}, "
            f"not_submitted={s['not_submitted']})"
        )
    # In annotation_store.py — add this method to AnnotationStore class

def mark_removed(self, annotation_id: str) -> None:
    """
    Mark annotation as REMOVED — hidden from canvas entirely.
    No box drawn, not counted in resolved or unmapped.
    """
    rec = self.get(annotation_id)
    if rec:
        rec.status        = "REMOVED"
        rec.sdtm_dataset  = ""
        rec.sdtm_variable = ""
        rec.sdtm_label    = ""


def stats(self) -> dict:
    """Return summary statistics."""
    total           = len(self._records)
    resolved        = sum(
        1 for r in self._records.values()
        if r.status == "RESOLVED"
    )
    user_corrected  = sum(
        1 for r in self._records.values()
        if r.status == "USER_CORRECTED"
    )
    not_submitted   = sum(
        1 for r in self._records.values()
        if r.status == "NOT_SUBMITTED"
    )
    removed         = sum(
        1 for r in self._records.values()
        if r.status == "REMOVED"
    )
    unmapped        = sum(
        1 for r in self._records.values()
        if r.status == "UNMAPPED"
    )
    active          = total - removed
    res_pct         = round(
        (resolved + user_corrected) / active * 100, 1
    ) if active else 0.0

    return {
        "total":          total,
        "active":         active,
        "resolved":       resolved,
        "user_corrected": user_corrected,
        "not_submitted":  not_submitted,
        "removed":        removed,
        "unmapped":       unmapped,
        "resolution_pct": res_pct,
    }