# CRF Annotation Editor


#### Documentation 
Full documentation is available at: 
**[https://rishitmahapatra.github.io/Automated-aCRF/](https://rishitmahapatra.github.io/Automated-aCRF/)**

A desktop annotation and review tool for PDF Case Report Forms (**CRFs**) that helps users inspect extracted field mappings, review unresolved items, correct annotations visually, and export an updated annotated PDF.

This application is designed around a simple workflow: load a CRF PDF, run the pipeline, review page-by-page annotations, correct what needs correction, and export the final annotated output.

<p align="center">
  <img width="949" height="499" alt="image" src="https://github.com/user-attachments/assets/9d87cbea-6a54-4ee4-b160-ea2a04a803c2" />
</p>


## Overview

The **CRF Annotation Editor** provides an interactive interface for working with annotated CRF PDFs. It combines:

- **PDF page rendering**: view pages exactly as they appear in the source document
- **Annotation overlays**: see mappings and statuses in context
- **Page-by-page navigation**: move through long forms efficiently
- **Manual correction of mappings**: confirm, correct, and adjust
- **Review of unresolved or ignored fields**: focus on what needs attention
- **Session-based editing**: keep work organized per file
- **Annotated PDF export**: produce a final reviewed output

The focus of the tool is **review and usability**, allowing users to quickly move through forms, inspect mapped variables, fix unmapped items, and maintain a clean exportable annotation output.

## Key Capabilities

- **Visual PDF Review**: Renders CRF pages directly in the application and overlays annotations on top of the form, allowing inspection of mappings in the exact visual context of the source CRF.

- **Pipeline-Driven Annotation Loading**: After uploading a CRF and running the pipeline, the application loads extracted annotations for each page and displays them interactively.

- **Interactive Annotation Editing**: Review annotations directly on the rendered page and update them through the editor workflow, including:
  - **Confirming mappings**
  - **Correcting mappings**
  - **Marking items as Not Submitted**
  - **Removing irrelevant annotations**
  - **Reviewing unresolved items**

- **Page Navigation**: Efficient movement through the CRF using:
  - **Previous / next page buttons**
  - **Sticky bottom navigation**
  - **Keyboard arrow navigation**
  - **Direct page jumps** (where available)

- **Unresolved Item Review**: Highlights unmapped or pending items so users can focus on the most important review actions first.

- **Export of Annotated Output**: When review is complete, export the annotated PDF for downstream use or documentation.

## Typical Workflow

1. **Upload a PDF**  
   Select a CRF PDF from your machine. The tool creates a session and prepares the file for processing.

2. **Run the Pipeline**  
   Click **Run Pipeline** to process the CRF and generate annotations. During this step, the application:
   - **Extracts** CRF structure and field information
   - **Generates** annotation records
   - **Prepares** the annotated view for review

3. **Review the Output**  
   After processing completes:
   - Page count becomes available
   - The first page loads into the canvas
   - Annotations appear over the page
   - Page metadata and review statistics become visible

4. **Navigate Through Pages**  
   Move through the CRF using navigation controls or the keyboard. This enables rapid review of long CRFs across many pages.

5. **Inspect and Correct Annotations**  
   Click annotations to inspect them and update their mapping status as needed. Use the editing controls to:
   - **Confirm correct mappings**
   - **Fix incorrect mappings**
   - **Ignore non-submittable items (Not Submitted)**
   - **Remove annotations** that should not be retained

6. **Export the Final PDF**  
   When review is complete, export the annotated PDF to save the reviewed version.

## Workflow Diagram

The end-to-end workflow is illustrated below. The application reads the CRF PDF, classifies pages, extracts and links annotation data, resolves SDTM mappings where possible, and surfaces unresolved items for manual review in the editor.

<p align="center">
<img width="959" height="539" alt="image" src="https://github.com/user-attachments/assets/2c24482b-22f4-42e8-a5e8-317a6d2d1dee" />
</p>



## User Interface Guide

### Sidebar

The sidebar acts as the main control center for the session. It is used for:

- **File upload**
- **Session display**
- **Pipeline execution**
- **Review statistics**
- **Annotation status overview**

Depending on the build and layout version, the sidebar may include workspace controls, statistics, and review-related summary panels.

<p align="center">
<img width="353" height="494" alt="image" src="https://github.com/user-attachments/assets/e6506302-752e-4920-8faf-83e3745c0db3" />
</p>



### Canvas Area

The canvas area displays the active CRF page and all visible annotations. It supports:

- **Viewing the current PDF page**
- **Selecting annotations**
- **Visual inspection of mappings**
- **Page-specific editing actions**
- **Zoomed review** for detailed reading

<p align="center">
<img width="752" height="539" alt="image" src="https://github.com/user-attachments/assets/ad1b19c0-c05a-4b97-9589-433708cc3116" />
</p>

### Sticky Bottom Navigation

The sticky navigation bar keeps core controls accessible while reviewing long pages. It typically includes:

- **Previous page**
- **Next page**
- **Current page / total pages**
- **Zoom controls**
- **Page context indicators**

This helps maintain flow during review without needing to return to the top of the interface.

<p align="center">
<img width="240" height="47" alt="image" src="https://github.com/user-attachments/assets/e4b365dd-3c0c-4ca7-b9e7-093dc7391e1b" />
</p>

## Annotation Types and States

Annotations appear in different visual styles depending on their status. Typical states include:

- **Resolved**: A mapping exists and is accepted
- **User Corrected**: A mapping was manually adjusted by the reviewer
- **Unmapped**: The item still requires review
- **Not Submitted**: The item is intentionally marked as not submitted
- **Removed**: The annotation is excluded from the final output

These statuses help reviewers quickly understand which parts of the CRF still need attention.

## Sessions

Each uploaded file is associated with a **session ID**. The session keeps the review state separate and organized, typically covering:

- **The selected PDF**
- **Generated annotations**
- **Review edits**
- **Statistics**
- **Export state**

If needed, the session can be restarted to clear the current working state and begin fresh.

## Navigation Shortcuts

### Keyboard

- **Left Arrow**: Previous page  
- **Right Arrow**: Next page

Shortcuts work when the user is not actively typing in an input field.

## Zoom and Page Viewing

The application supports zoom controls for close visual inspection of the CRF page. Typical behavior includes:

- **Zooming in** for detailed review
- **Zooming out** for broader page context
- **Maintaining annotation overlay alignment** with the PDF page
- **Page scrolling** within the visible canvas area

Zoom is intended to support reading and review rather than changing annotation meaning or placement.

## Working With Annotations

A typical annotation review process:

1. **Click** an annotation on the page  
2. **Inspect** the mapped variable or status  
3. **Decide** whether it is correct  
4. **Confirm or adjust** the mapping  
5. **Save** the updated review state through the editor flow

Some builds also support **adding annotations manually** or **repositioning** visual elements for better review clarity.

## Statistics and Review Progress

The tool may display summary metrics to help track review progress, such as:

- **Total annotations**
- **Resolved annotations**
- **User-corrected annotations**
- **Unmapped annotations**
- **Removed annotations**
- **Resolution percentage**

These indicators help users monitor how much review remains.

<p align="center">
<img width="244" height="290" alt="image" src="https://github.com/user-attachments/assets/d638ea72-6a53-4a19-a9d2-c473883b927c" />
</p>

## Export

When review is finished, the tool can generate an annotated PDF output. The exported file reflects the reviewed annotation state and is intended to preserve the final reviewed visual output.

Typical export flow:

1. Choose **Export**  
2. Confirm export settings (if applicable)  
3. Save the annotated PDF for downstream use or documentation


---

