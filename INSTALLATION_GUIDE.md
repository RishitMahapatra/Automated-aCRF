# ⚙️ CRF Annotation Editor — Installation Guide

> For developers and technical users who want to run the tool from source code.

---

## 📋 Table of Contents

1. [System Requirements](#1-system-requirements)
2. [Project Structure](#2-project-structure)
3. [Python Dependencies](#3-python-dependencies)
4. [The Excel Mapping File ⚠️](#4-the-excel-mapping-file-)
5. [Installation Steps](#5-installation-steps)
6. [Running the Application](#6-running-the-application)
7. [Output Directory](#7-output-directory)
8. [Platform-Specific Notes](#8-platform-specific-notes)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. System Requirements

| Component | Requirement |
|-----------|-------------|
| **Python** | 3.10 or later (3.11 recommended) |
| **Operating System** | Windows 10/11 · macOS 12+ · Linux (GTK3) |
| **RAM** | 4 GB minimum, 8 GB recommended |
| **Disk** | ~500 MB free (Python env + dependencies) |
| **Display** | 1024 × 700 px minimum (1440 × 900 recommended) |
| **WebView backend** | Windows: Edge WebView2 · macOS: WKWebView · Linux: GTK WebKit2 |

---

## 2. Project Structure

```
Automated-aCRF/
│
├── app.py                    ← Entry point — run this to start
├── api.py                    ← JS ↔ Python bridge (PyWebView API)
├── config.py                 ← All paths and constants
│
├── pipeline/
│   ├── crf_full_pipeline.py  ← Steps 1–5: extract, match, annotate
│   └── crf_annotator.py      ← Draws annotation boxes on PDF
│
├── bridge/
│   ├── pipeline_bridge.py    ← Pipeline orchestration from JS calls
│   ├── annotation_bridge.py  ← CRUD for annotation records
│   ├── editor_state_bridge.py← Saves/loads editor state (undo history)
│   └── export_bridge.py      ← PDF export logic
│
├── editor/
│   ├── annotation_store.py   ← In-memory annotation store
│   ├── confidence_engine.py  ← TF-IDF suggestion engine (RAW → SDTM)
│   ├── coordinate_mapper.py  ← PDF coordinate utilities
│   ├── export_manager.py     ← Page capture and PDF assembly
│   └── pdf_renderer.py       ← PDF-to-image renderer (PyMuPDF)
│
├── ui/                       ← Frontend (Vanilla JS, no framework)
│   ├── index.html
│   ├── styles/main.css
│   └── js/
│       ├── app.js
│       ├── canvas.js
│       ├── sidebar.js
│       ├── editpanel.js
│       ├── store.js
│       └── editor_state.js
│
├── assets/
│   └── RAW_SDTM_Mappings.xlsx   ← ⚠️  REQUIRED — see Section 4
│
└── outputs/                  ← Auto-created; session data stored here
    └── <session_id>/
        ├── components/
        │   ├── annotation_data.json
        │   └── pipeline_summary.txt
        ├── editor_state.json
        └── CRF_Annotated.pdf
```

---

## 3. Python Dependencies

Install all dependencies via `pip`. The full list with the reason each package is needed:

| Package | `pip` Name | Purpose |
|---------|-----------|---------|
| **PyMuPDF** | `pymupdf` | Parses and renders PDF pages; draws annotation boxes |
| **pywebview** | `pywebview` | Creates the native desktop window around the web frontend |
| **openpyxl** | `openpyxl` | Reads the Excel mapping file (`.xlsx`) |
| **pandas** | `pandas` | Loads and processes mapping table data from Excel |
| **Pillow** | `Pillow` | Image processing for page captures |
| **NumPy** | `numpy` | Numerical operations for the suggestion engine |
| **scikit-learn** | `scikit-learn` | TF-IDF vectoriser + cosine similarity for RAW → SDTM suggestions |

### Install all at once

```bash
pip install pymupdf pywebview openpyxl pandas Pillow numpy scikit-learn
```

### Or save to a requirements file and install

Create `requirements.txt`:

```text
pymupdf>=1.23.0
pywebview>=5.0.0
openpyxl>=3.1.0
pandas>=2.0.0
Pillow>=10.0.0
numpy>=1.24.0
scikit-learn>=1.3.0
```

Then install:

```bash
pip install -r requirements.txt
```

### Recommended: use a virtual environment

```bash
# Create virtual environment
python -m venv .venv

# Activate it
# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

# Install dependencies
pip install pymupdf pywebview openpyxl pandas Pillow numpy scikit-learn
```

---

## 4. The Excel Mapping File ⚠️

> **This file is mandatory. The pipeline will not run without it.**

The core of the annotation pipeline is a **RAW-to-SDTM variable mapping Excel workbook**. This spreadsheet defines how raw CRF field names from the source study are translated into standardised SDTM (Study Data Tabulation Model) variables.

### Where it must be placed

```
Automated-aCRF/
└── assets/
    └── RAW_SDTM_Mappings.xlsx   ← exact filename, exact location
```

The path is configured in `config.py`:

```python
EXCEL_PATH = ASSETS_DIR / "RAW_SDTM_Mappings.xlsx"
```

If the file is missing or misnamed, the pipeline will raise a `FileNotFoundError` on startup.

---

### Required Excel Structure

The workbook must follow one of two supported formats:

#### Format A — One sheet per SDTM domain

Each domain has its own sheet named after the domain code (e.g. `CM`, `AE`, `DM`). The following sheets are recognised:

```
CM  AE  DM  DS  EX  LB  VS  MH  PE  QS  SC  SU  EG  FA  PR
```

Each sheet must contain these columns (exact names, case-insensitive):

| Column Name | Description | Example |
|-------------|-------------|---------|
| `Source Dataset` | The raw/source dataset name | `CONMED` |
| `Source Variable` | The raw CRF field name | `CMTRT` |
| `SDTM Dataset` | The target SDTM domain | `CM` |
| `SDTM Variable` | The target SDTM variable | `CMTRT` |
| `SDTM Label` | Human-readable label | `Concomitant Medication Treatment` |

> **Column order does not matter** — the pipeline matches columns by name, not position.

#### Format B — Single consolidated sheet

A single sheet named **`RAW-SDTM Mappings`** containing all domains in one table, with the same five columns listed above plus the domain indicated by the `Source Dataset` / `SDTM Dataset` columns.

The pipeline automatically detects which format is present and reads accordingly.

---

### Example mapping rows

| Source Dataset | Source Variable | SDTM Dataset | SDTM Variable | SDTM Label |
|---------------|----------------|-------------|--------------|-----------|
| CONMED | CMTRT | CM | CMTRT | Concomitant Medication Treatment |
| CONMED | CMDOSE | CM | CMDOSE | Dose per Administration |
| ADVERSE | AETERM | AE | AETERM | Reported Term for Adverse Event |
| DEMOG | AGE | DM | AGE | Age |

---

### How it powers the pipeline

When the pipeline runs, it:

1. **Loads** the Excel workbook from `assets/RAW_SDTM_Mappings.xlsx`
2. **Parses** each domain sheet (Format A) or the consolidated sheet (Format B)
3. **Builds an in-memory lookup table** keyed by `(domain, raw_variable)`
4. For each field extracted from the CRF PDF, it **looks up the raw variable** and resolves it to an SDTM mapping
5. Confidence is scored as:
   - **≥ 80 %** → auto-annotated as `RESOLVED`
   - **60 – 79 %** → flagged as `NEEDS_REVIEW`
   - **< 60 %** → marked as `UNMAPPED`
6. The **TF-IDF suggestion engine** (`editor/confidence_engine.py`) also uses this data to power the *"Suggestions"* panel in the Edit Panel

---

### 🚧 Upcoming Feature — Automatic Mapping Extraction

> **Work in progress.** This section describes a feature that is actively being developed.

Currently, the mapping Excel file must be **manually prepared and placed** in the `assets/` folder before running the pipeline. The file must conform to the column structure described above.

**In a future release**, the tool will support **automatic extraction of RAW-to-SDTM mappings** from study-specific mapping documents. This will allow users to:

- Upload their study's existing mapping specification document (e.g. a Pinnacle 21-style mapping worksheet or a sponsor-internal mapping spec)
- Have the tool **automatically parse and ingest** the mapping table without manual reformatting
- Dynamically update the mapping source without restarting the application

Until this feature is shipped, **you must provide the mapping file yourself** in the exact format and location described above. If your organisation's mapping document uses different column names, edit `config.py` to update the column name constants:

```python
# config.py — adjust these to match your Excel column headers
COL_SRC_DATASET  = "Source Dataset"    # ← change if your header differs
COL_SRC_VARIABLE = "Source Variable"   # ← change if your header differs
COL_SDTM_DATASET = "SDTM Dataset"      # ← change if your header differs
COL_SDTM_VAR     = "SDTM Variable"     # ← change if your header differs
COL_SDTM_LABEL   = "SDTM Label"        # ← change if your header differs
```

---

## 5. Installation Steps

Follow these steps in order.

### Step 1 — Clone the repository

```bash
git clone https://github.com/rishitmahapatra/automated-acrf.git
cd automated-acrf
```

### Step 2 — Create and activate a virtual environment

```bash
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS / Linux
source .venv/bin/activate
```

### Step 3 — Install Python dependencies

```bash
pip install pymupdf pywebview openpyxl pandas Pillow numpy scikit-learn
```

### Step 4 — Place the Excel mapping file

```
⚠️  This step is required before the pipeline will work.
```

1. Obtain or prepare your `RAW_SDTM_Mappings.xlsx` file (see [Section 4](#4-the-excel-mapping-file-) for required structure).
2. Create the `assets/` directory inside the project root if it does not already exist:

   ```bash
   mkdir -p assets
   ```

3. Copy your mapping file into it:

   ```bash
   cp /path/to/your/RAW_SDTM_Mappings.xlsx assets/RAW_SDTM_Mappings.xlsx
   ```

   The final path must be exactly:

   ```
   Automated-aCRF/assets/RAW_SDTM_Mappings.xlsx
   ```

### Step 5 — (Optional) Create the outputs directory

The `outputs/` folder is created automatically on first run, but you can create it manually:

```bash
mkdir -p outputs
```

### Step 6 — Verify setup

Run a quick check to confirm all imports resolve:

```bash
python -c "
import fitz, webview, openpyxl, pandas, PIL, numpy
from sklearn.feature_extraction.text import TfidfVectorizer
from pathlib import Path
excel = Path('assets/RAW_SDTM_Mappings.xlsx')
print('✓ All imports OK')
print('✓ Excel file found:', excel.exists())
"
```

Expected output:

```
✓ All imports OK
✓ Excel file found: True
```

---

## 6. Running the Application

```bash
python app.py
```

This launches a native desktop window (1440 × 900 px, resizable). The window title is **"CRF Annotation Editor"**.

The console will print startup messages from `config.py`:

```
  [config] OK — root: /path/to/Automated-aCRF
  [config] Excel: /path/to/Automated-aCRF/assets/RAW_SDTM_Mappings.xlsx
```

> **Debug mode is enabled by default** (`webview.start(debug=True)`). Right-clicking the web area exposes browser dev-tools. Set `debug=False` in `app.py` for production use.

---

### Minimum window size

The application enforces a minimum window size of **1024 × 700 px**. Resizing below this snaps back to the minimum.

---

## 7. Output Directory

All session data is written to:

```
outputs/<session_id>/
├── components/
│   ├── annotation_data.json   ← All annotation records for this session
│   └── pipeline_summary.txt   ← Pipeline run summary log
├── editor_state.json          ← Saved undo/redo state
└── CRF_Annotated.pdf          ← Exported annotated PDF
```

Each session gets a unique ID derived from the PDF filename plus a random 8-character hex suffix (e.g. `STUDY001_CRF_a3f8b21c`). Sessions are isolated — running the same PDF twice creates two independent session directories.

---

## 8. Platform-Specific Notes

### 🪟 Windows

- Requires **Microsoft Edge WebView2 Runtime** (pre-installed on Windows 11; download for Windows 10 from [microsoft.com](https://developer.microsoft.com/en-us/microsoft-edge/webview2/))
- No additional system packages needed beyond the pip dependencies
- Run from **PowerShell** or **Command Prompt** (not WSL, as WebView2 does not work inside WSL)

### 🍎 macOS

- Uses **WKWebView** (built into macOS — no extra install needed)
- May prompt for **accessibility permissions** on first run
- Python from `brew` or `pyenv` is recommended over the system Python

### 🐧 Linux

PyWebView on Linux requires **GTK3 + WebKit2GTK**. Install the system packages for your distribution:

**Ubuntu / Debian:**

```bash
sudo apt-get install python3-gi python3-gi-cairo gir1.2-gtk-3.0 \
  gir1.2-webkit2-4.1 libgtk-3-dev libwebkit2gtk-4.1-dev
```

**Fedora / RHEL:**

```bash
sudo dnf install python3-gobject gtk3 webkit2gtk4.1
```

**Arch Linux:**

```bash
sudo pacman -S python-gobject gtk3 webkit2gtk-4.1
```

> If you see `ImportError: No module named 'gi'` on Linux, the GTK bindings are missing — install the packages above.

---

## 9. Troubleshooting

| Error | Likely Cause | Fix |
|-------|-------------|-----|
| `FileNotFoundError: assets/RAW_SDTM_Mappings.xlsx` | Excel file missing or misnamed | Place the file at `assets/RAW_SDTM_Mappings.xlsx` (exact name) |
| `ModuleNotFoundError: No module named 'fitz'` | PyMuPDF not installed | `pip install pymupdf` |
| `ModuleNotFoundError: No module named 'webview'` | pywebview not installed | `pip install pywebview` |
| `ModuleNotFoundError: No module named 'sklearn'` | scikit-learn not installed | `pip install scikit-learn` |
| `ModuleNotFoundError: No module named 'gi'` (Linux) | GTK bindings missing | Install `python3-gi` and `gir1.2-webkit2-4.1` via apt/dnf/pacman |
| Window opens but PDF rendering is blank | WebView engine not installed | Windows: install Edge WebView2 runtime |
| Pipeline runs but no annotations appear | Excel mapping has wrong column names | Update column name constants in `config.py` (see Section 4) |
| Pipeline runs but suggestions are all low confidence | Mapping file is sparse or domain sheets are misnamed | Ensure sheet names match the SDTM domain codes exactly (`CM`, `AE`, etc.) |
| `ValueError: No sheet named 'RAW-SDTM Mappings'` | Neither format A nor B detected | Rename your consolidated sheet to `RAW-SDTM Mappings` or use per-domain sheets |
| `PermissionError` on `outputs/` | Insufficient write permissions | Run from a directory where your user has write access, or `chmod` the folder |
| App window too small / cut off | Display scaling > 100 % | Set your OS display scaling to 100 %, or resize the window manually |
| `KeyError` in pipeline for a column | Column header has extra whitespace | Strip whitespace from column headers in your Excel file |

---

## Quick-Start Checklist

```
☐  Python 3.10+ installed
☐  Virtual environment created and activated
☐  pip install pymupdf pywebview openpyxl pandas Pillow numpy scikit-learn
☐  assets/ directory exists
☐  RAW_SDTM_Mappings.xlsx placed at assets/RAW_SDTM_Mappings.xlsx
☐  Excel workbook has correct sheet names and column headers
☐  python -c "import fitz, webview, openpyxl, pandas, PIL, numpy" runs clean
☐  python app.py — window opens successfully
```

---

*For usage instructions once the application is running, refer to [USER_MANUAL.md](USER_MANUAL.md).*
