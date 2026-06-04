"""
editor/coordinate_mapper.py
============================
Module 3 — Coordinate Mapper

Handles all translation between PDF point space and canvas pixel space.
This is the single place where coordinate math lives — no other module
does raw multiplication or division for coordinate conversion.

PDF point space  : origin top-left, units are PDF points (1pt = 1/72 inch)
Canvas pixel space: origin top-left, units are screen pixels

The scale factors are computed once per page load from:
  - page dimensions in PDF points  (from pdf_renderer.py)
  - rendered image dimensions in px (from pdf_renderer.py)

Zoom support: if the user zooms the canvas, only this module
needs to change — all other modules call into here.

Dependencies: editor/pdf_renderer.py (for scale factor inputs)
No fitz dependency — works purely with numbers.
"""

from __future__ import annotations
from dataclasses import dataclass


# =============================================================================
# COORDINATE MAPPER
# =============================================================================

@dataclass
class CoordinateMapper:
    """
    Encapsulates all coordinate translation logic for one page.

    Attributes
    ----------
    page_width_pts   : PDF page width in points
    page_height_pts  : PDF page height in points
    canvas_width_px  : rendered canvas width in pixels
    canvas_height_px : rendered canvas height in pixels
    zoom             : zoom multiplier (1.0 = no zoom)
    """

    page_width_pts:   float
    page_height_pts:  float
    canvas_width_px:  float
    canvas_height_px: float
    zoom:             float = 1.0

    # ── Derived scale factors ─────────────────────────────────────────────

    @property
    def scale_x(self) -> float:
        """PDF points → canvas pixels, horizontal."""
        return (self.canvas_width_px / self.page_width_pts) * self.zoom

    @property
    def scale_y(self) -> float:
        """PDF points → canvas pixels, vertical."""
        return (self.canvas_height_px / self.page_height_pts) * self.zoom

    # =========================================================================
    # PDF POINT SPACE → CANVAS PIXEL SPACE
    # =========================================================================

    def pdf_to_canvas(
        self,
        x0: float, y0: float,
        x1: float, y1: float,
    ) -> tuple[float, float, float, float]:
        """
        Convert a rectangle from PDF point space to canvas pixel space.

        Parameters
        ----------
        x0, y0 : top-left corner in PDF points
        x1, y1 : bottom-right corner in PDF points

        Returns
        -------
        (cx0, cy0, cx1, cy1) in canvas pixels
        """
        return (
            x0 * self.scale_x,
            y0 * self.scale_y,
            x1 * self.scale_x,
            y1 * self.scale_y,
        )

    def pdf_point_to_canvas(
        self,
        x: float,
        y: float,
    ) -> tuple[float, float]:
        """
        Convert a single point from PDF space to canvas pixel space.

        Parameters
        ----------
        x, y : coordinates in PDF points

        Returns
        -------
        (cx, cy) in canvas pixels
        """
        return x * self.scale_x, y * self.scale_y

    # =========================================================================
    # CANVAS PIXEL SPACE → PDF POINT SPACE
    # =========================================================================

    def canvas_to_pdf(
        self,
        cx0: float, cy0: float,
        cx1: float, cy1: float,
    ) -> tuple[float, float, float, float]:
        """
        Convert a rectangle from canvas pixel space to PDF point space.

        Parameters
        ----------
        cx0, cy0 : top-left corner in canvas pixels
        cx1, cy1 : bottom-right corner in canvas pixels

        Returns
        -------
        (x0, y0, x1, y1) in PDF points
        """
        return (
            cx0 / self.scale_x,
            cy0 / self.scale_y,
            cx1 / self.scale_x,
            cy1 / self.scale_y,
        )

    def canvas_point_to_pdf(
        self,
        cx: float,
        cy: float,
    ) -> tuple[float, float]:
        """
        Convert a single point from canvas pixel space to PDF point space.
        Used for hit detection — mouse click (cx, cy) → PDF coords.

        Parameters
        ----------
        cx, cy : coordinates in canvas pixels

        Returns
        -------
        (x, y) in PDF points
        """
        return cx / self.scale_x, cy / self.scale_y

    # =========================================================================
    # HIT DETECTION
    # =========================================================================

    def is_point_in_rect_canvas(
        self,
        cx: float, cy: float,
        rect_cx0: float, rect_cy0: float,
        rect_cx1: float, rect_cy1: float,
        tolerance: float = 4.0,
    ) -> bool:
        """
        Check if a canvas pixel point falls within a canvas rectangle.
        Tolerance adds a small hit buffer around the rect edges
        to make clicking easier.

        Parameters
        ----------
        cx, cy           : click point in canvas pixels
        rect_cx0/cy0/cx1/cy1 : rectangle bounds in canvas pixels
        tolerance        : extra pixels around rect edges

        Returns
        -------
        bool
        """
        return (
            (rect_cx0 - tolerance) <= cx <= (rect_cx1 + tolerance)
            and
            (rect_cy0 - tolerance) <= cy <= (rect_cy1 + tolerance)
        )

    def is_point_in_rect_pdf(
        self,
        x: float, y: float,
        rect_x0: float, rect_y0: float,
        rect_x1: float, rect_y1: float,
        tolerance_pts: float = 3.0,
    ) -> bool:
        """
        Check if a PDF point falls within a PDF rectangle.

        Parameters
        ----------
        x, y                   : point in PDF points
        rect_x0/y0/x1/y1       : rectangle in PDF points
        tolerance_pts          : tolerance in PDF points

        Returns
        -------
        bool
        """
        return (
            (rect_x0 - tolerance_pts) <= x <= (rect_x1 + tolerance_pts)
            and
            (rect_y0 - tolerance_pts) <= y <= (rect_y1 + tolerance_pts)
        )

    # =========================================================================
    # ZOOM
    # =========================================================================

    def set_zoom(self, zoom: float) -> None:
        """
        Update the zoom level.
        All subsequent coordinate conversions use the new zoom.

        Parameters
        ----------
        zoom : float — 1.0 is 100%, 2.0 is 200% etc.
        """
        self.zoom = max(0.1, min(zoom, 5.0))

    def zoom_in(self, step: float = 0.25) -> float:
        """Increase zoom by step. Returns new zoom level."""
        self.set_zoom(self.zoom + step)
        return self.zoom

    def zoom_out(self, step: float = 0.25) -> float:
        """Decrease zoom by step. Returns new zoom level."""
        self.set_zoom(self.zoom - step)
        return self.zoom

    # =========================================================================
    # ANNOTATION BOX PLACEMENT
    # =========================================================================

    def get_annotation_box_canvas(
    self,
    y0_pts: float,
    y1_pts: float,
    page_width_pts: float,
    text_width_pts: float = 60.0,
) -> tuple[float, float, float, float]:
        """
        Compute canvas pixel coordinates for an annotation box.
        Mirrors crf_annotator.py draw_variable_box logic exactly:
        - Horizontally centred on the page centre line
        - Sized to fit text width only
        - Vertically centred within the component y-band

        Parameters
        ----------
        y0_pts         : component top y in PDF points
        y1_pts         : component bottom y in PDF points
        page_width_pts : full page width in PDF points
        text_width_pts : estimated text width in PDF points

        Returns
        -------
        (cx0, cy0, cx1, cy1) in canvas pixels
        """
        CHIP_PAD_X    = 4.0
        CHIP_PAD_Y    = 2.0
        VAR_FONT_SIZE = 7.0

        box_w   = text_width_pts + CHIP_PAD_X * 2
        box_h   = VAR_FONT_SIZE  + CHIP_PAD_Y * 2

        # Centre of component band — vertical
        comp_cy = (y0_pts + y1_pts) / 2.0

        # Mirror crf_annotator exactly:
        # x centred on page_w / 2.0
        centre_x = page_width_pts / 2.0
        pdf_x0   = max(centre_x - box_w / 2.0, 4.0)
        pdf_x1   = min(centre_x + box_w / 2.0, page_width_pts - 4.0)

        # Vertically centred in component band
        pdf_y0   = max(comp_cy - box_h / 2.0, y0_pts + 1.0)
        pdf_y1   = min(comp_cy + box_h / 2.0, y1_pts - 1.0)

        return self.pdf_to_canvas(pdf_x0, pdf_y0, pdf_x1, pdf_y1)