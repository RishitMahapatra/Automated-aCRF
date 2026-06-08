"""
pipeline/crf_annotator.py
==========================
Draws annotation boxes on PDF.

Main entry point:
    run_annotator(pdf_path, session_id, records=None) -> Path
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from collections import defaultdict

import fitz

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from config import (
    FONT_NAME, FONT_BOLD,
    DS_FONT_SIZE,
    LINE_MIN_RATIO,
    COL_BLACK, COL_BLUE, COL_RED,
    COL_LIGHT_RED, COL_LIGHT_GREY,
    get_annotated_pdf_path, get_annotation_json_path,
    dataset_label,
)

# =============================================================================
# COLOUR-BLIND SAFE PALETTE (WONG-STYLE)
# Reset per form, remain consistent across pages of same form
# =============================================================================

WONG_PALETTE = [
    (245 / 255, 200 / 255, 66 / 255),    # Yellow
    (86 / 255, 180 / 255, 233 / 255),    # Sky Blue
    (0 / 255, 158 / 255, 115 / 255),     # Bluish Green
    (213 / 255, 94 / 255, 0 / 255),      # Vermillion
    (0 / 255, 114 / 255, 178 / 255),     # Blue
    (230 / 255, 159 / 255, 0 / 255),     # Orange
    (204 / 255, 121 / 255, 167 / 255),   # Reddish Purple
    (180 / 255, 180 / 255, 180 / 255),   # Light Grey
]

# USER_CORRECTED border
COL_CYAN = (0.0, 0.71, 0.85)
COL_WHITE = (1.0, 1.0, 1.0)

# Annotation sizing tuned so full variable names fit better
VAR_FONT_SIZE = 6.5
VAR_CHIP_PAD_X = 3.5
VAR_CHIP_PAD_Y = 1.8
VAR_TEXT_BUFFER = 1.5

# Header chip geometry
HEADER_CHIP_PAD_X = 4.0
HEADER_CHIP_PAD_Y = 2.0
HEADER_TEXT_BUFFER = 2.0
HEADER_DS_VERT_GAP = 1.0

BORDER_WIDTH = 0.8

# Optional symbolic colour overrides from dataset_colours.json
COLOUR_KEY_MAP = {
    "yellow":     (245 / 255, 200 / 255, 66 / 255),
    "blue":       (86 / 255, 180 / 255, 233 / 255),
    "teal":       (0 / 255, 158 / 255, 115 / 255),
    "vermillion": (213 / 255, 94 / 255, 0 / 255),
    "cobalt":     (0 / 255, 114 / 255, 178 / 255),
    "orange":     (230 / 255, 159 / 255, 0 / 255),
    "purple":     (204 / 255, 121 / 255, 167 / 255),
}


# =============================================================================
# NORMALISATION
# =============================================================================

def _normalise_record(rec: dict) -> dict:
    rec = dict(rec or {})

    rec["page"] = int(rec.get("page", 0) or 0)
    rec["page_type"] = str(rec.get("page_type") or "FORM").strip().upper()
    rec["form_code"] = str(rec.get("form_code") or "").strip()
    rec["status"] = str(rec.get("status") or "").strip().upper()
    rec["sdtm_dataset"] = str(rec.get("sdtm_dataset") or "").strip().upper()
    rec["sdtm_variable"] = str(rec.get("sdtm_variable") or "").strip().upper()
    rec["sdtm_label"] = str(rec.get("sdtm_label") or "").strip()
    rec["raw_variable"] = str(rec.get("raw_variable") or "").strip()

    if not rec["status"]:
        rec["status"] = "RESOLVED" if rec["sdtm_variable"] else "UNMAPPED"

    rec["y0_pts"] = float(rec.get("y0_pts", 0.0) or 0.0)
    rec["y1_pts"] = float(rec.get("y1_pts", 0.0) or 0.0)

    return rec


# =============================================================================
# COLOUR REGISTRY
# =============================================================================

def _load_dataset_colour_overrides(session_id: str) -> dict:
    try:
        json_path = get_annotation_json_path(session_id)
        colour_path = json_path.parent / "dataset_colours.json"
        if colour_path.exists():
            with open(colour_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data if isinstance(data, dict) else {}
        return {}
    except Exception:
        return {}


def build_form_colour_registry(records: list[dict], session_id: str) -> dict:
    """
    Assign colours per form_code:
    - same form_code => same dataset gets same colour across pages
    - new form_code => palette restarts
    """
    registry = {}
    overrides = _load_dataset_colour_overrides(session_id)

    by_page = defaultdict(list)
    for rec in records:
        r = _normalise_record(rec)
        by_page[r["page"]].append(r)

    for pnum in sorted(by_page.keys()):
        page_recs = by_page[pnum]
        if not page_recs:
            continue

        page_type = page_recs[0].get("page_type", "FORM")
        form_code = page_recs[0].get("form_code", "").upper()

        if page_type != "FORM":
            continue

        if form_code not in registry:
            registry[form_code] = {}

        for r in page_recs:
            if r.get("status") == "REMOVED":
                continue

            ds = (r.get("sdtm_dataset") or "").upper()
            if not ds:
                continue

            override_key = f"{form_code}::{ds}"
            override_name = str(overrides.get(override_key, "")).strip().lower()

            if ds not in registry[form_code]:
                if override_name in COLOUR_KEY_MAP:
                    registry[form_code][ds] = COLOUR_KEY_MAP[override_name]
                else:
                    slot = len(registry[form_code]) % len(WONG_PALETTE)
                    registry[form_code][ds] = WONG_PALETTE[slot]

    return registry


def get_colour(registry: dict, form_code: str, ds_code: str):
    fc = str(form_code or "").upper()
    ds = str(ds_code or "").upper()
    return registry.get(fc, {}).get(ds, WONG_PALETTE[0])


# =============================================================================
# TEXT WIDTH
# =============================================================================

def text_width(page, text, fontsize, bold=False, text_buffer=2.0):
    fname = FONT_BOLD if bold else FONT_NAME
    try:
        return page.get_text_length(text, fontname=fname, fontsize=fontsize) + text_buffer
    except Exception:
        return 0.55 * fontsize * len(text) + text_buffer
def fit_text_to_width(page, text, max_width_pts, start_fontsize, min_fontsize=5.2, bold=False):
    """
    Reduce font size slightly until text fits inside max_width_pts.
    Returns: (fontsize, text_width_pts)
    """
    fontsize = start_fontsize
    while fontsize >= min_fontsize:
        tw = text_width(page, text, fontsize, bold=bold, text_buffer=0.0)
        if tw <= max_width_pts:
            return fontsize, tw
        fontsize -= 0.2

    tw = text_width(page, text, min_fontsize, bold=bold, text_buffer=0.0)
    return min_fontsize, tw

# =============================================================================
# BOX DRAWING
# =============================================================================

def draw_box(page, x0, y0, x1, y1, bg_colour, border_colour, text, text_colour, fontsize, bold=False, dashed=False):
    rect = fitz.Rect(x0, y0, x1, y1)
    shape = page.new_shape()
    shape.draw_rect(rect)

    if dashed:
        shape.finish(
            color=border_colour,
            fill=bg_colour,
            width=1.2,
            dashes="[3 3] 0",
        )
    else:
        shape.finish(
            color=border_colour,
            fill=bg_colour,
            width=BORDER_WIDTH,
        )
    shape.commit()

    if not text:
        return

    fname = FONT_BOLD if bold else FONT_NAME
    try:
        tw = page.get_text_length(text, fontname=fname, fontsize=fontsize)
    except Exception:
        tw = 0.55 * fontsize * len(text)

    tx = x0 + (x1 - x0 - tw) / 2.0
    ty = y0 + (y1 - y0) * 0.65

    page.insert_text(
        fitz.Point(tx, ty),
        text,
        fontsize=fontsize,
        fontname=fname,
        color=text_colour,
    )


# =============================================================================
# ZONE DETECTION
# =============================================================================

def get_horizontal_lines(page):
    page_w = page.rect.width
    min_len = page_w * LINE_MIN_RATIO
    lines_y = []

    for path in page.get_drawings():
        for item in path.get("items", []):
            if item[0] == "l":
                p1, p2 = item[1], item[2]
                if abs(p1.y - p2.y) < 2.0 and abs(p2.x - p1.x) >= min_len:
                    lines_y.append((p1.y + p2.y) / 2.0)

        r = path.get("rect")
        if r and r.height < 3.0 and r.width >= min_len:
            lines_y.append((r.y0 + r.y1) / 2.0)

    lines_y = sorted(lines_y)
    deduped = []
    for y in lines_y:
        if not deduped or y - deduped[-1] > 3.0:
            deduped.append(y)

    return deduped


def get_footer_y(page):
    page_h = page.rect.height
    study_id_re = re.compile(r'D\d+C\d+_\w+_V[\d.]+')
    footer_y = None

    for w in page.get_text("words"):
        if study_id_re.search(w[4]) and w[1] > page_h * 0.5:
            if footer_y is None or w[1] < footer_y:
                footer_y = w[1]

    return footer_y if footer_y is not None else page_h * 0.92


def detect_header_zone(page):
    lines_y = get_horizontal_lines(page)
    header_y1 = lines_y[0] if lines_y else page.rect.height * 0.12
    return 0.0, header_y1


# =============================================================================
# DATASET CHIPS
# =============================================================================

def draw_dataset_chips(page, header_y0, header_y1, form_code, ds_list, registry):
    """
    Draw dataset chips in header zone:
    - label like DM=Demographics
    - black text
    - black border
    - background based on dataset colour
    """
    if not ds_list:
        return

    page_w = page.rect.width
    start_x = page_w / 2.0
    available_h = (header_y1 - header_y0) - 4.0

    font_size = DS_FONT_SIZE
    while font_size >= 5.0:
        chip_h = font_size + HEADER_CHIP_PAD_Y * 2
        total_h = len(ds_list) * chip_h + (len(ds_list) - 1) * HEADER_DS_VERT_GAP
        if total_h <= available_h:
            break
        font_size -= 0.5

    chip_h = font_size + HEADER_CHIP_PAD_Y * 2
    cursor_y = header_y0 + 2.0

    for ds_code in ds_list:
        colour = get_colour(registry, form_code, ds_code)
        label = dataset_label(ds_code)  # e.g. DM=Demographics
        tw = text_width(page, label, font_size, bold=False, text_buffer=HEADER_TEXT_BUFFER)
        chip_w = tw + HEADER_CHIP_PAD_X * 2

        x0 = start_x
        x1 = min(start_x + chip_w, page_w - 4.0)
        y0 = cursor_y
        y1 = cursor_y + chip_h

        if y1 > header_y1 - 1:
            break

        draw_box(
            page, x0, y0, x1, y1,
            bg_colour=colour,
            border_colour=COL_BLACK,
            text=label,
            text_colour=COL_BLACK,
            fontsize=font_size,
        )
        cursor_y = y1 + HEADER_DS_VERT_GAP


# =============================================================================
# VARIABLE BOXES
# =============================================================================

def draw_variable_box(page, comp_y0_pts, comp_y1_pts, sdtm_text, bg_colour, footer_y0, border_colour=None):
    """
    Draw centered variable box containing full DATASET.VARIABLE text,
    while preserving padding and preventing text overflow.
    """
    if comp_y0_pts >= footer_y0:
        return

    bc = border_colour if border_colour else COL_BLUE
    page_w = page.rect.width
    comp_cy = (comp_y0_pts + comp_y1_pts) / 2.0

    comp_h = max(0.0, comp_y1_pts - comp_y0_pts)
    if comp_h <= 2.0:
        return

    # Available width inside page center lane
    max_box_w = min(page_w * 0.46, page_w - 12.0)
    inner_max_text_w = max_box_w - (VAR_CHIP_PAD_X * 2)

    fitted_font, tw = fit_text_to_width(
        page,
        sdtm_text,
        inner_max_text_w,
        start_fontsize=VAR_FONT_SIZE,
        min_fontsize=5.2,
        bold=False,
    )

    box_w = min(max_box_w, tw + VAR_CHIP_PAD_X * 2)
    box_h = fitted_font + VAR_CHIP_PAD_Y * 2

    # Keep the annotation centered exactly as in editor mode
    x0 = max(page_w / 2.0 - box_w / 2.0, 4.0)
    x1 = min(page_w / 2.0 + box_w / 2.0, page_w - 4.0)

    y0 = max(comp_cy - box_h / 2.0, comp_y0_pts + 1.0)
    y1 = min(comp_cy + box_h / 2.0, comp_y1_pts - 1.0)

    if y1 <= y0 + 1 or x1 <= x0 + 1:
        return

    draw_box(
        page, x0, y0, x1, y1,
        bg_colour=bg_colour,
        border_colour=bc,
        text=sdtm_text,
        text_colour=COL_BLUE,
        fontsize=fitted_font,
    )

def draw_unresolved_box(page, comp_y0_pts, comp_y1_pts, footer_y0):
    """
    Unmapped:
    - red border
    - red text
    - light red background
    """
    if comp_y0_pts >= footer_y0:
        return

    page_w = page.rect.width
    comp_cy = (comp_y0_pts + comp_y1_pts) / 2.0
    label = "UNMAPPED"

    tw = text_width(
        page,
        label,
        VAR_FONT_SIZE,
        bold=False,
        text_buffer=VAR_TEXT_BUFFER,
    )
    box_w = tw + VAR_CHIP_PAD_X * 2
    box_h = VAR_FONT_SIZE + VAR_CHIP_PAD_Y * 2

    x0 = max(page_w / 2.0 - box_w / 2.0, 4.0)
    x1 = min(page_w / 2.0 + box_w / 2.0, page_w - 4.0)
    y0 = max(comp_cy - box_h / 2.0, comp_y0_pts + 1)
    y1 = min(comp_cy + box_h / 2.0, comp_y1_pts - 1)

    if y1 <= y0 + 1 or x1 <= x0 + 1:
        return

    draw_box(
        page, x0, y0, x1, y1,
        bg_colour=COL_LIGHT_RED,
        border_colour=COL_RED,
        text=label,
        text_colour=COL_RED,
        fontsize=VAR_FONT_SIZE,
        dashed=False,
    )


def draw_not_submitted_box(page, comp_y0_pts, comp_y1_pts, footer_y0):
    if comp_y0_pts >= footer_y0:
        return

    page_w = page.rect.width
    comp_cy = (comp_y0_pts + comp_y1_pts) / 2.0
    label = "Not Submitted"

    tw = text_width(
        page,
        label,
        VAR_FONT_SIZE,
        bold=False,
        text_buffer=VAR_TEXT_BUFFER,
    )
    box_w = tw + VAR_CHIP_PAD_X * 2
    box_h = VAR_FONT_SIZE + VAR_CHIP_PAD_Y * 2

    x0 = max(page_w / 2.0 - box_w / 2.0, 4.0)
    x1 = min(page_w / 2.0 + box_w / 2.0, page_w - 4.0)
    y0 = max(comp_cy - box_h / 2.0, comp_y0_pts + 1)
    y1 = min(comp_cy + box_h / 2.0, comp_y1_pts - 1)

    if y1 <= y0 + 1 or x1 <= x0 + 1:
        return

    draw_box(
        page, x0, y0, x1, y1,
        bg_colour=COL_LIGHT_GREY,
        border_colour=COL_BLACK,
        text=label,
        text_colour=COL_BLACK,
        fontsize=VAR_FONT_SIZE,
    )


# =============================================================================
# RUN ANNOTATOR
# =============================================================================

def run_annotator(pdf_path, session_id, records=None):
    pdf_path = Path(pdf_path)
    json_path = get_annotation_json_path(session_id)
    out_pdf_path = get_annotated_pdf_path(session_id)

    if records is None:
        with open(json_path, "r", encoding="utf-8") as f:
            records = json.load(f)

    records = [_normalise_record(r) for r in records]

    by_page = defaultdict(list)
    for rec in records:
        by_page[rec["page"]].append(rec)

    registry = build_form_colour_registry(records, session_id=session_id)

    doc = fitz.open(str(pdf_path))
    total_pages = len(doc)

    for page_index in range(total_pages):
        pnum = page_index + 1
        page = doc[page_index]
        page_records = by_page.get(pnum, [])

        if not page_records:
            continue

        page_type = page_records[0].get("page_type", "FORM")
        form_code = page_records[0].get("form_code", "")

        if page_type == "TABLE":
            continue

        header_y0, header_y1 = detect_header_zone(page)
        footer_y0 = get_footer_y(page)

        # Datasets used on this page, excluding removed
        ds_on_page = []
        seen = set()
        for r in page_records:
            if r.get("status") == "REMOVED":
                continue
            ds = (r.get("sdtm_dataset") or "").upper()
            if ds and ds not in seen:
                seen.add(ds)
                ds_on_page.append(ds)

        if ds_on_page:
            draw_dataset_chips(page, header_y0, header_y1, form_code, ds_on_page, registry)

        for rec in page_records:
            if rec.get("page_type") == "TABLE":
                continue
            if rec.get("status") == "REMOVED":
                continue

            status = rec.get("status", "UNMAPPED")
            sdtm_ds = rec.get("sdtm_dataset")
            sdtm_var = rec.get("sdtm_variable")
            y0_pts = rec.get("y0_pts", 0.0)
            y1_pts = rec.get("y1_pts", 0.0)

            # Skip unplaced
            if y0_pts == 0.0 and y1_pts == 0.0:
                continue

            if status == "NOT_SUBMITTED":
                draw_not_submitted_box(page, y0_pts, y1_pts, footer_y0)
            elif sdtm_ds and sdtm_var:
                bg = get_colour(registry, form_code, sdtm_ds)
                border = COL_CYAN if status == "USER_CORRECTED" else COL_BLUE
                draw_variable_box(
                    page,
                    y0_pts,
                    y1_pts,
                    f"{sdtm_ds}.{sdtm_var}",
                    bg,
                    footer_y0,
                    border,
                )
            else:
                draw_unresolved_box(page, y0_pts, y1_pts, footer_y0)

    out_pdf_path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(out_pdf_path))
    doc.close()

    return out_pdf_path