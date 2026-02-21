import {
  BASEMAPS,
  DEFAULT_IN_SCOPE_MUNICIPALITIES,
  DEFAULT_VISIBLE_PREFECTURES,
  DEPOTS,
  DEPOT_SITES,
  FULL_ADMIN_BOUNDARY_GEOJSON,
  MOBILE_BREAKPOINT_PX,
  OPERATIONAL_ADMIN_BOUNDARY_GEOJSON,
  ZIP_KEYS,
} from "./src/config.js";
import {
  canonicalAreaName,
  canonicalMunicipality,
  canonicalTownName,
  collectPostalCodes,
  escapeHtml,
  extractDepot,
  extractTownName,
  formatAreaIdForDisplay,
  formatPostalCodes,
  getAreaId,
  getAreaName,
  getMunicipality,
  getMunicipalityFromProps,
  normalizeDepotCode,
  normalizeHeader,
  normalizeMatchKey,
  normalizeZip,
  parseCsvRows,
  pickCsvValue,
} from "./src/utils.js";

const LOADING_MIN_VISIBLE_MS = 600;
const LOADING_FADE_OUT_MS = 220;
const LOADING_DOT_INTERVAL_MS = 100;
const PREFECTURE_DISPLAY_ORDER = ["東京都", "神奈川県", "千葉県", "埼玉県"];
const DETAIL_ENTER_ZOOM = 13;
const DETAIL_EXIT_ZOOM = 12;
const RENDER_SWITCH_DEBOUNCE_MS = 100;
const PREWARM_DELAY_MS = 120;
const DETAIL_SMOOTH_FACTOR = 1.2;
const LITE_SMOOTH_FACTOR = 1.7;
const BORDER_STYLE_DASH = Object.freeze({ solid: "", dashed: "8 6", dotted: "2 6" });
const BORDER_REFRESH_THROTTLE_MS = 120;
const LITE_STYLE = Object.freeze({
  selected: Object.freeze({ weight: 1.45, opacity: 0.72, fillOpacity: 0.2 }),
  default: Object.freeze({ weight: 0.95, opacity: 0.46, fillOpacity: 0.075 }),
  outOfScopeSelected: Object.freeze({ weight: 1.3, opacity: 0.58, fillOpacity: 0.18 }),
  outOfScopeDefault: Object.freeze({ weight: 0.7, opacity: 0.26, fillOpacity: 0.01 }),
});
const DETAIL_STYLE = Object.freeze({
  selected: Object.freeze({ weight: 2.8, opacity: 0.95, fillOpacity: 0.3, dashArray: "4 3" }),
  default: Object.freeze({ weight: 1.55, opacity: 0.86, fillOpacity: 0.12, dashArray: "" }),
  outOfScopeSelected: Object.freeze({ weight: 2.5, opacity: 0.92, fillOpacity: 0.24, dashArray: "" }),
  outOfScopeDefault: Object.freeze({ weight: 1.05, opacity: 0.3, fillOpacity: 0.008, dashArray: "" }),
});
const BORDER_PRESETS = Object.freeze({
  default: Object.freeze({
    shiku: Object.freeze({ width: 2.9, opacity: 0.86, color: "#44566c" }),
    block: Object.freeze({ width: 1.0, opacity: 0.86, style: "solid", color: "#44566c" }),
    fill: Object.freeze({ inScope: 1.0 }),
  }),
  thin: Object.freeze({
    shiku: Object.freeze({ width: 1.8, opacity: 0.62, color: "#5f6f82" }),
    block: Object.freeze({ width: 0.72, opacity: 0.62, style: "solid", color: "#5f6f82" }),
    fill: Object.freeze({ inScope: 0.85 }),
  }),
  bold: Object.freeze({
    shiku: Object.freeze({ width: 3.6, opacity: 0.95, color: "#2f4056" }),
    block: Object.freeze({ width: 1.45, opacity: 0.95, style: "solid", color: "#2f4056" }),
    fill: Object.freeze({ inScope: 1.12 }),
  }),
  "high-contrast": Object.freeze({
    shiku: Object.freeze({ width: 3.0, opacity: 1.0, color: "#111827" }),
    block: Object.freeze({ width: 1.35, opacity: 1.0, style: "solid", color: "#111827" }),
    fill: Object.freeze({ inScope: 1.0 }),
  }),
});

const state = {
  map: null,
  baseLayers: new Map(),
  activeBasemapId: "esri_street",
  geoLayerLite: null,
  geoLayerDetail: null,
  currentGeoLayer: null,
  renderMode: "lite",
  lastZoomForModeSwitch: 0,
  renderingLock: false,
  visibleFeatures: [],
  featureAreaIdMap: new WeakMap(),
  layerAreaIdMap: new WeakMap(),
  areaToLayers: new Map(),
  areaToLayersLite: new Map(),
  areaToLayersDetail: new Map(),
  areaMeta: new Map(),
  nameIndex: new Map(),
  assignments: new Map(),
  allAssignments: new Map(),
  initialAssignments: new Map(),
  initialAllAssignments: new Map(),
  selected: new Set(),
  visiblePrefectures: new Set(DEFAULT_VISIBLE_PREFECTURES),
  selectionHistory: [],
  selectionHistoryIndex: -1,
  inScopeMunicipalities: new Set(DEFAULT_IN_SCOPE_MUNICIPALITIES),
  municipalityBoundaryLayer: null,
  municipalityBoundaryRenderer: null,
  municipalityBoundarySource: null,
  loadedGeoData: null,
  asisAreaLabelByTown: new Map(),
  asisDefaultAreaLabelByMunicipality: new Map(),
  asisAreaLabelByPostal: new Map(),
  asisPostalCodesByTown: new Map(),
  depotMarkerLayer: null,
  brushSelection: {
    mode: "",
    pointerDown: false,
    dragActive: false,
    startAreaId: "",
    targetSelected: false,
    visitedAreaIds: new Set(),
    changed: false,
    disabledMapDragging: false,
    disabledTouchZoom: false,
  },
  suppressClickUntilMs: 0,
  suppressContextMenuUntilMs: 0,
  lastAreaClickAtMs: 0,
  loadingFlow: {
    token: "",
    active: false,
    scope: "",
    startedAt: 0,
    steps: {
      tiles: "pending",
      polygons: "pending",
    },
    closeTimerId: null,
    hideTimerId: null,
    dotTimerId: null,
    dotFrame: 0,
  },
  isMobileView: false,
  resizeTimerId: null,
  renderSwitchTimerId: null,
  prewarmTimerId: null,
  borderSettings: createBorderSettingsFromPreset("default"),
  borderUiRefresh: {
    timerId: null,
    rafId: null,
    queuedKinds: { shiku: false, block: false },
    lastRunAt: 0,
  },
  dirtyStyleModes: new Set(),
};

const el = {
  layout: document.getElementById("layout"),
  panelToggle: document.getElementById("panel-toggle"),
  panelBackdrop: document.getElementById("panel-backdrop"),
  exportCsv: document.getElementById("export-csv"),
  undoAction: document.getElementById("undo-action"),
  redoAction: document.getElementById("redo-action"),
  resetAll: document.getElementById("reset-all"),
  selectedCount: document.getElementById("selected-count"),
  selectedAreas: document.getElementById("selected-zips"),
  loadingOverlay: document.getElementById("loading-overlay"),
  loadingTitle: document.getElementById("loading-title"),
  loadingStepTiles: document.getElementById("loading-step-tiles"),
  loadingStepPolygons: document.getElementById("loading-step-polygons"),
  basemapInputs: [...document.querySelectorAll('input[name="basemap"]')],
  prefectureVisibilityInputs: [...document.querySelectorAll('input[name="prefecture-visibility"]')],
  borderPreset: document.getElementById("border-preset"),
  shikuWidth: document.getElementById("shiku-width"),
  shikuWidthValue: document.getElementById("shiku-width-value"),
  shikuOpacity: document.getElementById("shiku-opacity"),
  shikuOpacityValue: document.getElementById("shiku-opacity-value"),
  shikuColor: document.getElementById("shiku-color"),
  blockWidth: document.getElementById("block-width"),
  blockWidthValue: document.getElementById("block-width-value"),
  blockOpacity: document.getElementById("block-opacity"),
  blockOpacityValue: document.getElementById("block-opacity-value"),
  blockStyle: document.getElementById("block-style"),
  blockColor: document.getElementById("block-color"),
  fillInScope: document.getElementById("fill-inscope"),
  fillInScopeValue: document.getElementById("fill-inscope-value"),
};

init();

async function init() {
  const initialFlowToken = startLoadingFlow("initial", buildPolygonLoadingLabel("initial", state.visiblePrefectures));

  initMap();
  const initialLayer = state.baseLayers.get(state.activeBasemapId) || null;
  void waitForBasemapReady(initialLayer, 5000).then(() => {
    setLoadingStepDone("tiles", "Map Tilesを読み込んでいます...", initialFlowToken);
  });

  initDepotMarkers();
  setupEventHandlers();
  initBorderSettingsUi();
  initResponsiveSidebarMode();

  void loadInScopeMunicipalities();
  void loadAsisAreaLabels();
  await loadDefaultGeoJson(initialFlowToken);

  renderSelected();
}

function initMap() {
  state.map = L.map("map", { zoomControl: true, boxZoom: false, preferCanvas: true }).setView([35.45, 139.55], 11);
  state.lastZoomForModeSwitch = state.map.getZoom();
  state.renderMode = getRenderModeForZoom(state.lastZoomForModeSwitch, state.renderMode);

  state.map.createPane("municipalityBoundaryPane");
  state.map.getPane("municipalityBoundaryPane").style.zIndex = "520";

  state.map.createPane("depotPinPane");
  state.map.getPane("depotPinPane").style.zIndex = "650";

  Object.entries(BASEMAPS).forEach(([id, cfg]) => {
    state.baseLayers.set(id, L.tileLayer(cfg.url, cfg.options));
  });

  setBasemap("esri_street");
}

