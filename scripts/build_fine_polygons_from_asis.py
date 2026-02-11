#!/usr/bin/env python3
"""
Build fine-grained (town/chome level) polygons with existing depot assignment.

Inputs:
- asis.csv (ZIP-level current assignment)
- e-Stat KMZ package for Kanagawa (A002005212020DDKWC14.zip)
- baseline admin assignment CSV (for municipality fallback)
- optional N03 GeoJSON fallback for municipalities not covered by town polygons

Output:
- GeoJSON with properties:
  area_id, area_name, municipality, town_name, depot_code, depot_name, assign_status, ...
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import zipfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Set, Tuple


KML_NS = {"k": "http://www.opengis.net/kml/2.2"}
DEPOT_NAMES = {
    "SGM": "相模原デポ SGM",
    "FUJ": "藤沢デポ FUJ",
    "YOK": "横浜港北デポ YOK",
}


@dataclass
class TownArea:
    area_id: str
    pref_name: str
    municipality: str
    town_name: str
    keycode1: str
    geometry_coords: List[List[List[List[float]]]]  # GeoJSON MultiPolygon coordinates


def normalize_header(value: str) -> str:
    return str(value or "").replace("\ufeff", "").strip().lower()


def normalize_depot_code(value: str) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    upper = raw.upper()
    if upper in DEPOT_NAMES:
        return upper
    if "SGM" in upper or "相模原" in raw:
        return "SGM"
    if "FUJ" in upper or "藤沢" in raw:
        return "FUJ"
    if "YOK" in upper or "横浜港北" in raw:
        return "YOK"
    return ""


def normalize_text(value: str) -> str:
    return str(value or "").strip().replace(" ", "").replace("　", "")


def canonical_municipality(value: str) -> str:
    out = normalize_text(value)
    out = re.sub(r"^(東京都|神奈川県)", "", out)
    if out == "町田":
        out = "町田市"
    if out == "藤沢":
        out = "藤沢市"
    if re.match(r"^横浜.+区$", out) and not out.startswith("横浜市"):
        out = "横浜市" + out[len("横浜") :]
    if re.match(r"^川崎.+区$", out) and not out.startswith("川崎市"):
        out = "川崎市" + out[len("川崎") :]
    if re.match(r"^相模原.+区$", out) and not out.startswith("相模原市"):
        out = "相模原市" + out[len("相模原") :]
    return out


def canonical_town_name(value: str) -> str:
    out = normalize_text(value)
    out = out.replace("ヶ", "ケ").replace("ヵ", "ケ").replace("ｹ", "ケ")
    out = out.replace("之", "の")
    out = re.sub(r"[0-9０-９]+丁目$", "", out)
    out = re.sub(r"[一二三四五六七八九十]+丁目$", "", out)
    return out


def read_csv(path: Path) -> List[dict]:
    with path.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        return [dict(row) for row in reader]


def pick_value(row: dict, headers: Iterable[str]) -> str:
    lowered = {normalize_header(k): k for k in row.keys()}
    for h in headers:
        key = lowered.get(normalize_header(h))
        if key is not None:
            return str(row.get(key, "")).strip()
    return ""


def load_baseline_assignments(path: Path) -> Tuple[Dict[str, str], Dict[str, Set[str]]]:
    rows = read_csv(path)
    muni_to_single_depot: Dict[str, str] = {}
    muni_to_depots: Dict[str, Set[str]] = {}

    for row in rows:
        muni = canonical_municipality(pick_value(row, ["area_name", "municipality", "name", "市区"]))
        depot = normalize_depot_code(pick_value(row, ["depot_code", "depot", "管轄デポ", "担当デポ"]))
        if not muni:
            continue
        if muni not in muni_to_depots:
            muni_to_depots[muni] = set()
        if depot:
            muni_to_depots[muni].add(depot)

    for muni, depots in muni_to_depots.items():
        if len(depots) == 1:
            muni_to_single_depot[muni] = next(iter(depots))
        else:
            muni_to_single_depot[muni] = ""

    return muni_to_single_depot, muni_to_depots


def infer_municipality_from_asis(city: str, area_label: str, target_munis: Set[str]) -> str:
    city_c = canonical_municipality(city)
    if city_c in target_munis:
        return city_c

    area_c = canonical_municipality(re.sub(r"\(.*?\)|（.*?）", "", normalize_text(area_label)))
    if area_c in target_munis:
        return area_c

    return ""


def build_town_to_depots_map(asis_path: Path, target_munis: Set[str]) -> Dict[Tuple[str, str], Set[str]]:
    rows = read_csv(asis_path)
    out: Dict[Tuple[str, str], Set[str]] = {}
    for row in rows:
        depot = normalize_depot_code(pick_value(row, ["管轄デポ", "担当デポ", "depot_code", "depot"]))
        if not depot:
            continue
        city = pick_value(row, ["市区", "city", "municipality"])
        area_label = pick_value(row, ["対応エリア", "area_name"])
        # These rows represent special-case ZIP codes (e.g. large facilities),
        # not a general town-level service area; they can conflict with the town's default depot.
        if area_label == "特定施設・基地等":
            continue
        municipality = infer_municipality_from_asis(city, area_label, target_munis)
        if not municipality:
            continue

        town = pick_value(row, ["町", "town", "S_NAME"])
        if not town or town == "以下に掲載がない場合":
            continue
        town_key = canonical_town_name(town)
        key = (municipality, town_key)
        if key not in out:
            out[key] = set()
        out[key].add(depot)

    return out


def read_inner_kmz_kml_bytes(wrapper_zip_path: Path) -> bytes:
    with zipfile.ZipFile(wrapper_zip_path) as outer:
        names = outer.namelist()
        if not names:
            raise RuntimeError(f"No entries found in {wrapper_zip_path}")
        kmz_name = names[0]
        kmz_bytes = outer.read(kmz_name)

    with zipfile.ZipFile(io.BytesIO(kmz_bytes)) as kmz:
        kml_names = [name for name in kmz.namelist() if name.lower().endswith(".kml")]
        if not kml_names:
            raise RuntimeError(f"No KML found in inner KMZ: {wrapper_zip_path}")
        return kmz.read(kml_names[0])


def parse_coord_text(coord_text: str) -> List[List[float]]:
    coords: List[List[float]] = []
    for token in str(coord_text or "").strip().split():
        parts = token.split(",")
        if len(parts) < 2:
            continue
        try:
            lon = float(parts[0])
            lat = float(parts[1])
        except ValueError:
            continue
        coords.append([lon, lat])
    if coords and coords[0] != coords[-1]:
        coords.append(coords[0])
    return coords


def parse_polygon_coords(poly_elem: ET.Element) -> Optional[List[List[List[float]]]]:
    outer_text = poly_elem.findtext(".//k:outerBoundaryIs/k:LinearRing/k:coordinates", default="", namespaces=KML_NS)
    outer = parse_coord_text(outer_text)
    if len(outer) < 4:
        return None
    rings = [outer]

    for inner_elem in poly_elem.findall(".//k:innerBoundaryIs/k:LinearRing/k:coordinates", KML_NS):
        inner = parse_coord_text(inner_elem.text or "")
        if len(inner) >= 4:
            rings.append(inner)
    return rings


def collect_town_areas_from_kmz(kmz_zip_path: Path, target_munis: Set[str]) -> Dict[str, TownArea]:
    kml_bytes = read_inner_kmz_kml_bytes(kmz_zip_path)
    root = ET.fromstring(kml_bytes)

    grouped: Dict[str, TownArea] = {}

    for pm in root.findall(".//k:Placemark", KML_NS):
        attrs = {e.get("name"): (e.text or "").strip() for e in pm.findall(".//k:SimpleData", KML_NS)}
        municipality = canonical_municipality(attrs.get("CITY_NAME", ""))
        town_name = str(attrs.get("S_NAME", "")).strip()
        keycode1 = str(attrs.get("KEYCODE1", "")).strip()
        pref_name = str(attrs.get("PREF_NAME", "")).strip() or "神奈川県"

        if municipality not in target_munis:
            continue
        if not town_name or not keycode1:
            continue

        polygon_coords = []
        for poly in pm.findall(".//k:Polygon", KML_NS):
            rings = parse_polygon_coords(poly)
            if rings:
                polygon_coords.append(rings)
        if not polygon_coords:
            continue

        area_id = f"KA14-{keycode1}"
        if area_id not in grouped:
            grouped[area_id] = TownArea(
                area_id=area_id,
                pref_name=pref_name,
                municipality=municipality,
                town_name=town_name,
                keycode1=keycode1,
                geometry_coords=[],
            )
        grouped[area_id].geometry_coords.extend(polygon_coords)

    return grouped


def pick_depot_for_town(
    municipality: str,
    town_name: str,
    town_to_depots: Dict[Tuple[str, str], Set[str]],
    muni_to_single_depot: Dict[str, str],
    muni_to_depots: Dict[str, Set[str]],
) -> Tuple[str, str]:
    key = (municipality, canonical_town_name(town_name))
    depots = town_to_depots.get(key, set())
    if len(depots) == 1:
        return next(iter(depots)), "TOWN_MATCH"
    if len(depots) > 1:
        return "", "TOWN_CONFLICT:" + "/".join(sorted(depots))

    single = muni_to_single_depot.get(municipality, "")
    if single:
        return single, "MUNI_FALLBACK"

    multi = muni_to_depots.get(municipality, set())
    if len(multi) > 1:
        return "", "MUNI_CONFLICT:" + "/".join(sorted(multi))
    return "", "NO_DATA"


def build_town_features(
    areas: Dict[str, TownArea],
    town_to_depots: Dict[Tuple[str, str], Set[str]],
    muni_to_single_depot: Dict[str, str],
    muni_to_depots: Dict[str, Set[str]],
) -> List[dict]:
    features = []
    for area_id in sorted(areas):
        area = areas[area_id]
        depot_code, status = pick_depot_for_town(
            municipality=area.municipality,
            town_name=area.town_name,
            town_to_depots=town_to_depots,
            muni_to_single_depot=muni_to_single_depot,
            muni_to_depots=muni_to_depots,
        )
        geometry = (
            {"type": "Polygon", "coordinates": area.geometry_coords[0]}
            if len(area.geometry_coords) == 1
            else {"type": "MultiPolygon", "coordinates": area.geometry_coords}
        )
        feature = {
            "type": "Feature",
            "properties": {
                "area_id": area.area_id,
                "area_name": f"{area.municipality}{area.town_name}",
                "municipality": area.municipality,
                "town_name": area.town_name,
                "pref_name": area.pref_name,
                "town_code": area.keycode1,
                "source": "e-stat-r2ka14-kmz",
                "depot_code": depot_code,
                "depot_name": DEPOT_NAMES.get(depot_code, ""),
                "assign_status": status,
            },
            "geometry": geometry,
        }
        features.append(feature)
    return features


def load_n03_fallback_features(n03_geojson_path: Path, target_ids: Set[str], muni_to_single_depot: Dict[str, str]) -> List[dict]:
    if not n03_geojson_path.exists():
        return []

    with n03_geojson_path.open(encoding="utf-8") as f:
        data = json.load(f)

    out = []
    for ft in data.get("features", []):
        props = ft.get("properties", {})
        area_id = str(props.get("area_id") or props.get("N03_007") or "").strip()
        if area_id not in target_ids:
            continue
        municipality = canonical_municipality(props.get("area_name") or props.get("municipality") or props.get("N03_004") or "")
        depot_code = muni_to_single_depot.get(municipality, "")
        out.append(
            {
                "type": "Feature",
                "properties": {
                    "area_id": f"N03-{area_id}",
                    "area_name": municipality or area_id,
                    "municipality": municipality or area_id,
                    "town_name": "",
                    "pref_name": str(props.get("pref_name") or props.get("N03_001") or "").strip(),
                    "town_code": area_id,
                    "source": "n03-fallback",
                    "depot_code": depot_code,
                    "depot_name": DEPOT_NAMES.get(depot_code, ""),
                    "assign_status": "N03_FALLBACK",
                },
                "geometry": ft.get("geometry"),
            }
        )
    return out


def summarize(features: List[dict]) -> Dict[str, int]:
    out = {"total": 0, "assigned": 0, "SGM": 0, "FUJ": 0, "YOK": 0, "unassigned": 0}
    out["total"] = len(features)
    for ft in features:
        depot = str(ft.get("properties", {}).get("depot_code") or "").strip()
        if depot in ("SGM", "FUJ", "YOK"):
            out["assigned"] += 1
            out[depot] += 1
        else:
            out["unassigned"] += 1
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="Build fine-grained area polygons with existing assignment.")
    parser.add_argument("--asis", default="asis.csv", help="Path to asis CSV.")
    parser.add_argument(
        "--kanagawa-kmz-zip",
        default="/Users/tomoki/Downloads/A002005212020DDKWC14.zip",
        help="Path to e-Stat KMZ wrapper ZIP for Kanagawa.",
    )
    parser.add_argument(
        "--baseline",
        default="data/asis_admin_assignments.csv",
        help="Baseline admin assignment CSV for municipality fallback.",
    )
    parser.add_argument(
        "--n03-fallback",
        default="data/n03_target_admin_areas.geojson",
        help="N03 GeoJSON used for municipalities not covered by town KMZ (e.g. Machida).",
    )
    parser.add_argument(
        "--out",
        default="data/asis_fine_polygons.geojson",
        help="Output GeoJSON path.",
    )
    args = parser.parse_args()

    asis_path = Path(args.asis)
    kmz_zip_path = Path(args.kanagawa_kmz_zip)
    baseline_path = Path(args.baseline)
    n03_fallback_path = Path(args.n03_fallback)
    out_path = Path(args.out)

    muni_to_single_depot, muni_to_depots = load_baseline_assignments(baseline_path)
    target_munis = set(muni_to_depots.keys()) - {"町田市"}

    town_to_depots = build_town_to_depots_map(asis_path, target_munis)
    town_areas = collect_town_areas_from_kmz(kmz_zip_path, target_munis)
    town_features = build_town_features(town_areas, town_to_depots, muni_to_single_depot, muni_to_depots)

    # Machida is not covered by the Kanagawa KMZ; include it from N03 fallback.
    fallback_features = load_n03_fallback_features(n03_fallback_path, {"13209"}, muni_to_single_depot)

    all_features = town_features + fallback_features
    out = {"type": "FeatureCollection", "features": all_features}

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)

    stats = summarize(all_features)
    print(f"wrote: {out_path}")
    print(f"features: {stats['total']}")
    print(f"assigned: {stats['assigned']} (SGM={stats['SGM']}, FUJ={stats['FUJ']}, YOK={stats['YOK']})")
    print(f"unassigned: {stats['unassigned']}")


if __name__ == "__main__":
    main()
