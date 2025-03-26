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

# Observer cache
observer_cache = {}

def get_observer(lat, lon, elevation):
    key = (lat, lon, elevation)
    if key not in observer_cache:
        observer_cache[key] = eph['earth'] + wgs84.latlon(
            latitude_degrees=lat,
            longitude_degrees=lon,
            elevation_m=elevation
        )
    return observer_cache[key]

def moon_age(utc_time):
    known_new_moon = datetime(2000, 1, 6, 18, 14)
    return (utc_time.utc_datetime().replace(tzinfo=None) - known_new_moon).total_seconds() / 86400.0

def calculate_astronomy(lat, lon, elevation, year, month, day, hour, minute):
    utc_time = ts.utc(year, month, day, hour, minute)
    observer = get_observer(lat, lon, elevation)
    sun = eph['sun']
    moon = eph['moon']

    sun_astrometric = observer.at(utc_time).observe(sun).apparent()
    moon_astrometric = observer.at(utc_time).observe(moon).apparent()

    sun_alt, _, sun_distance = sun_astrometric.altaz()
    moon_alt, _, moon_distance = moon_astrometric.altaz()
    separation = moon_astrometric.separation_from(sun_astrometric)
    phase_angle = almanac.moon_phase(eph, utc_time).degrees

    illumination_fraction = (1 - np.cos(np.radians(phase_angle))) / 2
    crescent_width = illumination_fraction * 180
    age_days = moon_age(utc_time)

    return {
        'sun_altitude_deg': sun_alt.degrees,
        'moon_altitude_deg': moon_alt.degrees,
        'moon_sun_separation_deg': separation.degrees,
        'moon_distance_km': moon_distance.km,
        'sun_distance_km': sun_distance.km,
        'moon_phase_angle_deg': phase_angle,
        'moon_illumination_fraction': illumination_fraction,
        'moon_crescent_width_deg': crescent_width,
        'moon_age_days': age_days,
        'moon_apparent_magnitude': -12.7,
        'sun_apparent_magnitude': -26.74
    }

def get_solar_lunar_events(lat, lon, elevation, year, month, day):
    observer = get_observer(lat, lon, elevation)
    t0 = ts.utc(year, month, day)
    t1 = ts.utc(year, month, day + 1)
    events = {}

    try:
        sun_times, sun_events = find_discrete(t0, t1, sunrise_sunset(eph, observer))
        for t, evt in zip(sun_times, sun_events):
            label = "sunrise_utc" if evt else "sunset_utc"
            events[label] = t.utc_strftime("%Y-%m-%dT%H:%M:%SZ")

        moon_times, moon_events = find_discrete(t0, t1, almanac.risings_and_settings(eph, eph['moon'], observer))
        for t, evt in zip(moon_times, moon_events):
            label = "moonrise_utc" if evt else "moonset_utc"
            events[label] = t.utc_strftime("%Y-%m-%dT%H:%M:%SZ")

    except Exception as e:
        print(f"Error calculating rise/set: {e}")

    return events
