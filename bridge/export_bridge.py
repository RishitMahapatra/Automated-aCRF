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
        self._doc: fitz.Document | None = None

    def set_pdf(self, pdf_path: Path):
        if self._doc:
            try:
                self._doc.close()
            except Exception:
                pass
            self._doc = None

        self._pdf_path = Path(pdf_path)
        try:
            self._doc = fitz.open(self._pdf_path)
            self._page_count = len(self._doc)
        except Exception:
            self._doc = None
            self._page_count = 0

    def get_page_count(self):
        return self._page_count

    def render_page_base64(self, page_number: int, dpi: int = 150):
        try:
            if not self._pdf_path or not self._doc:
                return {"ok": False, "error": "No PDF loaded"}

            if page_number < 1 or page_number > self._page_count:
                return {"ok": False, "error": "Invalid page number"}

            page = self._doc[page_number - 1]
            scale = dpi / 72.0
            matrix = fitz.Matrix(scale, scale)
            pix = page.get_pixmap(matrix=matrix, alpha=False)

            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            b64 = base64.b64encode(buf.getvalue()).decode("utf-8")

            rect = page.rect
            return {
                "ok": True,
                "page_number": page_number,
                "image": f"data:image/png;base64,{b64}",
                "page_width_pts": rect.width,
                "page_height_pts": rect.height,
                "width": pix.width,
                "height": pix.height,
            }

        except Exception as e:
            return {"ok": False, "error": str(e)}

    def export_from_page_images(self, page_images: list, out_path: str | Path):
        """
        Build a PDF from page data.

        Each entry in page_images may be:
          - A dict {"image": <data-url or base64>, "widthPts": float, "heightPts": float}
          - A plain string (data-url or base64) — legacy format, pixel dims used as fallback

        When widthPts/heightPts are provided they are used as the PDF page size so the
        output matches the original document dimensions. The high-res screenshot is then
        fitted into that page, yielding ~600 DPI quality with correct physical dimensions.
        """
        doc = fitz.open()
        try:
            for item in page_images:
                if not item:
                    continue

                if isinstance(item, dict):
                    raw = item.get("image") or item.get("data") or ""
                    width_pts = float(item.get("widthPts") or 0)
                    height_pts = float(item.get("heightPts") or 0)
                else:
                    raw = str(item)
                    width_pts = 0.0
                    height_pts = 0.0

                data = str(raw)
                if data.startswith("data:image"):
                    b64 = data.split(",", 1)[1]
                else:
                    b64 = data

                img_bytes = base64.b64decode(b64)
                pil_img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
                img_w_px, img_h_px = pil_img.size

                if width_pts > 0 and height_pts > 0:
                    page_width = width_pts
                    page_height = height_pts
                else:
                    # Fallback: preserve aspect ratio at a sensible letter-size width
                    page_width = 612.0
                    page_height = 612.0 * img_h_px / img_w_px if img_w_px else 792.0

                page = doc.new_page(width=page_width, height=page_height)
                page.insert_image(
                    fitz.Rect(0, 0, page_width, page_height),
                    stream=img_bytes,
                )

            out_path = Path(out_path)
            out_path.parent.mkdir(parents=True, exist_ok=True)
            doc.save(out_path, garbage=4, deflate=True)

            return {"ok": True, "path": str(out_path)}

        except Exception as e:
            return {"ok": False, "error": str(e)}

        finally:
            try:
                doc.close()
            except Exception:
                pass