function setupEventHandlers() {
  el.exportCsv.addEventListener("click", exportAssignmentsCsv);
  el.undoAction?.addEventListener("click", undoSelection);
  el.redoAction?.addEventListener("click", redoSelection);
  el.resetAll?.addEventListener("click", resetAllAssignments);

  el.panelToggle.addEventListener("click", toggleSidebar);
  el.panelBackdrop?.addEventListener("click", () => {
    if (!el.layout.classList.contains("panel-collapsed")) {
      setSidebarCollapsed(true);
    }
  });
  updatePanelToggleLabel();

  window.addEventListener("resize", handleViewportResize);
  window.addEventListener("mouseup", handleGlobalMouseUp);
  window.addEventListener("contextmenu", handleGlobalContextMenu);

  const mapContainer = state.map?.getContainer();
  if (mapContainer) {
    mapContainer.addEventListener("touchstart", handleMapTouchStart, { passive: false });
    mapContainer.addEventListener("touchmove", handleMapTouchMove, { passive: false });
    mapContainer.addEventListener("touchend", handleMapTouchEnd, { passive: false });
    mapContainer.addEventListener("touchcancel", handleMapTouchEnd, { passive: false });
  }

  el.basemapInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) {
        setBasemap(input.value);
      }
    });
  });
  el.prefectureVisibilityInputs.forEach((input) => {
    input.addEventListener("change", handlePrefectureVisibilityChange);
  });

  document.querySelectorAll(".depot-btn").forEach((btn) => {
    btn.addEventListener("click", () => assignSelected(btn.dataset.depot));
  });

  state.map.on("zoomend", () => {
    scheduleRenderModeSwitch();
  });
  state.map.on("zoomstart", closeAllAreaTooltips);
  state.map.on("movestart", closeAllAreaTooltips);
  state.map.on("click", handleMapClickFallback);

  updateHistoryButtons();
}

function initBorderSettingsUi() {
  syncBorderSettingsUiFromState();
  setupBorderSettingsHandlers();
}

function setupBorderSettingsHandlers() {
  if (el.borderPreset) {
    el.borderPreset.addEventListener("change", () => {
      applyBorderPreset(el.borderPreset.value);
    });
  }

  bindRangeControl(el.shikuWidth, (value) => {
    state.borderSettings.shiku.width = clamp(toNumber(value, state.borderSettings.shiku.width), 0.2, 6.0);
    renderBorderSettingsValueLabels();
    scheduleBorderRefresh({ shiku: true });
  });
  bindRangeControl(el.shikuOpacity, (value) => {
    state.borderSettings.shiku.opacity = clamp(toNumber(value, state.borderSettings.shiku.opacity), 0, 1);
    renderBorderSettingsValueLabels();
    scheduleBorderRefresh({ shiku: true });
  });
  bindColorControl(el.shikuColor, (value) => {
    state.borderSettings.shiku.color = normalizeColor(value, state.borderSettings.shiku.color);
    scheduleBorderRefresh({ shiku: true });
  });

  bindRangeControl(el.blockWidth, (value) => {
    state.borderSettings.block.width = clamp(toNumber(value, state.borderSettings.block.width), 0.2, 3.0);
    renderBorderSettingsValueLabels();
    scheduleBorderRefresh({ block: true });
  });
  bindRangeControl(el.blockOpacity, (value) => {
    state.borderSettings.block.opacity = clamp(toNumber(value, state.borderSettings.block.opacity), 0, 1);
    renderBorderSettingsValueLabels();
    scheduleBorderRefresh({ block: true });
  });
  bindSelectControl(el.blockStyle, (value) => {
    state.borderSettings.block.style = normalizeBorderStyle(value);
    scheduleBorderRefresh({ block: true });
  });
  bindColorControl(el.blockColor, (value) => {
    state.borderSettings.block.color = normalizeColor(value, state.borderSettings.block.color);
    scheduleBorderRefresh({ block: true });
  });

  bindRangeControl(el.fillInScope, (value) => {
    state.borderSettings.fill.inScope = clamp(toNumber(value, state.borderSettings.fill.inScope), 0, 3);
    renderBorderSettingsValueLabels();
    scheduleBorderRefresh({ block: true });
  });
}

function bindRangeControl(node, onValue) {
  if (!node) {
    return;
  }
  const handler = () => onValue(node.value);
  node.addEventListener("input", handler);
  node.addEventListener("change", handler);
}

function bindSelectControl(node, onValue) {
  if (!node) {
    return;
  }
  node.addEventListener("change", () => onValue(node.value));
}

function bindColorControl(node, onValue) {
  if (!node) {
    return;
  }
  const handler = () => onValue(node.value);
  node.addEventListener("input", handler);
  node.addEventListener("change", handler);
}

function applyBorderPreset(presetKey) {
  state.borderSettings = createBorderSettingsFromPreset(presetKey);
  syncBorderSettingsUiFromState();
  scheduleBorderRefresh({ shiku: true, block: true });
}

function syncBorderSettingsUiFromState() {
  const settings = state.borderSettings;
  if (el.borderPreset) {
    el.borderPreset.value = settings.preset;
  }
  if (el.shikuWidth) {
    el.shikuWidth.value = String(settings.shiku.width);
  }
  if (el.shikuOpacity) {
    el.shikuOpacity.value = String(settings.shiku.opacity);
  }
  if (el.shikuColor) {
    el.shikuColor.value = settings.shiku.color;
  }
  if (el.blockWidth) {
    el.blockWidth.value = String(settings.block.width);
  }
  if (el.blockOpacity) {
    el.blockOpacity.value = String(settings.block.opacity);
  }
  if (el.blockStyle) {
    el.blockStyle.value = settings.block.style;
  }
  if (el.blockColor) {
    el.blockColor.value = settings.block.color;
  }
  if (el.fillInScope) {
    el.fillInScope.value = String(settings.fill.inScope);
  }
  renderBorderSettingsValueLabels();
}

function renderBorderSettingsValueLabels() {
  if (el.shikuWidthValue) {
    el.shikuWidthValue.textContent = state.borderSettings.shiku.width.toFixed(1);
  }
  if (el.shikuOpacityValue) {
    el.shikuOpacityValue.textContent = state.borderSettings.shiku.opacity.toFixed(2);
  }
  if (el.blockWidthValue) {
    el.blockWidthValue.textContent = state.borderSettings.block.width.toFixed(2);
  }
  if (el.blockOpacityValue) {
    el.blockOpacityValue.textContent = state.borderSettings.block.opacity.toFixed(2);
  }
  if (el.fillInScopeValue) {
    el.fillInScopeValue.textContent = state.borderSettings.fill.inScope.toFixed(2);
  }
}

function scheduleRenderModeSwitch() {
  if (state.renderSwitchTimerId) {
    clearTimeout(state.renderSwitchTimerId);
    state.renderSwitchTimerId = null;
  }
  state.renderSwitchTimerId = setTimeout(() => {
    state.renderSwitchTimerId = null;
    switchRenderModeIfNeeded();
  }, RENDER_SWITCH_DEBOUNCE_MS);
}

function handlePrefectureVisibilityChange() {
  if (state.renderingLock) {
    return;
  }
  const next = new Set(
    el.prefectureVisibilityInputs
      .filter((input) => input.checked)
      .map((input) => String(input.value || "").trim())
      .filter(Boolean)
  );
  const sameSize = next.size === state.visiblePrefectures.size;
  const sameMembers = sameSize && [...next].every((value) => state.visiblePrefectures.has(value));
  if (sameMembers) {
    return;
  }
  state.visiblePrefectures = next;
  state.renderingLock = true;
  const flowToken = startLoadingFlow("visibility", buildPolygonLoadingLabel("visibility", next));
  setLoadingStepDone("tiles", "Map Tilesを読み込んでいます...", flowToken);
  requestAnimationFrame(() => rebuildGeoLayerForVisibility(flowToken));
}

function rebuildGeoLayerForVisibility(flowToken = "") {
  try {
    if (!state.loadedGeoData) {
      finishLoadingFlowSilently(flowToken);
      return;
    }
    const assignmentSnapshot = new Map(state.allAssignments);
    const selectedSnapshot = new Set(state.selected);
    const initialAssignmentsSnapshot = new Map(state.initialAllAssignments);
    loadGeoJson(state.loadedGeoData, {
      preserveAssignmentSnapshot: assignmentSnapshot,
      preserveSelectionSnapshot: selectedSnapshot,
      preserveInitialAssignments: initialAssignmentsSnapshot,
      skipFitBounds: true,
      preferredRenderMode: state.renderMode,
    });
    scheduleLayerPrewarm();
    markPolygonsDoneAfterPaint(flowToken, buildPolygonLoadingLabel("visibility", state.visiblePrefectures));
  } finally {
    state.renderingLock = false;
    scheduleRenderModeSwitch();
  }
}

async function loadDefaultGeoJson(flowToken = "") {
  try {
    const res = await fetch("./data/asis_fine_polygons.geojson");
    if (!res.ok) {
      throw new Error(`status ${res.status}`);
    }
    const data = await res.json();
    initializeAllAssignmentsFromData(data);
    loadGeoJson(data);
    scheduleLayerPrewarm();
    markPolygonsDoneAfterPaint(flowToken, buildPolygonLoadingLabel("initial", state.visiblePrefectures));
  } catch (_err) {
    finishLoadingFlowSilently(flowToken);
    alert("Failed to load default data: data/asis_fine_polygons.geojson");
  }
}

