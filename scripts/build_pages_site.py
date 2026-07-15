"""Build the static GitHub Pages Hilaal app.

The public site is static, so this script samples the Python/Skyfield engine
into JSON that the browser can explore without a server.
"""

from __future__ import annotations

import calendar
import json
import math
import os
import sys
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import date, datetime, timedelta
from pathlib import Path

import cartopy
from cartopy.io import shapereader
from shapely.geometry import mapping

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from calculations import get_lunar_phase_events, get_solar_lunar_events
from visibility_engine import evaluate_datetime_fast, islamic_sighting_context, local_to_utc, parse_utc


PAGES_DIR = ROOT / "pages"
DATA_DIR = PAGES_DIR / "data"
DOCS_DIR = PAGES_DIR / "docs"
CARTOPY_DATA_DIR = ROOT / "cartopy_data"
cartopy.config["data_dir"] = str(CARTOPY_DATA_DIR)

WORKER_POINTS = []

METRICS = {
    "yallop": {
        "label": "Yallop",
        "status": "Formula-based criterion using ARCV and topocentric crescent width W.",
    },
    "odeh": {
        "label": "Odeh",
        "status": "Formula-based criterion using ARCV and topocentric crescent width W.",
    },
}

LOCATION_PRESETS = [
    ("Melbourne, Australia", -37.8136, 144.9631, 31, 10.0, "Australia", "Melbourne Victoria CBD Naarm"),
    ("Sydney, Australia", -33.8688, 151.2093, 58, 10.0, "Australia", "Sydney NSW"),
    ("Brisbane, Australia", -27.4698, 153.0251, 28, 10.0, "Australia", "Brisbane Queensland"),
    ("Perth, Australia", -31.9523, 115.8613, 31, 8.0, "Australia", "Perth WA"),
    ("Adelaide, Australia", -34.9285, 138.6007, 50, 9.5, "Australia", "Adelaide SA"),
    ("Canberra, Australia", -35.2809, 149.13, 577, 10.0, "Australia", "Canberra ACT"),
    ("Mecca, Saudi Arabia", 21.3891, 39.8579, 277, 3.0, "Saudi Arabia", "Makkah Kaaba"),
    ("Medina, Saudi Arabia", 24.5247, 39.5692, 608, 3.0, "Saudi Arabia", "Madinah"),
    ("Riyadh, Saudi Arabia", 24.7136, 46.6753, 612, 3.0, "Saudi Arabia", "Riyadh"),
    ("Jakarta, Indonesia", -6.2088, 106.8456, 8, 7.0, "Indonesia", "Jakarta Java"),
    ("Kuala Lumpur, Malaysia", 3.139, 101.6869, 66, 8.0, "Malaysia", "KL Selangor"),
    ("Singapore", 1.3521, 103.8198, 15, 8.0, "Singapore", "Singapore"),
    ("London, United Kingdom", 51.5072, -0.1276, 11, 0.0, "United Kingdom", "London England"),
    ("New York, United States", 40.7128, -74.006, 10, -5.0, "United States", "New York NYC Manhattan"),
    ("Toronto, Canada", 43.6532, -79.3832, 76, -5.0, "Canada", "Toronto Ontario"),
    ("Cairo, Egypt", 30.0444, 31.2357, 23, 2.0, "Egypt", "Cairo"),
    ("Istanbul, Turkiye", 41.0082, 28.9784, 40, 3.0, "Turkiye", "Istanbul Turkey"),
    ("Karachi, Pakistan", 24.8607, 67.0011, 10, 5.0, "Pakistan", "Karachi Sindh"),
    ("Mumbai, India", 19.076, 72.8777, 14, 5.5, "India", "Mumbai Bombay"),
    ("Delhi, India", 28.6139, 77.209, 216, 5.5, "India", "Delhi New Delhi"),
    ("Dhaka, Bangladesh", 23.8103, 90.4125, 4, 6.0, "Bangladesh", "Dhaka"),
    ("Cape Town, South Africa", -33.9249, 18.4241, 25, 2.0, "South Africa", "Cape Town"),
    ("Lagos, Nigeria", 6.5244, 3.3792, 41, 1.0, "Nigeria", "Lagos"),
    ("Sao Paulo, Brazil", -23.5558, -46.6396, 760, -3.0, "Brazil", "Sao Paulo"),
]

