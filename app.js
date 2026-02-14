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

const state = {
  map: null,
  baseLayers: new Map(),
  activeBasemapId: "esri_street",
  geoLayer: null,
  areaToLayers: new Map(),
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
  isMobileView: false,
  resizeTimerId: null,
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
  basemapInputs: [...document.querySelectorAll('input[name="basemap"]')],
  prefectureVisibilityInputs: [...document.querySelectorAll('input[name="prefecture-visibility"]')],
};

init();

function init() {
  initMap();
  initDepotMarkers();
  setupEventHandlers();
  initResponsiveSidebarMode();

  loadInScopeMunicipalities();
  loadAsisAreaLabels();
  loadDefaultGeoJson();

  renderSelected();
}

function initMap() {
  state.map = L.map("map", { zoomControl: true, boxZoom: false }).setView([35.45, 139.55], 11);

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
    refreshAllStyles();
    refreshMunicipalityBoundaryStyle();
  });
  state.map.on("zoomstart", closeAllAreaTooltips);
  state.map.on("movestart", closeAllAreaTooltips);

  updateHistoryButtons();
}

function handlePrefectureVisibilityChange() {
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
  rebuildGeoLayerForVisibility();
}

function rebuildGeoLayerForVisibility() {
  if (!state.loadedGeoData) {
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
  });
}

