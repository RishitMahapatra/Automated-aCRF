"""
api.py
======
Bridge between JS frontend and Python backend.
Every public method is callable from JS via window.pywebview.api.method_name()
"""

from __future__ import annotations

import shutil
import traceback
import uuid
from pathlib import Path

import webview

from config import ROOT_DIR, OUTPUTS_DIR, EXCEL_PATH, get_session_output_dir
from bridge.pipeline_bridge import PipelineBridge, run_full_pipeline
from bridge import annotation_bridge
from bridge import editor_state_bridge
from bridge import session_bridge
from bridge.export_bridge import ExportBridge


class Api:
    """Exposed to JS as window.pywebview.api"""

    def __init__(self):
        self._window = None
        self._pdf_path: Path | None = None
        self._session_id: str = ""
        self._acrf_path: Path | None = None
        self._pipeline = PipelineBridge()
        self._export = ExportBridge()

    # ==========================================================================
    # FILE UPLOAD
    # ==========================================================================

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

    # ==========================================================================
    # SESSION
    # ==========================================================================

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
            self._acrf_path = None
            self._export = ExportBridge()
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    # ==========================================================================
    # PIPELINE
    # ==========================================================================

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

    # ==========================================================================
    # PAGE RENDERING
    # ==========================================================================

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

    # ==========================================================================
    # ANNOTATIONS
    # ==========================================================================

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

    def get_annotation(self, annotation_id):
        try:
            rec = annotation_bridge.get_annotation(self._session_id, str(annotation_id or "").strip())
            if rec is None:
                return {"ok": False, "error": "Not found"}
            return {"ok": True, "record": rec}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def update_comment(self, annotation_id, comment=""):
        try:
            return annotation_bridge.update_comment(
                self._session_id,
                annotation_id,
                comment=str(comment or "").strip(),
            )
        except Exception as e:
            return {"ok": False, "error": str(e)}

    # ==========================================================================
    # EDITOR STATE SNAPSHOT
    # ==========================================================================

    def save_editor_state(self, state):
        try:
            if not self._session_id:
                return {"ok": False, "error": "No session ID"}

            return editor_state_bridge.save_editor_state(
                self._session_id,
                state or {},
            )
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def load_editor_state(self):
        try:
            if not self._session_id:
                return {"ok": False, "error": "No session ID"}

            return editor_state_bridge.load_editor_state(self._session_id)
        except Exception as e:
            return {"ok": False, "error": str(e)}

    # ==========================================================================
    # STATS
    # ==========================================================================

    def get_stats(self):
        try:
            stats = annotation_bridge.get_stats(self._session_id)
            return {"ok": True, **stats}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    # ==========================================================================
    # EXPORT
    # ==========================================================================

    def export_pdf(self):
        """
        Existing export path. Kept for backward compatibility.
        """
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

    def export_pdf_from_images(self, page_images):
        """
        New screenshot-style export path.
        Frontend sends one rendered page image per PDF page.
        """
        try:
            if not self._session_id:
                return {"ok": False, "error": "No session ID"}

            if not page_images or not isinstance(page_images, list):
                return {"ok": False, "error": "No page images provided"}

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

            temp_out = (
                get_session_output_dir(self._session_id)
                / f"{self._session_id}_screenshot_export.pdf"
            )

            result = self._export.export_from_page_images(page_images, temp_out)
            if not result.get("ok"):
                return result

            if not temp_out.exists():
                return {"ok": False, "error": "Temporary export PDF not created"}

            out_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(temp_out, out_path)

            return {"ok": True, "path": str(out_path)}

        except Exception as e:
            return {"ok": False, "error": str(e)}

    # ==========================================================================
    # COLOUR
    # ==========================================================================

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

    # ==========================================================================
    # SESSION FILE (.acrf) — Save / Open / Save As
    # ==========================================================================

    def save_session_file(self, editor_state=None, frontend_annotations=None):
        """
        Save to the current .acrf path (or prompt Save As if no path yet).
        frontend_annotations: list of annotation records from the JS Store,
        including user-created ones that only exist in the frontend.
        """
        try:
            if not self._pdf_path:
                return {"ok": False, "error": "No PDF loaded"}
            if not self._session_id:
                return {"ok": False, "error": "No session ID"}

            self._merge_frontend_annotations(frontend_annotations)

            if not self._acrf_path:
                return self.save_session_file_as(editor_state, frontend_annotations)

            result = session_bridge.save_session(
                save_path=self._acrf_path,
                session_id=self._session_id,
                pdf_path=self._pdf_path,
                editor_state=editor_state,
            )
            return result

        except Exception as e:
            return {"ok": False, "error": str(e)}

    def save_session_file_as(self, editor_state=None, frontend_annotations=None):
        """
        Prompt for location and save the .acrf session file.
        """
        try:
            if not self._pdf_path:
                return {"ok": False, "error": "No PDF loaded"}
            if not self._session_id:
                return {"ok": False, "error": "No session ID"}

            self._merge_frontend_annotations(frontend_annotations)

            suggested_name = f"{self._session_id}.acrf"

            save_result = self._window.create_file_dialog(
                webview.SAVE_DIALOG,
                save_filename=suggested_name,
                file_types=("aCRF Session (*.acrf)",),
            )

            if not save_result:
                return {"ok": False, "error": "Save cancelled"}

            if isinstance(save_result, (list, tuple)):
                out_path = Path(save_result[0])
            else:
                out_path = Path(save_result)

            if out_path.suffix.lower() != ".acrf":
                out_path = out_path.with_suffix(".acrf")

            result = session_bridge.save_session(
                save_path=out_path,
                session_id=self._session_id,
                pdf_path=self._pdf_path,
                editor_state=editor_state,
            )

            if result.get("ok"):
                self._acrf_path = out_path

            return result

        except Exception as e:
            return {"ok": False, "error": str(e)}

    def _merge_frontend_annotations(self, frontend_annotations):
        """
        Merge frontend-only annotations (user-drawn, with user_ or
        userdschip_ prefixed IDs) into the backend annotation_data.json
        so they survive save/restore.
        """
        if not frontend_annotations or not isinstance(frontend_annotations, list):
            return
        if not self._session_id:
            return

        from config import get_annotation_json_path
        import json

        json_path = get_annotation_json_path(self._session_id)

        existing = []
        if json_path.exists():
            try:
                existing = json.loads(json_path.read_text(encoding="utf-8"))
                if not isinstance(existing, list):
                    existing = []
            except Exception:
                existing = []

        existing_ids = {
            str(r.get("annotation_id", "")) for r in existing if r
        }

        added = 0
        for rec in frontend_annotations:
            if not rec or not isinstance(rec, dict):
                continue
            ann_id = str(rec.get("annotation_id", ""))
            if not ann_id:
                continue

            if ann_id in existing_ids:
                for i, ex in enumerate(existing):
                    if str(ex.get("annotation_id", "")) == ann_id:
                        # Never overwrite comment — it's always authoritative in
                        # annotation_data.json (saved directly via update_comment)
                        rec_for_merge = {k: v for k, v in rec.items() if k != "comment"}
                        existing[i] = {**ex, **rec_for_merge}
                        break
            else:
                existing.append(rec)
                existing_ids.add(ann_id)
                added += 1

        json_path.parent.mkdir(parents=True, exist_ok=True)
        json_path.write_text(
            json.dumps(existing, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

    def open_session_file(self):
        """
        Open file picker for .acrf files and load the session.
        """
        try:
            result = self._window.create_file_dialog(
                webview.OPEN_DIALOG,
                allow_multiple=False,
                file_types=("aCRF Session (*.acrf)",),
            )

            if not result or len(result) == 0:
                return {"ok": False, "error": "No file selected"}

            acrf_path = Path(result[0])
            load_result = session_bridge.open_session(acrf_path)

            if not load_result.get("ok"):
                return load_result

            self._session_id = load_result["session_id"]
            self._pdf_path = Path(load_result["pdf_path"])
            self._acrf_path = acrf_path
            self._export.set_pdf(self._pdf_path)

            return load_result

        except Exception as e:
            return {"ok": False, "error": str(e)}

    def get_recent_sessions(self):
        """
        Return the 10 most recently opened .acrf sessions.
        """
        try:
            sessions = session_bridge.get_recent_sessions(limit=10)
            return {"ok": True, "sessions": sessions}
        except Exception as e:
            return {"ok": False, "error": str(e)}