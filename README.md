# Crescent Visibility

Interactive crescent-visibility explorer for comparing how Moon/Sun geometry changes by
location, date, and time.

## Quick Start

```powershell
pip install -r requirements.txt
streamlit run app.py
```

Open the Streamlit URL, usually `http://localhost:8501`.

## GitHub Pages

The repository also ships a static GitHub Pages dashboard in `pages/`. Pages cannot run the
Streamlit/Skyfield model at request time, so the static site is generated from the same Python
engine into `pages/data/site_data.json`.

Build it with:

```powershell
python scripts/build_pages_site.py
```

The published Pages site includes date/time/location selectors, a projected Earth map with
country overlays, map tooltips, model-status labels, charts, Islamic sighting-gate fields, and
the full documentation tab.

## Accuracy Note

The app uses real Skyfield astronomy calculations for topocentric Sun/Moon geometry. It now
implements formula-based Yallop and Odeh ARCV/crescent-width criteria. The Composite, Ilyas,
Shaukat, and SAAO entries remain exploratory or legacy heuristic scores and should not be
treated as official criteria.

See `docs/CRESCENT_VISIBILITY.md` for the full explanation.

## What The App Does

- Uses Skyfield and the DE421 ephemeris to calculate Sun/Moon geometry.
- Lets users set location, elevation, date, local time, and UTC offset.
- Can use the browser's current location and time.
- Shows moon birth/conjunction, local sunset, moonset, sunset-to-moonset lag, and basic Islamic
  geometry gates for the selected local date.
- Draws a projected Earth map with land, water, country outlines, and sampled visibility points.
- Shows tooltips with Moon altitude, Sun altitude, elongation, ARCV, DAZ, crescent width,
  Yallop q, Odeh V, illumination, Moon age, and model labels.
- Provides time, date, and position sweep charts.

## Main Files

- `app.py`: Streamlit user interface, map, controls, tooltips, and docs tab.
- `visibility_engine.py`: shared calculation/scoring helpers for maps and charts.
- `calculations.py`: Skyfield astronomy and rise/set calculations.
- `models.py`: simplified proxy visibility model thresholds.
- `scripts/build_pages_site.py`: static dataset builder for GitHub Pages.
- `pages/`: static GitHub Pages dashboard.
- `docs/CRESCENT_VISIBILITY.md`: detailed docs and limitations.
