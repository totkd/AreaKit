const DEPOTS = {
  SGM: { name: "相模原デポ SGM", color: "#2e7d32" },
  FUJ: { name: "藤沢デポ FUJ", color: "#2d6cdf" },
  YOK: { name: "横浜港北デポ YOK", color: "#b71c1c" },
};

const DEPOT_SITES = [
  {
    code: "SGM",
    address: "相模原市中央区上溝7-12-15",
    lat: 35.558763,
    lng: 139.370176,
  },
  {
    code: "FUJ",
    address: "藤沢市石川5-10-27",
    lat: 35.3982,
    lng: 139.4699,
  },
  {
    code: "YOK",
    address: "横浜市港北区樽町1-19-6",
    lat: 35.548296,
    lng: 139.648303,
  },
];

const BASEMAPS = {
  gsi_std: {
    name: "地理院 標準（日本語）",
    url: "https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png",
    options: {
      attribution:
        '<a href="https://maps.gsi.go.jp/development/ichiran.html">地理院タイル</a>',
      maxZoom: 18,
    },
  },
  gsi_pale: {
    name: "地理院 淡色",
    url: "https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png",
    options: {
      attribution:
        '<a href="https://maps.gsi.go.jp/development/ichiran.html">地理院タイル</a>',
      maxZoom: 18,
    },
  },
  gsi_seamless: {
    name: "地理院 シームレス写真",
    url: "https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg",
    options: {
      attribution:
        '<a href="https://maps.gsi.go.jp/development/ichiran.html">地理院タイル</a>',
      maxZoom: 18,
    },
  },
  osm: {
    name: "オープンストリートマップ",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    options: {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    },
  },
  carto: {
    name: "CARTO ボイジャー",
    url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    options: {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
      maxZoom: 20,
    },
  },
  carto_light: {
    name: "CARTO ポジトロン",
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    options: {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
      maxZoom: 20,
    },
  },
  esri_street: {
    name: "Esri ワールドストリート",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    options: {
      attribution: "Tiles &copy; Esri",
      maxZoom: 19,
    },
  },
};

const DEFAULT_IN_SCOPE_MUNICIPALITIES = new Set([
  "大和市",
  "川崎市中原区",
  "川崎市多摩区",
  "川崎市宮前区",
  "川崎市川崎区",
  "川崎市幸区",
  "川崎市高津区",
  "川崎市麻生区",
  "平塚市",
  "座間市",
  "横浜市中区",
  "横浜市保土ケ谷区",
  "横浜市南区",
  "横浜市戸塚区",
  "横浜市旭区",
  "横浜市栄区",
  "横浜市泉区",
  "横浜市港北区",
  "横浜市港南区",
  "横浜市瀬谷区",
  "横浜市磯子区",
  "横浜市神奈川区",
  "横浜市緑区",
  "横浜市西区",
  "横浜市都筑区",
  "横浜市金沢区",
  "横浜市青葉区",
  "横浜市鶴見区",
  "海老名市",
  "町田市",
  "相模原市中央区",
  "相模原市南区",
  "綾瀬市",
  "茅ヶ崎市",
  "藤沢市",
  "鎌倉市",
]);

const ZIP_KEYS = ["zip_code", "zipcode", "zip", "postal_code", "郵便番号"];
const AREA_ID_KEYS = ["area_id", "area_code", "code", "id", "N03_007", ...ZIP_KEYS];
const AREA_NAME_KEYS = [
  "area_name",
  "name",
  "名称",
  "municipality",
  "市区町村",
  "市区",
  "対応エリア",
  "N03_004",
  "N03_003",
];
const MUNICIPALITY_KEYS = ["municipality", "city", "ward", "自治体", "市区町村", "市区", "対応エリア", "N03_004"];

const state = {
  map: null,
  baseLayers: new Map(),
  activeBasemapId: "esri_street",
  geoLayer: null,
  areaToLayers: new Map(),
  areaMeta: new Map(),
  nameIndex: new Map(),
  assignments: new Map(),
  initialAssignments: new Map(),
  assignmentHistory: [],
  assignmentHistoryIndex: -1,
  selected: new Set(),
  inScopeMunicipalities: new Set(DEFAULT_IN_SCOPE_MUNICIPALITIES),
  municipalityBoundaryLayer: null,
  municipalityBoundarySource: null,
  loadedGeoData: null,
  asisAreaLabelByTown: new Map(),
  asisDefaultAreaLabelByMunicipality: new Map(),
  asisPostalCodesByTown: new Map(),
  depotMarkerLayer: null,
};