function startLoadingFlow(scope, polygonLabel) {
  clearLoadingFlowTimers();
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  state.loadingFlow.token = token;
  state.loadingFlow.active = true;
  state.loadingFlow.scope = scope;
  state.loadingFlow.startedAt = Date.now();
  state.loadingFlow.steps.tiles = "pending";
  state.loadingFlow.steps.polygons = "pending";
  state.loadingFlow.dotFrame = 0;

  if (el.loadingOverlay) {
    el.loadingOverlay.classList.remove("is-closing");
    el.loadingOverlay.classList.add("is-visible");
  }

  setLoadingTitlePending("Loading", token);
  setLoadingStepPending("tiles", "Map Tilesを読み込んでいます...", token);
  setLoadingStepPending("polygons", polygonLabel, token);
  startLoadingDots(token);
  return token;
}

function setLoadingStepPending(stepKey, text, token = state.loadingFlow.token) {
  if (!isCurrentLoadingFlowToken(token)) {
    return;
  }
  state.loadingFlow.steps[stepKey] = "pending";
  const node = getLoadingStepElement(stepKey);
  if (!node) {
    return;
  }
  node.classList.remove("is-done");
  node.classList.add("is-pending");
  node.dataset.loadingBase = normalizeLoadingPendingText(text);
  renderLoadingDotsFrame(token);
}

function setLoadingStepDone(stepKey, text, token = state.loadingFlow.token) {
  if (!isCurrentLoadingFlowToken(token)) {
    return;
  }
  state.loadingFlow.steps[stepKey] = "done";
  const node = getLoadingStepElement(stepKey);
  if (node) {
    node.classList.remove("is-pending");
    node.classList.add("is-done");
    delete node.dataset.loadingBase;
    node.textContent = toDoneText(text || node.textContent || "");
  }

  if (state.loadingFlow.steps.tiles === "done" && state.loadingFlow.steps.polygons === "done") {
    finishLoadingFlowSilently(token);
  }
}

function finishLoadingFlowSilently(token = state.loadingFlow.token) {
  if (!isCurrentLoadingFlowToken(token)) {
    return;
  }

  clearLoadingFlowTimers();
  const elapsed = Date.now() - state.loadingFlow.startedAt;
  const waitMs = Math.max(0, LOADING_MIN_VISIBLE_MS - elapsed);

  state.loadingFlow.closeTimerId = setTimeout(() => {
    if (!isCurrentLoadingFlowToken(token)) {
      return;
    }

    if (el.loadingOverlay) {
      el.loadingOverlay.classList.add("is-closing");
    }

    state.loadingFlow.hideTimerId = setTimeout(() => {
      if (!isCurrentLoadingFlowToken(token)) {
        return;
      }
      if (el.loadingOverlay) {
        el.loadingOverlay.classList.remove("is-visible", "is-closing");
      }

      stopLoadingDots();
      state.loadingFlow.active = false;
      state.loadingFlow.scope = "";
      state.loadingFlow.startedAt = 0;
      state.loadingFlow.steps.tiles = "pending";
      state.loadingFlow.steps.polygons = "pending";
      state.loadingFlow.closeTimerId = null;
      state.loadingFlow.hideTimerId = null;
    }, LOADING_FADE_OUT_MS);
  }, waitMs);
}

function clearLoadingFlowTimers() {
  if (state.loadingFlow.closeTimerId) {
    clearTimeout(state.loadingFlow.closeTimerId);
    state.loadingFlow.closeTimerId = null;
  }
  if (state.loadingFlow.hideTimerId) {
    clearTimeout(state.loadingFlow.hideTimerId);
    state.loadingFlow.hideTimerId = null;
  }
  stopLoadingDots();
}

function isCurrentLoadingFlowToken(token) {
  return Boolean(token) && state.loadingFlow.active && state.loadingFlow.token === token;
}

function getLoadingStepElement(stepKey) {
  if (stepKey === "tiles") {
    return el.loadingStepTiles;
  }
  if (stepKey === "polygons") {
    return el.loadingStepPolygons;
  }
  return null;
}

function setLoadingTitlePending(text, token = state.loadingFlow.token) {
  if (!isCurrentLoadingFlowToken(token) || !el.loadingTitle) {
    return;
  }
  el.loadingTitle.dataset.loadingBase = normalizeLoadingPendingText(text || "Loading");
  renderLoadingDotsFrame(token);
}

function startLoadingDots(token = state.loadingFlow.token) {
  stopLoadingDots();
  if (!isCurrentLoadingFlowToken(token)) {
    return;
  }
  renderLoadingDotsFrame(token);
  state.loadingFlow.dotTimerId = setInterval(() => {
    if (!isCurrentLoadingFlowToken(token)) {
      stopLoadingDots();
      return;
    }
    state.loadingFlow.dotFrame += 1;
    renderLoadingDotsFrame(token);
  }, LOADING_DOT_INTERVAL_MS);
}

function stopLoadingDots() {
  if (state.loadingFlow.dotTimerId) {
    clearInterval(state.loadingFlow.dotTimerId);
    state.loadingFlow.dotTimerId = null;
  }
}

function renderLoadingDotsFrame(token = state.loadingFlow.token) {
  if (!isCurrentLoadingFlowToken(token)) {
    return;
  }
  const dots = ".".repeat((state.loadingFlow.dotFrame % 3) + 1);
  if (el.loadingTitle) {
    const base = el.loadingTitle.dataset.loadingBase || "Loading";
    el.loadingTitle.textContent = `${base}${dots}`;
  }
  ["tiles", "polygons"].forEach((stepKey) => {
    if (state.loadingFlow.steps[stepKey] !== "pending") {
      return;
    }
    const node = getLoadingStepElement(stepKey);
    if (!node) {
      return;
    }
    const base = node.dataset.loadingBase || normalizeLoadingPendingText(node.textContent || "");
    node.dataset.loadingBase = base;
    node.textContent = `${base}${dots}`;
  });
}

function normalizeLoadingPendingText(value) {
  const text = String(value || "").trim();
  return text.replace(/\s*完了$/, "").replace(/[.。…\s]+$/, "");
}

function toDoneText(value) {
  const text = String(value || "").trim();
  const normalized = text.replace(/\s*完了$/, "");
  if (normalized.endsWith("...") || normalized.endsWith("…")) {
    return `${normalized}完了`;
  }
  return `${normalized}...完了`;
}

function waitForBasemapReady(layer, timeoutMs = 5000) {
  return new Promise((resolve) => {
    if (!layer) {
      resolve();
      return;
    }

    let settled = false;
    let timerId = null;
    const cleanup = () => {
      if (timerId) {
        clearTimeout(timerId);
      }
      layer.off("load", handleDone);
      layer.off("tileerror", handleDone);
    };
    const handleDone = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve();
    };

    if (typeof layer.isLoading === "function" && !layer.isLoading()) {
      handleDone();
      return;
    }

    layer.once("load", handleDone);
    layer.once("tileerror", handleDone);
    timerId = setTimeout(handleDone, Math.max(400, timeoutMs));
  });
}

function markPolygonsDoneAfterPaint(token, label) {
  if (!isCurrentLoadingFlowToken(token)) {
    return;
  }
  const done = () => setLoadingStepDone("polygons", label, token);
  requestAnimationFrame(() => requestAnimationFrame(done));
}

function buildPolygonLoadingLabel(scope, visiblePrefectures) {
  if (scope === "initial") {
    return "東京都と神奈川県の町域ポリゴンを読み込んでいます...";
  }

  const values = Array.from(visiblePrefectures || []).filter(Boolean);
  if (values.length === 0) {
    return "選択中都県の町域ポリゴンを読み込んでいます...";
  }

  const sorted = values.sort((a, b) => {
    const ai = PREFECTURE_DISPLAY_ORDER.indexOf(a);
    const bi = PREFECTURE_DISPLAY_ORDER.indexOf(b);
    const aa = ai >= 0 ? ai : 99;
    const bb = bi >= 0 ? bi : 99;
    if (aa !== bb) {
      return aa - bb;
    }
    return a.localeCompare(b, "ja");
  });

  if (sorted.length <= 2) {
    return `${sorted.join("と")}の町域ポリゴンを読み込んでいます...`;
  }
  return "選択中都県の町域ポリゴンを読み込んでいます...";
}

function initializeAllAssignmentsFromData(data) {
  state.allAssignments.clear();
  state.initialAllAssignments.clear();

  let fallbackCounter = 0;
  (data?.features || []).forEach((feature) => {
    const props = feature?.properties || {};
    let areaId = getAreaId(props);
    const areaName = getAreaName(props);
    if (!areaId) {
      fallbackCounter += 1;
      areaId = areaName ? `name:${areaName}` : `feature:${String(fallbackCounter).padStart(5, "0")}`;
    }
    if (!areaId || state.allAssignments.has(areaId)) {
      return;
    }
    state.allAssignments.set(areaId, extractDepot(props) || "");
  });

  state.initialAllAssignments = new Map(state.allAssignments);
}

function initResponsiveSidebarMode() {
  state.isMobileView = isMobileViewport();
  if (state.isMobileView) {
    el.layout.classList.add("panel-collapsed");
  } else {
    el.layout.classList.remove("panel-collapsed");
  }
  updatePanelToggleLabel();
  setTimeout(() => state.map.invalidateSize(), 120);
}

function isMobileViewport() {
  return window.innerWidth <= MOBILE_BREAKPOINT_PX;
}

function handleViewportResize() {
  if (state.resizeTimerId) {
    clearTimeout(state.resizeTimerId);
  }
  state.resizeTimerId = setTimeout(() => state.map.invalidateSize(), 140);

  const nextMobile = isMobileViewport();
  if (nextMobile === state.isMobileView) {
    return;
  }
  state.isMobileView = nextMobile;
  setSidebarCollapsed(nextMobile);
}

function closeAllAreaTooltips() {
  state.areaToLayers.forEach((layers) => {
    layers.forEach((layer) => {
      if (typeof layer.closeTooltip === "function") {
        layer.closeTooltip();
      }
    });
  });
}

function toggleSidebar() {
  setSidebarCollapsed(!el.layout.classList.contains("panel-collapsed"));
}