PUBLIC_LOCATION_NAMES = {
    "Melbourne, Australia",
    "Sydney, Australia",
    "Mecca, Saudi Arabia",
    "Jakarta, Indonesia",
    "Kuala Lumpur, Malaysia",
    "London, United Kingdom",
    "New York, United States",
    "Cairo, Egypt",
    "Karachi, Pakistan",
    "Delhi, India",
}

CITY_POINTS = [
    ("Tokyo", "Japan", 35.6762, 139.6503, 40),
    ("Seoul", "South Korea", 37.5665, 126.978, 38),
    ("Beijing", "China", 39.9042, 116.4074, 44),
    ("Shanghai", "China", 31.2304, 121.4737, 4),
    ("Manila", "Philippines", 14.5995, 120.9842, 16),
    ("Bangkok", "Thailand", 13.7563, 100.5018, 15),
    ("Dubai", "United Arab Emirates", 25.2048, 55.2708, 16),
    ("Doha", "Qatar", 25.2854, 51.531, 10),
    ("Kuwait City", "Kuwait", 29.3759, 47.9774, 16),
    ("Amman", "Jordan", 31.9539, 35.9106, 757),
    ("Jerusalem", "Palestine/Israel", 31.7683, 35.2137, 754),
    ("Casablanca", "Morocco", 33.5731, -7.5898, 27),
    ("Rabat", "Morocco", 34.0209, -6.8416, 75),
    ("Algiers", "Algeria", 36.7538, 3.0588, 186),
    ("Tunis", "Tunisia", 36.8065, 10.1815, 4),
    ("Nairobi", "Kenya", -1.2921, 36.8219, 1795),
    ("Auckland", "New Zealand", -36.8509, 174.7645, 20),
    ("Los Angeles", "United States", 34.0522, -118.2437, 71),
    ("Chicago", "United States", 41.8781, -87.6298, 181),
    ("Mexico City", "Mexico", 19.4326, -99.1332, 2240),
    ("Buenos Aires", "Argentina", -34.6037, -58.3816, 25),
    ("Paris", "France", 48.8566, 2.3522, 35),
    ("Berlin", "Germany", 52.52, 13.405, 34),
    ("Madrid", "Spain", 40.4168, -3.7038, 667),
    ("Rome", "Italy", 41.9028, 12.4964, 21),
]

STATE_POINTS = [
    ("New South Wales", "Australia", -31.2532, 146.9211, 0),
    ("Victoria", "Australia", -37.4713, 144.7852, 0),
    ("Queensland", "Australia", -22.5752, 144.0848, 0),
    ("Western Australia", "Australia", -27.6728, 121.6283, 0),
    ("South Australia", "Australia", -30.0002, 136.2092, 0),
    ("Tasmania", "Australia", -42.0409, 146.8087, 0),
    ("Australian Capital Territory", "Australia", -35.4735, 149.0124, 0),
    ("Northern Territory", "Australia", -19.4914, 132.5510, 0),
    ("California", "United States", 36.7783, -119.4179, 0),
    ("Texas", "United States", 31.9686, -99.9018, 0),
    ("New York State", "United States", 43.2994, -74.2179, 0),
    ("Ontario", "Canada", 50.0000, -85.0000, 0),
    ("Punjab", "Pakistan", 31.1704, 72.7097, 0),
    ("Sindh", "Pakistan", 26.0094, 68.7768, 0),
    ("Maharashtra", "India", 19.7515, 75.7139, 0),
    ("West Java", "Indonesia", -6.9175, 107.6191, 0),
]