const el = {
  layout: document.getElementById("layout"),
  panelToggle: document.getElementById("panel-toggle"),
  exportCsv: document.getElementById("export-csv"),
  undoAction: document.getElementById("undo-action"),
  redoAction: document.getElementById("redo-action"),
  resetAll: document.getElementById("reset-all"),
  selectedCount: document.getElementById("selected-count"),
  selectedAreas: document.getElementById("selected-zips"),
  stats: document.getElementById("stats"),
  basemapInputs: [...document.querySelectorAll('input[name="basemap"]')],
};

init();

function init() {
  initMap();
  initDepotMarkers();
  setupEventHandlers();

  loadInScopeMunicipalities();
  loadAsisAreaLabels();
  loadDefaultGeoJson();

  renderSelected();
  renderStats();
}

function initMap() {
  state.map = L.map("map", { zoomControl: true }).setView([35.45, 139.55], 11);

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
  el.undoAction?.addEventListener("click", undoAssignments);
  el.redoAction?.addEventListener("click", redoAssignments);
  el.resetAll?.addEventListener("click", resetAllAssignments);

  el.panelToggle.addEventListener("click", toggleSidebar);
  updatePanelToggleLabel();

  el.basemapInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) {
        setBasemap(input.value);
      }
    });
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

async function loadDefaultGeoJson() {
  try {
    const res = await fetch("./data/asis_fine_polygons.geojson");
    if (!res.ok) {
      throw new Error(`status ${res.status}`);
    }
    const data = await res.json();
    loadGeoJson(data);
  } catch (_err) {
    alert("Failed to load default data: data/asis_fine_polygons.geojson");
  }
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
  el.layout.classList.toggle("panel-collapsed");
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
        html: `<span class="depot-pin" style="background:${depot.color}"></span>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
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
    const res = await fetch("./data/n03_target_admin_areas.geojson");
    if (!res.ok) {
      return;
    }
    const data = await res.json();
    if (!Array.isArray(data?.features)) {
      return;
    }

    state.municipalityBoundarySource = data;

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

    const town = canonicalTownName(pickCsvValue(row, indexByHeader, ["町", "town", "S_NAME"]));
    const postalCodes = collectPostalCodes(
      pickCsvValue(row, indexByHeader, ["郵便番号", "postal_code", "zip_code", "zipcode", "zip"])
    );
    if (town) {
      const key = `${municipality}|${town}`;
      addCount(townCounter, key, areaLabel);
      addPostalCodes(postalByTown, key, postalCodes);
    } else {
      addCount(municipalityCounter, municipality, areaLabel);
    }
  }

  state.asisAreaLabelByTown = collapseCountMap(townCounter);
  state.asisDefaultAreaLabelByMunicipality = collapseCountMap(municipalityCounter);
  state.asisPostalCodesByTown = collapsePostalCodeMap(postalByTown);
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    if (ch === "\r") {
      continue;
    }

    field += ch;
  }

  row.push(field);
  if (row.length > 1 || String(row[0] || "").trim()) {
    rows.push(row);
  }

  return rows;
}

function normalizeHeader(value) {
  return String(value || "")
    .replace(/\ufeff/g, "")
    .trim()
    .toLowerCase();
}

function pickCsvValue(row, indexByHeader, keys) {
  for (const key of keys) {
    const idx = indexByHeader.get(String(key).toLowerCase());
    if (idx === undefined) {
      continue;
    }
    const value = row[idx];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return "";
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

function collectPostalCodes(raw) {
  const input = String(raw || "").trim();
  if (!input) {
    return [];
  }
  const codes = [];
  const re = /(\d{3})-?(\d{4})/g;
  let m = re.exec(input);
  while (m) {
    const code = `${m[1]}${m[2]}`;
    if (code.length === 7) {
      codes.push(code);
    }
    m = re.exec(input);
  }

  if (codes.length > 0) {
    return [...new Set(codes)];
  }

  const normalized = normalizeZip(input);
  if (normalized.length === 7) {
    return [normalized];
  }
  return [];
}

function applyAsisAreaLabelsToLoadedAreas() {
  state.areaMeta.forEach((meta, areaId) => {
    let changed = false;
    if (!meta.dispatchAreaLabel) {
      const label = lookupDispatchAreaLabel(meta.municipality, meta.townName);
      if (label) {
        meta.dispatchAreaLabel = label;
        changed = true;
      }
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

function loadGeoJson(data) {
  if (!data || data.type !== "FeatureCollection" || !Array.isArray(data.features)) {
    alert("Please provide a valid GeoJSON FeatureCollection.");
    return;
  }

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

  let fallbackCounter = 0;

  state.geoLayer = L.geoJSON(data, {
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
        state.areaMeta.set(areaId, {
          name: areaName || areaId,
          municipality,
          townName,
          dispatchAreaLabel: getDispatchAreaLabel(props, municipality, townName),
          postalCodes: getPostalCodes(props, municipality, townName, areaId),
          raw: props,
        });
      }

      const currentDepot = state.assignments.get(areaId) || "";
      const initialDepot = extractDepot(props);
      state.assignments.set(areaId, initialDepot || currentDepot);

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

  const bounds = state.geoLayer.getBounds();
  if (bounds.isValid()) {
    state.map.fitBounds(bounds.pad(0.15));
  }

  state.initialAssignments = new Map(state.assignments);
  resetAssignmentHistory();
  refreshAllStyles();
  renderSelected();
  renderStats();
}

function handleAreaClick(areaId, layer) {
  if (isInScopeArea(areaId)) {
    if (state.selected.has(areaId)) {
      state.selected.delete(areaId);
    } else {
      state.selected.add(areaId);
    }

    state.areaToLayers.get(areaId)?.forEach((entry) => {
      entry.setStyle(styleForArea(areaId));
    });

    renderSelected();
  }

  const content = buildPopupHtml(areaId);
  if (layer.getPopup()) {
    layer.setPopupContent(content);
  } else {
    layer.bindPopup(content, { maxWidth: 360 });
  }
  layer.openPopup();
}

function getAreaId(props) {
  for (const key of AREA_ID_KEYS) {
    if (props[key] === null || props[key] === undefined) {
      continue;
    }
    const value = normalizeAreaIdValue(key, props[key]);
    if (value) {
      return value;
    }
  }
  return "";
}

function normalizeAreaIdValue(key, value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  if (ZIP_KEYS.includes(key)) {
    return normalizeZip(raw);
  }
  return raw;
}

function getAreaName(props) {
  const n03Name = composeN03Name(props);
  if (n03Name) {
    return n03Name;
  }
  for (const key of AREA_NAME_KEYS) {
    if (props[key]) {
      return String(props[key]).trim();
    }
  }
  return "";
}

function getMunicipality(props, fallbackName = "") {
  const n03Name = composeN03Name(props);
  if (n03Name) {
    return canonicalMunicipality(n03Name);
  }
  for (const key of MUNICIPALITY_KEYS) {
    if (props[key]) {
      return canonicalMunicipality(String(props[key]));
    }
  }
  return canonicalMunicipality(fallbackName);
}

function getMunicipalityFromProps(props) {
  return canonicalMunicipality(
    String(props?.municipality || props?.area_name || props?.市区 || props?.N03_004 || composeN03Name(props) || "")
  );
}

function composeN03Name(props) {
  const city = String(props.N03_004 || "").trim();
  const ward = String(props.N03_005 || "").trim();
  if (city && ward) {
    return `${city}${ward}`;
  }
  return city || "";
}

function extractTownName(props, areaName, municipality) {
  const direct = String(props.town_name || props.S_NAME || props.町 || "").trim();
  if (direct) {
    return direct;
  }

  const name = String(areaName || "").trim();
  const muni = String(municipality || "").trim();
  if (name && muni && name.startsWith(muni) && name.length > muni.length) {
    return name.slice(muni.length).trim();
  }
  return "";
}

function getDispatchAreaLabel(props, municipality, townName) {
  const inline = String(
    props.dispatch_area_label || props.dispatch_area || props.group_label || props.対応エリア || ""
  ).trim();
  if (inline && inline !== municipality) {
    return inline;
  }
  return lookupDispatchAreaLabel(municipality, townName);
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

function lookupDispatchAreaLabel(municipality, townName) {
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

function canonicalMunicipality(value) {
  return canonicalAreaName(value);
}

function canonicalTownName(value) {
  let out = String(value || "").trim();
  if (!out || out === "以下に掲載がない場合") {
    return "";
  }
  out = out.replace(/[\s　]/g, "");
  out = out.replace(/ヶ/g, "ケ").replace(/ヵ/g, "ケ").replace(/ｹ/g, "ケ");
  out = out.replace(/之/g, "の");
  out = out.replace(/[0-9０-９]+丁目$/g, "");
  out = out.replace(/[一二三四五六七八九十]+丁目$/g, "");
  return out;
}

function normalizeZip(value) {
  const digits = String(value).replace(/[^\d]/g, "");
  if (digits.length >= 7) {
    return digits.slice(0, 7);
  }
  return digits;
}

function formatPostalCode(zip) {
  const digits = normalizeZip(zip);
  if (digits.length !== 7) {
    return "";
  }
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}`;
}