function setSidebarCollapsed(collapsed) {
  el.layout.classList.toggle("panel-collapsed", collapsed);
  updatePanelToggleLabel();
  setTimeout(() => state.map.invalidateSize(), 220);
}

function updatePanelToggleLabel() {
  const collapsed = el.layout.classList.contains("panel-collapsed");
  el.panelToggle.dataset.collapsed = collapsed ? "true" : "false";
  el.panelToggle.setAttribute("aria-label", collapsed ? "Show Sidebar" : "Hide Sidebar");
  el.panelToggle.setAttribute("aria-expanded", String(!collapsed));
}

function setBasemap(id) {
  const nextId = BASEMAPS[id] ? id : "esri_street";
  if (nextId === state.activeBasemapId && state.baseLayers.get(nextId) && state.map.hasLayer(state.baseLayers.get(nextId))) {
    return;
  }

  state.baseLayers.forEach((layer) => {
    if (state.map.hasLayer(layer)) {
      state.map.removeLayer(layer);
    }
  });

  const nextLayer = state.baseLayers.get(nextId);
  if (nextLayer) {
    nextLayer.addTo(state.map);
    state.activeBasemapId = nextId;
  }

  el.basemapInputs.forEach((input) => {
    input.checked = input.value === state.activeBasemapId;
  });

  scheduleBorderRefresh({ shiku: true, block: true });
}

function initDepotMarkers() {
  if (state.depotMarkerLayer) {
    state.map.removeLayer(state.depotMarkerLayer);
  }

  state.depotMarkerLayer = L.layerGroup();
  DEPOT_SITES.forEach((site) => {
    const depot = DEPOTS[site.code];
    if (!depot) {
      return;
    }
    const depotName = stripDepotCodeSuffix(depot.name, site.code);

    const marker = L.marker([site.lat, site.lng], {
      pane: "depotPinPane",
      icon: L.divIcon({
        className: "",
        html: `<span class="depot-pin depot-${site.code.toLowerCase()}">${site.code}</span>`,
        iconSize: [56, 28],
        iconAnchor: [28, 14],
      }),
      title: `${site.code} ${depotName}`,
    });

    marker.bindTooltip(`${site.code} ${depotName}<br>${site.address}`, {
      direction: "top",
      offset: [0, -14],
      opacity: 0.95,
    });

    state.depotMarkerLayer.addLayer(marker);
  });

  state.depotMarkerLayer.addTo(state.map);
}

function stripDepotCodeSuffix(name, code) {
  const trimmed = String(name || "").trim();
  const normalizedCode = String(code || "").trim();
  if (!normalizedCode) {
    return trimmed;
  }
  const pattern = new RegExp(`\\s*${normalizedCode}\\s*$`, "i");
  return trimmed.replace(pattern, "").trim() || trimmed;
}

function bringDepotMarkersToFront() {
  state.depotMarkerLayer?.eachLayer?.((layer) => {
    layer?.bringToFront?.();
  });
}

async function loadInScopeMunicipalities() {
  try {
    const res = await fetch(OPERATIONAL_ADMIN_BOUNDARY_GEOJSON);
    if (!res.ok) {
      return;
    }
    const data = await res.json();
    if (!Array.isArray(data?.features)) {
      return;
    }

    const values = data.features
      .map((feature) => canonicalMunicipality(getMunicipalityFromProps(feature?.properties || {})))
      .filter(Boolean);

    if (values.length > 0) {
      state.inScopeMunicipalities = new Set(values);
    }

    refreshAllStyles();
    if (state.loadedGeoData) {
      void drawMunicipalityBoundaryLayer(state.loadedGeoData);
    }
  } catch (_err) {
    // 取得不可時は既定値(DEFAULT_IN_SCOPE_MUNICIPALITIES)を利用。
  }
}

async function loadAsisAreaLabels() {
  try {
    const res = await fetch("./asis.csv");
    if (!res.ok) {
      return;
    }
    const csvText = await res.text();
    buildAsisAreaLabelMaps(csvText);
    applyAsisAreaLabelsToLoadedAreas();
  } catch (_err) {
    // asis.csv が取得できない環境でも編集作業は継続可能。
  }
}

function buildAsisAreaLabelMaps(csvText) {
  const rows = parseCsvRows(csvText);
  if (rows.length < 2) {
    return;
  }

  const headers = rows[0].map((value) => normalizeHeader(value));
  const indexByHeader = new Map();
  headers.forEach((name, idx) => {
    if (name && !indexByHeader.has(name)) {
      indexByHeader.set(name, idx);
    }
  });

  const townCounter = new Map();
  const municipalityCounter = new Map();
  const postalCounter = new Map();
  const postalByTown = new Map();

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row || row.length === 0) {
      continue;
    }

    const depotCode = normalizeDepotCode(
      pickCsvValue(row, indexByHeader, ["管轄デポ", "担当デポ", "depot_code", "depot"])
    );
    if (!depotCode) {
      continue;
    }

    const municipality = canonicalMunicipality(pickCsvValue(row, indexByHeader, ["市区", "city", "municipality"]));
    if (!municipality) {
      continue;
    }

    const areaLabel = String(pickCsvValue(row, indexByHeader, ["対応エリア", "area_name", "group_label"]) || "").trim();
    if (!areaLabel || areaLabel === "特定施設・基地等") {
      continue;
    }

    addCount(municipalityCounter, municipality, areaLabel);

    const town = canonicalTownName(pickCsvValue(row, indexByHeader, ["町", "town", "S_NAME"]));
    const postalCodes = collectPostalCodes(
      pickCsvValue(row, indexByHeader, ["郵便番号", "postal_code", "zip_code", "zipcode", "zip"])
    );
    postalCodes.forEach((postal) => addCount(postalCounter, postal, areaLabel));
    if (town) {
      const key = `${municipality}|${town}`;
      addCount(townCounter, key, areaLabel);
      addPostalCodes(postalByTown, key, postalCodes);
    }
  }

  state.asisAreaLabelByTown = collapseCountMap(townCounter);
  state.asisDefaultAreaLabelByMunicipality = collapseCountMap(municipalityCounter);
  state.asisAreaLabelByPostal = collapseCountMap(postalCounter);
  state.asisPostalCodesByTown = collapsePostalCodeMap(postalByTown);
}

function addCount(container, key, label) {
  if (!key || !label) {
    return;
  }
  if (!container.has(key)) {
    container.set(key, new Map());
  }
  const counter = container.get(key);
  counter.set(label, (counter.get(label) || 0) + 1);
}

function addPostalCodes(container, key, codes) {
  if (!key || !Array.isArray(codes) || codes.length === 0) {
    return;
  }
  if (!container.has(key)) {
    container.set(key, new Set());
  }
  const codeSet = container.get(key);
  codes.forEach((code) => {
    if (code) {
      codeSet.add(code);
    }
  });
}

function collapseCountMap(counterMap) {
  const out = new Map();
  counterMap.forEach((counter, key) => {
    const sorted = [...counter.entries()].sort((a, b) => {
      if (b[1] !== a[1]) {
        return b[1] - a[1];
      }
      return a[0].localeCompare(b[0], "ja");
    });
    if (sorted.length > 0) {
      out.set(key, sorted[0][0]);
    }
  });
  return out;
}

function collapsePostalCodeMap(codeMap) {
  const out = new Map();
  codeMap.forEach((codeSet, key) => {
    const values = [...codeSet].sort((a, b) => a.localeCompare(b, "ja"));
    if (values.length > 0) {
      out.set(key, values);
    }
  });
  return out;
}

function applyAsisAreaLabelsToLoadedAreas() {
  state.areaMeta.forEach((meta, areaId) => {
    let changed = false;
    const resolvedLabel = getDispatchAreaLabel(meta.raw || {}, meta.municipality, meta.townName, meta.postalCodes || []);
    if (resolvedLabel && meta.dispatchAreaLabel !== resolvedLabel) {
      meta.dispatchAreaLabel = resolvedLabel;
      changed = true;
    }

    if (!meta.postalCodes || meta.postalCodes.length === 0) {
      const codes = lookupPostalCodes(meta.municipality, meta.townName);
      if (codes.length > 0) {
        meta.postalCodes = codes;
        changed = true;
      }
    }

    if (!changed) {
      return;
    }
    const allLayers = [
      ...(state.areaToLayersLite.get(areaId) || []),
      ...(state.areaToLayersDetail.get(areaId) || []),
    ];
    allLayers.forEach((layer) => {
      if (layer.getTooltip()) {
        layer.setTooltipContent(tooltipText(areaId));
      }
      if (layer.getPopup()) {
        layer.setPopupContent(buildPopupHtml(areaId));
      }
    });
  });
}

