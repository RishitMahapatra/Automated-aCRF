"""
api.py
======
Bridge between JS frontend and Python backend.
Every public method is callable from JS via window.pywebview.api.method_name()
"""

from __future__ import annotations
import shutil
import traceback
from pathlib import Path

import uuid

import webview

from config import ROOT_DIR, OUTPUTS_DIR, EXCEL_PATH
from bridge.pipeline_bridge import PipelineBridge, run_full_pipeline
from bridge import annotation_bridge
from bridge.export_bridge import ExportBridge


class Api:
    """Exposed to JS as window.pywebview.api"""

    def __init__(self):
        self._window = None
        self._pdf_path: Path | None = None
        self._session_id: str = ""
        self._pipeline = PipelineBridge()
        self._export = ExportBridge()

    # =========================================================================
    # FILE UPLOAD
    # =========================================================================

    def select_pdf(self):
        """
        Open file picker and store selected PDF internally.
        """
        try:
            result = self._window.create_file_dialog(
                webview.OPEN_DIALOG,
                allow_multiple=False,
                file_types=("PDF Files (*.pdf)",),
            )

            if result and len(result) > 0:
                path = Path(result[0])
                if path.exists() and path.suffix.lower() == ".pdf":
                    self._pdf_path = path
                    base = path.stem.strip().replace(" ", "_")
                    suffix = uuid.uuid4().hex[:8]
                    self._session_id = f"{base}_{suffix}"
                    self._export.set_pdf(path)

                    return {
                        "ok": True,
                        "filename": path.name,
                        "path": str(path),
                        "session_id": self._session_id,
                    }

            return {"ok": False, "error": "No file selected"}

        except Exception as e:
            return {"ok": False, "error": str(e)}

    def open_pdf_dialog(self):
        """
        Backward-compatible alias for older frontend code.
        """
        return self.select_pdf()

    # =========================================================================
    # SESSION
    # =========================================================================

    def set_session_id(self, session_id):
        self._session_id = str(session_id or "").strip().replace(" ", "_")
        return {"ok": True, "session_id": self._session_id}

    def get_state(self):
        return {
            "ok": True,
            "pdf_loaded": self._pdf_path is not None,
            "pdf_name": self._pdf_path.name if self._pdf_path else None,
            "pdf_path": str(self._pdf_path) if self._pdf_path else None,
            "session_id": self._session_id,
            "page_count": self._export.get_page_count(),
        }
    def restart_session(self):
        """
        Clear current in-memory session state so the frontend can reset the app
        and start a fresh session.
        """
        try:
            self._pdf_path = None
            self._session_id = ""
            self._export = ExportBridge()
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    # =========================================================================
    # PIPELINE
    # =========================================================================

    def run_pipeline(self, pdf_path=None, session_id=None):
        """
        Run pipeline using either:
        - stored self._pdf_path / self._session_id
        - or optional args from older frontend code
        """
        try:
            if pdf_path:
                self._pdf_path = Path(pdf_path)

            if session_id:
                self._session_id = str(session_id).strip().replace(" ", "_")

            if not self._pdf_path:
                return {"ok": False, "error": "No PDF loaded"}

            if not self._session_id:
                return {"ok": False, "error": "No session ID"}

            result = run_full_pipeline(
                pdf_path=self._pdf_path,
                session_id=self._session_id,
            )

            if result.get("ok"):
                self._export.set_pdf(self._pdf_path)

            return result

        except Exception as e:
            return {
                "ok": False,
                "error": str(e),
                "trace": traceback.format_exc(),
            }

    # =========================================================================
    # PAGE RENDERING
    # =========================================================================

    def get_page_image(self, page_number, dpi=150):
        try:
            return self._export.render_page_base64(int(page_number), int(dpi))
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def get_page_count(self):
        try:
            return {"ok": True, "count": self._export.get_page_count()}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    # =========================================================================
    # ANNOTATIONS
    # =========================================================================

    def get_annotations(self):
        try:
            records = annotation_bridge.get_annotations(self._session_id)
            return {"ok": True, "records": records}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def get_page_annotations(self, page_number):
        try:
            records = annotation_bridge.get_page_annotations(
                self._session_id,
                int(page_number),
            )
            return {"ok": True, "records": records}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def get_annotation(self, annotation_id):
        try:
            rec = annotation_bridge.get_annotation(self._session_id, annotation_id)
            if rec:
                return {"ok": True, "record": rec}
            return {"ok": False, "error": "Not found"}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def get_suggestions(self, annotation_id):
        try:
            suggestions = annotation_bridge.get_suggestions(
                self._session_id,
                annotation_id,
            )
            return {"ok": True, "suggestions": suggestions}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def update_annotation(
        self,
        annotation_id,
        status,
        sdtm_dataset="",
        sdtm_variable="",
        sdtm_label="",
    ):
        """
        Generic annotation update method for frontend compatibility.
        """
        try:
            return annotation_bridge.update_annotation(
                self._session_id,
                annotation_id,
                status=status,
                sdtm_dataset=(sdtm_dataset or "").strip().upper(),
                sdtm_variable=(sdtm_variable or "").strip().upper(),
                sdtm_label=(sdtm_label or "").strip(),
            )
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def confirm_mapping(self, annotation_id, dataset, variable, label=""):
        try:
            return self.update_annotation(
                annotation_id=annotation_id,
                status="USER_CORRECTED",
                sdtm_dataset=dataset,
                sdtm_variable=variable,
                sdtm_label=label,
            )
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def mark_not_submitted(self, annotation_id):
        try:
            return self.update_annotation(
                annotation_id=annotation_id,
                status="NOT_SUBMITTED",
                sdtm_dataset="",
                sdtm_variable="",
                sdtm_label="Not Submitted",
            )
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def clear_mapping(self, annotation_id):
        try:
            return self.update_annotation(
                annotation_id=annotation_id,
                status="UNMAPPED",
                sdtm_dataset="",
                sdtm_variable="",
                sdtm_label="",
            )
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def remove_annotation(self, annotation_id):
        try:
            return self.update_annotation(
                annotation_id=annotation_id,
                status="REMOVED",
                sdtm_dataset="",
                sdtm_variable="",
                sdtm_label="",
            )
        except Exception as e:
            return {"ok": False, "error": str(e)}

    # =========================================================================
    # STATS
    # =========================================================================

    def get_stats(self):
        try:
            stats = annotation_bridge.get_stats(self._session_id)
            return {"ok": True, **stats}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    # =========================================================================
    # EXPORT
    # =========================================================================

    def export_pdf(self):
        try:
            if not self._pdf_path:
                return {"ok": False, "error": "No PDF loaded"}

            if not self._session_id:
                return {"ok": False, "error": "No session ID"}

            suggested_name = f"{self._session_id}.pdf"

            save_result = self._window.create_file_dialog(
                webview.SAVE_DIALOG,
                save_filename=suggested_name,
                file_types=("PDF Files (*.pdf)",),
            )

            if not save_result:
                return {"ok": False, "error": "Export cancelled"}

            if isinstance(save_result, (list, tuple)):
                out_path = Path(save_result[0])
            else:
                out_path = Path(save_result)

            if out_path.suffix.lower() != ".pdf":
                out_path = out_path.with_suffix(".pdf")

            export_result = self._export.export_annotated_pdf(
                pdf_path=self._pdf_path,
                session_id=self._session_id,
                annotations=None,
            )

            if not export_result.get("ok"):
                return export_result

            generated_path = Path(export_result["path"])
            if not generated_path.exists():
                return {"ok": False, "error": "Generated annotated PDF not found"}

            out_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(generated_path, out_path)

            return {
                "ok": True,
                "path": str(out_path),
            }

        except Exception as e:
            return {"ok": False, "error": str(e)}

    # =========================================================================
    # COLOUR
    # =========================================================================

    def get_dataset_colours(self):
        try:
            colours = annotation_bridge.get_dataset_colours(self._session_id)
            return {"ok": True, "colours": colours}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def set_dataset_colour(self, dataset, colour_key):
        try:
            records = annotation_bridge.get_annotations(self._session_id)

            form_code = ""
            dataset_upper = (dataset or "").strip().upper()

            for rec in records:
                if (rec.get("sdtm_dataset") or "").strip().upper() == dataset_upper:
                    form_code = rec.get("form_code", "")
                    break

            result = annotation_bridge.update_dataset_colour(
                self._session_id,
                form_code,
                dataset_upper,
                colour_key,
            )
            return result

        except Exception as e:
            return {"ok": False, "error": str(e)}