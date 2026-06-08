"""
bridge/export_bridge.py
========================
PDF page rendering + export helpers for the PyWebView app.
"""

from __future__ import annotations

import base64
import io
from pathlib import Path

import fitz
from PIL import Image


class ExportBridge:
    def __init__(self):
        self._pdf_path: Path | None = None
        self._page_count: int = 0

    # =========================================================================
    # PDF STATE
    # =========================================================================

    def set_pdf(self, pdf_path: str | Path) -> dict:
        """
        Register the current PDF and cache its page count.
        """
        try:
            pdf_path = Path(pdf_path)

            if not pdf_path.exists():
                return {"ok": False, "error": f"PDF not found: {pdf_path}"}

            if pdf_path.suffix.lower() != ".pdf":
                return {"ok": False, "error": "Selected file is not a PDF"}

            with fitz.open(str(pdf_path)) as doc:
                self._page_count = len(doc)

            self._pdf_path = pdf_path

            return {
                "ok": True,
                "pdf_path": str(self._pdf_path),
                "page_count": self._page_count,
            }

        except Exception as e:
            self._pdf_path = None
            self._page_count = 0
            return {"ok": False, "error": str(e)}

    def get_page_count(self) -> int:
        return self._page_count

    # =========================================================================
    # PAGE RENDERING
    # =========================================================================

    def render_page_base64(self, page_number: int, dpi: int = 150) -> dict:
        """
        Render a PDF page as a PNG data URL for the frontend canvas.
        """
        try:
            if not self._pdf_path:
                return {"ok": False, "error": "No PDF loaded"}

            if not self._pdf_path.exists():
                return {"ok": False, "error": f"PDF not found: {self._pdf_path}"}

            page_idx = int(page_number) - 1
            if page_idx < 0 or page_idx >= self._page_count:
                return {"ok": False, "error": f"Invalid page {page_number}"}

            dpi = int(dpi) if dpi else 150
            zoom = dpi / 72.0

            with fitz.open(str(self._pdf_path)) as doc:
                page = doc[page_idx]

                page_width_pts = float(page.rect.width)
                page_height_pts = float(page.rect.height)

                matrix = fitz.Matrix(zoom, zoom)
                pix = page.get_pixmap(matrix=matrix, alpha=False)

                img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)

            buffer = io.BytesIO()
            img.save(buffer, format="PNG", optimize=True)
            b64 = base64.b64encode(buffer.getvalue()).decode("ascii")

            return {
                "ok": True,
                "image": f"data:image/png;base64,{b64}",
                "width": pix.width,
                "height": pix.height,
                "page_width_pts": page_width_pts,
                "page_height_pts": page_height_pts,
                "dpi": dpi,
            }

        except Exception as e:
            return {"ok": False, "error": str(e)}

    # =========================================================================
    # EXPORT
    # =========================================================================

    def export_annotated_pdf(self, pdf_path: str | Path, session_id: str, annotations=None) -> dict:
        """
        Export the final annotated PDF using the current saved annotation JSON.
        This regenerates the annotated PDF from the latest current state so the
        exported file preserves the latest mapping changes, measurements, and padding.
        """
        try:
            from pipeline.crf_annotator import run_annotator

            pdf_path = Path(pdf_path)

            if not pdf_path.exists():
                return {"ok": False, "error": f"PDF not found: {pdf_path}"}

            out_path = run_annotator(
                pdf_path=pdf_path,
                session_id=session_id,
            )

            return {"ok": True, "path": str(out_path)}

        except Exception as e:
            return {"ok": False, "error": str(e)}