function loadGeoJson(data, options = {}) {
  if (!data || data.type !== "FeatureCollection" || !Array.isArray(data.features)) {
    alert("Please provide a valid GeoJSON FeatureCollection.");
    return;
  }
  const preserveAssignmentSnapshot = options.preserveAssignmentSnapshot instanceof Map ? options.preserveAssignmentSnapshot : null;
  const preserveSelectionSnapshot = options.preserveSelectionSnapshot instanceof Set ? options.preserveSelectionSnapshot : null;
  const preserveInitialAssignments = options.preserveInitialAssignments instanceof Map ? options.preserveInitialAssignments : null;
  const skipFitBounds = Boolean(options.skipFitBounds);
  const preferredRenderMode =
    options.preferredRenderMode === "lite" || options.preferredRenderMode === "detail"
      ? options.preferredRenderMode
      : getRenderModeForZoom(state.map?.getZoom?.() ?? DETAIL_ENTER_ZOOM, state.renderMode);

  state.loadedGeoData = data;
  state.lastZoomForModeSwitch = state.map?.getZoom?.() ?? state.lastZoomForModeSwitch;
  clearBorderRefreshQueue(true);

  removeGeoLayersFromMap();
  state.geoLayerLite = null;
  state.geoLayerDetail = null;
  state.currentGeoLayer = null;
  state.visibleFeatures = [];
  state.featureAreaIdMap = new WeakMap();
  state.layerAreaIdMap = new WeakMap();
  state.areaToLayersLite.clear();
  state.areaToLayersDetail.clear();
  state.areaToLayers.clear();
  state.areaMeta.clear();
  state.nameIndex.clear();
  state.assignments.clear();
  state.selected.clear();
  resetBrushSelection();

  let fallbackCounter = 0;
  data.features.forEach((feature) => {
    const props = feature?.properties || {};
    if (!isPrefectureVisible(props)) {
      return;
    }
    let areaId = getAreaId(props);
    const areaName = getAreaName(props);
    const municipality = getMunicipality(props, areaName);
    const townName = extractTownName(props, areaName, municipality);

    if (!areaId) {
      fallbackCounter += 1;
      areaId = areaName ? `name:${areaName}` : `feature:${String(fallbackCounter).padStart(5, "0")}`;
    }

    state.visibleFeatures.push(feature);
    state.featureAreaIdMap.set(feature, areaId);

    if (!state.areaMeta.has(areaId)) {
      const postalCodes = getPostalCodes(props, municipality, townName, areaId);
      state.areaMeta.set(areaId, {
        name: areaName || areaId,
        municipality,
        townName,
        dispatchAreaLabel: getDispatchAreaLabel(props, municipality, townName, postalCodes),
        postalCodes,
        raw: props,
      });
    }

    const snapshotDepot = preserveAssignmentSnapshot?.get(areaId) || "";
    const cachedDepot = state.allAssignments.get(areaId) || "";
    const initialDepot = extractDepot(props);
    const resolvedDepot = snapshotDepot || cachedDepot || initialDepot || "";
    state.assignments.set(areaId, resolvedDepot);
    state.allAssignments.set(areaId, resolvedDepot);
  });

  rebuildNameIndex();
  void drawMunicipalityBoundaryLayer(data);

  if (preserveSelectionSnapshot) {
    state.selected = new Set([...preserveSelectionSnapshot].filter((areaId) => state.areaMeta.has(areaId)));
  }

  activateLayer(preferredRenderMode);

  const preferredBounds = getPreferredFitBounds();
  if (!skipFitBounds && preferredBounds && preferredBounds.isValid()) {
    state.map.fitBounds(preferredBounds.pad(0.15));
  }

  if (state.initialAllAssignments.size > 0) {
    state.initialAssignments = buildVisibleAssignmentsFrom(state.initialAllAssignments);
  } else if (preserveInitialAssignments) {
    state.initialAssignments = buildVisibleAssignmentsFrom(preserveInitialAssignments);
  } else {
    state.initialAssignments = new Map(state.assignments);
  }
  resetSelectionHistory();
  refreshAllStyles();
  renderSelected();
  scheduleLayerPrewarm();
}

function removeGeoLayersFromMap() {
  if (state.prewarmTimerId) {
    clearTimeout(state.prewarmTimerId);
    state.prewarmTimerId = null;
  }
  if (state.renderSwitchTimerId) {
    clearTimeout(state.renderSwitchTimerId);
    state.renderSwitchTimerId = null;
  }
  [state.currentGeoLayer, state.geoLayerLite, state.geoLayerDetail].forEach((layer) => {
    if (layer && state.map?.hasLayer(layer)) {
      state.map.removeLayer(layer);
    }
  });
}

function getRenderModeForZoom(zoom, currentMode = state.renderMode) {
  const z = Number(zoom);
  if (!Number.isFinite(z)) {
    return "detail";
  }
  if (currentMode === "detail") {
    return z <= DETAIL_EXIT_ZOOM ? "lite" : "detail";
  }
  return z >= DETAIL_ENTER_ZOOM ? "detail" : "lite";
}

function switchRenderModeIfNeeded() {
  if (!state.map || state.renderingLock) {
    return;
  }
  const zoom = state.map.getZoom();
  state.lastZoomForModeSwitch = zoom;
  const nextMode = getRenderModeForZoom(zoom, state.renderMode);
  if (nextMode === state.renderMode) {
    return;
  }

  const needsBuild = nextMode === "detail" ? !state.geoLayerDetail : !state.geoLayerLite;
  if (!needsBuild) {
    activateLayer(nextMode);
    return;
  }

  state.renderingLock = true;
  requestAnimationFrame(() => {
    try {
      activateLayer(nextMode);
    } finally {
      state.renderingLock = false;
      scheduleRenderModeSwitch();
    }
  });
}

function activateLayer(mode) {
  const normalizedMode = mode === "detail" ? "detail" : "lite";
  let layer = normalizedMode === "detail" ? state.geoLayerDetail : state.geoLayerLite;
  if (!layer) {
    layer = buildGeoLayerForMode(normalizedMode);
  }
  if (!layer) {
    return;
  }

  if (state.currentGeoLayer && state.currentGeoLayer !== layer && state.map?.hasLayer(state.currentGeoLayer)) {
    state.map.removeLayer(state.currentGeoLayer);
  }
  if (state.map && !state.map.hasLayer(layer)) {
    layer.addTo(state.map);
  }

  state.currentGeoLayer = layer;
  state.renderMode = normalizedMode;
  state.lastZoomForModeSwitch = state.map?.getZoom?.() ?? state.lastZoomForModeSwitch;
  state.areaToLayers = normalizedMode === "detail" ? state.areaToLayersDetail : state.areaToLayersLite;
  if (state.dirtyStyleModes.has(normalizedMode)) {
    refreshStylesForMode(normalizedMode);
    state.dirtyStyleModes.delete(normalizedMode);
  }

  state.municipalityBoundaryLayer?.bringToFront();
  bringDepotMarkersToFront();
}

function buildGeoLayerForMode(mode) {
  const normalizedMode = mode === "detail" ? "detail" : "lite";
  const interactive = true;
  const enableBrush = normalizedMode === "detail";
  const layerMap = normalizedMode === "detail" ? state.areaToLayersDetail : state.areaToLayersLite;
  layerMap.clear();

  const layer = L.geoJSON(
    {
      type: "FeatureCollection",
      features: state.visibleFeatures,
    },
    {
      interactive,
      smoothFactor: normalizedMode === "detail" ? DETAIL_SMOOTH_FACTOR : LITE_SMOOTH_FACTOR,
      style: (feature) => styleForArea(state.featureAreaIdMap.get(feature) || getAreaId(feature?.properties || {}), normalizedMode),
      onEachFeature: (feature, featureLayer) => {
        const areaId = state.featureAreaIdMap.get(feature) || getAreaId(feature?.properties || {});
        if (!areaId) {
          return;
        }
        if (!layerMap.has(areaId)) {
          layerMap.set(areaId, []);
        }
        layerMap.get(areaId).push(featureLayer);
        state.layerAreaIdMap.set(featureLayer, areaId);

        featureLayer.on("click", () => handleAreaClick(areaId, featureLayer));

        if (!enableBrush) {
          return;
        }

        featureLayer.on("add", () => setAreaIdOnLayerElement(featureLayer, areaId));
        setAreaIdOnLayerElement(featureLayer, areaId);
        featureLayer.on("mousedown", (event) => beginBrushSelection(areaId, event, "mouse-right"));
        featureLayer.on("mouseover", () => applyBrushSelection(areaId));
        featureLayer.on("contextmenu", (event) => {
          event?.originalEvent?.preventDefault();
        });
        featureLayer.bindTooltip(tooltipText(areaId), {
          sticky: false,
          direction: "top",
          opacity: 0.94,
        });
        featureLayer.on("mouseout", () => {
          featureLayer.closeTooltip();
          featureLayer.closePopup();
        });
        featureLayer.on("remove", () => featureLayer.closeTooltip());
      },
    }
  );

  if (normalizedMode === "detail") {
    state.geoLayerDetail = layer;
  } else {
    state.geoLayerLite = layer;
  }
  return layer;
}

function scheduleLayerPrewarm() {
  if (state.prewarmTimerId) {
    clearTimeout(state.prewarmTimerId);
    state.prewarmTimerId = null;
  }
  state.prewarmTimerId = setTimeout(() => {
    state.prewarmTimerId = null;
    prewarmInactiveLayer();
  }, PREWARM_DELAY_MS);
}

function prewarmInactiveLayer() {
  if (state.renderingLock) {
    return;
  }
  const inactiveMode = state.renderMode === "detail" ? "lite" : "detail";
  const alreadyBuilt = inactiveMode === "detail" ? state.geoLayerDetail : state.geoLayerLite;
  if (alreadyBuilt) {
    return;
  }
  try {
    buildGeoLayerForMode(inactiveMode);
    const areaMap = inactiveMode === "detail" ? state.areaToLayersDetail : state.areaToLayersLite;
    areaMap.forEach((layers, areaId) => {
      layers.forEach((layer) => layer.setStyle(styleForArea(areaId, inactiveMode)));
    });
  } catch (_err) {
    // prewarm失敗時は体験を止めない
  }
}

function isPrefectureVisible(props) {
  const prefName = getPrefectureName(props);
  if (!prefName) {
    return true;
  }
  return state.visiblePrefectures.has(prefName);
}

function getPrefectureName(props) {
  const prefName = String(props?.pref_name || props?.N03_001 || "").trim();
  return prefName;
}

function buildVisibleAssignmentsFrom(source) {
  const out = new Map();
  state.areaMeta.forEach((_meta, areaId) => {
    out.set(areaId, source.get(areaId) || "");
  });
  return out;
}

