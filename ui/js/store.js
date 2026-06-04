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
};