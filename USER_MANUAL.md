# 📋 CRF Annotation Editor — User Manual

> **Version:** 1.0 &nbsp;|&nbsp; **Stack:** Python · PyWebView · Vanilla JS · PDF.js · jsPDF

---

## 🗺️ Interface Overview

The editor is divided into four colour-coded regions. Every feature in this manual maps to one of these areas.

| Region | Colour | Description |
|--------|--------|-------------|
|  **Side Panel** | `#ffbd59` Peach | Upload, Analytics, Review tabs on the left |
|  **Editor / Canvas** | `#5170ff` Vivid Blue | PDF viewer with annotation overlays in the centre |
|  **Edit Panel** | `#00bf63` Green | Variable/dataset editor on the right |
|  **Bottom Nav** | `#ff3131` Bright Red | Zoom and page navigation strip at the very bottom |

<p align = "center">
<img width="959" height="539" alt="image" src="https://github.com/user-attachments/assets/d1293a6c-51e6-4e42-867a-3d2eb89171c1" />
</p>

---

## 🚀 Setup & Initial Actions

### Step 1 — Upload a PDF

1. Click the **Upload tab** (📤 icon) in the **Side Panel**.
2. Either:
   - **Click the drop zone** labelled *"Click or drag a CRF PDF here"* to open a file browser, or
   - **Drag and drop** a `.pdf` file directly onto the drop zone.
3. Once loaded, the drop zone shows the **filename**, **page count**, and a **×** dismiss button.
4. The **Session ID** field auto-populates from the filename. You may edit it — this ID links all saved data on the backend.
   
<p align = "center">
<img width="959" height="539" alt="image" src="https://github.com/user-attachments/assets/dec14516-9f80-4c8a-b125-d623f9e56195" />
</p>

> ⚠️ Only PDF files are accepted. The tool processes CRF (Case Report Form) documents that contain structured form fields.

---

### Step 2 — Run the Pipeline

1. Verify the **Session ID** field is filled in (the pipeline will warn you if it is empty).
2. Click **▶ Run Pipeline**.
3. A **progress bar** appears beneath the button with animated status messages:

   | Progress | Stage |
   |----------|-------|
   | 0 – 30 % | *"Extracting components…"* |
   | 30 – 60 % | *"Matching SDTM variables…"* |
   | 60 – 78 % | *"Drawing annotations…"* |
   | 100 % | *"Pipeline complete!"* |

4. On success, the button freezes as **✓ Pipeline Complete** and all annotations appear on the canvas.
5. The **Analytics** and **Review** tabs populate automatically.