function getPreferredFitBounds() {
  let preferred = null;
  state.areaToLayers.forEach((layers, areaId) => {
    if (!isInScopeArea(areaId)) {
      return;
    }
    layers.forEach((layer) => {
      if (typeof layer.getBounds !== "function") {
        return;
      }
      const layerBounds = layer.getBounds();
      if (!layerBounds || !layerBounds.isValid()) {
        return;
      }
      if (!preferred) {
        preferred = L.latLngBounds(layerBounds.getSouthWest(), layerBounds.getNorthEast());
      } else {
        preferred.extend(layerBounds);
      }
    });
  });

  if (preferred && preferred.isValid()) {
    return preferred;
  }
  const fallbackBounds = state.currentGeoLayer?.getBounds?.() || state.geoLayerLite?.getBounds?.() || state.geoLayerDetail?.getBounds?.();
  if (fallbackBounds && fallbackBounds.isValid()) {
    return fallbackBounds;
  }
  return null;
}

function handleAreaClick(areaId, layer) {
  if (Date.now() < state.suppressClickUntilMs) {
    return;
  }
  state.lastAreaClickAtMs = Date.now();

  let changedSelection = false;
  if (state.selected.has(areaId)) {
    state.selected.delete(areaId);
  } else {
    state.selected.add(areaId);
  }
  changedSelection = true;
  applyAreaStyle(areaId);
  renderSelected();

  const content = buildPopupHtml(areaId);
  if (layer.getPopup()) {
    layer.setPopupContent(content);
  } else {
    layer.bindPopup(content, { maxWidth: 360 });
  }
  layer.openPopup();

  if (changedSelection) {
    pushSelectionHistory();
  }
}

function handleMapClickFallback(event) {
  if (!event?.latlng || !state.currentGeoLayer || state.renderingLock) {
    return;
  }
  const originalTarget = event?.originalEvent?.target;
  if (originalTarget?.closest?.(".depot-pin")) {
    return;
  }
  if (Date.now() - state.lastAreaClickAtMs < 80) {
    return;
  }

  const hitLayer = findAreaLayerAtLatLng(event.latlng);
  if (!hitLayer) {
    return;
  }
  const areaId = state.layerAreaIdMap.get(hitLayer);
  if (!areaId) {
    return;
  }
  handleAreaClick(areaId, hitLayer);
}

function findAreaLayerAtLatLng(latlng) {
  if (!state.currentGeoLayer || !state.map || !latlng) {
    return null;
  }
  const point = state.map.latLngToLayerPoint(latlng);
  let hitLayer = null;
  state.currentGeoLayer.eachLayer((layer) => {
    if (hitLayer || typeof layer?._containsPoint !== "function") {
      return;
    }
    if (typeof layer.getBounds === "function") {
      const bounds = layer.getBounds();
      if (bounds && bounds.isValid && !bounds.contains(latlng)) {
        return;
      }
    }
    if (layer._containsPoint(point)) {
      hitLayer = layer;
    }
  });
  return hitLayer;
}

function beginBrushSelection(areaId, event, mode) {
  if (!state.areaToLayers.has(areaId)) {
    return;
  }

  if (mode === "mouse-right") {
    if (event?.originalEvent?.button !== 2) {
      return;
    }
  } else if (mode === "touch-two-finger") {
    if ((event?.originalEvent?.touches?.length || 0) < 2) {
      return;
    }
  } else {
    return;
  }

  const brush = state.brushSelection;
  brush.mode = mode;
  brush.pointerDown = true;
  brush.dragActive = false;
  brush.startAreaId = areaId;
  brush.targetSelected = !state.selected.has(areaId);
  brush.visitedAreaIds = new Set();
  brush.changed = false;
  brush.disabledMapDragging = false;
  brush.disabledTouchZoom = false;

  if (state.map?.dragging?.enabled()) {
    state.map.dragging.disable();
    brush.disabledMapDragging = true;
  }
  if (mode === "touch-two-finger" && state.map?.touchZoom?.enabled?.()) {
    state.map.touchZoom.disable();
    brush.disabledTouchZoom = true;
  }

  if (event?.originalEvent?.preventDefault) {
    event.originalEvent.preventDefault();
  }
}

function applyBrushSelection(areaId) {
  const brush = state.brushSelection;
  if (!brush.pointerDown || !brush.mode) {
    return;
  }
  if (!state.areaToLayers.has(areaId)) {
    return;
  }

  if (!brush.dragActive && areaId !== brush.startAreaId) {
    brush.dragActive = true;
    applyBrushSelectionForArea(brush.startAreaId);
  }
  if (!brush.dragActive) {
    return;
  }

  applyBrushSelectionForArea(areaId);
}

function applyBrushSelectionForArea(areaId) {
  if (!state.areaToLayers.has(areaId)) {
    return;
  }

  const brush = state.brushSelection;
  if (brush.visitedAreaIds.has(areaId)) {
    return;
  }
  brush.visitedAreaIds.add(areaId);

  const hasArea = state.selected.has(areaId);
  if (brush.targetSelected && !hasArea) {
    state.selected.add(areaId);
    applyAreaStyle(areaId);
    brush.changed = true;
    return;
  }
  if (!brush.targetSelected && hasArea) {
    state.selected.delete(areaId);
    applyAreaStyle(areaId);
    brush.changed = true;
  }
}

function finalizeBrushSelection(mode) {
  const brush = state.brushSelection;
  if (!brush.pointerDown || !brush.mode || brush.mode !== mode) {
    return;
  }

  const wasDragSelection = brush.dragActive;
  const hadChanges = brush.changed;
  resetBrushSelection();

  if (!wasDragSelection) {
    return;
  }

  if (hadChanges) {
    renderSelected();
    pushSelectionHistory();
  }
  state.suppressClickUntilMs = Date.now() + 260;
}

function resetBrushSelection() {
  const brush = state.brushSelection;
  if (brush.disabledMapDragging && state.map?.dragging && !state.map.dragging.enabled()) {
    state.map.dragging.enable();
  }
  if (brush.disabledTouchZoom && state.map?.touchZoom?.enabled && !state.map.touchZoom.enabled()) {
    state.map.touchZoom.enable();
  }

  brush.mode = "";
  brush.pointerDown = false;
  brush.dragActive = false;
  brush.startAreaId = "";
  brush.targetSelected = false;
  brush.visitedAreaIds = new Set();
  brush.changed = false;
  brush.disabledMapDragging = false;
  brush.disabledTouchZoom = false;
}

function handleGlobalMouseUp(event) {
  if (event?.button !== 2) {
    return;
  }
  state.suppressContextMenuUntilMs = Date.now() + 320;
  finalizeBrushSelection("mouse-right");
}

function handleGlobalContextMenu(event) {
  if (Date.now() < state.suppressContextMenuUntilMs) {
    event.preventDefault();
    return;
  }
  if (state.brushSelection.mode !== "mouse-right") {
    return;
  }
  event.preventDefault();
}

function handleMapTouchStart(event) {
  if (state.brushSelection.pointerDown) {
    return;
  }
  if ((event.touches?.length || 0) < 2) {
    return;
  }

  const areaId = findFirstAreaIdFromTouches(event.touches);
  if (!areaId) {
    return;
  }

  beginBrushSelection(areaId, { originalEvent: event }, "touch-two-finger");
}

function handleMapTouchMove(event) {
  const brush = state.brushSelection;
  if (brush.mode !== "touch-two-finger" || !brush.pointerDown) {
    return;
  }

  if ((event.touches?.length || 0) < 2) {
    finalizeBrushSelection("touch-two-finger");
    return;
  }

  event.preventDefault();
  if (!brush.dragActive) {
    brush.dragActive = true;
    applyBrushSelectionForArea(brush.startAreaId);
  }

  const areaIds = findAreaIdsFromTouches(event.touches);
  areaIds.forEach((areaId) => applyBrushSelection(areaId));
}

function handleMapTouchEnd(event) {
  if (state.brushSelection.mode !== "touch-two-finger") {
    return;
  }
  if ((event.touches?.length || 0) >= 2) {
    return;
  }
  finalizeBrushSelection("touch-two-finger");
}

function setAreaIdOnLayerElement(layer, areaId) {
  if (!layer || typeof layer.getElement !== "function") {
    return;
  }
  const element = layer.getElement();
  if (!element) {
    return;
  }
  element.dataset.areaId = areaId;
}

function findFirstAreaIdFromTouches(touches) {
  for (const touch of Array.from(touches || [])) {
    const areaId = findAreaIdFromPoint(touch.clientX, touch.clientY);
    if (areaId) {
      return areaId;
    }
  }
  return "";
}

function findAreaIdsFromTouches(touches) {
  const out = new Set();
  for (const touch of Array.from(touches || [])) {
    const areaId = findAreaIdFromPoint(touch.clientX, touch.clientY);
    if (areaId) {
      out.add(areaId);
    }
  }
  return out;
}

function findAreaIdFromPoint(clientX, clientY) {
  const element = document.elementFromPoint(clientX, clientY);
  if (!element) {
    return "";
  }

  const mapContainer = state.map?.getContainer();
  let cursor = element;
  while (cursor && cursor !== document.body) {
    const areaId = cursor.dataset?.areaId;
    if (areaId && state.areaToLayers.has(areaId)) {
      return areaId;
    }
    if (cursor === mapContainer) {
      break;
    }
    cursor = cursor.parentElement;
  }
  return "";
}

function getDispatchAreaLabel(props, municipality, townName, postalCodes = []) {
  const inline = String(
    props.dispatch_area_label || props.dispatch_area || props.group_label || props.対応エリア || ""
  ).trim();
  const fromAsis = lookupDispatchAreaLabel(municipality, townName, postalCodes);
  if (fromAsis) {
    return fromAsis;
  }
  if (inline && inline !== municipality) {
    return inline;
  }
  return inline || "";
}

function getPostalCodes(props, municipality, townName, areaId) {
  const fromProps = ZIP_KEYS.flatMap((key) => collectPostalCodes(props[key]));
  if (fromProps.length > 0) {
    return [...new Set(fromProps)];
  }

  const fromAsis = lookupPostalCodes(municipality, townName);
  if (fromAsis.length > 0) {
    return fromAsis;
  }

  const fromAreaId = collectPostalCodes(areaId);
  if (fromAreaId.length > 0) {
    return fromAreaId;
  }
  return [];
}