CAPITAL_POINTS = [
    ("Canberra", "Australia", -35.2809, 149.1300, 577),
    ("Washington, DC", "United States", 38.9072, -77.0369, 7),
    ("Ottawa", "Canada", 45.4215, -75.6972, 70),
    ("Brasilia", "Brazil", -15.8267, -47.9218, 1172),
    ("Riyadh", "Saudi Arabia", 24.7136, 46.6753, 612),
    ("Cairo", "Egypt", 30.0444, 31.2357, 23),
    ("Ankara", "Turkiye", 39.9334, 32.8597, 938),
    ("Islamabad", "Pakistan", 33.6844, 73.0479, 540),
    ("New Delhi", "India", 28.6139, 77.2090, 216),
    ("Dhaka", "Bangladesh", 23.8103, 90.4125, 4),
    ("Kuala Lumpur", "Malaysia", 3.1390, 101.6869, 66),
    ("Jakarta", "Indonesia", -6.2088, 106.8456, 8),
    ("London", "United Kingdom", 51.5072, -0.1276, 11),
    ("Paris", "France", 48.8566, 2.3522, 35),
    ("Berlin", "Germany", 52.5200, 13.4050, 34),
    ("Madrid", "Spain", 40.4168, -3.7038, 667),
    ("Rome", "Italy", 41.9028, 12.4964, 21),
    ("Wellington", "New Zealand", -41.2865, 174.7762, 31),
]


def finite_or_none(value, digits=4):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, bool) or value is None:
        return value
    try:
        number = float(value)
    except (TypeError, ValueError):
        return value
    return round(number, digits) if math.isfinite(number) else None


def pick(row, keys):
    return {key: finite_or_none(row.get(key)) for key in keys}


DETAIL_KEYS = [
    "datetime_utc",
    "latitude",
    "longitude",
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
    "yallop_score",
    "yallop_label",
    "odeh_v",
    "odeh_score",
    "odeh_label",
]


def compact_row(row):
    return [
        finite_or_none(row["yallop_score"], 0),
        finite_or_none(row["odeh_score"], 0),
        finite_or_none(row["yallop_q"]),
        finite_or_none(row["odeh_v"]),
        finite_or_none(row["moon_altitude_deg"]),
        finite_or_none(row["sun_altitude_deg"]),
        finite_or_none(row["moon_sun_separation_deg"]),
        finite_or_none(row["moon_arc_of_vision_deg"]),
        finite_or_none(row["moon_relative_azimuth_deg"]),
        finite_or_none(row["moon_crescent_width_arcmin"]),
        finite_or_none(row["moon_illumination_fraction"], 5),
        finite_or_none(row["moon_age_days"]),
    ]


def yallop_van_gent_score(q):
    if q is None or not math.isfinite(float(q)):
        return 0
    q = float(q)
    if q > 0.216:
        return 5
    if q > -0.014:
        return 4
    if q > -0.160:
        return 3
    if q > -0.232:
        return 2
    if q > -0.293:
        return 1
    return 0


def solar_utc_offset(longitude):
    return max(-12.0, min(14.0, float(longitude) / 15.0))


def compact_first_visibility_row(point, local_day):
    offset = solar_utc_offset(point["longitude"])
    events = get_solar_lunar_events(
        point["latitude"],
        point["longitude"],
        point["elevation_m"],
        local_day.year,
        local_day.month,
        local_day.day,
        utc_offset_hours=offset,
    )
    sunset_dt = parse_utc(events.get("sunset_utc"))
    moonset_dt = parse_utc(events.get("moonset_utc"))
    if not sunset_dt or not moonset_dt:
        return [3, 0, None, None, None, None, None, None, None, None, None, None, events.get("sunset_utc"), events.get("moonset_utc"), None, None]

    lag_minutes = (moonset_dt - sunset_dt).total_seconds() / 60.0
    best_dt = sunset_dt + (moonset_dt - sunset_dt) * (4.0 / 9.0)
    phase_events = get_lunar_phase_events(
        best_dt.year,
        best_dt.month,
        best_dt.day,
        best_dt.hour,
        best_dt.minute,
    )
    birth_dt = parse_utc(phase_events.get("previous_new_moon_utc"))
    if moonset_dt <= sunset_dt:
        status = 1
    elif birth_dt and best_dt < birth_dt:
        status = 2
    else:
        status = 0

    row = dict(evaluate_datetime_fast(point["latitude"], point["longitude"], point["elevation_m"], best_dt))
    q = row.get("yallop_q")
    age_hours = (best_dt - birth_dt).total_seconds() / 3600.0 if birth_dt else None
    return [
        status,
        yallop_van_gent_score(q),
        finite_or_none(q),
        finite_or_none(row.get("moon_altitude_deg")),
        finite_or_none(row.get("sun_altitude_deg")),
        finite_or_none(row.get("moon_sun_separation_deg")),
        finite_or_none(row.get("moon_arc_of_vision_deg")),
        finite_or_none(row.get("moon_relative_azimuth_deg")),
        finite_or_none(row.get("moon_crescent_width_arcmin")),
        finite_or_none(row.get("moon_illumination_fraction"), 5),
        finite_or_none(age_hours),
        best_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
        events.get("sunset_utc"),
        events.get("moonset_utc"),
        phase_events.get("previous_new_moon_utc"),
        finite_or_none(lag_minutes),
    ]


