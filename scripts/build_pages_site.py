"""Build a static GitHub Pages dashboard from the crescent visibility engine.

GitHub Pages cannot run the Streamlit app or Skyfield at request time, so this
script samples the same Python model into a compact JSON dataset used by the
static HTML/JS site in ``pages/``.
"""

from __future__ import annotations

import json
import math
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

import cartopy
from cartopy.io import shapereader
from shapely.geometry import mapping

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from visibility_engine import evaluate_datetime, evaluate_datetime_fast, local_to_utc


PAGES_DIR = ROOT / "pages"
DATA_DIR = PAGES_DIR / "data"
DOCS_DIR = PAGES_DIR / "docs"
CARTOPY_DATA_DIR = ROOT / "cartopy_data"
cartopy.config["data_dir"] = str(CARTOPY_DATA_DIR)

LOCATION_PRESETS = {
    "Melbourne, AU": (-37.8136, 144.9631, 31, 10.0),
    "Mecca, SA": (21.3891, 39.8579, 277, 3.0),
    "Jakarta, ID": (-6.2088, 106.8456, 8, 7.0),
    "Kuala Lumpur, MY": (3.1390, 101.6869, 66, 8.0),
    "London, UK": (51.5072, -0.1276, 11, 0.0),
    "New York, US": (40.7128, -74.0060, 10, -5.0),
}

METRICS = {
    "composite": {
        "label": "Composite index (exploratory)",
        "status": "Exploratory proxy, not a published visibility criterion.",
    },
    "yallop": {
        "label": "Yallop q (real formula criterion)",
        "status": "Formula-based implementation using ARCV and crescent width W.",
    },
    "odeh": {
        "label": "Odeh V (real formula criterion)",
        "status": "Formula-based implementation using ARCV and crescent width W.",
    },
    "ilyas": {
        "label": "Ilyas (legacy heuristic)",
        "status": "Legacy threshold heuristic retained for comparison.",
    },
    "shaukat": {
        "label": "Shaukat (legacy heuristic)",
        "status": "Legacy threshold heuristic retained for comparison.",
    },
    "saao": {
        "label": "SAAO (legacy heuristic)",
        "status": "Legacy moon-age and lag heuristic retained for comparison.",
    },
}


def finite_or_none(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return round(value, 6) if math.isfinite(value) else None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return value
    return round(number, 6) if math.isfinite(number) else None


def pick(row, keys):
    return {key: finite_or_none(row.get(key)) for key in keys}


POINT_KEYS = [
    "datetime_utc",
    "latitude",
    "longitude",
    "composite",
    "moon_altitude_deg",
    "sun_altitude_deg",
    "moon_sun_separation_deg",
    "moon_arc_of_vision_deg",
    "moon_relative_azimuth_deg",
    "moon_crescent_width_arcmin",
    "moon_illumination_fraction",
    "moon_age_days",
    "moon_birth_utc",
    "next_moon_birth_utc",
    "sunset_utc",
    "moonset_utc",
    "moon_lag_minutes",
    "moon_age_at_sunset_hours",
    "moon_born_before_sunset",
    "moonset_after_sunset",
    "islamic_geometry_gate",
    "yallop_q",
    "odeh_v",
    "ilyas_score",
    "ilyas_label",
    "yallop_score",
    "yallop_label",
    "odeh_score",
    "odeh_label",
    "shaukat_score",
    "shaukat_label",
    "saao_score",
    "saao_label",
]

MAP_POINT_KEYS = [
    "datetime_utc",
    "latitude",
    "longitude",
    "composite",
    "moon_altitude_deg",
    "sun_altitude_deg",
    "moon_sun_separation_deg",
    "moon_arc_of_vision_deg",
    "moon_relative_azimuth_deg",
    "moon_crescent_width_arcmin",
    "moon_illumination_fraction",
    "moon_age_days",
    "yallop_q",
    "odeh_v",
    "ilyas_score",
    "yallop_score",
    "odeh_score",
    "shaukat_score",
    "saao_score",
]


def build_country_geojson():
    shp_path = shapereader.natural_earth(
        resolution="110m",
        category="cultural",
        name="admin_0_countries",
    )
    features = []
    for record in shapereader.Reader(shp_path).records():
        attrs = record.attributes
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "name": attrs.get("NAME") or attrs.get("ADMIN") or "Country",
                    "admin": attrs.get("ADMIN") or attrs.get("NAME") or "Country",
                },
                "geometry": mapping(record.geometry),
            }
        )
    return {"type": "FeatureCollection", "features": features}


def build_dataset():
    generated_at = datetime.utcnow().replace(microsecond=0)
    base_day = generated_at.date()
    dates = [(base_day + timedelta(days=offset)).isoformat() for offset in range(-2, 9)]
    minutes = [16 * 60, 17 * 60, 18 * 60, 19 * 60, 20 * 60, 21 * 60]
    minute_labels = {str(minute): f"{minute // 60:02d}:{minute % 60:02d}" for minute in minutes}

    locations = []
    location_rows = {}
    for name, (lat, lon, elevation, utc_offset) in LOCATION_PRESETS.items():
        locations.append(
            {
                "name": name,
                "latitude": lat,
                "longitude": lon,
                "elevation_m": elevation,
                "utc_offset_hours": utc_offset,
            }
        )
        location_rows[name] = {}
        for day_text in dates:
            local_day = date.fromisoformat(day_text)
            location_rows[name][day_text] = {}
            for minute in minutes:
                dt_utc = local_to_utc(local_day, minute, utc_offset)
                row = dict(evaluate_datetime(lat, lon, elevation, dt_utc))
                row["local_date"] = day_text
                row["local_time"] = minute_labels[str(minute)]
                location_rows[name][day_text][str(minute)] = pick(row, POINT_KEYS + ["local_date", "local_time"])

    map_grids = {}
    for day_text in dates:
        local_day = date.fromisoformat(day_text)
        map_grids[day_text] = {}
        for minute in minutes:
            dt_utc = local_to_utc(local_day, minute, 0.0)
            points = []
            for lat in range(-60, 61, 15):
                for lon in range(-180, 181, 20):
                    row = dict(evaluate_datetime_fast(float(lat), float(lon), 0.0, dt_utc))
                    points.append(pick(row, MAP_POINT_KEYS))
            map_grids[day_text][str(minute)] = points

    return {
        "generated_at_utc": generated_at.isoformat() + "Z",
        "source": "Generated from the repository Python Skyfield/Yallop/Odeh engine.",
        "metrics": METRICS,
        "dates": dates,
        "minutes": minutes,
        "minute_labels": minute_labels,
        "locations": locations,
        "location_rows": location_rows,
        "map_grids": map_grids,
        "countries": build_country_geojson(),
    }


def copy_docs():
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    source = ROOT / "docs" / "CRESCENT_VISIBILITY.md"
    target = DOCS_DIR / "CRESCENT_VISIBILITY.md"
    target.write_text(source.read_text(encoding="utf-8"), encoding="utf-8")


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    copy_docs()
    payload = build_dataset()
    (DATA_DIR / "site_data.json").write_text(
        json.dumps(payload, ensure_ascii=True, separators=(",", ":")),
        encoding="utf-8",
    )
    (PAGES_DIR / ".nojekyll").write_text("", encoding="utf-8")
    print(f"Wrote {DATA_DIR / 'site_data.json'}")


if __name__ == "__main__":
    main()