function lookupDispatchAreaLabel(municipality, townName, postalCodes = []) {
  const muni = canonicalMunicipality(municipality);
  if (!muni) {
    return "";
  }

  const town = canonicalTownName(townName);
  if (town) {
    const key = `${muni}|${town}`;
    if (state.asisAreaLabelByTown.has(key)) {
      return state.asisAreaLabelByTown.get(key);
    }
  }

  for (const code of postalCodes) {
    const zip = normalizeZip(code);
    if (zip && state.asisAreaLabelByPostal.has(zip)) {
      return state.asisAreaLabelByPostal.get(zip);
    }
  }

  return state.asisDefaultAreaLabelByMunicipality.get(muni) || "";
}

function lookupPostalCodes(municipality, townName) {
  const muni = canonicalMunicipality(municipality);
  if (!muni) {
    return [];
  }
  const town = canonicalTownName(townName);
  if (!town) {
    return [];
  }
  return state.asisPostalCodesByTown.get(`${muni}|${town}`) || [];
}

function tooltipText(areaId) {
  const meta = state.areaMeta.get(areaId);
  if (!meta) {
    return formatAreaIdForDisplay(areaId);
  }
  return meta.name || formatAreaIdForDisplay(areaId);
}

function buildPopupHtml(areaId) {
  const meta = state.areaMeta.get(areaId);
  if (!meta) {
    return `<div class="popup-grid"><dt>Town</dt><dd>${escapeHtml(formatAreaIdForDisplay(areaId))}</dd></div>`;
  }

  if (!isInScopeArea(areaId)) {
    return ['<dl class="popup-grid">', `<dt>Town</dt><dd>${escapeHtml(meta.name || "-")}</dd>`, "</dl>"].join("");
  }

  const depotCode = state.assignments.get(areaId) || "";
  const depotName = DEPOTS[depotCode]?.name || "Unassigned";
  const areaLabel =
    meta.dispatchAreaLabel ||
    lookupDispatchAreaLabel(meta.municipality, meta.townName, meta.postalCodes || []) ||
    meta.municipality ||
    "-";

  return [
    '<dl class="popup-grid">',
    `<dt>Town</dt><dd>${escapeHtml(meta.name || "-")}</dd>`,
    `<dt>Area</dt><dd>${escapeHtml(areaLabel)}</dd>`,
    `<dt>Depot</dt><dd>${escapeHtml(depotName)}</dd>`,
    "</dl>",
  ].join("");
}

function styleForArea(areaId, mode = state.renderMode) {
  const selected = state.selected.has(areaId);
  const assignment = state.assignments.get(areaId);
  const depot = DEPOTS[assignment];
  const baseColor = depot ? depot.color : "#9ea8b6";
  const isOutOfScope = !isInScopeArea(areaId);
  const fujScale = assignment === "FUJ" ? 1.3 : 1;
  const styleSet = mode === "lite" ? LITE_STYLE : DETAIL_STYLE;
  const style = isOutOfScope
    ? selected
      ? styleSet.outOfScopeSelected
      : styleSet.outOfScopeDefault
    : selected
      ? styleSet.selected
      : styleSet.default;
  const defaultStyle = isOutOfScope ? styleSet.outOfScopeDefault : styleSet.default;
  const weightScale = defaultStyle.weight > 0 ? style.weight / defaultStyle.weight : 1;
  const opacityScale = defaultStyle.opacity > 0 ? style.opacity / defaultStyle.opacity : 1;
  const block = state.borderSettings.block;
  const boundaryColors = getEffectiveBoundaryColors();
  const fillScale = isOutOfScope ? 1 : state.borderSettings.fill.inScope;
  const dashArray = BORDER_STYLE_DASH[normalizeBorderStyle(block.style)];
  const baseFillOpacity = isOutOfScope
    ? style.fillOpacity
    : mode === "lite"
      ? Math.min(0.4, style.fillOpacity * fujScale)
      : Math.min(0.5, style.fillOpacity * fujScale);
  const fillColor = isOutOfScope && (mode === "lite" || selected) ? "#8f98a5" : baseColor;
  return {
    color: boundaryColors.block,
    weight: clamp(block.width * weightScale, 0.2, 6),
    dashArray,
    fillColor,
    fillOpacity: clamp(baseFillOpacity * fillScale, 0, 1),
    opacity: clamp(block.opacity * opacityScale, 0, 1),
  };
}

function isInScopeArea(areaId) {
  const municipality = String(state.areaMeta.get(areaId)?.municipality || "").trim();
  if (!municipality) {
    return true;
  }
  return state.inScopeMunicipalities.has(municipality);
}

async function drawMunicipalityBoundaryLayer(fallbackData) {
  if (state.municipalityBoundaryLayer) {
    state.map.removeLayer(state.municipalityBoundaryLayer);
  }
  if (!state.municipalityBoundaryRenderer) {
    state.municipalityBoundaryRenderer = L.svg({ pane: "municipalityBoundaryPane" });
  }

  const sourceData = (await getMunicipalityBoundarySource()) || fallbackData;
  if (!sourceData || !Array.isArray(sourceData.features)) {
    return;
  }

  const loadedMunicipalities = new Set(
    [...state.areaMeta.values()]
      .map((meta) => canonicalMunicipality(meta.municipality))
      .filter(Boolean)
  );

  state.municipalityBoundaryLayer = L.geoJSON(sourceData, {
    pane: "municipalityBoundaryPane",
    renderer: state.municipalityBoundaryRenderer,
    style: () => getMunicipalityBoundaryStyle(),
    filter: (feature) => {
      const municipality = canonicalMunicipality(getMunicipalityFromProps(feature?.properties || {}));
      if (!municipality) {
        return false;
      }
      return loadedMunicipalities.size === 0 || loadedMunicipalities.has(municipality);
    },
  }).addTo(state.map);

  state.municipalityBoundaryLayer.bringToFront();
  bringDepotMarkersToFront();
}

function getMunicipalityBoundaryStyle() {
  const shiku = state.borderSettings.shiku;
  const boundaryColors = getEffectiveBoundaryColors();
  return {
    color: boundaryColors.shiku,
    weight: clamp(toNumber(shiku.width, 2.9), 0.2, 6),
    dashArray: "",
    opacity: clamp(toNumber(shiku.opacity, 0.86), 0, 1),
    fillOpacity: 0,
    interactive: false,
  };
}

function getEffectiveBoundaryColors() {
  if (state.activeBasemapId === "gsi_seamless") {
    return {
      shiku: "#f5f8ff",
      block: "#e4ecfa",
    };
  }
  return {
    shiku: normalizeColor(state.borderSettings.shiku.color, "#44566c"),
    block: normalizeColor(state.borderSettings.block.color, "#44566c"),
  };
}

async function getMunicipalityBoundarySource() {
  if (state.municipalityBoundarySource) {
    return state.municipalityBoundarySource;
  }

  try {
    const paths = [FULL_ADMIN_BOUNDARY_GEOJSON, OPERATIONAL_ADMIN_BOUNDARY_GEOJSON];
    for (const path of paths) {
      try {
        const res = await fetch(path);
        if (!res.ok) {
          continue;
        }
        const data = await res.json();
        if (!Array.isArray(data?.features)) {
          continue;
        }
        state.municipalityBoundarySource = data;
        return data;
      } catch (_innerErr) {
        // Try next source.
      }
    }
  } catch (_err) {
    // ignore
  }
  return null;
}

function refreshStylesForMode(mode) {
  const normalizedMode = mode === "detail" ? "detail" : "lite";
  const layerMap = normalizedMode === "detail" ? state.areaToLayersDetail : state.areaToLayersLite;
  layerMap.forEach((layers, areaId) => {
    layers.forEach((layer) => layer.setStyle(styleForArea(areaId, normalizedMode)));
  });
}

function refreshAllStyles() {
  refreshStylesForMode("detail");
  refreshStylesForMode("lite");
}

function scheduleBorderRefresh(kinds = {}) {
  if (kinds.shiku) {
    state.borderUiRefresh.queuedKinds.shiku = true;
  }
  if (kinds.block) {
    state.borderUiRefresh.queuedKinds.block = true;
  }
  if (!state.borderUiRefresh.queuedKinds.shiku && !state.borderUiRefresh.queuedKinds.block) {
    return;
  }
  if (state.borderUiRefresh.timerId || state.borderUiRefresh.rafId) {
    return;
  }
  const elapsed = Date.now() - state.borderUiRefresh.lastRunAt;
  const delay = Math.max(0, BORDER_REFRESH_THROTTLE_MS - elapsed);
  state.borderUiRefresh.timerId = setTimeout(() => {
    state.borderUiRefresh.timerId = null;
    state.borderUiRefresh.rafId = requestAnimationFrame(() => {
      state.borderUiRefresh.rafId = null;
      runBorderRefresh();
    });
  }, delay);
}

function runBorderRefresh() {
  const queued = state.borderUiRefresh.queuedKinds;
  const applyShiku = Boolean(queued.shiku);
  const applyBlock = Boolean(queued.block);
  state.borderUiRefresh.queuedKinds = { shiku: false, block: false };
  state.borderUiRefresh.lastRunAt = Date.now();

  if (applyShiku) {
    state.municipalityBoundaryLayer?.setStyle(getMunicipalityBoundaryStyle());
  }
  if (applyBlock) {
    const currentMode = state.renderMode === "detail" ? "detail" : "lite";
    const inactiveMode = currentMode === "detail" ? "lite" : "detail";
    refreshStylesForMode(currentMode);
    state.dirtyStyleModes.delete(currentMode);
    state.dirtyStyleModes.add(inactiveMode);
  }
}

