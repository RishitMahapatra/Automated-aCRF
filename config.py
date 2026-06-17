"""
config.py
=========
Central configuration for CRF Annotator — PyWebView edition.
All paths and constants live here.
"""

from pathlib import Path

# =============================================================================
# ROOT PATHS
# =============================================================================
ROOT_DIR = Path(__file__).parent.resolve()
ASSETS_DIR = ROOT_DIR / "assets"
OUTPUTS_DIR = ROOT_DIR / "outputs"
PIPELINE_DIR = ROOT_DIR / "pipeline"
UI_DIR = ROOT_DIR / "ui"

print(f"  [config] OK — root: {ROOT_DIR}")

# =============================================================================
# FIXED ASSETS
# =============================================================================
EXCEL_PATH = ASSETS_DIR / "RAW_SDTM_Mappings.xlsx"
print(f"  [config] Excel: {EXCEL_PATH}")

# =============================================================================
# PROCESSING SETTINGS
# =============================================================================
RENDER_DPI = 150
LINE_MIN_RATIO = 0.30

TABLE_MARKERS = {"Field Name", "Data Type", "SAS Label"}
JOIN_KEYS = {"STUDY", "SUBJECT", "USUBJID", "SUBJID", "SITEID"}

# =============================================================================
# EXCEL FORMAT
# =============================================================================
DOMAIN_SHEETS = [
    "CM", "AE", "DM", "DS", "EX", "LB",
    "VS", "MH", "PE", "QS", "SC", "SU", "EG", "FA", "PR"
]
RAW_SDTM_SHEET = "RAW-SDTM Mappings"
COL_SRC_DATASET = "Source Dataset"
COL_SRC_VARIABLE = "Source Variable"
COL_SDTM_DATASET = "SDTM Dataset"
COL_SDTM_VAR = "SDTM Variable"
COL_SDTM_LABEL = "SDTM Label"

# =============================================================================
# ANNOTATION COLOURS (fitz float RGB 0.0–1.0)
# =============================================================================
COL_YELLOW = (1.00, 1.00, 0.00)
COL_LIGHT_BLUE = (0.68, 0.85, 0.90)
COL_LIGHT_GREEN = (0.70, 0.93, 0.70)
COL_BLACK = (0.00, 0.00, 0.00)
COL_BLUE = (0.00, 0.00, 0.75)
COL_RED = (0.85, 0.10, 0.10)
COL_WHITE = (1.00, 1.00, 1.00)
COL_LIGHT_RED = (1.00, 0.88, 0.88)
COL_DARK_GREY = (0.30, 0.30, 0.30)
COL_LIGHT_GREY = (0.95, 0.95, 0.95)
COL_LIGHT_BLUE2 = (0.85, 0.93, 1.00)
DATASET_COLOURS = [COL_YELLOW, COL_LIGHT_BLUE, COL_LIGHT_GREEN]

# =============================================================================
# ANNOTATION TYPOGRAPHY & GEOMETRY
# =============================================================================
FONT_NAME = "helv"
FONT_BOLD = "hebo"
DS_FONT_SIZE = 10.0
VAR_FONT_SIZE = 10.0
TOC_TITLE_SIZE = 14.0
TOC_HEAD_SIZE = 9.0
TOC_BODY_SIZE = 8.5
CHIP_PAD_X = 6.0
CHIP_PAD_Y = 3.5
TEXT_BUFFER = 10.0
DS_VERT_GAP = 5.0
BORDER_WIDTH = 0.8

# =============================================================================
# DATASET FULL NAMES
# =============================================================================
DATASET_NAMES = {
    "AE": "Adverse Events",
    "CM": "Concomitant Medications",
    "DM": "Demographics",
    "DS": "Disposition",
    "EG": "ECG Findings",
    "EX": "Exposure",
    "FA": "Findings About",
    "LB": "Laboratory",
    "MH": "Medical History",
    "PE": "Physical Examination",
    "PR": "Procedures",
    "QS": "Questionnaires",
    "SC": "Subject Characteristics",
    "SU": "Substance Use",
    "VS": "Vital Signs",
    "DA": "Drug Accountability",
    "DD": "Death Details",
    "HO": "Healthcare Encounters",
    "IE": "Inclusion/Exclusion",
    "MB": "Microbiology Specimen",
    "MI": "Microscopic Findings",
    "MS": "Microbiology Susceptibility",
    "OE": "Ophthalmic Examinations",
    "PC": "PK Concentrations",
    "PP": "PK Parameters",
    "RE": "Respiratory Findings",
    "RS": "Disease Response",
    "TU": "Tumour Identification",
    "UR": "Urinary System Findings",
}


def dataset_label(ds_code: str) -> str:
    code = ds_code.strip().upper()
    name = DATASET_NAMES.get(code)
    if name:
        return f"{code}={name}"
    if code.startswith("SUPP") and len(code) > 4:
        parent = code[4:]
        return f"{code}=Supplemental for {parent}"
    return code


# =============================================================================
# SESSION OUTPUT HELPERS
# =============================================================================
def get_session_dir(session_id: str) -> Path:
    d = OUTPUTS_DIR / str(session_id)
    d.mkdir(parents=True, exist_ok=True)
    return d


def get_session_output_dir(session_id: str) -> Path:
    return get_session_dir(session_id)


def get_components_dir(session_id: str) -> Path:
    d = get_session_dir(session_id) / "components"
    d.mkdir(parents=True, exist_ok=True)
    return d


def get_annotation_json_path(session_id: str) -> Path:
    return get_components_dir(session_id) / "annotation_data.json"


def get_editor_state_path(session_id: str) -> Path:
    return get_session_dir(session_id) / "editor_state.json"


def get_annotated_pdf_path(session_id: str) -> Path:
    return get_session_dir(session_id) / "CRF_Annotated.pdf"


def get_summary_path(session_id: str) -> Path:
    return get_components_dir(session_id) / "pipeline_summary.txt"