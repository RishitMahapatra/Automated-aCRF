"""
editor/pdf_renderer.py
======================
Module 1 — PDF Page Renderer

Responsible for rendering a single PDF page into a PIL Image
and a Tkinter-compatible PhotoImage. This is the only module
in the editor package that directly interfaces with PyMuPDF's
pixmap rendering pipeline.

Also exposes get_scale_factor() which computes the pixel-to-PDF-point
ratio used by coordinate_mapper.py for all coordinate translations.

Dependencies: PyMuPDF (fitz), Pillow (PIL)
No dependency on any other editor module.
"""

import fitz
from PIL import Image, ImageTk
from pathlib import Path


def render_page_to_pil(
    pdf_path: str | Path,
    page_index: int,
    dpi: int = 150,
) -> tuple[Image.Image, fitz.Page, float, float]:
    """
    Render a single PDF page to a PIL Image.

    Parameters
    ----------
    pdf_path   : path to the PDF file
    page_index : zero-based page index
    dpi        : render resolution (default 150 for screen display)

    Returns
    -------
    (pil_image, page, page_width_pts, page_height_pts)

    pil_image       : rendered PIL.Image in RGB mode
    page_width_pts  : original page width in PDF points
    page_height_pts : original page height in PDF points
    """
    doc  = fitz.open(str(pdf_path))
    page = doc[page_index]

    page_width_pts  = page.rect.width
    page_height_pts = page.rect.height

    zoom   = dpi / 72.0
    matrix = fitz.Matrix(zoom, zoom)
    pix    = page.get_pixmap(matrix=matrix, alpha=False)

    img = Image.frombytes(
        "RGB",
        [pix.width, pix.height],
        pix.samples,
    )

    doc.close()
    return img, page_width_pts, page_height_pts


def render_page_to_photoimage(
    pdf_path: str | Path,
    page_index: int,
    dpi: int = 150,
) -> tuple[ImageTk.PhotoImage, float, float]:
    """
    Render a single PDF page to a Tkinter PhotoImage.
    Used directly by the Tkinter canvas in pdf_editor_tab.py.

    Parameters
    ----------
    pdf_path   : path to the PDF file
    page_index : zero-based page index
    dpi        : render resolution

    Returns
    -------
    (photo_image, page_width_pts, page_height_pts)
    """
    img, pw, ph = render_page_to_pil(pdf_path, page_index, dpi)
    return ImageTk.PhotoImage(img), pw, ph


def get_page_count(pdf_path: str | Path) -> int:
    """
    Return the total number of pages in the PDF.

    Parameters
    ----------
    pdf_path : path to the PDF file

    Returns
    -------
    int — total page count
    """
    doc   = fitz.open(str(pdf_path))
    count = len(doc)
    doc.close()
    return count


def get_scale_factor(
    page_width_pts: float,
    page_height_pts: float,
    rendered_img: Image.Image,
) -> tuple[float, float]:
    """
    Compute scale factors from PDF point space to pixel space.
    Used by coordinate_mapper.py for all coordinate translations.

    Parameters
    ----------
    page_width_pts  : PDF page width in points
    page_height_pts : PDF page height in points
    rendered_img    : the PIL Image returned by render_page_to_pil

    Returns
    -------
    (scale_x, scale_y) — multiply PDF coords by these to get pixel coords
    """
    scale_x = rendered_img.width  / page_width_pts
    scale_y = rendered_img.height / page_height_pts
    return scale_x, scale_y