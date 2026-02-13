#!/usr/bin/env python3
"""
Build merged municipality boundary GeoJSON from N03 prefecture files.

This script groups features by municipality code (N03_007) and emits one
feature per municipality using Polygon / MultiPolygon geometry.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Dict, List


def canonical_municipality(props: dict) -> str:
    city = str(props.get("N03_004") or "").strip()
    ward = str(props.get("N03_005") or "").strip()
    if city and ward:
        return f"{city}{ward}"
    return city


def normalize_polygons(geometry: dict) -> List[list]:
    if not geometry:
        return []
    geom_type = geometry.get("type")
    coords = geometry.get("coordinates")
    if geom_type == "Polygon" and isinstance(coords, list):
        return [coords]
    if geom_type == "MultiPolygon" and isinstance(coords, list):
        return list(coords)
    return []


def load_features(path: Path) -> List[dict]:
    with path.open(encoding="utf-8") as f:
        data = json.load(f)
    return list(data.get("features") or [])


def build_grouped_features(features: List[dict]) -> List[dict]:
    grouped: Dict[str, dict] = {}
    for ft in features:
        props = dict(ft.get("properties") or {})
        area_code = str(props.get("N03_007") or "").strip()
        municipality = canonical_municipality(props)
        if not area_code or not municipality:
            continue
        if municipality == "所属未定地":
            continue

        polygons = normalize_polygons(ft.get("geometry") or {})
        if not polygons:
            continue

        if area_code not in grouped:
            grouped[area_code] = {
                "props": props,
                "municipality": municipality,
                "polygons": [],
            }
        grouped[area_code]["polygons"].extend(polygons)

    out: List[dict] = []
    for area_code in sorted(grouped.keys()):
        item = grouped[area_code]
        props = item["props"]
        municipality = item["municipality"]
        polygons = item["polygons"]
        geometry = (
            {"type": "Polygon", "coordinates": polygons[0]}
            if len(polygons) == 1
            else {"type": "MultiPolygon", "coordinates": polygons}
        )
        out.append(
            {
                "type": "Feature",
                "properties": {
                    "N03_001": str(props.get("N03_001") or "").strip(),
                    "N03_002": str(props.get("N03_002") or "").strip(),
                    "N03_003": str(props.get("N03_003") or "").strip(),
                    "N03_004": str(props.get("N03_004") or "").strip(),
                    "N03_005": str(props.get("N03_005") or "").strip(),
                    "N03_007": area_code,
                    "area_id": area_code,
                    "area_name": municipality,
                    "municipality": municipality,
                    "pref_name": str(props.get("N03_001") or "").strip(),
                },
                "geometry": geometry,
            }
        )
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="Build merged municipality boundary GeoJSON from N03 sources.")
    parser.add_argument(
        "--tokyo",
        default="data/n03_tokyo_kanagawa/tokyo/N03-20250101_13.geojson",
        help="Tokyo N03 GeoJSON path.",
    )
    parser.add_argument(
        "--kanagawa",
        default="data/n03_tokyo_kanagawa/kanagawa/N03-20250101_14.geojson",
        help="Kanagawa N03 GeoJSON path.",
    )
    parser.add_argument(
        "--out",
        default="data/n03_tokyo_kanagawa_admin_areas.geojson",
        help="Output GeoJSON path.",
    )
    args = parser.parse_args()

    in_paths = [Path(args.tokyo), Path(args.kanagawa)]
    features: List[dict] = []
    for path in in_paths:
        features.extend(load_features(path))

    grouped = build_grouped_features(features)
    out_obj = {"type": "FeatureCollection", "features": grouped}

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(out_obj, f, ensure_ascii=False)

    print(f"wrote: {out_path}")
    print(f"features: {len(grouped)}")


if __name__ == "__main__":
    main()