def init_worker(points):
    global WORKER_POINTS
    WORKER_POINTS = points


def map_values_for_instant(day_text, minute):
    utc_day = date.fromisoformat(day_text)
    dt_utc = datetime.combine(utc_day, datetime.min.time()) + timedelta(minutes=minute)
    values = []
    for point in WORKER_POINTS:
        row = dict(
            evaluate_datetime_fast(
                point["latitude"],
                point["longitude"],
                point["elevation_m"],
                dt_utc,
            )
        )
        values.append(compact_row(row))
    return day_text, minute, values


def first_visibility_values_for_day(day_text):
    local_day = date.fromisoformat(day_text)
    values = [compact_first_visibility_row(point, local_day) for point in WORKER_POINTS]
    return day_text, values


def choose_workers():
    configured_workers = os.environ.get("HILAAL_WORKERS")
    return int(configured_workers) if configured_workers else max(1, min(8, (os.cpu_count() or 2) - 1))


def build_first_visibility_values(points, date_texts, workers):
    first_visibility_values = {day_text: [] for day_text in date_texts}
    print(f"Building {len(date_texts)} first-visibility Yallop snapshots for {len(points)} points with {workers} workers...", flush=True)
    if workers == 1:
        init_worker(points)
        for day_text in date_texts:
            result_day, values = first_visibility_values_for_day(day_text)
            first_visibility_values[result_day] = values
    else:
        with ProcessPoolExecutor(max_workers=workers, initializer=init_worker, initargs=(points,)) as executor:
            futures = [executor.submit(first_visibility_values_for_day, day_text) for day_text in date_texts]
            for future in as_completed(futures):
                result_day, values = future.result()
                first_visibility_values[result_day] = values
    return first_visibility_values


def location_rows_for_location(loc, date_texts, minutes, minute_labels):
    name = loc["name"]
    rows = {}
    for day_text in date_texts:
        local_day = date.fromisoformat(day_text)
        rows[day_text] = {}
        events = get_solar_lunar_events(
            loc["latitude"],
            loc["longitude"],
            loc["elevation_m"],
            local_day.year,
            local_day.month,
            local_day.day,
            utc_offset_hours=loc["utc_offset_hours"],
        )
        sunset_dt = parse_utc(events.get("sunset_utc"))
        phase_dt = sunset_dt or local_to_utc(local_day, 18 * 60, loc["utc_offset_hours"])
        phase_events = get_lunar_phase_events(
            phase_dt.year,
            phase_dt.month,
            phase_dt.day,
            phase_dt.hour,
            phase_dt.minute,
        )
        daily_context = islamic_sighting_context(events, phase_events)
        for minute in minutes:
            dt_utc = local_to_utc(local_day, minute, loc["utc_offset_hours"])
            row = dict(evaluate_datetime_fast(loc["latitude"], loc["longitude"], loc["elevation_m"], dt_utc))
            row.update(daily_context)
            row["local_date"] = day_text
            row["local_time"] = minute_labels[str(minute)]
            rows[day_text][str(minute)] = pick(row, DETAIL_KEYS + ["local_date", "local_time"])
    return name, rows


def month_dates(anchor):
    _, days_in_month = calendar.monthrange(anchor.year, anchor.month)
    return [date(anchor.year, anchor.month, day) for day in range(1, days_in_month + 1)]


