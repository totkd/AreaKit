#!/usr/bin/env python3
"""
Build merged municipality boundary GeoJSON.

- Tokyo / Kanagawa: grouped from N03 prefecture files (Polygon / MultiPolygon).
- Optional extra prefectures: derived from fine town polygons by extracting only
  municipality boundary lines (MultiLineString).
"""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import DefaultDict, Dict, Iterable, List, Set, Tuple


SCALE = 1_000_000
Point = Tuple[int, int]
Edge = Tuple[Point, Point]


def canonical_municipality(source: object) -> str:
    if isinstance(source, dict):
        city = str(source.get("N03_004") or "").strip()
        ward = str(source.get("N03_005") or "").strip()
        if city and ward:
            return f"{city}{ward}"
        return city
    return str(source or "").strip()


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


def canonical_pref_name(props: dict) -> str:
    return str(props.get("pref_name") or props.get("N03_001") or "").strip()


def quantize_point(coord: list) -> Point:
    return (int(round(float(coord[0]) * SCALE)), int(round(float(coord[1]) * SCALE)))


def dequantize_point(point: Point) -> List[float]:
    return [point[0] / SCALE, point[1] / SCALE]


def canonical_edge(a: Point, b: Point) -> Edge:
    if a <= b:
        return (a, b)
    return (b, a)


def iter_edges(polygons: List[list]) -> Iterable[Edge]:
    for poly in polygons:
        if not isinstance(poly, list):
            continue
        for ring in poly:
            if not isinstance(ring, list) or len(ring) < 2:
                continue
            for i in range(len(ring) - 1):
                a_raw = ring[i]
                b_raw = ring[i + 1]
                if len(a_raw) < 2 or len(b_raw) < 2:
                    continue
                a = quantize_point(a_raw)
                b = quantize_point(b_raw)
                if a == b:
                    continue
                yield canonical_edge(a, b)


def load_features(path: Path) -> List[dict]:
    with path.open(encoding="utf-8") as f:
        data = json.load(f)
    return list(data.get("features") or [])


def merge_edges_to_lines(edges: Set[Edge]) -> List[List[List[float]]]:
    if not edges:
        return []

    adjacency: DefaultDict[Point, Set[Point]] = defaultdict(set)
    for a, b in edges:
        adjacency[a].add(b)
        adjacency[b].add(a)

    visited: Set[Edge] = set()
    lines: List[List[Point]] = []

    def walk(start: Point, nxt: Point) -> List[Point]:
        path: List[Point] = [start, nxt]
        visited.add(canonical_edge(start, nxt))
        prev, current = start, nxt

        while True:
            candidates = [pt for pt in adjacency[current] if pt != prev and canonical_edge(current, pt) not in visited]
            if not candidates:
                break
            if len(adjacency[current]) != 2:
                break
            next_point = candidates[0]
            path.append(next_point)
            visited.add(canonical_edge(current, next_point))
            prev, current = current, next_point
            if current == start:
                break
        return path

    # Open chains: start from nodes that are not degree-2.
    for node, neighbors in adjacency.items():
        if len(neighbors) == 2:
            continue
        for neighbor in neighbors:
            edge = canonical_edge(node, neighbor)
            if edge in visited:
                continue
            lines.append(walk(node, neighbor))

    # Remaining edges are closed loops.
    for edge in edges:
        if edge in visited:
            continue
        a, b = edge
        lines.append(walk(a, b))

    return [[dequantize_point(pt) for pt in line if len(line) >= 2] for line in lines if len(line) >= 2]


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


def build_extra_pref_boundary_features(
    fine_features: List[dict],
    target_pref_names: Set[str],
    excluded_municipalities: Set[str],
) -> List[dict]:
    edge_muni_counts: Dict[Edge, Counter] = {}
    municipality_pref: Dict[str, str] = {}

    for ft in fine_features:
        props = dict(ft.get("properties") or {})
        pref_name = canonical_pref_name(props)
        if target_pref_names and pref_name not in target_pref_names:
            continue

        municipality = canonical_municipality(props.get("municipality") or props.get("area_name") or props.get("N03_004") or "")
        if not municipality or municipality in excluded_municipalities:
            continue

        polygons = normalize_polygons(ft.get("geometry") or {})
        if not polygons:
            continue

        municipality_pref[municipality] = pref_name
        for edge in iter_edges(polygons):
            if edge not in edge_muni_counts:
                edge_muni_counts[edge] = Counter()
            edge_muni_counts[edge][municipality] += 1

    municipality_edges: DefaultDict[str, Set[Edge]] = defaultdict(set)
    for edge, muni_counter in edge_muni_counts.items():
        municipalities = list(muni_counter.keys())
        if len(municipalities) == 1:
            muni = municipalities[0]
            # count == 1 -> outer municipal edge
            if muni_counter[muni] == 1:
                municipality_edges[muni].add(edge)
        else:
            # shared by different municipalities -> boundary edge for each side
            for muni in municipalities:
                municipality_edges[muni].add(edge)

    out: List[dict] = []
    for index, municipality in enumerate(sorted(municipality_edges.keys()), start=1):
        lines = merge_edges_to_lines(municipality_edges[municipality])
        if not lines:
            continue
        geometry = {"type": "LineString", "coordinates": lines[0]} if len(lines) == 1 else {"type": "MultiLineString", "coordinates": lines}
        pref_name = municipality_pref.get(municipality, "")
        out.append(
            {
                "type": "Feature",
                "properties": {
                    "N03_001": pref_name,
                    "N03_002": "",
                    "N03_003": "",
                    "N03_004": municipality,
                    "N03_005": "",
                    "N03_007": f"FINE-{index:05d}",
                    "area_id": f"FINE-{index:05d}",
                    "area_name": municipality,
                    "municipality": municipality,
                    "pref_name": pref_name,
                    "source": "fine-polygon-derived",
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
    parser.add_argument(
        "--fine-polygons",
        default="data/asis_fine_polygons.geojson",
        help="Fine town/chome polygons GeoJSON path (used for extra prefecture boundaries).",
    )
    parser.add_argument(
        "--extra-pref-names",
        default="埼玉県,千葉県",
        help="Comma separated prefecture names to supplement from fine polygons.",
    )
    args = parser.parse_args()

    in_paths = [Path(args.tokyo), Path(args.kanagawa)]
    features: List[dict] = []
    for path in in_paths:
        features.extend(load_features(path))

    grouped = build_grouped_features(features)
    excluded_municipalities = {str(ft.get("properties", {}).get("municipality") or "").strip() for ft in grouped}

    extra_pref_names = {name.strip() for name in str(args.extra_pref_names or "").split(",") if name.strip()}
    fine_polygons_path = Path(args.fine_polygons)
    if extra_pref_names and fine_polygons_path.exists():
        fine_features = load_features(fine_polygons_path)
        grouped.extend(build_extra_pref_boundary_features(fine_features, extra_pref_names, excluded_municipalities))

    grouped.sort(
        key=lambda ft: (
            str(ft.get("properties", {}).get("pref_name") or ""),
            str(ft.get("properties", {}).get("municipality") or ""),
            str(ft.get("properties", {}).get("area_id") or ""),
        )
    )
    out_obj = {"type": "FeatureCollection", "features": grouped}

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(out_obj, f, ensure_ascii=False)

    print(f"wrote: {out_path}")
    print(f"features: {len(grouped)}")


if __name__ == "__main__":
    main()
