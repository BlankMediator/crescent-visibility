from datetime import date, datetime, timedelta
from functools import lru_cache

import numpy as np
import pandas as pd

from calculations import calculate_astronomy, get_lunar_phase_events, get_solar_lunar_events
from models import (
    odeh_details,
    odeh_model,
    yallop_details,
    yallop_model,
)


MODEL_NAMES = ["yallop", "odeh"]
METRIC_NAMES = MODEL_NAMES


def normalise_datetime(value):
    if isinstance(value, datetime):
        return value.replace(second=0, microsecond=0, tzinfo=None)
    raise TypeError("Expected a datetime")


def local_to_utc(local_day, minute_of_day, utc_offset_hours):
    if isinstance(local_day, datetime):
        local_day = local_day.date()
    if not isinstance(local_day, date):
        raise TypeError("local_day must be a date")

    local_dt = datetime.combine(local_day, datetime.min.time()) + timedelta(minutes=int(minute_of_day))
    return normalise_datetime(local_dt - timedelta(hours=float(utc_offset_hours)))


def score_to_category(score):
    if np.isnan(score):
        return "N/A"
    if score < 0.75:
        return "Not visible"
    if score < 1.5:
        return "Marginal"
    if score < 2.5:
        return "Possible"
    return "Visible"


def composite_visibility_index(results):
    moon_alt = np.clip((results["moon_altitude_deg"] + 2.0) / 18.0, 0.0, 1.0)
    elongation = np.clip((results["moon_sun_separation_deg"] - 6.0) / 10.0, 0.0, 1.0)
    illumination = np.clip(results["moon_illumination_fraction"] / 0.08, 0.0, 1.0)
    sun_darkness = np.clip((-results["sun_altitude_deg"] - 2.0) / 10.0, 0.0, 1.0)
    age = np.clip((results["moon_age_days"] - 12.0) / 18.0, 0.0, 1.0)

    return float(100.0 * (
        moon_alt * 0.30
        + elongation * 0.25
        + illumination * 0.15
        + sun_darkness * 0.20
        + age * 0.10
    ))


@lru_cache(maxsize=4096)
def cached_events(lat, lon, elevation, year, month, day):
    return get_solar_lunar_events(lat, lon, elevation, year, month, day)


@lru_cache(maxsize=4096)
def cached_lunar_phase_events(year, month, day, hour, minute):
    return get_lunar_phase_events(year, month, day, hour, minute)


def parse_utc(value):
    if not value:
        return None
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ")


def lag_minutes_from_events(events):
    sunset = events.get("sunset_utc")
    moonset = events.get("moonset_utc")
    if not sunset or not moonset:
        return np.nan

    sunset_dt = parse_utc(sunset)
    moonset_dt = parse_utc(moonset)
    return (moonset_dt - sunset_dt).total_seconds() / 60.0


def islamic_sighting_context(events, phase_events):
    sunset_dt = parse_utc(events.get("sunset_utc"))
    moonset_dt = parse_utc(events.get("moonset_utc"))
    birth_dt = parse_utc(phase_events.get("previous_new_moon_utc"))
    next_birth_dt = parse_utc(phase_events.get("next_new_moon_utc"))
    lag_minutes = lag_minutes_from_events(events)

    born_before_sunset = bool(birth_dt and sunset_dt and birth_dt <= sunset_dt)
    moonset_after_sunset = bool(moonset_dt and sunset_dt and moonset_dt > sunset_dt)
    age_at_sunset_hours = (
        (sunset_dt - birth_dt).total_seconds() / 3600.0
        if birth_dt and sunset_dt
        else np.nan
    )

    return {
        "moon_birth_utc": phase_events.get("previous_new_moon_utc"),
        "next_moon_birth_utc": phase_events.get("next_new_moon_utc"),
        "sunrise_utc": events.get("sunrise_utc"),
        "sunset_utc": events.get("sunset_utc"),
        "moonrise_utc": events.get("moonrise_utc"),
        "moonset_utc": events.get("moonset_utc"),
        "moon_lag_minutes": lag_minutes,
        "moon_age_at_sunset_hours": age_at_sunset_hours,
        "moon_age_at_sunset_days": age_at_sunset_hours / 24.0 if not np.isnan(age_at_sunset_hours) else np.nan,
        "moon_born_before_sunset": born_before_sunset,
        "moonset_after_sunset": moonset_after_sunset,
        "islamic_geometry_gate": bool(born_before_sunset and moonset_after_sunset),
    }


def _model_outputs(results, lag_minutes=np.nan):
    arcv = results["moon_arc_of_vision_deg"]
    width = results["moon_crescent_width_arcmin"]
    outputs = {
        "yallop": yallop_model(arcv, width),
        "odeh": odeh_model(arcv, width),
    }
    return outputs