async function loadDefaultGeoJson() {
  try {
    const res = await fetch("./data/asis_fine_polygons.geojson");
    if (!res.ok) {
      throw new Error(`status ${res.status}`);
    }
    const data = await res.json();
    initializeAllAssignmentsFromData(data);
    loadGeoJson(data);
  } catch (_err) {
    alert("Failed to load default data: data/asis_fine_polygons.geojson");
  }
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
  el.panelToggle.textContent = collapsed ? "Show Sidebar" : "Hide Sidebar";
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

    const marker = L.marker([site.lat, site.lng], {
      pane: "depotPinPane",
      icon: L.divIcon({
        className: "",
        html: `<span class="depot-pin depot-${site.code.toLowerCase()}">${site.code}</span>`,
        iconSize: [56, 28],
        iconAnchor: [28, 14],
      }),
      title: `${site.code} ${site.address}`,
    });

    marker.bindTooltip(`${site.code} ${depot.name}<br>${site.address}`, {
      direction: "top",
      offset: [0, -14],
      opacity: 0.95,
    });

    state.depotMarkerLayer.addLayer(marker);
  });

  state.depotMarkerLayer.addTo(state.map);
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
    const layers = state.areaToLayers.get(areaId) || [];
    layers.forEach((layer) => {
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

  state.loadedGeoData = data;

  if (state.geoLayer) {
    state.map.removeLayer(state.geoLayer);
  }

  state.geoLayer = null;
  state.areaToLayers.clear();
  state.areaMeta.clear();
  state.nameIndex.clear();
  state.assignments.clear();
  state.selected.clear();
  resetBrushSelection();

  let fallbackCounter = 0;

  state.geoLayer = L.geoJSON(data, {
    filter: (feature) => isPrefectureVisible(feature?.properties || {}),
    style: (feature) => {
      const areaId = getAreaId(feature?.properties || {});
      return styleForArea(areaId);
    },
    onEachFeature: (feature, layer) => {
      const props = feature.properties || {};
      let areaId = getAreaId(props);
      const areaName = getAreaName(props);
      const municipality = getMunicipality(props, areaName);
      const townName = extractTownName(props, areaName, municipality);

      if (!areaId) {
        fallbackCounter += 1;
        areaId = areaName ? `name:${areaName}` : `feature:${String(fallbackCounter).padStart(5, "0")}`;
      }

      if (!state.areaToLayers.has(areaId)) {
        state.areaToLayers.set(areaId, []);
      }
      state.areaToLayers.get(areaId).push(layer);

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

      layer.on("add", () => setAreaIdOnLayerElement(layer, areaId));
      setAreaIdOnLayerElement(layer, areaId);
      layer.on("mousedown", (event) => beginBrushSelection(areaId, event, "mouse-right"));
      layer.on("mouseover", () => applyBrushSelection(areaId));
      layer.on("contextmenu", (event) => {
        event?.originalEvent?.preventDefault();
      });
      layer.on("click", () => handleAreaClick(areaId, layer));
      layer.bindTooltip(tooltipText(areaId), {
        sticky: false,
        direction: "top",
        opacity: 0.94,
      });
      layer.on("mouseout", () => {
        layer.closeTooltip();
        layer.closePopup();
      });
      layer.on("remove", () => layer.closeTooltip());
    },
  }).addTo(state.map);

  rebuildNameIndex();
  void drawMunicipalityBoundaryLayer(data);

  if (preserveSelectionSnapshot) {
    state.selected = new Set([...preserveSelectionSnapshot].filter((areaId) => state.areaToLayers.has(areaId)));
  }

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
  state.areaToLayers.forEach((_layers, areaId) => {
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
  const fallbackBounds = state.geoLayer?.getBounds();
  if (fallbackBounds && fallbackBounds.isValid()) {
    return fallbackBounds;
  }
  return null;
}

function handleAreaClick(areaId, layer) {
  if (Date.now() < state.suppressClickUntilMs) {
    return;
  }

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

function styleForArea(areaId) {
  const zoom = state.map ? state.map.getZoom() : 11;
  const zoomFactor = Math.max(0, zoom - 10);
  const borderBoost = Math.min(1.1, zoomFactor * 0.1);
  const selected = state.selected.has(areaId);
  const assignment = state.assignments.get(areaId);
  const depot = DEPOTS[assignment];
  const baseColor = depot ? depot.color : "#9ea8b6";
  const isOutOfScope = !isInScopeArea(areaId);
  const activeFill = selected ? 0.3 : 0.12;
  const fujScale = assignment === "FUJ" ? 1.3 : 1;

  if (isOutOfScope && selected) {
    return {
      color: "#334155",
      weight: 2.5 + borderBoost * 0.8,
      dashArray: "",
      fillColor: "#8f98a5",
      fillOpacity: 0.24,
      opacity: 0.92,
    };
  }

  return {
    color: isOutOfScope ? "#6b7280" : selected ? "#0f1720" : "#44566c",
    weight: isOutOfScope ? 1.05 + borderBoost * 0.35 : selected ? 2.5 + borderBoost * 0.8 : 1.25 + borderBoost * 0.7,
    dashArray: isOutOfScope ? "" : selected ? "4 3" : "",
    fillColor: baseColor,
    fillOpacity: isOutOfScope ? 0.008 : Math.min(0.5, activeFill * fujScale),
    opacity: isOutOfScope ? 0.3 : 0.86,
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
  state.depotMarkerLayer?.bringToFront();
}

function getMunicipalityBoundaryStyle() {
  const zoom = state.map ? state.map.getZoom() : 11;
  const zoomFactor = Math.max(0, zoom - 10);
  const borderBoost = Math.min(1.1, zoomFactor * 0.1);
  return {
    color: "#44566c",
    weight: 2.2 + borderBoost * 1.1,
    opacity: 0.86,
    fillOpacity: 0,
    interactive: false,
  };
}

function refreshMunicipalityBoundaryStyle() {
  if (!state.municipalityBoundaryLayer) {
    return;
  }
  state.municipalityBoundaryLayer.setStyle(getMunicipalityBoundaryStyle());
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

function refreshAllStyles() {
  state.areaToLayers.forEach((layers, areaId) => {
    layers.forEach((layer) => layer.setStyle(styleForArea(areaId)));
  });
}

function applyAreaStyle(areaId) {
  state.areaToLayers.get(areaId)?.forEach((layer) => layer.setStyle(styleForArea(areaId)));
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

  refreshAllStyles();
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
  state.selected = new Set(snapshot);
  refreshAllStyles();
  renderSelected();
}

function syncPopupContentForAllAreas() {
  state.areaToLayers.forEach((layers, areaId) => {
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
