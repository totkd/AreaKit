# 配送エリア調整ツール（行政区画版）

神奈川県・東京都町田市の配送担当を、行政区画ポリゴン単位で地図上から調整するためのWebツールです。

## できること

- 起動時に `data/asis_fine_polygons.geojson` を自動読み込み
- ポリゴンをクリック選択して `SGM / FUJ / YOK` に割当
- クリック時に「対応エリア」（`asis.csv` 由来）をポップアップ表示
- ベースマップ切替（地理院標準/地理院淡色/地理院写真/OSM/CARTO/Esri）
- サイドバーの表示/非表示切替
- SGM/FUJ/YOK 拠点ピンを固定表示
- 自治体フィルタ、エリアID/名称ジャンプ
- 運用対象外エリアをグレーアウトし、選択・割当を禁止
- 割当結果のCSV出力

## 起動方法

```bash
cd /Users/tomoki/src/RGU
python3 -m http.server 8000
```

ブラウザで `http://localhost:8000` を開く。
起動すると、`data/asis_fine_polygons.geojson` が自動で地図に反映されます。

## すぐ使うファイル（運用）

- 行政区画GeoJSON: `/Users/tomoki/src/RGU/data/n03_target_admin_areas.geojson`
- 初期割当CSV: `/Users/tomoki/src/RGU/data/asis_admin_assignments.csv`
- 細粒度ポリゴン（町丁目ベース, asis反映済み）: `/Users/tomoki/src/RGU/data/asis_fine_polygons.geojson`

運用では `asis_fine_polygons.geojson` をデフォルトデータとして使います。

## 入力データ仕様（GeoJSON）

- 形式: `FeatureCollection`
- 各 Feature は `Polygon` または `MultiPolygon`
- 座標: GeoJSON標準（WGS84, `[経度,緯度]`）

### `properties` の推奨列

必須相当（どれか1つ）:
- `area_id` / `area_code` / `code` / `id`
- `N03_007`（国土数値情報の行政コード）
- `zip_code` など郵便番号系キー（後方互換）

名称・フィルタ用（任意）:
- `area_name` / `name` / `名称`
- `municipality` / `市区町村` / `市区` / `N03_004` / `N03_005` / `対応エリア`

初期割当（任意）:
- `depot_code` / `depot` / `管轄デポ` / `担当デポ`
- 値は `SGM`,`FUJ`,`YOK` 推奨（`相模原`,`藤沢`,`横浜港北(...)` も自動変換）

## 出力CSV

- `area_id`
- `area_name`
- `municipality`
- `depot_code`
- `depot_name`

## UI調整メモ（2026-02）

- 塗りと境界線のコントラストを再調整し、道路・地名ラベルを優先。
- デフォルトの地図を地理院標準（日本語）へ変更し、タイル切替を追加。
- 市区境界を町域境界より太く濃い色でオーバーレイし、ズームに応じて境界線を強調。
- 運用対象外（既存 SGM/FUJ/YOK 対象外）行政区は非活性化。

## data 配下の整理

- 旧サンプルGeoJSONは `data/archive/` に移動。
- 東京（町田市）町丁目データは `data/tokyo/machida_towns.geojson` または e-Stat ZIP を直接指定。

## 細粒度データ再生成

神奈川の町丁目KMZと `asis.csv` から細粒度ポリゴンを再生成できます。
町田市は、GeoJSONまたは東京都のe-Stat ZIPをそのまま投入できます。

```bash
python3 /Users/tomoki/src/RGU/scripts/build_fine_polygons_from_asis.py \
  --asis /Users/tomoki/src/RGU/asis.csv \
  --kanagawa-kmz-zip /Users/tomoki/Downloads/A002005212020DDKWC14.zip \
  --tokyo-town-geojson /Users/tomoki/Downloads/A002005212020DDKWC13.zip \
  --baseline /Users/tomoki/src/RGU/data/asis_admin_assignments.csv \
  --n03-fallback /Users/tomoki/src/RGU/data/n03_target_admin_areas.geojson \
  --out /Users/tomoki/src/RGU/data/asis_fine_polygons.geojson
```

`--tokyo-town-geojson` は `.geojson` と `.zip` の両方を受け付けます。
未配置の場合は、町田市のみ N03 境界（市単位）へフォールバックします。

### 東京都町域データの入手先（e-Stat）

1. e-Stat 境界データダウンロードを開く  
   https://www.e-stat.go.jp/gis/statmap-search/boundary_data
2. 「小地域（町丁・字等）」を選び、都道府県で「東京都」を指定してダウンロード
3. 取得したZIP（例: `A002005212020DDKWC13.zip`）を `--tokyo-town-geojson` に指定