def _row_from_results(lat, lon, elevation, dt_utc, results, context, model_outputs):
    arcv = results["moon_arc_of_vision_deg"]
    width = results["moon_crescent_width_arcmin"]
    birth_dt = parse_utc(context.get("moon_birth_utc"))
    age_since_birth_hours = (
        (dt_utc - birth_dt).total_seconds() / 3600.0
        if birth_dt
        else np.nan
    )
    row = {
        "datetime_utc": dt_utc,
        "latitude": float(lat),
        "longitude": float(lon),
        "elevation_m": float(elevation),
        "composite": composite_visibility_index(results),
        **yallop_details(arcv, width),
        **odeh_details(arcv, width),
        **results,
        **context,
        "moon_age_since_birth_hours": age_since_birth_hours,
        "moon_age_since_birth_days": age_since_birth_hours / 24.0 if not np.isnan(age_since_birth_hours) else np.nan,
    }
    row["lag_minutes"] = row["moon_lag_minutes"]
    if not np.isnan(row["moon_age_since_birth_days"]):
        row["moon_age_days"] = row["moon_age_since_birth_days"]

    for model, (score, label) in model_outputs.items():
        row[f"{model}_score"] = score
        row[f"{model}_label"] = label

    return row


@lru_cache(maxsize=200000)
def evaluate_point_fast(lat, lon, elevation, year, month, day, hour, minute):
    dt_utc = datetime(year, month, day, hour, minute)
    results = calculate_astronomy(lat, lon, elevation, year, month, day, hour, minute)
    phase_events = cached_lunar_phase_events(year, month, day, hour, minute)
    context = islamic_sighting_context({}, phase_events)
    return _row_from_results(lat, lon, elevation, dt_utc, results, context, _model_outputs(results))


@lru_cache(maxsize=200000)
def evaluate_point(lat, lon, elevation, year, month, day, hour, minute):
    dt_utc = datetime(year, month, day, hour, minute)
    results = calculate_astronomy(lat, lon, elevation, year, month, day, hour, minute)
    events = cached_events(float(lat), float(lon), float(elevation), year, month, day)
    phase_events = cached_lunar_phase_events(year, month, day, hour, minute)
    context = islamic_sighting_context(events, phase_events)
    return _row_from_results(
        lat,
        lon,
        elevation,
        dt_utc,
        results,
        context,
        _model_outputs(results, context["moon_lag_minutes"]),
    )


def evaluate_datetime(lat, lon, elevation, dt_utc):
    dt_utc = normalise_datetime(dt_utc)
    return evaluate_point(
        float(lat),
        float(lon),
        float(elevation),
        dt_utc.year,
        dt_utc.month,
        dt_utc.day,
        dt_utc.hour,
        dt_utc.minute,
    )


def evaluate_datetime_fast(lat, lon, elevation, dt_utc):
    dt_utc = normalise_datetime(dt_utc)
    return evaluate_point_fast(
        float(lat),
        float(lon),
        float(elevation),
        dt_utc.year,
        dt_utc.month,
        dt_utc.day,
        dt_utc.hour,
        dt_utc.minute,
    )


def metric_value(row, metric):
    if metric == "composite":
        return row["composite"]
    return row[f"{metric}_score"]


def metric_label(row, metric):
    if metric == "composite":
        return score_to_category(row["composite"] / 25.0)
    return row[f"{metric}_label"]


def build_time_series(lat, lon, elevation, local_day, utc_offset_hours, step_minutes=15):
    rows = []
    for minute in range(0, 24 * 60, int(step_minutes)):
        dt_utc = local_to_utc(local_day, minute, utc_offset_hours)
        row = dict(evaluate_datetime(lat, lon, elevation, dt_utc))
        row["local_time"] = datetime.combine(local_day, datetime.min.time()) + timedelta(minutes=minute)
        rows.append(row)
    return pd.DataFrame(rows)


def build_date_series(lat, lon, elevation, start_day, days, minute_of_day, utc_offset_hours):
    rows = []
    for offset in range(int(days)):
        local_day = start_day + timedelta(days=offset)
        dt_utc = local_to_utc(local_day, minute_of_day, utc_offset_hours)
        row = dict(evaluate_datetime(lat, lon, elevation, dt_utc))
        row["local_date"] = local_day
        rows.append(row)
    return pd.DataFrame(rows)


def build_position_series(lat, lon, elevation, dt_utc, mode, step_degrees=5, metric="yallop"):
    evaluator = evaluate_datetime_fast
    rows = []
    if mode == "latitude":
        for sweep_lat in np.arange(-70.0, 71.0, float(step_degrees)):
            rows.append(dict(evaluator(float(sweep_lat), lon, elevation, dt_utc)))
    elif mode == "longitude":
        for sweep_lon in np.arange(-180.0, 181.0, float(step_degrees)):
            rows.append(dict(evaluator(lat, float(sweep_lon), elevation, dt_utc)))
    else:
        raise ValueError("mode must be 'latitude' or 'longitude'")
    return pd.DataFrame(rows)


def build_world_grid(elevation, dt_utc, lat_step=10, lon_step=10, metric="yallop"):
    evaluator = evaluate_datetime_fast
    rows = []
    latitudes = np.arange(-70.0, 71.0, float(lat_step))
    longitudes = np.arange(-180.0, 181.0, float(lon_step))
    for grid_lat in latitudes:
        for grid_lon in longitudes:
            rows.append(dict(evaluator(float(grid_lat), float(grid_lon), elevation, dt_utc)))
    return pd.DataFrame(rows)