function clearBorderRefreshQueue(clearDirty = false) {
  if (state.borderUiRefresh.timerId) {
    clearTimeout(state.borderUiRefresh.timerId);
    state.borderUiRefresh.timerId = null;
  }
  if (state.borderUiRefresh.rafId) {
    cancelAnimationFrame(state.borderUiRefresh.rafId);
    state.borderUiRefresh.rafId = null;
  }
  state.borderUiRefresh.queuedKinds.shiku = false;
  state.borderUiRefresh.queuedKinds.block = false;
  if (clearDirty) {
    state.dirtyStyleModes.clear();
  }
}

function applyAreaStyle(areaId) {
  const detailLayers = state.areaToLayersDetail.get(areaId) || [];
  detailLayers.forEach((layer) => layer.setStyle(styleForArea(areaId, "detail")));
  const liteLayers = state.areaToLayersLite.get(areaId) || [];
  liteLayers.forEach((layer) => layer.setStyle(styleForArea(areaId, "lite")));
}

function toggleAreaSelection(areaId) {
  if (!state.areaToLayers.has(areaId)) {
    return;
  }
  if (state.selected.has(areaId)) {
    state.selected.delete(areaId);
  } else {
    state.selected.add(areaId);
  }
  applyAreaStyle(areaId);
  renderSelected();
  pushSelectionHistory();
}

function clearSelection() {
  if (state.selected.size === 0) {
    return;
  }
  const selectedNow = [...state.selected];
  state.selected.clear();
  selectedNow.forEach((areaId) => {
    applyAreaStyle(areaId);
  });
  renderSelected();
  pushSelectionHistory();
}

function assignSelected(depotCode) {
  if (!DEPOTS[depotCode]) {
    return;
  }
  if (state.selected.size === 0) {
    alert("Select at least one zone first.");
    return;
  }

  let changed = false;
  const changedAreaIds = [];
  state.selected.forEach((areaId) => {
    if (!isInScopeArea(areaId)) {
      return;
    }
    if (state.assignments.get(areaId) === depotCode) {
      return;
    }
    state.assignments.set(areaId, depotCode);
    state.allAssignments.set(areaId, depotCode);
    changed = true;
    changedAreaIds.push(areaId);

    const layers = state.areaToLayers.get(areaId) || [];
    layers.forEach((layer) => {
      if (layer.getPopup()) {
        layer.setPopupContent(buildPopupHtml(areaId));
      }
    });
  });

  if (!changed) {
    return;
  }

  changedAreaIds.forEach((areaId) => applyAreaStyle(areaId));
}

function createAssignmentSnapshot() {
  return new Map(state.assignments);
}

function isSameAssignmentSnapshot(a, b) {
  if (!a || !b || a.size !== b.size) {
    return false;
  }
  for (const [key, value] of a.entries()) {
    if (b.get(key) !== value) {
      return false;
    }
  }
  return true;
}

function createSelectionSnapshot() {
  return [...state.selected].sort((a, b) => a.localeCompare(b, "ja"));
}

function isSameSelectionSnapshot(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function resetSelectionHistory() {
  state.selectionHistory = [createSelectionSnapshot()];
  state.selectionHistoryIndex = 0;
  updateHistoryButtons();
}

function pushSelectionHistory() {
  const snapshot = createSelectionSnapshot();
  const current = state.selectionHistory[state.selectionHistoryIndex];
  if (current && isSameSelectionSnapshot(current, snapshot)) {
    return;
  }
  if (state.selectionHistoryIndex < state.selectionHistory.length - 1) {
    state.selectionHistory = state.selectionHistory.slice(0, state.selectionHistoryIndex + 1);
  }
  state.selectionHistory.push(snapshot);
  state.selectionHistoryIndex = state.selectionHistory.length - 1;
  updateHistoryButtons();
}

function applySelectionSnapshot(snapshot) {
  if (!Array.isArray(snapshot)) {
    return;
  }
  const nextSelected = new Set(snapshot);
  const changedAreaIds = new Set();
  state.selected.forEach((areaId) => {
    if (!nextSelected.has(areaId)) {
      changedAreaIds.add(areaId);
    }
  });
  nextSelected.forEach((areaId) => {
    if (!state.selected.has(areaId)) {
      changedAreaIds.add(areaId);
    }
  });
  state.selected = nextSelected;
  changedAreaIds.forEach((areaId) => applyAreaStyle(areaId));
  renderSelected();
}

function syncPopupContentForAllAreas() {
  const areaIds = new Set([...state.areaToLayersLite.keys(), ...state.areaToLayersDetail.keys()]);
  areaIds.forEach((areaId) => {
    const layers = [...(state.areaToLayersLite.get(areaId) || []), ...(state.areaToLayersDetail.get(areaId) || [])];
    layers.forEach((layer) => {
      if (layer.getPopup()) {
        layer.setPopupContent(buildPopupHtml(areaId));
      }
    });
  });
}

function undoSelection() {
  if (state.selectionHistoryIndex <= 0) {
    return;
  }
  state.selectionHistoryIndex -= 1;
  applySelectionSnapshot(state.selectionHistory[state.selectionHistoryIndex]);
  updateHistoryButtons();
}

function redoSelection() {
  if (state.selectionHistoryIndex >= state.selectionHistory.length - 1) {
    return;
  }
  state.selectionHistoryIndex += 1;
  applySelectionSnapshot(state.selectionHistory[state.selectionHistoryIndex]);
  updateHistoryButtons();
}

function resetAllAssignments() {
  if (state.areaMeta.size === 0) {
    return;
  }
  resetBrushSelection();
  state.allAssignments = new Map(state.initialAllAssignments);
  state.assignments = buildVisibleAssignmentsFrom(state.allAssignments);
  state.selected.clear();
  refreshAllStyles();
  syncPopupContentForAllAreas();
  renderSelected();
  resetSelectionHistory();
}

function updateHistoryButtons() {
  if (el.undoAction) {
    el.undoAction.disabled = state.selectionHistoryIndex <= 0;
  }
  if (el.redoAction) {
    el.redoAction.disabled = state.selectionHistoryIndex >= state.selectionHistory.length - 1;
  }
}

function rebuildNameIndex() {
  state.nameIndex.clear();
  state.areaMeta.forEach((meta, areaId) => {
    const names = [areaId, formatAreaIdForDisplay(areaId), meta.name, meta.municipality, meta.dispatchAreaLabel || ""];
    names.forEach((name) => {
      if (!name) {
        return;
      }
      const raw = String(name);
      addNameIndex(normalizeMatchKey(raw), areaId);
      addNameIndex(normalizeMatchKey(canonicalAreaName(raw)), areaId);
    });
  });
}

function addNameIndex(key, areaId) {
  if (!key) {
    return;
  }
  if (!state.nameIndex.has(key)) {
    state.nameIndex.set(key, new Set());
  }
  state.nameIndex.get(key).add(areaId);
}

function exportAssignmentsCsv() {
  if (state.areaMeta.size === 0) {
    alert("No area data loaded.");
    return;
  }

  const rows = [["area_id", "area_name", "municipality", "depot_code", "depot_name"]];
  const areaIds = [...state.areaMeta.keys()].sort((a, b) => {
    const am = state.areaMeta.get(a);
    const bm = state.areaMeta.get(b);
    const keyA = `${am?.municipality || ""} ${am?.name || ""} ${a}`;
    const keyB = `${bm?.municipality || ""} ${bm?.name || ""} ${b}`;
    return keyA.localeCompare(keyB, "ja");
  });

  areaIds.forEach((areaId) => {
    const meta = state.areaMeta.get(areaId);
    const depotCode = state.assignments.get(areaId) || "";
    const depotName = DEPOTS[depotCode]?.name || "";
    rows.push([areaId, meta?.name || "", meta?.municipality || "", depotCode, depotName]);
  });

  const csv = rows
    .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `depot_assignments_admin_${getDateStamp()}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function getDateStamp() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function renderSelected() {
  const areaIds = [...state.selected].sort((a, b) => a.localeCompare(b, "ja"));
  el.selectedCount.textContent = `Selected: ${areaIds.length}`;
  el.selectedAreas.innerHTML = "";

  if (areaIds.length === 0) {
    const span = document.createElement("span");
    span.className = "hint";
    span.textContent = "Click polygons on the map.";
    el.selectedAreas.append(span);
    return;
  }

  areaIds.forEach((areaId) => {
    const meta = state.areaMeta.get(areaId);
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    const title = document.createElement("span");
    title.className = "chip-title";
    title.textContent = meta?.name || formatAreaIdForDisplay(areaId);

    const group = document.createElement("span");
    group.className = "chip-sub";
    group.textContent = meta?.dispatchAreaLabel || meta?.municipality || "-";

    const postal = document.createElement("span");
    postal.className = "chip-meta";
    postal.textContent = `〒${formatPostalCodes(meta?.postalCodes)}`;

    chip.append(title, group, postal);
    chip.addEventListener("click", () => toggleAreaSelection(areaId));
    el.selectedAreas.append(chip);
  });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeBorderStyle(value) {
  const raw = String(value || "").trim().toLowerCase();
  return raw === "dashed" || raw === "dotted" ? raw : "solid";
}

function normalizeColor(value, fallback = "#44566c") {
  const raw = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(raw) ? raw : fallback;
}

function createBorderSettingsFromPreset(presetKey = "default") {
  const key = BORDER_PRESETS[presetKey] ? presetKey : "default";
  const preset = BORDER_PRESETS[key];
  return {
    preset: key,
    shiku: {
      width: clamp(toNumber(preset?.shiku?.width, 2.9), 0.2, 6),
      opacity: clamp(toNumber(preset?.shiku?.opacity, 0.86), 0, 1),
      color: normalizeColor(preset?.shiku?.color, "#44566c"),
    },
    block: { ...preset.block },
    fill: {
      inScope: clamp(toNumber(preset?.fill?.inScope, 1), 0, 3),
    },
  };
}