def build_country_geojson_and_points():
    shp_path = shapereader.natural_earth(
        resolution="110m",
        category="cultural",
        name="admin_0_countries",
    )
    features = []
    points = []
    for record in shapereader.Reader(shp_path).records():
        attrs = record.attributes
        name = attrs.get("NAME") or attrs.get("ADMIN") or "Country"
        admin = attrs.get("ADMIN") or name
        geom = record.geometry
        rep = geom.representative_point()
        features.append(
            {
                "type": "Feature",
                "properties": {"name": name, "admin": admin},
                "geometry": mapping(geom),
            }
        )
        if -70 <= rep.y <= 70:
            points.append(
                {
                    "type": "country",
                    "name": admin,
                    "country": admin,
                    "latitude": round(rep.y, 4),
                    "longitude": round(rep.x, 4),
                    "elevation_m": 0,
                    "search": f"{admin} {name}",
                }
            )
    return {"type": "FeatureCollection", "features": features}, points


def build_points(country_points):
    points = []
    for lat in range(-60, 61, 15):
        for lon in range(-180, 181, 15):
            points.append(
                {
                    "type": "grid",
                    "name": f"Grid {lat}, {lon}",
                    "country": "",
                    "latitude": float(lat),
                    "longitude": float(lon),
                    "elevation_m": 0,
                    "search": "",
                }
            )
    points.extend(country_points)
    for name, country, lat, lon, elevation in STATE_POINTS:
        points.append(
            {
                "type": "state",
                "name": f"{name}, {country}",
                "country": country,
                "latitude": lat,
                "longitude": lon,
                "elevation_m": elevation,
                "search": f"{name} {country} state province region",
            }
        )
    for name, country, lat, lon, elevation in CAPITAL_POINTS:
        points.append(
            {
                "type": "capital",
                "name": f"{name}, {country}",
                "country": country,
                "latitude": lat,
                "longitude": lon,
                "elevation_m": elevation,
                "search": f"{name} {country} capital",
            }
        )
    for name, country, lat, lon, elevation in CITY_POINTS:
        points.append(
            {
                "type": "city",
                "name": f"{name}, {country}",
                "country": country,
                "latitude": lat,
                "longitude": lon,
                "elevation_m": elevation,
                "search": f"{name} {country}",
            }
        )
    for idx, point in enumerate(points):
        point["id"] = idx
    return points


def build_locations():
    locations = []
    for idx, (name, lat, lon, elevation, utc_offset, country, aliases) in enumerate(LOCATION_PRESETS):
        if name not in PUBLIC_LOCATION_NAMES:
            continue
        locations.append(
            {
                "id": f"loc-{idx}",
                "name": name,
                "country": country,
                "latitude": lat,
                "longitude": lon,
                "elevation_m": elevation,
                "utc_offset_hours": utc_offset,
                "search": f"{name} {country} {aliases}",
            }
        )
    return locations


