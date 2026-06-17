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

    def set_pdf(self, pdf_path: Path):
        self._pdf_path = Path(pdf_path)
        try:
            with fitz.open(self._pdf_path) as doc:
                self._page_count = len(doc)
        except Exception:
            self._page_count = 0

    def get_page_count(self):
        return self._page_count

    def render_page_base64(self, page_number: int, dpi: int = 150):
        try:
            if not self._pdf_path:
                return {"ok": False, "error": "No PDF loaded"}

            with fitz.open(self._pdf_path) as doc:
                if page_number < 1 or page_number > len(doc):
                    return {"ok": False, "error": "Invalid page number"}

                page = doc[page_number - 1]
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

    def export_from_page_images(self, page_images: list[str], out_path: str | Path):
        """
        Build a PDF from a list of PNG data URLs or raw base64 PNG strings.
        Each image becomes one full PDF page.
        """
        doc = fitz.open()
        try:
            for item in page_images:
                if not item:
                    continue

                data = str(item)
                if data.startswith("data:image"):
                    b64 = data.split(",", 1)[1]
                else:
                    b64 = data

                img_bytes = base64.b64decode(b64)
                pil_img = Image.open(io.BytesIO(img_bytes)).convert("RGB")

                width_px, height_px = pil_img.size

                # 72 dpi logical page size from pixel dimensions
                page_width = float(width_px)
                page_height = float(height_px)

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