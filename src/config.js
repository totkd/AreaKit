export const DEPOTS = {
  SGM: { name: "相模原デポ SGM", color: "#2e7d32" },
  FUJ: { name: "藤沢デポ FUJ", color: "#2d6cdf" },
  YOK: { name: "横浜港北デポ YOK", color: "#b71c1c" },
};

export const DEPOT_SITES = [
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

export const BASEMAPS = {
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
  gsi_blank: {
    name: "地理院 白地図",
    url: "https://cyberjapandata.gsi.go.jp/xyz/blank/{z}/{x}/{y}.png",
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
  osm_hot: {
    name: "OSM Humanitarian",
    url: "https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
    options: {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, Tiles style by <a href="https://www.hotosm.org/" target="_blank" rel="noopener noreferrer">Humanitarian OpenStreetMap Team</a>',
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

export const DEFAULT_IN_SCOPE_MUNICIPALITIES = new Set([
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

export const ZIP_KEYS = ["zip_code", "zipcode", "zip", "postal_code", "郵便番号"];
export const AREA_ID_KEYS = ["area_id", "area_code", "code", "id", "N03_007", ...ZIP_KEYS];
export const AREA_NAME_KEYS = [
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
export const MUNICIPALITY_KEYS = ["municipality", "city", "ward", "自治体", "市区町村", "市区", "対応エリア", "N03_004"];

export const MOBILE_BREAKPOINT_PX = 1180;
export const FULL_ADMIN_BOUNDARY_GEOJSON = "./data/n03_tokyo_kanagawa_admin_areas.geojson";
export const OPERATIONAL_ADMIN_BOUNDARY_GEOJSON = "./data/n03_target_admin_areas.geojson";
export const DEFAULT_VISIBLE_PREFECTURES = new Set(["神奈川県", "東京都"]);
