# 配送エリア調整ツール（行政区画版）

神奈川県・東京都町田市の配送担当を、行政区画ポリゴン単位で地図上から調整するためのWebツールです。

## できること

- 行政区画 GeoJSON（Polygon/MultiPolygon）を読み込み
- ポリゴンをクリック選択して `SGM / FUJ / YOK` に割当
- 自治体フィルタ、エリアID/名称ジャンプ
- 運用対象外エリアをグレーアウトし、選択・割当を禁止
- 割当結果のCSV出力

## 起動方法

```bash
cd /Users/tomoki/src/RGU
python3 -m http.server 8000
```

ブラウザで `http://localhost:8000` を開く。

## すぐ使うファイル（運用）

- 行政区画GeoJSON: `/Users/tomoki/src/RGU/data/n03_target_admin_areas.geojson`
- 初期割当CSV: `/Users/tomoki/src/RGU/data/asis_admin_assignments.csv`
- 細粒度ポリゴン（町丁目ベース, asis反映済み）: `/Users/tomoki/src/RGU/data/asis_fine_polygons.geojson`

運用では `asis_fine_polygons.geojson` を読み込む前提です。

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

- 塗りの透明度を下げ、ラベル可読性を優先。
- ベースマップをラベル重視構成（CARTO light + labels）へ変更。
- 市区境界の視認性を上げるため、境界オーバーレイを追加。
- 運用対象外（既存 SGM/FUJ/YOK 対象外）行政区は非活性化。

## data 配下の整理

- 旧サンプルGeoJSONは `data/archive/` に移動。
- 東京（町田市）町丁目データを差し込む場合は `data/tokyo/machida_towns.geojson` を配置。

## 細粒度データ再生成

神奈川の町丁目KMZと `asis.csv` から細粒度ポリゴンを再生成できます。
必要に応じて、町田市の町丁目GeoJSONを追加投入してください。

```bash
python3 /Users/tomoki/src/RGU/scripts/build_fine_polygons_from_asis.py \
  --asis /Users/tomoki/src/RGU/asis.csv \
  --kanagawa-kmz-zip /Users/tomoki/Downloads/A002005212020DDKWC14.zip \
  --tokyo-town-geojson /Users/tomoki/src/RGU/data/tokyo/machida_towns.geojson \
  --baseline /Users/tomoki/src/RGU/data/asis_admin_assignments.csv \
  --n03-fallback /Users/tomoki/src/RGU/data/n03_target_admin_areas.geojson \
  --out /Users/tomoki/src/RGU/data/asis_fine_polygons.geojson
```

`--tokyo-town-geojson` が未配置の場合は、町田市のみ N03 境界（市単位）へフォールバックします。
