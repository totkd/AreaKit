# AreaKit

[![Deploy](https://img.shields.io/badge/Deploy-Vercel-000000?logo=vercel)](https://rgu-chi.vercel.app/)
![App](https://img.shields.io/badge/App-AreaKit-111827)
![Map](https://img.shields.io/badge/Map-Leaflet-199900)
![Data](https://img.shields.io/badge/Data-GeoJSON%20%2B%20CSV-2563eb)

配送エリアを地図上で調整するための運用ツールです。  
神奈川県 + 東京都町田市の町域ポリゴンを表示し、`SGM / FUJ / YOK` の担当割当を編集してCSVで出力できます。

---

## 一般向けガイド

### できること
- 町域ポリゴンをクリックして複数選択
- 選択町域を `SGM / FUJ / YOK` に一括割当
- `Undo / Redo`（選択状態の履歴）
- `All Reset`（初期割当へ復元 + 選択解除）
- 拠点ピン（SGM/FUJ/YOK）を固定表示
- `Download CSV` で割当結果を出力

### 操作フロー
1. `Map Tiles` で背景地図を選ぶ
2. 地図上の町域をクリックして選択
3. `Zone Select` でデポを割り当て
4. 必要に応じて `Undo / Redo` で調整
5. `Download CSV` で結果を保存

### 画面の見方
- `Map Tiles`: 背景地図の切替
- `Zone Select`: 選択件数・割当操作・Undo/Redo・All Reset
- `Stats`: 全体件数/割当済み/未割当/デポ別件数
- `Selected Zones`: 現在選択中の町域一覧

### CSV出力列
- `area_id`
- `area_name`
- `municipality`
- `depot_code`
- `depot_name`

---

## 技術者向けガイド

### 公開URL / デプロイ先
- Production: [https://rgu-chi.vercel.app/](https://rgu-chi.vercel.app/)
- Hosting: Vercel（Static）

### Vercel運用（このプロジェクトの標準）

#### 反映の流れ
1. GitHubにpush
2. Vercelが自動デプロイ
3. `main` へマージ後、Productionが更新

#### 推奨ワークフロー
1. 作業ブランチをpush
2. Vercel Preview URLで動作確認
3. PR作成・レビュー
4. `main` マージで本番反映

#### 初回セットアップの要点
- VercelでGitHubリポジトリ `totkd/RGU` をImport
- Framework Preset: `Other`
- Root Directory: `./`
- Build Command: なし
- Output Directory: なし（静的配信）
- Environment Variables: 不要

#### キャッシュ戦略（`vercel.json`）
- `/index.html`: `no-cache, no-store, must-revalidate`
- `/app.js`, `/styles.css`: `max-age=300`
- `/data/*.geojson`, `/data/*.csv`: `max-age=60`

これにより、UI変更は比較的すぐ反映しつつ、巨大GeoJSONも短時間キャッシュで配信します。

### 実装仕様（現行）
- 起動時に `data/asis_fine_polygons.geojson` を自動読込
- 既定ベースマップは `Esri ワールドストリート`
- `Undo / Redo` は**選択履歴**を管理（割当履歴ではない）
- `All Reset` は初期割当復元 + 選択解除 + 履歴初期化
- 市区境界は別レイヤで太線表示（ズーム連動強調）
- 対象外自治体ポリゴンは非活性（選択/割当不可）

### Area（ブロック名）解決ロジック
ポップアップの `Area` は次の優先順で解決。
1. `asis.csv` の町域キー（`市区 + 町`）
2. `asis.csv` の郵便番号キー
3. `asis.csv` の市区キー
4. GeoJSON側 `dispatch_area_label / dispatch_area / group_label / 対応エリア`

### 主要ファイル
- `/Users/tomoki/src/RGU/index.html`: UI構造
- `/Users/tomoki/src/RGU/styles.css`: デザイン
- `/Users/tomoki/src/RGU/app.js`: クライアントロジック
- `/Users/tomoki/src/RGU/asis.csv`: 既存割当マスタ
- `/Users/tomoki/src/RGU/data/asis_fine_polygons.geojson`: 運用主データ
- `/Users/tomoki/src/RGU/data/n03_tokyo_kanagawa_admin_areas.geojson`: 東京+神奈川の市区町村境界（地図Overlay用）
- `/Users/tomoki/src/RGU/data/n03_target_admin_areas.geojson`: 市区境界/フォールバック
- `/Users/tomoki/src/RGU/data/asis_admin_assignments.csv`: 初期割当補助

### 町域データ再生成
`asis.csv` と町域データから `asis_fine_polygons.geojson` を再生成できます。

```bash
python3 /Users/tomoki/src/RGU/scripts/build_fine_polygons_from_asis.py \
  --asis /Users/tomoki/src/RGU/asis.csv \
  --kanagawa-kmz-zip /Users/tomoki/Downloads/A002005212020DDKWC14.zip \
  --tokyo-town-geojson /Users/tomoki/Downloads/A002005212020DDKWC13.zip \
  --baseline /Users/tomoki/src/RGU/data/asis_admin_assignments.csv \
  --n03-fallback /Users/tomoki/src/RGU/data/n03_target_admin_areas.geojson \
  --coverage-mode operational \
  --out /Users/tomoki/src/RGU/data/asis_fine_polygons.geojson
```

補足:
- `--tokyo-town-geojson` は `.geojson` と `.zip`（e-Stat配布ZIP）両対応
- 東京都町域がない場合は `--n03-fallback` へフォールバック
- `--coverage-mode`:
  - `operational`（既定）: SGM/FUJ/YOKの運用対象自治体中心で生成
  - `full`: 神奈川全域 + 東京全域を生成（対象外町域もクリック反応させたいときに利用）

全域生成（`full`）例:

```bash
python3 /Users/tomoki/src/RGU/scripts/build_fine_polygons_from_asis.py \
  --asis /Users/tomoki/src/RGU/asis.csv \
  --kanagawa-kmz-zip /Users/tomoki/Downloads/A002005212020DDKWC14.zip \
  --tokyo-town-geojson /Users/tomoki/Downloads/A002005212020DDKWC13.zip \
  --baseline /Users/tomoki/src/RGU/data/asis_admin_assignments.csv \
  --n03-fallback /Users/tomoki/src/RGU/data/n03_target_admin_areas.geojson \
  --coverage-mode full \
  --out /Users/tomoki/src/RGU/data/asis_fine_polygons.geojson
```

市区町村境界Overlayデータ（東京+神奈川）再生成:

```bash
python3 /Users/tomoki/src/RGU/scripts/build_admin_boundary_geojson.py \
  --tokyo /Users/tomoki/src/RGU/data/n03_tokyo_kanagawa/tokyo/N03-20250101_13.geojson \
  --kanagawa /Users/tomoki/src/RGU/data/n03_tokyo_kanagawa/kanagawa/N03-20250101_14.geojson \
  --out /Users/tomoki/src/RGU/data/n03_tokyo_kanagawa_admin_areas.geojson
```

### 既知の注意点
- 町名の表記ゆれ（異体字/丁目表現差）で `Area` 解決がフォールバックになる場合あり
- 運用で表記が増えたら `asis.csv` を更新して再生成する運用を推奨
