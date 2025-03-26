melbourne_range.py

import os
import csv
import argparse
import matplotlib.pyplot as plt
from datetime import datetime, timedelta
from skyfield.api import load
from calculations import calculate_astronomy, get_solar_lunar_events
from models import ilyas_model, yallop_model, odeh_model, shaukat_model, saao_model
from collections import defaultdict
import numpy as np

lat = -37.8136
lon = 144.9631
elevation = 31
output_path = "data/melbourne_march2025.csv"
dates = [29, 30, 31]

parser = argparse.ArgumentParser(description="Melbourne moon visibility test for March 2025")
parser.add_argument("--events", nargs='+', choices=["sunset", "moonset"], default=["sunset"], help="Events to evaluate")
parser.add_argument("--full-range", action="store_true", help="Calculate every minute between sunset and moonset")
parser.add_argument("--models", nargs='+', choices=["ilyas", "yallop", "odeh", "shaukat", "saao"], required=True, help="List of visibility models to apply")
parser.add_argument("--plot", action="store_true", help="Generate plots after processing")
parser.add_argument("--clean", nargs='*', choices=["png", "csv", "txt"], help="Delete specified file types in data/ before running")
args = parser.parse_args()

# Clean selected file types in data/
if args.clean:
    for ext in args.clean:
        for file in os.listdir("data"):
            if file.endswith(f".{ext}"):
                os.remove(os.path.join("data", file))
    print(f"Deleted files in data/ with extensions: {args.clean}")

os.makedirs(os.path.dirname(output_path), exist_ok=True)
eph = load('de421.bsp')
ts = load.timescale()

# Build header
header = [
    "datetime", "event_type", "sunrise", "sunset", "moonrise", "moonset",
    "moon_altitude", "sun_altitude", "separation", "illumination_fraction",
    "crescent_width", "moon_age", "moon_phase_angle", "moon_distance",
    "sun_distance", "moon_apparent_mag", "sun_apparent_mag", "visibility_score"
]
for model in args.models:
    header.append(f"{model}_score")
    header.append(f"{model}_label")

all_data = []

print("Checking available events by date:")

for day in dates:
    events = get_solar_lunar_events(lat, lon, elevation, 2025, 3, day)
    print(f"2025-03-{day}:", {k: v for k, v in events.items() if v})
    timepoints = []

    if args.full_range and events.get("sunset_utc") and events.get("moonset_utc"):
        t0 = datetime.strptime(events['sunset_utc'], "%Y-%m-%dT%H:%M:%SZ")
        t1 = datetime.strptime(events['moonset_utc'], "%Y-%m-%dT%H:%M:%SZ")
        current = t0
        while current <= t1:
            timepoints.append((current, "range"))
            current += timedelta(minutes=1)
    else:
        for e in args.events:
            key = f"{e}_utc"
            if events.get(key):
                dt = datetime.strptime(events[key], "%Y-%m-%dT%H:%M:%SZ")
                timepoints.append((dt, e))

    for dt, label in timepoints:
        results = calculate_astronomy(lat, lon, elevation, dt.year, dt.month, dt.day, dt.hour, dt.minute)
        lag_minutes = 0
        if events.get('sunset_utc') and events.get('moonset_utc'):
            sunset_dt = datetime.strptime(events['sunset_utc'], "%Y-%m-%dT%H:%M:%SZ")
            moonset_dt = datetime.strptime(events['moonset_utc'], "%Y-%m-%dT%H:%M:%SZ")
            lag_minutes = (moonset_dt - sunset_dt).total_seconds() / 60

        vis_scores = {}
        for model in args.models:
            if model == "ilyas":
                vis_scores[model] = ilyas_model(results['moon_altitude_deg'], results['moon_sun_separation_deg'])
            elif model == "yallop":
                arc_v = results['moon_sun_separation_deg']
                diff_alt = results['moon_altitude_deg'] - results['sun_altitude_deg']
                vis_scores[model] = yallop_model(arc_v, diff_alt)
            elif model == "odeh":
                vis_scores[model] = odeh_model(results['moon_sun_separation_deg'], results['moon_age_days'])
            elif model == "shaukat":
                vis_scores[model] = shaukat_model(results['moon_sun_separation_deg'], results['moon_altitude_deg'], results['moon_age_days'])
            elif model == "saao":
                vis_scores[model] = saao_model(results['moon_age_days'], lag_minutes)

        row = [
            dt.isoformat(), label,
            events.get('sunrise_utc'), events.get('sunset_utc'),
            events.get('moonrise_utc'), events.get('moonset_utc'),
            results['moon_altitude_deg'], results['sun_altitude_deg'],
            results['moon_sun_separation_deg'], results['moon_illumination_fraction'],
            results['moon_crescent_width_deg'], results['moon_age_days'],
            results['moon_phase_angle_deg'], results['moon_distance_km'],
            results['sun_distance_km'], results['moon_apparent_magnitude'],
            results['sun_apparent_magnitude'],
            (results['moon_illumination_fraction'] * 100 + results['moon_crescent_width_deg'] * 50 + results['moon_altitude_deg'] * 2)
        ]
        for model in args.models:
            score, label_txt = vis_scores[model]
            row.append(score)
            row.append(label_txt)

        all_data.append((dt, label, row))

# Write CSV
with open(output_path, 'w', newline='') as f:
    writer = csv.writer(f)
    writer.writerow(header)
    for _, _, row in all_data:
        writer.writerow(row)

print(f"Saved data to {output_path}")

# Plotting
if not args.plot:
    exit()

plot_data = defaultdict(lambda: defaultdict(list))

for dt, label, row in all_data:
    date_key = dt.date()
    for i, key in enumerate(header):
        if key.endswith("_label") or key in ["datetime", "event_type", "sunrise", "sunset", "moonrise", "moonset"]:
            continue
        plot_data[key][date_key].append((dt, row[i]))

for key, daily_series in plot_data.items():
    plt.figure()
    for date_key, series in sorted(daily_series.items()):
        times, values = zip(*series)
        plt.plot(times, values, marker='o', label=str(date_key))
        plt.plot([np.nan], [np.nan])
    plt.title(key.replace("_", " ").title() + " Over Time")
    plt.xlabel("UTC Time")
    plt.ylabel(key.replace("_", " ").title())
    plt.grid(True)
    plt.gcf().autofmt_xdate()
    plt.tight_layout()
    plt.legend()
    out_path = f"data/{key}.png"
    plt.savefig(out_path)
    print(f"Saved plot: {out_path}")