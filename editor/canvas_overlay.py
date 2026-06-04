"""
editor/canvas_overlay.py
=========================
Module 5 — Canvas Overlay

Renders annotation boxes onto a PIL Image of a PDF page.
Uses Wong (2011) colour-blind safe 8-colour palette.

Statuses and their visual treatment:
  RESOLVED       — dataset colour bg, blue border, blue text
  USER_CORRECTED — dataset colour bg, cyan border, blue text
  UNMAPPED       — white bg, red dashed border, red text
  NOT_SUBMITTED  — grey bg, black border, black text
  REMOVED        — hidden entirely, no box drawn

Page type rules:
  FORM  — annotations drawn normally
  TABLE — no annotations drawn (reference pages only)

Dependencies:
  editor/coordinate_mapper.py
  editor/annotation_store.py
  Pillow (PIL)
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional
from PIL import Image, ImageDraw, ImageFont

from editor.annotation_store  import AnnotationRecord, AnnotationStore
from editor.coordinate_mapper import CoordinateMapper


# =============================================================================
# WONG (2011) COLOUR-BLIND SAFE PALETTE
# =============================================================================

WONG_PALETTE: list[tuple[int, int, int]] = [
    (245, 200,  66),   # 1 — Yellow
    ( 86, 180, 233),   # 2 — Sky Blue
    (  0, 158, 115),   # 3 — Bluish Green
    (213,  94,   0),   # 4 — Vermillion
    (  0, 114, 178),   # 5 — Blue
    (230, 159,   0),   # 6 — Orange
    (204, 121, 167),   # 7 — Reddish Purple
    (180, 180, 180),   # 8 — Light Grey
]

# Fixed colours
BLACK              = (  0,   0,   0)
WHITE              = (255, 255, 255)
COL_BLUE           = (  0,   0, 255)
RED_DASHED         = (204,   0,   0)
CYAN_BORDER        = (  0, 180, 216)

# Not Submitted
NOT_SUBMITTED_BG     = (180, 180, 180)
NOT_SUBMITTED_BORDER = (  0,   0,   0)
NOT_SUBMITTED_TEXT   = (  0,   0,   0)
NOT_SUBMITTED_LABEL  = "Not Submitted"

LABEL_PAD  = 3
LINE_WIDTH = 1


# =============================================================================
# DATASET COLOUR REGISTRY
# =============================================================================

class DatasetColourRegistry:
    """
    Assigns Wong palette slots to SDTM datasets scoped by form_code.

    Rules:
      - Within the same form_code, a dataset always gets
        the same colour
      - A new form_code gets fresh assignments from slot 0
      - Registry is shared for the entire session —
        never rebuilt on rerun
    """

    def __init__(self):
        # {form_code: {dataset: slot_index}}
        self._form_assignments: dict[str, dict[str, int]] = {}

    def get_colour(
        self,
        sdtm_dataset: str,
        form_code:    str = "",
    ) -> tuple[int, int, int]:
        """Return RGB colour for a dataset within a form."""
        ds = sdtm_dataset.strip().upper()
        fc = (
            form_code.strip().upper()
            if form_code else "__GLOBAL__"
        )

        if not ds:
            return WHITE

        if fc not in self._form_assignments:
            self._form_assignments[fc] = {}

        form_scope = self._form_assignments[fc]

        if ds not in form_scope:
            slot           = len(form_scope) % len(WONG_PALETTE)
            form_scope[ds] = slot

        return WONG_PALETTE[form_scope[ds]]

    def get_assignments(
        self, form_code: str = ""
    ) -> dict[str, tuple[int, int, int]]:
        """Return all dataset → colour assignments for a form."""
        fc    = (
            form_code.strip().upper()
            if form_code else "__GLOBAL__"
        )
        scope = self._form_assignments.get(fc, {})
        return {
            ds: WONG_PALETTE[slot]
            for ds, slot in scope.items()
        }

    def get_all_assignments(
        self,
    ) -> dict[str, dict[str, tuple]]:
        """Return all form → dataset → colour assignments."""
        return {
            fc: {
                ds: WONG_PALETTE[slot]
                for ds, slot in scope.items()
            }
            for fc, scope in self._form_assignments.items()
        }

    def reset_form(self, form_code: str) -> None:
        """Reset colour assignments for a specific form."""
        fc = form_code.strip().upper()
        if fc in self._form_assignments:
            del self._form_assignments[fc]

    def reset_all(self) -> None:
        """Reset all assignments — call only on new PDF load."""
        self._form_assignments.clear()


# =============================================================================
# ANNOTATION BOX SPEC
# =============================================================================

@dataclass
class AnnotationBoxSpec:
    """Computed draw spec for one annotation component."""
    annotation_id:  str
    status:         str
    var_box_cx0:    float
    var_box_cy0:    float
    var_box_cx1:    float
    var_box_cy1:    float
    var_label_text: str
    ds_label_text:  str
    bg_colour:      tuple[int, int, int]
    border_colour:  tuple[int, int, int]
    text_colour:    tuple[int, int, int]
    hit_cx0:        float
    hit_cy0:        float
    hit_cx1:        float
    hit_cy1:        float


# =============================================================================
# CANVAS OVERLAY
# =============================================================================

class CanvasOverlay:
    """
    Renders annotation boxes onto a PIL Image of a PDF page.

    Usage (Streamlit)
    -----------------
    overlay = CanvasOverlay(colour_registry)
    annotated_img, unplaced = overlay.render(
        base_img, mapper, store, page_number,
        header_y0_pts, header_y1_pts, form_code
    )

    TABLE pages:
        render() returns the base image unchanged with an
        empty unplaced list — no boxes are ever drawn on
        TABLE pages.

    REMOVED records:
        Skipped entirely — no box drawn, not hit-detectable,
        not counted in unplaced.
    """

    def __init__(
        self,
        colour_registry: DatasetColourRegistry,
        font_size:       int = 11,
    ):
        self._registry  = colour_registry
        self._font_size = font_size
        self._font      = self._load_font(font_size)
        self._font_sm   = self._load_font(
            max(7, font_size - 2)
        )
        self._box_specs: dict[str, AnnotationBoxSpec] = {}

    # ── Font ──────────────────────────────────────────────────────────

    @staticmethod
    def _load_font(size: int) -> ImageFont.FreeTypeFont:
        candidates = [
            "arial.ttf", "Arial.ttf",
            "DejaVuSans.ttf",
            "LiberationSans-Regular.ttf",
        ]
        for name in candidates:
            try:
                return ImageFont.truetype(name, size)
            except (IOError, OSError):
                continue
        return ImageFont.load_default()

    # =========================================================================
    # COMPUTE BOX SPECS
    # =========================================================================

    def compute_box_specs(
        self,
        mapper:      CoordinateMapper,
        store:       AnnotationStore,
        page_number: int,
    ) -> list[AnnotationBoxSpec]:
        """
        Compute draw specs for all visible annotations on a page.

        Skips:
          - TABLE page records  (reference pages, never annotated)
          - REMOVED records     (hidden by user)
          - Unplaced records    (y0 == y1 == 0.0)
        """
        records = store.get_by_page(page_number)
        specs   = []

        for rec in records:

            # ── Skip TABLE page records ───────────────────────────────
            # TABLE pages contain raw variable definitions.
            # They are reference pages only — never annotated.
            if rec.page_type == "TABLE":
                continue

            # ── Skip REMOVED records ──────────────────────────────────
            # User explicitly removed this annotation.
            # No box drawn, not hit-detectable.
            if rec.status == "REMOVED":
                continue

            # ── Skip unplaced records ─────────────────────────────────
            y0_pts = rec.fitz_rect[1]
            y1_pts = rec.fitz_rect[3]
            if y0_pts == 0.0 and y1_pts == 0.0:
                continue

            spec = self._build_spec(rec, mapper)
            if spec:
                specs.append(spec)
                self._box_specs[rec.annotation_id] = spec

        return specs

    def _build_spec(
        self,
        rec:    AnnotationRecord,
        mapper: CoordinateMapper,
    ) -> Optional[AnnotationBoxSpec]:
        """Build AnnotationBoxSpec for one record."""
        y0_pts = rec.fitz_rect[1]
        y1_pts = rec.fitz_rect[3]
        pw     = mapper.page_width_pts

        domain   = (rec.sdtm_dataset  or "").strip().upper()
        variable = (rec.sdtm_variable or "").strip().upper()

        # Label text
        if rec.status == "NOT_SUBMITTED":
            var_label = NOT_SUBMITTED_LABEL
        elif domain and variable:
            var_label = f"{domain}.{variable}"
        else:
            var_label = rec.raw_variable or "UNMAPPED"

        # Dataset label for chips
        ds_full_name = _SDTM_DOMAIN_NAMES.get(domain, domain)
        ds_label     = (
            f"{ds_full_name} ({domain})"
            if ds_full_name != domain and domain
            else domain or "PENDING"
        )

        # Estimate text width
        VAR_FONT_SIZE  = 7.0
        TEXT_BUFFER    = 2.0
        est_text_w_pts = (
            0.55 * VAR_FONT_SIZE * len(var_label)
            + TEXT_BUFFER
        )

        cx0, cy0, cx1, cy1 = mapper.get_annotation_box_canvas(
            y0_pts, y1_pts, pw,
            text_width_pts = est_text_w_pts,
        )

        if cx1 - cx0 < 2 or cy1 - cy0 < 1:
            return None

        # Colours by status
        if rec.status == "NOT_SUBMITTED":
            bg_col     = NOT_SUBMITTED_BG
            border_col = NOT_SUBMITTED_BORDER
            text_col   = NOT_SUBMITTED_TEXT
        elif rec.status == "UNMAPPED":
            bg_col     = WHITE
            border_col = RED_DASHED
            text_col   = RED_DASHED
        else:
            bg_col     = self._registry.get_colour(
                domain, rec.form_code
            )
            border_col = (
                CYAN_BORDER
                if rec.status == "USER_CORRECTED"
                else COL_BLUE
            )
            text_col = COL_BLUE

        return AnnotationBoxSpec(
            annotation_id  = rec.annotation_id,
            status         = rec.status,
            var_box_cx0    = cx0,
            var_box_cy0    = cy0,
            var_box_cx1    = cx1,
            var_box_cy1    = cy1,
            var_label_text = var_label,
            ds_label_text  = ds_label,
            bg_colour      = bg_col,
            border_colour  = border_col,
            text_colour    = text_col,
            hit_cx0        = cx0,
            hit_cy0        = cy0,
            hit_cx1        = cx1,
            hit_cy1        = cy1,
        )

    # =========================================================================
    # DRAW BOXES
    # =========================================================================

    def draw_boxes(
        self,
        img:   Image.Image,
        specs: list[AnnotationBoxSpec],
    ) -> Image.Image:
        """Draw all annotation boxes onto a copy of the image."""
        out  = img.copy()
        draw = ImageDraw.Draw(out)
        for spec in specs:
            self._draw_single_box(draw, spec)
        return out

    def _draw_single_box(
        self,
        draw: ImageDraw.ImageDraw,
        spec: AnnotationBoxSpec,
    ) -> None:
        """Draw one compact variable box in the component band."""
        is_unmapped      = spec.status == "UNMAPPED"
        is_corrected     = spec.status == "USER_CORRECTED"
        is_not_submitted = spec.status == "NOT_SUBMITTED"

        rect = [
            spec.var_box_cx0, spec.var_box_cy0,
            spec.var_box_cx1, spec.var_box_cy1,
        ]

        # Background
        draw.rectangle(
            rect, fill=spec.bg_colour, outline=None
        )

        # Border
        if is_unmapped:
            self._draw_dashed_rect(
                draw, rect, RED_DASHED, LINE_WIDTH
            )
        elif is_not_submitted:
            draw.rectangle(
                rect,
                fill    = None,
                outline = NOT_SUBMITTED_BORDER,
                width   = LINE_WIDTH,
            )
        else:
            draw.rectangle(
                rect,
                fill    = None,
                outline = (
                    CYAN_BORDER if is_corrected
                    else COL_BLUE
                ),
                width   = LINE_WIDTH,
            )

        # Text
        self._draw_label(
            draw,
            spec.var_label_text,
            spec.var_box_cx0 + LABEL_PAD,
            spec.var_box_cy0 + LABEL_PAD,
            spec.var_box_cx1 - LABEL_PAD,
            spec.var_box_cy1 - LABEL_PAD,
            colour = spec.text_colour,
            font   = self._font,
        )

    # =========================================================================
    # HEADER CHIPS
    # =========================================================================

    def draw_header_chips(
        self,
        img:           Image.Image,
        mapper:        CoordinateMapper,
        store:         AnnotationStore,
        page_number:   int,
        header_y0_pts: float,
        header_y1_pts: float,
        form_code:     str = "",
    ) -> Image.Image:
        """
        Draw dataset chips in the header zone.

        Only draws chips for datasets that appear on FORM
        records on this page. TABLE records and REMOVED
        records are excluded from chip generation.
        """
        records = store.get_by_page(page_number)

        seen     = []
        seen_set = set()
        for rec in records:
            # Only count FORM records that are not REMOVED
            if rec.page_type == "TABLE":
                continue
            if rec.status == "REMOVED":
                continue
            ds = (rec.sdtm_dataset or "").strip().upper()
            if ds and ds not in seen_set:
                seen.append(ds)
                seen_set.add(ds)

        if not seen:
            return img

        out  = img.copy()
        draw = ImageDraw.Draw(out)
        pw   = mapper.page_width_pts

        _, chip_y0_px      = mapper.pdf_point_to_canvas(
            0, header_y0_pts
        )
        _, chip_y1_px      = mapper.pdf_point_to_canvas(
            0, header_y1_pts
        )
        chip_start_x_px, _ = mapper.pdf_point_to_canvas(
            pw / 2.0, 0
        )

        available_h_px = chip_y1_px - chip_y0_px - 4.0
        DS_FONT_SIZE   = float(self._font_size)
        CHIP_PAD_Y     = 2.0
        DS_VERT_GAP    = 1.0

        chip_h_px = DS_FONT_SIZE + CHIP_PAD_Y * 2
        total_h   = (
            len(seen) * chip_h_px
            + (len(seen) - 1) * DS_VERT_GAP
        )

        while total_h > available_h_px and DS_FONT_SIZE > 6:
            DS_FONT_SIZE -= 0.5
            chip_h_px     = DS_FONT_SIZE + CHIP_PAD_Y * 2
            total_h       = (
                len(seen) * chip_h_px
                + (len(seen) - 1) * DS_VERT_GAP
            )

        font     = self._load_font(int(DS_FONT_SIZE))
        cursor_y = chip_y0_px + 2.0

        for ds_code in seen:
            colour    = self._registry.get_colour(
                ds_code, form_code
            )
            full_name = _SDTM_DOMAIN_NAMES.get(
                ds_code, ds_code
            )
            label = (
                f"{full_name} ({ds_code})"
                if full_name != ds_code else ds_code
            )

            bbox       = draw.textbbox(
                (0, 0), label, font=font
            )
            text_w     = bbox[2] - bbox[0]
            CHIP_PAD_X = 4.0
            chip_w     = text_w + CHIP_PAD_X * 2

            x0 = chip_start_x_px
            x1 = min(
                x0 + chip_w, float(out.width) - 4.0
            )
            y0 = cursor_y
            y1 = cursor_y + chip_h_px

            if y1 > chip_y1_px - 1:
                break

            draw.rectangle(
                [x0, y0, x1, y1],
                fill    = colour,
                outline = BLACK,
                width   = LINE_WIDTH,
            )
            draw.text(
                (x0 + CHIP_PAD_X, y0 + CHIP_PAD_Y),
                label,
                fill = BLACK,
                font = font,
            )
            cursor_y = y1 + DS_VERT_GAP

        return out

    # =========================================================================
    # HELPERS
    # =========================================================================

    def _draw_label(
        self,
        draw:   ImageDraw.ImageDraw,
        text:   str,
        x0:     float, y0: float,
        x1:     float, y1: float,
        colour: tuple,
        font:   ImageFont.FreeTypeFont,
    ) -> None:
        """Draw text clipped to box with ellipsis truncation."""
        max_w = x1 - x0
        if max_w <= 0:
            return
        display = text
        while display:
            bbox = draw.textbbox((0, 0), display, font=font)
            tw   = bbox[2] - bbox[0]
            if tw <= max_w:
                break
            display = display[:-2] + "…"
        draw.text((x0, y0), display, fill=colour, font=font)

    def _draw_dashed_rect(
        self,
        draw:   ImageDraw.ImageDraw,
        rect:   list[float],
        colour: tuple[int, int, int],
        width:  int = 1,
        dash:   int = 6,
    ) -> None:
        x0, y0, x1, y1 = rect
        for ax0, ay0, ax1, ay1 in [
            (x0, y0, x1, y0),
            (x0, y1, x1, y1),
            (x0, y0, x0, y1),
            (x1, y0, x1, y1),
        ]:
            self._draw_dashed_line(
                draw, ax0, ay0, ax1, ay1,
                colour, width, dash,
            )

    @staticmethod
    def _draw_dashed_line(
        draw:   ImageDraw.ImageDraw,
        x0: float, y0: float,
        x1: float, y1: float,
        colour: tuple,
        width:  int = 1,
        dash:   int = 6,
    ) -> None:
        import math
        dx   = x1 - x0
        dy   = y1 - y0
        dist = math.hypot(dx, dy)
        if dist == 0:
            return
        steps = int(dist / dash)
        for i in range(steps):
            if i % 2 == 0:
                t0 = i / steps
                t1 = (i + 1) / steps
                draw.line(
                    [
                        (x0 + dx * t0, y0 + dy * t0),
                        (x0 + dx * t1, y0 + dy * t1),
                    ],
                    fill  = colour,
                    width = width,
                )

    # =========================================================================
    # HIT DETECTION
    # =========================================================================

    def get_annotation_at(
        self,
        cx:     float,
        cy:     float,
        mapper: CoordinateMapper,
    ) -> Optional[str]:
        """
        Return annotation_id at canvas position (cx, cy).
        Returns None if no hit.
        REMOVED and TABLE records are never in _box_specs
        so they are never hit-detectable.
        """
        for aid, spec in self._box_specs.items():
            if mapper.is_point_in_rect_canvas(
                cx, cy,
                spec.hit_cx0, spec.hit_cy0,
                spec.hit_cx1, spec.hit_cy1,
                tolerance = 4.0,
            ):
                return aid
        return None

    # =========================================================================
    # UNPLACED
    # =========================================================================

    def get_unplaced(
        self,
        store:       AnnotationStore,
        page_number: int,
    ) -> list[AnnotationRecord]:
        """
        Return all unplaced records on this page.

        Excludes:
          - TABLE records  (never placed, never shown)
          - REMOVED records (hidden by user)
        """
        return [
            r for r in store.get_by_page(page_number)
            if r.fitz_rect[1] == 0.0
            and r.fitz_rect[3] == 0.0
            and r.page_type != "TABLE"
            and r.status    != "REMOVED"
        ]

    def place_unplaced(
        self,
        store:          AnnotationStore,
        annotation_id:  str,
        cy_canvas:      float,
        mapper:         CoordinateMapper,
        box_height_pts: float = 12.0,
    ) -> bool:
        """Place an unplaced annotation at a canvas y-position."""
        rec = store.get(annotation_id)
        if not rec:
            return False
        _, y_pts      = mapper.canvas_point_to_pdf(0, cy_canvas)
        y0_pts        = y_pts - box_height_pts / 2
        y1_pts        = y_pts + box_height_pts / 2
        rec.fitz_rect = (0.0, y0_pts, 1.0, y1_pts)
        return True

    # =========================================================================
    # FULL RENDER
    # =========================================================================

    def render(
        self,
        base_img:      Image.Image,
        mapper:        CoordinateMapper,
        store:         AnnotationStore,
        page_number:   int,
        header_y0_pts: float = 0.0,
        header_y1_pts: float = 0.0,
        form_code:     str   = "",
    ) -> tuple[Image.Image, list[AnnotationRecord]]:
        """
        Full render pipeline for one page.

        TABLE pages:
            Returns base_img unchanged with empty unplaced list.
            No chips, no boxes, no hit zones registered.

        FORM pages:
            1. Draw header chips (datasets present on this page,
               excluding REMOVED records)
            2. Compute box specs (skipping TABLE + REMOVED)
            3. Draw boxes
            4. Collect unplaced (skipping TABLE + REMOVED)
        """
        self._box_specs.clear()

        # ── Detect page type from store records ───────────────────────
        records   = store.get_by_page(page_number)
        page_type = (
            records[0].page_type
            if records else "FORM"
        )

        # ── TABLE pages — return base image unchanged ─────────────────
        if page_type == "TABLE":
            return base_img.copy(), []

        # ── FORM pages — full render ──────────────────────────────────
        out_img = base_img

        # Draw header chips
        if header_y1_pts > header_y0_pts:
            out_img = self.draw_header_chips(
                base_img, mapper, store,
                page_number,
                header_y0_pts,
                header_y1_pts,
                form_code = form_code,
            )

        # Compute and draw annotation boxes
        specs   = self.compute_box_specs(
            mapper, store, page_number
        )
        out_img = self.draw_boxes(out_img, specs)

        # Collect unplaced records
        unplaced = self.get_unplaced(store, page_number)

        return out_img, unplaced


# =============================================================================
# SDTM DOMAIN FULL NAMES
# =============================================================================

_SDTM_DOMAIN_NAMES: dict[str, str] = {
    "CM":     "Concomitant Medications",
    "AE":     "Adverse Events",
    "DM":     "Demographics",
    "DS":     "Disposition",
    "EX":     "Exposure",
    "LB":     "Laboratory Tests",
    "VS":     "Vital Signs",
    "MH":     "Medical History",
    "PE":     "Physical Examination",
    "QS":     "Questionnaires",
    "SC":     "Subject Characteristics",
    "SU":     "Substance Use",
    "EG":     "ECG Test Results",
    "FA":     "Findings About",
    "PR":     "Procedures",
    "IE":     "Inclusion/Exclusion Criteria",
    "TU":     "Tumor/Lesion Identification",
    "RS":     "Disease Response",
    "MB":     "Microbiology Specimen",
    "MS":     "Microbiology Susceptibility",
    "MI":     "Microscopic Findings",
    "PC":     "Pharmacokinetics Concentrations",
    "PP":     "Pharmacokinetics Parameters",
    "DA":     "Drug Accountability",
    "DD":     "Death Details",
    "HO":     "Healthcare Encounters",
    "OE":     "Ophthalmic Examinations",
    "RE":     "Respiratory System Findings",
    "UR":     "Urinary System Findings",
    "SUPP":   "Supplemental Qualifiers",
    "SUPPAE": "Supplemental AE Qualifiers",
    "SUPPCM": "Supplemental CM Qualifiers",
    "SUPPVS": "Supplemental VS Qualifiers",
    "SUPPLB": "Supplemental LB Qualifiers",
    "SUPPDM": "Supplemental DM Qualifiers",
    "SUPPDS": "Supplemental DS Qualifiers",
    "SUPPEX": "Supplemental EX Qualifiers",
    "FAMH":   "Findings About Medical History",
}