def build_dataset():
    generated_at = datetime.utcnow().replace(microsecond=0)
    anchor = generated_at.date()
    dates = month_dates(anchor)
    minutes = list(range(0, 24 * 60, 60))
    map_minutes = minutes
    minute_labels = {str(minute): f"{minute // 60:02d}:{minute % 60:02d}" for minute in minutes}
    country_geojson, country_points = build_country_geojson_and_points()
    points = build_points(country_points)
    locations = build_locations()

    workers = choose_workers()
    date_texts = [day.isoformat() for day in dates]
    print(f"Building {len(locations)} preset location tables with {workers} workers...", flush=True)
    location_rows = {}
    if workers == 1:
        for loc in locations:
            name, rows = location_rows_for_location(loc, date_texts, minutes, minute_labels)
            location_rows[name] = rows
    else:
        with ProcessPoolExecutor(max_workers=workers) as executor:
            futures = [executor.submit(location_rows_for_location, loc, date_texts, minutes, minute_labels) for loc in locations]
            for future in as_completed(futures):
                name, rows = future.result()
                location_rows[name] = rows

    # Include adjacent UTC days so local date/time conversion can safely cross month boundaries.
    utc_days = [dates[0] - timedelta(days=1), *dates, dates[-1] + timedelta(days=1)]
    map_values = {utc_day.isoformat(): {} for utc_day in utc_days}
    tasks = [(utc_day.isoformat(), minute) for utc_day in utc_days for minute in map_minutes]
    print(f"Building {len(tasks)} hourly map snapshots for {len(points)} points with {workers} workers...", flush=True)
    if workers == 1:
        init_worker(points)
        for day_text, minute in tasks:
            result_day, result_minute, values = map_values_for_instant(day_text, minute)
            map_values[result_day][str(result_minute)] = values
    else:
        with ProcessPoolExecutor(max_workers=workers, initializer=init_worker, initargs=(points,)) as executor:
            futures = [executor.submit(map_values_for_instant, day_text, minute) for day_text, minute in tasks]
            for future in as_completed(futures):
                result_day, result_minute, values = future.result()
                map_values[result_day][str(result_minute)] = values

    first_visibility_values = build_first_visibility_values(points, date_texts, workers)

    return {
        "generated_at_utc": generated_at.isoformat() + "Z",
        "source": "Generated from the repository Python Skyfield/Yallop/Odeh engine.",
        "month": f"{anchor.year:04d}-{anchor.month:02d}",
        "metrics": METRICS,
        "dates": [day.isoformat() for day in dates],
        "minutes": minutes,
        "map_minutes": map_minutes,
        "minute_labels": minute_labels,
        "locations": locations,
        "location_rows": location_rows,
        "point_schema": [
            "yallop_score",
            "odeh_score",
            "yallop_q",
            "odeh_v",
            "moon_altitude_deg",
            "sun_altitude_deg",
            "moon_sun_separation_deg",
            "moon_arc_of_vision_deg",
            "moon_relative_azimuth_deg",
            "moon_crescent_width_arcmin",
            "moon_illumination_fraction",
            "moon_age_days",
        ],
        "first_visibility_schema": [
            "status_code",
            "van_gent_score",
            "yallop_q",
            "moon_altitude_deg",
            "sun_altitude_deg",
            "moon_sun_separation_deg",
            "moon_arc_of_vision_deg",
            "moon_relative_azimuth_deg",
            "moon_crescent_width_arcmin",
            "moon_illumination_fraction",
            "moon_age_hours",
            "best_datetime_utc",
            "sunset_utc",
            "moonset_utc",
            "moon_birth_utc",
            "moon_lag_minutes",
        ],
        "points": points,
        "map_values": map_values,
        "first_visibility_values": first_visibility_values,
        "countries": country_geojson,
    }


def copy_docs():
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    source = ROOT / "docs" / "CRESCENT_VISIBILITY.md"
    target = DOCS_DIR / "CRESCENT_VISIBILITY.md"
    target.write_text(source.read_text(encoding="utf-8"), encoding="utf-8")


def update_existing_first_visibility_payload():
    path = DATA_DIR / "site_data.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    workers = choose_workers()
    payload["first_visibility_schema"] = [
        "status_code",
        "van_gent_score",
        "yallop_q",
        "moon_altitude_deg",
        "sun_altitude_deg",
        "moon_sun_separation_deg",
        "moon_arc_of_vision_deg",
        "moon_relative_azimuth_deg",
        "moon_crescent_width_arcmin",
        "moon_illumination_fraction",
        "moon_age_hours",
        "best_datetime_utc",
        "sunset_utc",
        "moonset_utc",
        "moon_birth_utc",
        "moon_lag_minutes",
    ]
    payload["first_visibility_values"] = build_first_visibility_values(payload["points"], payload["dates"], workers)
    payload["first_visibility_source"] = "Generated with Yallop at sunset + 4/9 of local sunset-to-moonset interval, with conjunction and moonset masks."
    path.write_text(
        json.dumps(payload, ensure_ascii=True, separators=(",", ":")),
        encoding="utf-8",
    )


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    copy_docs()
    if os.environ.get("HILAAL_INCREMENTAL_FIRST") == "1":
        update_existing_first_visibility_payload()
        print(f"Updated first-visibility layer in {DATA_DIR / 'site_data.json'}")
        return
    payload = build_dataset()
    (DATA_DIR / "site_data.json").write_text(
        json.dumps(payload, ensure_ascii=True, separators=(",", ":")),
        encoding="utf-8",
    )
    (PAGES_DIR / ".nojekyll").write_text("", encoding="utf-8")
    print(f"Wrote {DATA_DIR / 'site_data.json'}")


if __name__ == "__main__":
    main()
