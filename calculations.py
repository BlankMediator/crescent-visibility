#calculations.py

import os
import csv
import numpy as np
import matplotlib.pyplot as plt
from datetime import datetime, timedelta
from skyfield.api import load, wgs84
from skyfield.almanac import find_discrete, sunrise_sunset
from skyfield import almanac

# Load ephemeris and timescale
eph = load('de421.bsp')
ts = load.timescale()
MOON_RADIUS_KM = 1737.4
SYNODIC_MONTH_DAYS = 29.53058867

# Observer cache
observer_cache = {}
location_cache = {}

def get_observer(lat, lon, elevation):
    key = (lat, lon, elevation)
    if key not in observer_cache:
        observer_cache[key] = eph['earth'] + wgs84.latlon(
            latitude_degrees=lat,
            longitude_degrees=lon,
            elevation_m=elevation
        )
    return observer_cache[key]

def get_location(lat, lon, elevation):
    key = (lat, lon, elevation)
    if key not in location_cache:
        location_cache[key] = wgs84.latlon(
            latitude_degrees=lat,
            longitude_degrees=lon,
            elevation_m=elevation
        )
    return location_cache[key]

def moon_age(utc_time):
    known_new_moon = datetime(2000, 1, 6, 18, 14)
    days_since_known_new_moon = (
        utc_time.utc_datetime().replace(tzinfo=None) - known_new_moon
    ).total_seconds() / 86400.0
    return days_since_known_new_moon % SYNODIC_MONTH_DAYS

def get_lunar_phase_events(year, month, day, hour=0, minute=0):
    center = datetime(year, month, day, hour, minute)
    t0_dt = center - timedelta(days=45)
    t1_dt = center + timedelta(days=45)
    t0 = ts.utc(t0_dt.year, t0_dt.month, t0_dt.day, t0_dt.hour, t0_dt.minute)
    t1 = ts.utc(t1_dt.year, t1_dt.month, t1_dt.day, t1_dt.hour, t1_dt.minute)
    events = {
        "previous_new_moon_utc": None,
        "next_new_moon_utc": None,
    }

    try:
        phase_times, phase_values = find_discrete(t0, t1, almanac.moon_phases(eph))
        new_moons = [
            t.utc_datetime().replace(tzinfo=None)
            for t, phase in zip(phase_times, phase_values)
            if int(phase) == 0
        ]
        previous = [dt for dt in new_moons if dt <= center]
        future = [dt for dt in new_moons if dt > center]
        if previous:
            events["previous_new_moon_utc"] = previous[-1].strftime("%Y-%m-%dT%H:%M:%SZ")
        if future:
            events["next_new_moon_utc"] = future[0].strftime("%Y-%m-%dT%H:%M:%SZ")
    except Exception as e:
        print(f"Error calculating lunar phase events: {e}")

    return events

def calculate_astronomy(lat, lon, elevation, year, month, day, hour, minute):
    utc_time = ts.utc(year, month, day, hour, minute)
    observer = get_observer(lat, lon, elevation)
    sun = eph['sun']
    moon = eph['moon']

    sun_astrometric = observer.at(utc_time).observe(sun).apparent()
    moon_astrometric = observer.at(utc_time).observe(moon).apparent()

    sun_alt, sun_az, sun_distance = sun_astrometric.altaz()
    moon_alt, moon_az, moon_distance = moon_astrometric.altaz()
    separation = moon_astrometric.separation_from(sun_astrometric)
    phase_angle = almanac.moon_phase(eph, utc_time).degrees

    illumination_fraction = (1 - np.cos(np.radians(phase_angle))) / 2
    moon_semidiameter_arcmin = np.degrees(np.arcsin(MOON_RADIUS_KM / moon_distance.km)) * 60.0
    crescent_width_arcmin = moon_semidiameter_arcmin * (1 - np.cos(np.radians(phase_angle)))
    daz = abs((moon_az.degrees - sun_az.degrees + 180.0) % 360.0 - 180.0)
    age_days = moon_age(utc_time)

    return {
        'sun_altitude_deg': sun_alt.degrees,
        'sun_azimuth_deg': sun_az.degrees,
        'moon_altitude_deg': moon_alt.degrees,
        'moon_azimuth_deg': moon_az.degrees,
        'moon_sun_separation_deg': separation.degrees,
        'moon_arc_of_vision_deg': moon_alt.degrees - sun_alt.degrees,
        'moon_relative_azimuth_deg': daz,
        'moon_distance_km': moon_distance.km,
        'sun_distance_km': sun_distance.km,
        'moon_phase_angle_deg': phase_angle,
        'moon_illumination_fraction': illumination_fraction,
        'moon_semidiameter_arcmin': moon_semidiameter_arcmin,
        'moon_crescent_width_arcmin': crescent_width_arcmin,
        'moon_crescent_width_deg': crescent_width_arcmin / 60.0,
        'moon_age_days': age_days,
        'moon_apparent_magnitude': -12.7,
        'sun_apparent_magnitude': -26.74
    }

def get_solar_lunar_events(lat, lon, elevation, year, month, day, utc_offset_hours=0):
    location = get_location(lat, lon, elevation)
    local_day_start = datetime(year, month, day)
    utc_day_start = local_day_start - timedelta(hours=float(utc_offset_hours))
    utc_day_end = utc_day_start + timedelta(days=1)
    t0 = ts.utc(
        utc_day_start.year,
        utc_day_start.month,
        utc_day_start.day,
        utc_day_start.hour,
        utc_day_start.minute,
    )
    t1 = ts.utc(
        utc_day_end.year,
        utc_day_end.month,
        utc_day_end.day,
        utc_day_end.hour,
        utc_day_end.minute,
    )
    events = {}

    try:
        sun_times, sun_events = find_discrete(t0, t1, sunrise_sunset(eph, location))
        for t, evt in zip(sun_times, sun_events):
            label = "sunrise_utc" if evt else "sunset_utc"
            events[label] = t.utc_strftime("%Y-%m-%dT%H:%M:%SZ")

        moon_times, moon_events = find_discrete(t0, t1, almanac.risings_and_settings(eph, eph['moon'], location))
        for t, evt in zip(moon_times, moon_events):
            label = "moonrise_utc" if evt else "moonset_utc"
            events[label] = t.utc_strftime("%Y-%m-%dT%H:%M:%SZ")

    except Exception as e:
        print(f"Error calculating rise/set: {e}")

    return events