function formatPostalCodes(codes) {
  const values = Array.isArray(codes) ? codes : [];
  const formatted = values.map((value) => formatPostalCode(value)).filter(Boolean);
  if (formatted.length === 0) {
    return "-";
  }
  return [...new Set(formatted)].join(" / ");
}

function extractDepot(props) {
  const values = [
    props.depot,
    props.depot_code,
    props.depot_name,
    props.担当デポ,
    props.管轄デポ,
    props.管轄,
  ];
  for (const value of values) {
    const code = normalizeDepotCode(value);
    if (code) {
      return code;
    }
  }
  return "";
}

function normalizeDepotCode(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  const upper = raw.toUpperCase();
  if (DEPOTS[upper]) {
    return upper;
  }
  if (upper.includes("SGM")) {
    return "SGM";
  }
  if (upper.includes("FUJ")) {
    return "FUJ";
  }
  if (upper.includes("YOK")) {
    return "YOK";
  }
  if (raw.includes("相模原")) {
    return "SGM";
  }
  if (raw.includes("藤沢")) {
    return "FUJ";
  }
  if (raw.includes("横浜港北")) {
    return "YOK";
  }
  return "";
}

function formatAreaIdForDisplay(areaId) {
  const raw = String(areaId || "");
  if (!raw) {
    return "";
  }
  if (raw.startsWith("name:") || raw.startsWith("feature:")) {
    return raw;
  }
  return raw.replace(/^(KA\d+|TK\d+|N03|KA|TK)-/i, "");
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

  const depotCode = state.assignments.get(areaId) || "";
  const depotName = DEPOTS[depotCode]?.name || "Unassigned";

  return [
    '<dl class="popup-grid">',
    `<dt>Town</dt><dd>${escapeHtml(meta.name || "-")}</dd>`,
    `<dt>Area</dt><dd>${escapeHtml(meta.dispatchAreaLabel || "-")}</dd>`,
    `<dt>Depot</dt><dd>${escapeHtml(depotName)}</dd>`,
    "</dl>",
  ].join("");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
  const isFuj = assignment === "FUJ";
  const activeFill = selected ? 0.3 : 0.12;
  const fujBoost = isFuj ? (selected ? 0.08 : 0.04) : 0;

  return {
    color: isOutOfScope ? "#7c8591" : selected ? "#0f1720" : "#44566c",
    weight: isOutOfScope ? 0.9 + borderBoost * 0.4 : selected ? 2.5 + borderBoost * 0.8 : 1.25 + borderBoost * 0.7,
    dashArray: isOutOfScope ? "3 5" : selected ? "4 3" : "",
    fillColor: baseColor,
    fillOpacity: isOutOfScope ? 0.02 : activeFill + fujBoost,
    opacity: isOutOfScope ? 0.28 : 0.86,
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
      if (!municipality || !state.inScopeMunicipalities.has(municipality)) {
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
  return {
    color: "#071632",
    weight: 4.2 + Math.min(2.6, zoomFactor * 0.35),
    opacity: 0.96,
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
    const res = await fetch("./data/n03_target_admin_areas.geojson");
    if (!res.ok) {
      return null;
    }
    const data = await res.json();
    if (!Array.isArray(data?.features)) {
      return null;
    }
    state.municipalityBoundarySource = data;
    return data;
  } catch (_err) {
    return null;
  }
}

function refreshAllStyles() {
  state.areaToLayers.forEach((layers, areaId) => {
    layers.forEach((layer) => layer.setStyle(styleForArea(areaId)));
  });
  renderStats();
}

function toggleAreaSelection(areaId) {
  if (!state.areaToLayers.has(areaId) || !isInScopeArea(areaId)) {
    return;
  }
  if (state.selected.has(areaId)) {
    state.selected.delete(areaId);
  } else {
    state.selected.add(areaId);
  }
  state.areaToLayers.get(areaId).forEach((layer) => layer.setStyle(styleForArea(areaId)));
  renderSelected();
}

function clearSelection() {
  if (state.selected.size === 0) {
    return;
  }
  const selectedNow = [...state.selected];
  state.selected.clear();
  selectedNow.forEach((areaId) => {
    state.areaToLayers.get(areaId)?.forEach((layer) => layer.setStyle(styleForArea(areaId)));
  });
  renderSelected();
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
  pushAssignmentHistory();
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

function resetAssignmentHistory() {
  state.assignmentHistory = [createAssignmentSnapshot()];
  state.assignmentHistoryIndex = 0;
  updateHistoryButtons();
}

function pushAssignmentHistory() {
  const snapshot = createAssignmentSnapshot();
  const current = state.assignmentHistory[state.assignmentHistoryIndex];
  if (current && isSameAssignmentSnapshot(current, snapshot)) {
    return;
  }
  if (state.assignmentHistoryIndex < state.assignmentHistory.length - 1) {
    state.assignmentHistory = state.assignmentHistory.slice(0, state.assignmentHistoryIndex + 1);
  }
  state.assignmentHistory.push(snapshot);
  state.assignmentHistoryIndex = state.assignmentHistory.length - 1;
  updateHistoryButtons();
}

function applyAssignmentSnapshot(snapshot) {
  if (!snapshot) {
    return;
  }
  state.assignments = new Map(snapshot);
  refreshAllStyles();
  syncPopupContentForAllAreas();
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

function undoAssignments() {
  if (state.assignmentHistoryIndex <= 0) {
    return;
  }
  state.assignmentHistoryIndex -= 1;
  applyAssignmentSnapshot(state.assignmentHistory[state.assignmentHistoryIndex]);
  updateHistoryButtons();
}

function redoAssignments() {
  if (state.assignmentHistoryIndex >= state.assignmentHistory.length - 1) {
    return;
  }
  state.assignmentHistoryIndex += 1;
  applyAssignmentSnapshot(state.assignmentHistory[state.assignmentHistoryIndex]);
  updateHistoryButtons();
}

function resetAllAssignments() {
  if (state.areaMeta.size === 0) {
    return;
  }
  const snapshot = new Map(state.initialAssignments);
  if (isSameAssignmentSnapshot(snapshot, createAssignmentSnapshot())) {
    return;
  }
  state.assignments = snapshot;
  refreshAllStyles();
  syncPopupContentForAllAreas();
  pushAssignmentHistory();
}

function updateHistoryButtons() {
  if (el.undoAction) {
    el.undoAction.disabled = state.assignmentHistoryIndex <= 0;
  }
  if (el.redoAction) {
    el.redoAction.disabled = state.assignmentHistoryIndex >= state.assignmentHistory.length - 1;
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

function normalizeMatchKey(value) {
  return String(value || "")
    .replace(/[\s　]/g, "")
    .toLowerCase();
}

function canonicalAreaName(value) {
  let out = String(value || "").trim();
  out = out.replace(/[\s　]/g, "");
  out = out.replace(/\(.*?\)/g, "");
  out = out.replace(/（.*?）/g, "");
  out = out.replace(/^東京都/, "");
  out = out.replace(/^神奈川県/, "");

  if (out === "町田") {
    out = "町田市";
  }
  if (out === "藤沢") {
    out = "藤沢市";
  }
  if (/^横浜.+区$/.test(out) && !out.startsWith("横浜市")) {
    out = out.replace(/^横浜/, "横浜市");
  }
  if (/^川崎.+区$/.test(out) && !out.startsWith("川崎市")) {
    out = out.replace(/^川崎/, "川崎市");
  }
  if (/^相模原.+区$/.test(out) && !out.startsWith("相模原市")) {
    out = out.replace(/^相模原/, "相模原市");
  }

  return out;
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

function renderStats() {
  const total = state.assignments.size;
  let assigned = 0;
  const byDepot = { SGM: 0, FUJ: 0, YOK: 0 };

  state.assignments.forEach((depotCode) => {
    if (!depotCode) {
      return;
    }
    assigned += 1;
    if (byDepot[depotCode] !== undefined) {
      byDepot[depotCode] += 1;
    }
  });

  el.stats.innerHTML = "";
  appendStat("Total zones", total);
  appendStat("Assigned", assigned);
  appendStat("Unassigned", Math.max(total - assigned, 0));
  appendStat("SGM", byDepot.SGM);
  appendStat("FUJ", byDepot.FUJ);
  appendStat("YOK", byDepot.YOK);
}

function appendStat(label, value) {
  const tr = document.createElement("tr");
  const th = document.createElement("th");
  th.className = "stat-key";
  th.textContent = String(label);
  const td = document.createElement("td");
  td.className = "stat-value";
  td.textContent = String(value);
  tr.append(th, td);
  el.stats.append(tr);
}