> 💡 To re-run the pipeline on the same file you must **Restart the Session** first (see [Restarting a Session](#restarting-a-session)).

**Error handling:** If the pipeline fails, the progress bar turns red and a toast notification shows the error. The button reactivates so you can retry.

---

## 🧭 Navigation

<p align = "center">
<img width="959" height="539" alt="image" src="https://github.com/user-attachments/assets/e2f06879-58ad-4e12-b72b-487c5e0f2ef5" />
</p>


### Page Navigation

| Method | Action |
|--------|--------|
| `←` Arrow key | Go to previous page |
| `→` Arrow key | Go to next page |
| **‹** button (bottom nav) | Go to previous page |
| **›** button (bottom nav) | Go to next page |
| **Click the page display** (e.g. `5 / 20`) | Type a page number and press `Enter` to jump |
| `Escape` while in page input | Cancel and stay on current page |

> ℹ️ **Table pages** are read-only reference pages. A banner reading *"TABLE PAGE — Reference only"* appears. You cannot add or edit annotations on these pages.

---

### Zoom Controls

| Method | Action |
|--------|--------|
| `Ctrl + Scroll ↑` | Zoom in (maintains cursor position) |
| `Ctrl + Scroll ↓` | Zoom out (maintains cursor position) |
| **+** button (bottom nav) | Zoom in by 10% |
| **−** button (bottom nav) | Zoom out by 10% |

- **Range:** 50% – 200% &nbsp;|&nbsp; **Default:** 100%
- Current zoom is displayed in the **toolbar** (top-right corner of the canvas).

---

### Undo & Redo

| Shortcut | Action |
|----------|--------|
| `Ctrl + Z` / `Cmd + Z` | Undo last action |
| `Ctrl + Y` / `Ctrl + Shift + Z` / `Cmd + Y` | Redo last undone action |

The unified undo stack covers: **annotation creation**, **removal**, **moves**, **resizes**, **status changes**, and **suggestion applications**.

---

## Side Panel — Tabs

The Side Panel sits on the left edge of the interface. It has three tabs that collapse to icon-only mode when the panel is narrowed below ~145 px (drag the vertical resizer to adjust width).

---

### 📤 Upload Tab

| Control | Description |
|---------|-------------|
| **Drop Zone** | Click to browse or drag-and-drop a CRF PDF |
| **Filename chip** | Displays loaded filename; click **×** to clear |
| **Session ID** | Links this run to backend-stored data; auto-filled from filename |
| **▶ Run Pipeline** | Executes AI annotation; disabled after a successful run |
| **Progress bar** | Appears during pipeline execution |
| **↺ Restart Session** | Clears all annotations and resets to a clean state |

---

### 📊 Analytics Tab

Provides a real-time overview of the annotation coverage.

#### Progress Ring

A **neumorphic glass ring** with dual neon-purple arcs shows the overall resolution percentage.

<p align = "center">
<img width="488" height="581" alt="Screenshot 2026-06-29 143234" src="https://github.com/user-attachments/assets/7eb8ef98-5ccf-4d6c-b6f1-50bafbe4f5b2" />
</p>

The ring **sweeps from zero** every time the percentage updates — the animation restarts from the beginning so you can see the change clearly.

**Formula:** `(RESOLVED + USER_CORRECTED + NOT_SUBMITTED) ÷ ACTIVE × 100`

#### Stat Grid

| Tile | Colour | Meaning |
|------|--------|---------|
| **Resolved** | 🔵 Blue `#3DB7FF` | Pipeline-matched at ≥ 80 % confidence (status: `RESOLVED`) |
| **Unmapped** | 🟠 Orange `#FF8A00` | No match found, < 60 % confidence (status: `UNMAPPED`) |
| **Corrected** | 🟣 Violet `#A374FF` | User-corrected or manually entered (status: `USER_CORRECTED`) |
| **Removed** | ⚫ Muted `#5B6BA3` | Permanently removed this session (status: `REMOVED`) |

#### Deep Analysis Row

| Label | Count |
|-------|-------|
| **Total** | All active (non-removed) annotations |
| **Review** | `UNMAPPED + NEEDS_REVIEW` (need attention) |
| **Resolved** | `RESOLVED + USER_CORRECTED + NOT_SUBMITTED` (actioned) |

---

### 🔍 Review Tab

The Review tab is the primary workspace for human evaluation of annotations flagged by the pipeline.

#### Summary Badge

Shows **"X pending"** — the number of annotations still requiring action (UNMAPPED + NEEDS_REVIEW).

#### Confidence Legend

| Colour | Confidence | Status |
|--------|-----------|--------|
| 🟢 Green | ≥ 80 % | Auto-annotated (`RESOLVED`) — high confidence, no action needed |
| 🟡 Yellow | 60 – 79 % | Needs review (`NEEDS_REVIEW`) — moderate confidence |
| 🔴 Red | < 60 % | Unmapped (`UNMAPPED`) — pipeline could not match |

---

#### Active vs. Resolved Queue

Use the **Active / Resolved** inner tabs to switch between work queues.

| Queue | Contains |
|-------|----------|
| **Active** | `UNMAPPED` + `NEEDS_REVIEW` — items requiring action |
| **Resolved** | `USER_CORRECTED` + `NOT_SUBMITTED` — completed items |

---

#### Filter Chips (Active Queue Only)

| Chip | Shows |
|------|-------|
| **All** | Everything in the active queue |
| **Unmapped** | Only `UNMAPPED` items (red ⚠ icon) |
| **Needs Review** | Only `NEEDS_REVIEW` items (yellow ⚙ icon) |
| **Dataset** | Only dataset-level review items (added via "Add to Review" on a dataset chip) |

**Search box:** Filters by SDTM variable name, dataset code, raw variable text, or page number — all at once.

---

#### Queue Row Anatomy

```
 ⚠  CM.CMTRT                    [CM]
     RAW: Concomitant Medication      💬
```

| Element | Meaning |
|---------|---------|
| **Status Icon** | ⚠ red = Unmapped · ⚙ yellow = Needs Review · ✓ green = Corrected · – grey = Not Submitted |
| **SDTM Label** | Best-guess or confirmed mapping (e.g. `CM.CMTRT`) |
| **Domain Badge** | Colour-coded dataset code (e.g. `CM`) |
| **Raw Variable** | Original text extracted from the PDF form field |
| **💬 Comment** | Visible only when a comment exists — click to read it |

**Click a row** → Navigates to the annotation's page and highlights it with a purple pulse animation.

**Click a Dataset row** → Highlights the dataset chip on the canvas with a shake animation (no page navigation needed — dataset chips persist across pages).

---

#### Right-Click on Queue Items

| Option | Action |
|--------|--------|
| **Resolved** | Marks as `USER_CORRECTED`; uses suggested SDTM mapping |
| **Ignore** | Marks as `NOT_SUBMITTED`; moves to Resolved queue |
| **Mark for Review** | Changes status to `NEEDS_REVIEW`; greyed out if already in review |
| **Remove from Review** | Reverts `NEEDS_REVIEW` → `UNMAPPED`; only shown for NEEDS_REVIEW items |
| **Convert to Unmapped** | Forces status to `UNMAPPED`; hidden for already-resolved or dataset items |
| **Add Comments** | Opens the comment dialog |
| **Cancel** | Closes the menu |

---

#### Comments

**Adding a comment:**
1. Right-click any queue item → **Add Comments**
2. Type your note in the dialog box
3. Click **Save** — the 💬 icon appears on the row

**Viewing a comment:**
- Click the **💬** button on any row to open the comment viewer panel (read-only)

> 💡 Comments are ideal for flagging issues for teammates, noting why a mapping was skipped, or recording SME decisions.

---

## 🔵 Editor / Canvas

The central canvas renders the PDF with annotation overlays. Every annotation is interactive.

---

### Annotation Types & Colour Coding

| Type | Visual on Canvas | Status |
|------|-----------------|--------|
| **Variable annotation** | Coloured box + label (Wong palette colour) | `RESOLVED` / `USER_CORRECTED` |
| **Unmapped annotation** | Light-pink bg + red dashed border, red label | `UNMAPPED` |
| **Not Submitted** | Grey bg + dark border | `NOT_SUBMITTED` |
| **Needs Review** | Yellow/amber highlighted box | `NEEDS_REVIEW` |
| **Dataset chip** | Header chip at top of component group | Any status |

**Component bands** are invisible full-height click targets that group all annotations for a single form component. Clicking one selects the group and opens the edit panel.

---

### Adding an Annotation

1. **Right-click** anywhere on the PDF canvas.
2. Select **Add Annotation** from the context menu.
3. In the **Add Annotation dialog**, choose an annotation type:

   | Type | Required Fields |
   |------|----------------|
   | **Variable** | Dataset code + Variable name |
   | **Dataset** | Dataset shorthand + Full name + Colour swatch |
   | **Unmapped** | No fields — creates a blank UNMAPPED annotation |
   | **Not Submitted** | No fields — creates a NOT_SUBMITTED annotation |

4. Fill in the required fields.
5. Click **Create** (or press `Enter`).

The annotation appears at the position where you right-clicked. It is immediately undoable with `Ctrl+Z`.

> ⚠️ Validation errors appear in red below the form. Common errors: *"Dataset is required"*, *"Variable name is required"*, *"Please select a colour"*.

---

### Selecting an Annotation

| Click Target | Result |
|-------------|--------|
| **Annotation box** | Selects annotation; opens Edit Panel; highlights with purple band |
| **Component band** | Selects group; opens Edit Panel for first annotation in component |
| **Dataset chip** | Opens Edit Panel with dataset-specific fields |

Selected annotations are highlighted with a **full-width purple band** across the component row.

---

### Moving (Drag & Drop)

1. **Click and hold** on an annotation box or dataset chip.
2. **Drag** to a new position on the page (cursor changes to ✋).
3. **Release** — position is saved and added to the undo stack.

> `Ctrl+Z` restores the previous position.

---

### Resizing

1. **Hover** over an annotation box — a **↘ resize handle** appears in the bottom-right corner.
2. **Click and drag** the handle to change the box size.
3. **Release** — new dimensions are saved and undoable.

> **Minimum size:** 28 px wide × 14 px tall (enforced automatically).

---

### Canvas Right-Click Menu

Right-clicking opens a context-sensitive menu. Options vary depending on whether you click a blank area or an existing annotation.

| Option | Shown When | Action |
|--------|-----------|--------|
| **Add Annotation** | Always | Opens the Add Annotation dialog |
| **Edit Annotation** | On annotation | Opens Edit Panel for this annotation |
| **Mark as Unmapped** | On annotation | Sets status → `UNMAPPED`, clears mapping |
| **Mark as Not Submitted** | On annotation | Sets status → `NOT_SUBMITTED` |
| **Add to Review** | On annotation (not already in review) | Sets status → `NEEDS_REVIEW` |
| **Remove from Review** | On `NEEDS_REVIEW` annotation | Reverts → `UNMAPPED` |
| **Show in Review Query** | On annotation | Navigates sidebar to highlight this item in the queue |
| **Remove Annotation** 🔴 | On annotation | Permanently removes (shows confirmation dialog) |
| **Cancel** | Always | Closes menu |

**Dataset Chip Context Menu** (right-click a dataset header chip):

| Option | Action |
|--------|--------|
| **Edit Annotation** | Opens Edit Panel for the dataset chip |
| **Add to Review** | Adds this dataset to the Review queue |
| **Show in Review Query** | Highlights the dataset review row in sidebar |
| **Cancel** | Closes menu |

---

## 🟤 Edit Panel

The Edit Panel opens on the right side when you click any annotation or queue item.

### Empty State

When nothing is selected, the panel shows:

```
        ✏
  Select an Annotation
    or Review Query

  Click any box on the PDF
```

---

### Active State Layout

When an annotation is selected, the panel is divided into collapsible sections:

```
┌──────────────────────────────────┐
│ ● Edit Annotation           [×]  │  ← Header
├──────────────────────────────────┤
│ RAW: [CMTRT]  Component: [field] │  ← Identity
│ Form: [FORM_001]                 │
├──────────────────────────────────┤
│ Current: CM.CMTRT                │  ← Current Mapping
│ "Concomitant Med Treatment"      │
├──────────────────────────────────┤
│ ▾ Suggestions         [—————]    │  ← Collapsible
├──────────────────────────────────┤
│ ▾ Manual Override     [—————]    │  ← Collapsible
├──────────────────────────────────┤
│ ▾ Change Dataset Colour [————]   │  ← Collapsible
├──────────────────────────────────┤
│ ▾ Actions             [—————]    │  ← Collapsible
└──────────────────────────────────┘
```

---

### Header

| Element | Meaning |
|---------|---------|
| **Status dot** | Colour matches annotation status (see colour table below) |
| **Title** | "Edit Annotation" or "Edit Dataset" |
| **× button** | Closes the Edit Panel |

**Status dot colours:**

| Colour | Status |
|--------|--------|
| 🔵 Blue `#3DB7FF` | `RESOLVED` — auto-matched, high confidence |
| 🟢 Green `#00E676` | `USER_CORRECTED` — user manually corrected |
| 🟠 Orange `#FF8A00` | `UNMAPPED` — no pipeline match |
| ⚫ Grey `#8B8D99` | `NOT_SUBMITTED` — intentionally skipped |
| 🔴 Red `#E05252` | `REMOVED` — deleted this session |

---

### Identity Section (read-only)

| Field | Description |
|-------|-------------|
| **Raw Variable** | Exact text extracted from the PDF form (monospace chip) |
| **Component** | Form field type (e.g. `text_field`, `checkbox`, `DATASET_HEADER`) |
| **Form Code** | CRF form identifier for this page (e.g. `FORM_001`) |

---

### Current Mapping Section (read-only)

Displays the active SDTM mapping in large monospace text:

```
  CM.CMTRT
  Concomitant Medication Treatment
```

Shows `No mapping` when UNMAPPED, or `Not Submitted` when NOT_SUBMITTED.

---

### Suggestions Section ▾

Click the section header to expand.

The panel shows AI-ranked SDTM suggestions ordered by confidence:

```
  CMTRT        CM     87 %   ████████░░
  CMCAT        CM     62 %   ██████░░░░
  CMSCAT       CM     41 %   ████░░░░░░
```

| Element | Description |
|---------|-------------|
| **Variable name** | Suggested SDTM variable (e.g. `CMTRT`) |
| **Dataset code** | Suggested domain (e.g. `CM`) |
| **Confidence %** | Match certainty |
| **Colour coding** | 🟢 ≥ 70 % · 🟡 40–69 % · 🔴 < 40 % |

**Applying a suggestion:**

1. Click any suggestion card.
2. A **confirmation dialog** appears:
   > *"Apply Suggestion? This will set the mapping to CM.CMTRT and can be undone with Ctrl+Z."*
3. Click **Apply** to confirm, or **Cancel** to dismiss.
4. The mapping updates immediately. Undo with `Ctrl+Z`.

> 💡 For **user-created annotations**, the suggestions section is labelled *"Suggestions (User Generated)"* in muted text — it behaves identically.

---

### Manual Override Section ▾

Click the section header to expand. Use this to enter a mapping that wasn't suggested by the pipeline.

**For variable annotations:**

| Field | Placeholder | Example |
|-------|------------|---------|
| **Dataset** | `Dataset` | `CM` |
| **Variable** | `Variable` | `CMTRT` |
| **Label** | `Label (optional)` | `Concomitant Medication Treatment` |
| **Confirm** button | — | Applies the mapping |

**For dataset chip annotations:**

| Field | Placeholder | Example |
|-------|------------|---------|
| **Dataset code** | `CM` | `VS` |
| **Dataset name** | `Concomitant Medication` | `Vital Signs` |
| **Confirm** button | — | Updates the chip |

**Dataset name format rules:**

- Plain text → converted to `UPPERCASE` (e.g. `vital signs` → `VITAL SIGNS`)
- With parentheses `(CM)` → preserves the parenthesised suffix (e.g. `Vital Signs (VS)`)
- Only **one set of parentheses** is allowed; nesting is invalid

> `Ctrl+Z` undoes a manual override.

---

### Change Dataset Colour Section ▾

Applies a colour to **all annotations in the same dataset on the same form**.

| Swatch | Colour | Name |
|--------|--------|------|
| 🟡 | `rgb(255,255,150)` | Yellow |
| 🩵 | `rgb(191,255,255)` | Sky Blue |
| 🟢 | `rgb(150,255,150)` | Bluish Green |
| 🍑 | `rgb(255,190,155)` | Vermillion |
| 🟣 | `rgb(204,121,167)` | Reddish Purple |

Click any swatch to apply immediately. The change is undoable.

> These are **Wong's colour-blind safe palette** — chosen for accessibility.

---

### Actions Section ▾

| Button | Effect |
|--------|--------|
| **Not Submitted** | Sets status → `NOT_SUBMITTED`; clears SDTM fields |
| **Clear Mapping** / **Unmap** | Clears dataset + variable; sets status → `UNMAPPED` |
| **Remove** 🔴 | Opens confirmation dialog; permanently removes the annotation |
| **Close** | Closes the Edit Panel |

> ⚠️ **Remove** is irreversible within the dialog flow but can be undone with `Ctrl+Z` immediately after.

---

## 📤 Export

### Export Button

Located in the **top-right navigation bar**: `Export ↗`

> Requires the pipeline to have run at least once.

### Export Process

1. Click **Export ↗**.
2. The button shows *"Exporting…"* and disables temporarily.
3. The tool silently **renders all pages at 100 % zoom** (ensuring consistent output quality, regardless of your current zoom level).
4. Each page is captured as a **PNG at 2× scale** (≈ 300 DPI — print quality).
5. All captured images are assembled into a **single PDF** with the original page dimensions.
6. A **save dialog** opens via the backend (Python); choose your file location.
7. On success: a green toast notification shows *"PDF exported to: /path/to/file.pdf"*.

### Output Format

| Property | Value |
|----------|-------|
| Format | PDF |
| Resolution | 2× scale (≈ 300 DPI) |
| Background | White |
| Content | All annotation boxes, labels, and dataset chips |

---

## 🔄 Restarting a Session

Click the **↺ Restart Session** button in the Upload tab.

### If a PDF is not loaded:
A dialog warns: *"Select a CRF PDF first before restarting the session."*

### If annotations exist (3-step flow):

**Step 1 — Confirm restart:**
> *"Restart Session? This will clear all current annotations."*
> → **Restart** or **Cancel**

**Step 2 — Save before restarting:**
> *"Save Before Restarting? Export the annotated PDF first?"*
> → **Save** (triggers export, then restarts) · **Skip** (restarts immediately) · **Cancel**

**Step 3 — If "Save" is chosen:**
The export runs first. If export succeeds, the session clears. If export fails, the restart is cancelled and an error toast appears.

> 💡 After a restart, you can upload a new PDF and run the pipeline again on a fresh session, or reload the same PDF with a different session ID.

---

## ⚫ Bottom Navigation Bar

The sticky bar at the very bottom of the canvas area:

```
 [‹]   [−]   [ 5 / 20 ]   [+]   [›]
```

| Control | Function |
|---------|----------|
| **‹** | Previous page (disabled on page 1) |
| **−** | Zoom out 10 % (disabled at 50 %) |
| **[ 5 / 20 ]** | Current page / total pages — click to enter a page number |
| **+** | Zoom in 10 % (disabled at 200 %) |
| **›** | Next page (disabled on last page) |

### Inline Page Jump

1. Click the **page display** (e.g. `5 / 20`).
2. The display becomes an editable number input.
3. Type the target page number.
4. Press `Enter` to navigate, `Escape` to cancel.
5. If the number is outside the valid range, a dialog notifies you: *"Please enter a valid page number between 1 and [total]."*

---

### Canvas Toolbar (top-right corner of canvas)

| Item | Example | Meaning |
|------|---------|---------|
| **Form Code** | `FORM_001` | Current page's CRF form identifier |
| **DPI** | `150 DPI` | Render resolution |
| **Zoom** | `100%` | Current zoom level |

---

## 🔔 Notifications & Dialogs

### Toast Notifications

Toasts appear at the bottom-right of the screen and auto-dismiss.

| Type | Colour | Duration | Examples |
|------|--------|---------|---------|
| ℹ️ Info | Blue | 4.5 s | General messages |
| ⚠️ Warning | Yellow | 4.5 s | *"Enter a session ID"*, *"Run the pipeline first"* |
| ❌ Error | Red | 4.5 s | *"Pipeline failed: [error]"*, *"Export failed"* |
| ✅ Success | Green | 7 s | *"PDF exported to: /path/file.pdf"* |

Click the **×** on any toast to dismiss it immediately.

---

### Modal Dialogs

| Dialog | Trigger | Buttons |
|--------|---------|---------|
| **Add Annotation** | Right-click → Add Annotation | Create · Cancel |
| **Apply Suggestion?** | Click a suggestion card | Apply · Cancel |
| **Remove Annotation?** | Remove button / right-click Remove | Remove 🔴 · Cancel |
| **Restart Session?** | ↺ Restart Session button | Restart · Cancel |
| **Save Before Restarting?** | Shown after Restart confirmed | Save · Skip · Cancel |
| **Invalid Page Number** | Enter out-of-range page | OK |
| **No PDF Selected** | Restart with no PDF loaded | OK |

---

## ⌨️ Full Keyboard Shortcut Reference

| Shortcut | Action |
|----------|--------|
| `←` | Previous page |
| `→` | Next page |
| `Ctrl + Z` / `Cmd + Z` | Undo |
| `Ctrl + Y` / `Ctrl + Shift + Z` / `Cmd + Y` | Redo |
| `Ctrl + Scroll ↑` | Zoom in |
| `Ctrl + Scroll ↓` | Zoom out |
| `Enter` | Confirm dialog / jump to page |
| `Escape` | Close dialog / cancel page input / close context menu |

---

## ⚡ Quick Reference Cheat Sheet

| Task | How |
|------|-----|
| Load a PDF | Upload tab → drop zone (click or drag) |
| Run AI annotation | Enter Session ID → ▶ Run Pipeline |
| Navigate pages | `←` / `→` keys or ‹ / › buttons |
| Jump to page | Click page display → type number → `Enter` |
| Zoom | `Ctrl+Scroll` or +/− buttons |
| Add annotation | Right-click canvas → Add Annotation |
| Edit annotation | Click box on canvas (or right-click → Edit Annotation) |
| Move annotation | Click and drag the box |
| Resize annotation | Hover over box → drag ↘ handle |
| Apply suggestion | Edit Panel → Suggestions → click card → Apply |
| Manual mapping | Edit Panel → Manual Override → fill fields → Confirm |
| Change dataset colour | Edit Panel → Change Dataset Colour → click swatch |
| Mark as unmapped | Right-click box → Mark as Unmapped, or Actions → Unmap |
| Mark as not submitted | Actions → Not Submitted, or right-click → Mark as Not Submitted |
| Add to review queue | Right-click box → Add to Review |
| Remove from review | Right-click NEEDS_REVIEW box → Remove from Review |
| Resolve queue item | Review tab → right-click row → Resolved |
| Ignore queue item | Review tab → right-click row → Ignore |
| Add comment | Review tab → right-click row → Add Comments |
| View comment | Review tab → click 💬 button on row |
| Highlight annotation | Review tab → click row (navigates + highlights) |
| Highlight dataset chip | Review tab → click dataset row (shakes chip on canvas) |
| Export PDF | Top nav → Export ↗ (after pipeline runs) |
| Undo anything | `Ctrl+Z` |
| Redo | `Ctrl+Y` |
| Restart session | Upload tab → ↺ Restart Session |
| Resize side panel | Drag the vertical divider between Side Panel and Canvas |
| Resize edit panel | Drag the vertical divider between Canvas and Edit Panel |

---

## 🎨 Colour & Status Reference

### Annotation Statuses

| Status | Meaning | Canvas Appearance | Queue Icon |
|--------|---------|------------------|-----------|
| `RESOLVED` | Pipeline auto-matched ≥ 80 % | Colour-coded box, blue border | — (not in queue) |
| `NEEDS_REVIEW` | Pipeline matched 60–79 % | Amber-highlighted box | ⚙ Yellow |
| `UNMAPPED` | No match, < 60 % | Pink bg + red dashed border + red label | ⚠ Red |
| `USER_CORRECTED` | User applied a mapping | Colour-coded box, blue border | ✓ Green (Resolved queue) |
| `NOT_SUBMITTED` | Intentionally skipped | Grey bg + dark border | – Grey (Resolved queue) |
| `REMOVED` | Deleted | Not rendered | — |

### Domain Badge Colours

Domain badges in the review queue use distinct colours to help you visually identify datasets at a glance. Common examples:

| Domain | Colour |
|--------|--------|
| `AE` | Red/rose |
| `CM` | Blue |
| `DM` | Green |
| `EX` | Orange |
| `LB` | Purple |
| `MH` | Teal |
| `VS` | Gold |

---

## 🛠️ Technical Stack

| Component | Technology |
|-----------|-----------|
| **Desktop shell** | 🐍 Python + PyWebView |
| **PDF rendering** | 📄 PDF.js |
| **Frontend** | 🌐 Vanilla JS (no framework) |
| **Styles** | 🎨 Custom CSS (dark neumorphic glass design) |
| **PDF export** | 📦 jsPDF + html2canvas |
| **AI pipeline** | 🤖 Python backend (SDTM matching) |
| **Data persistence** | 💾 Python backend session store |

---

## 🆘 Troubleshooting

| Problem | Cause | Solution |
|---------|-------|----------|
| *"Enter a session ID"* toast | Session ID field is empty | Type any ID in the Session ID box before running the pipeline |
| *"Run the pipeline first"* toast | Export clicked before pipeline ran | Click ▶ Run Pipeline and wait for it to complete |
| Pipeline bar stays at 0 % | Backend not running | Ensure the Python server (`main.py`) is running |
| Annotations missing after reload | Session ID mismatch | Make sure the Session ID matches the one used in the previous run |
| Cannot resize annotations | Annotation is on a TABLE page | TABLE pages are read-only; switch to a FORM page |
| Suggestion confidence all grey | User-created annotation | User-created annotations use basic similarity matching only |
| Export produces blank pages | Zoom was not at 100 % during export | The tool resets zoom automatically — if pages are blank, try reloading and exporting again |

---

*© CRF Annotation Editor — Internal Use Only*
