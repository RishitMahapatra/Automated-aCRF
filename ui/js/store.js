/**
 * ui/js/store.js
 * --------------
 * Simple client-side state store for the PyWebView CRF Annotation Editor.
 */

const Store = {
  sessionId: "",
  pdfLoaded: false,
  pdfName: "",
  pdfPath: "",
  zoomPct: 50,
  zoomMin: 25,
  zoomMax: 200,
  zoomStep: 10,

  pipelineRan: false,
  pageCount: 0,
  currentPage: 1,

  pageImage: null,
  pageImageData: null,
  pageWidthPts: 0,
  pageHeightPts: 0,
  imgWidth: 0,
  imgHeight: 0,

  annotations: [],
  pageRecords: [],
  selectedId: null,
  selectedRecord: null,
  selectedAnnotation: null,

  formDatasetColours: {},

  // New canonical frontend export state containers
  editorObjects: [],
  datasetChips: [],

  stats: {
    total: 0,
    resolved: 0,
    user_corrected: 0,
    unmapped: 0,
    not_submitted: 0,
    removed: 0,
    resolution_pct: 0,
  },

  undoStack: [],
  redoStack: [],
  historyLimit: 5,

  resetSession() {
    this.sessionId = "";
    this.pdfLoaded = false;
    this.pdfName = "";
    this.pdfPath = "";
    this.zoomPct = 50;

    this.pipelineRan = false;
    this.pageCount = 0;
    this.currentPage = 1;

    this.pageImage = null;
    this.pageImageData = null;
    this.pageWidthPts = 0;
    this.pageHeightPts = 0;
    this.imgWidth = 0;
    this.imgHeight = 0;

    this.annotations = [];
    this.pageRecords = [];
    this.selectedId = null;
    this.selectedRecord = null;
    this.selectedAnnotation = null;

    this.formDatasetColours = {};
    this.editorObjects = [];
    this.datasetChips = [];

    this.stats = {
      total: 0,
      resolved: 0,
      user_corrected: 0,
      unmapped: 0,
      not_submitted: 0,
      removed: 0,
      resolution_pct: 0,
    };

    this.undoStack = [];
    this.redoStack = [];
  },

  setPageImage(image, widthPts, heightPts, imgWidth, imgHeight) {
    this.pageImage = image;
    this.pageImageData = image;
    this.pageWidthPts = widthPts || 0;
    this.pageHeightPts = heightPts || 0;
    this.imgWidth = imgWidth || 0;
    this.imgHeight = imgHeight || 0;
  },

  setAnnotations(records) {
    const safe = Array.isArray(records) ? records : [];
    this.annotations = safe;
    this.pageRecords = safe;
  },

  setSelectedAnnotation(record) {
    this.selectedRecord = record || null;
    this.selectedAnnotation = record || null;
    this.selectedId = record?.annotation_id || null;
  },

  clearSelectedAnnotation() {
    this.selectedRecord = null;
    this.selectedAnnotation = null;
    this.selectedId = null;
  },

  setEditorObjects(objects) {
    this.editorObjects = Array.isArray(objects) ? objects : [];
  },

  getVisibleEditorObjects() {
    return (this.editorObjects || []).filter(
      o => o && o.visible !== false && o.removed !== true
    );
  },

  upsertEditorObject(obj) {
    if (!obj || !obj.object_id) return;
    const idx = this.editorObjects.findIndex(x => x.object_id === obj.object_id);
    if (idx >= 0) {
      this.editorObjects[idx] = obj;
    } else {
      this.editorObjects.push(obj);
    }
  },

  removeEditorObject(objectId) {
    const idx = this.editorObjects.findIndex(x => x.object_id === objectId);
    if (idx >= 0) {
      this.editorObjects[idx].removed = true;
      this.editorObjects[idx].visible = false;
    }
  },

  setDatasetChips(chips) {
    this.datasetChips = Array.isArray(chips) ? chips : [];
  },

  upsertDatasetChip(chip) {
    if (!chip || !chip.chip_id) return;
    const idx = this.datasetChips.findIndex(x => x.chip_id === chip.chip_id);
    if (idx >= 0) {
      this.datasetChips[idx] = chip;
    } else {
      this.datasetChips.push(chip);
    }
  },

  removeDatasetChip(chipId) {
    const idx = this.datasetChips.findIndex(x => x.chip_id === chipId);
    if (idx >= 0) {
      this.datasetChips[idx].removed = true;
      this.datasetChips[idx].visible = false;
    }
  },

  pushHistory(action) {
    if (!action) return;
    this.undoStack.push(action);
    if (this.undoStack.length > this.historyLimit) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  },

  popUndo() {
    if (!this.undoStack.length) return null;
    return this.undoStack.pop();
  },

  pushRedo(action) {
    if (!action) return;
    this.redoStack.push(action);
    if (this.redoStack.length > this.historyLimit) {
      this.redoStack.shift();
    }
  },

  popRedo() {
    if (!this.redoStack.length) return null;
    return this.redoStack.pop();
  },

  canUndo() {
    return this.undoStack.length > 0;
  },

  canRedo() {
    return this.redoStack.length > 0;
  },

  setZoom(pct) {
    const next = Math.max(this.zoomMin, Math.min(this.zoomMax, pct));
    this.zoomPct = next;
  },

  zoomIn() {
    this.setZoom(this.zoomPct + this.zoomStep);
  },

  zoomOut() {
    this.setZoom(this.zoomPct - this.zoomStep);
  },

  resetZoom() {
    this.zoomPct = 50;
  },
};