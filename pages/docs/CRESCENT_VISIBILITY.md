# Crescent Visibility Documentation

## Purpose

This project is an exploratory crescent-visibility tool. It compares how lunar crescent
visibility changes across location, date, local time, map projection, and model choice.

It is not an official moon-sighting authority. Weather, local horizon, extinction, observer
acuity, and jurisdictional rules are still outside the model.

## Source Status

The app now has two formula-based published crescent-visibility criteria:

- Yallop q criterion, based on arc of vision (ARCV) and crescent width W.
- Odeh V criterion, based on arc of vision (ARCV) and crescent width W.

The app also shows Islamic crescent-sighting geometry gates:

- latest astronomical new moon/conjunction before local sunset, shown as `Moon birth UTC`,
- the next astronomical new moon/conjunction, shown as `Next moon birth UTC`,
- local sunset for the selected local date,
- local moonset for the selected local date,
- sunset-to-moonset lag,
- whether conjunction happened before sunset,
- and whether moonset happens after sunset.

The app also keeps these exploratory or legacy heuristic scores:

- Composite index.
- Ilyas.
- Shaukat.
- SAAO.

Those heuristic entries are clearly labeled as non-canonical in the UI and tooltips.

## Sources

1. Mohammad Sh. Odeh, "New Criterion for Lunar Crescent Visibility", Experimental Astronomy,
   volume 18, pages 39-64, DOI: https://doi.org/10.1007/s10686-005-9002-5.

2. B. D. Yallop, "A method for predicting the first sighting of the new crescent moon",
   RGO NAO Technical Note No. 69, 1997. This is cited in Odeh's paper and in the Crossref
   reference list for the Odeh article.

3. Yassir Lairgi, "When Astronomy Meets AI: Manazel For Crescent Visibility Prediction in
   Morocco", arXiv: https://arxiv.org/abs/2503.21634. This recent paper summarizes the
   modern ARCV/W feature family and defines ARCV, relative azimuth, and crescent width in
   crescent-visibility modelling.

## Astronomy Geometry

The astronomy geometry is calculated with Skyfield using the DE421 ephemeris. For each
observer and UTC time, the app computes:

- Sun altitude.
- Sun azimuth.
- Moon altitude.
- Moon azimuth.
- Moon-Sun elongation.
- ARCV, the vertical angular separation between Moon and Sun: `moon_altitude - sun_altitude`.
- DAZ, the absolute azimuth difference between Moon and Sun.
- Moon phase angle.
- Illumination fraction.
- Topocentric Moon semidiameter.
- Crescent width W in arcminutes.
- Moon age since the latest astronomical new moon/conjunction.
- Moon distance.
- Sun distance.
- Sunrise/sunset.
- Moonrise/moonset.
- Sunset-to-moonset lag.
- Previous astronomical new moon/conjunction, labeled as Moon birth.
- Next astronomical new moon/conjunction.

## Crescent Width W

The app estimates topocentric crescent width in arcminutes as:

```text
W = SD * (1 - cos(phase_angle))
```

Where:

- `SD` is the topocentric apparent semidiameter of the Moon in arcminutes.
- `phase_angle` is the lunar phase angle from Skyfield.

This gives the illuminated crescent width used by the Yallop and Odeh criteria.

## Islamic Sighting Geometry Gates

Many Islamic crescent-sighting workflows require at least these local-date geometry facts
before a new-crescent sighting claim is meaningful:

1. The Moon must have been born before local sunset.
2. The Moon must set after local sunset, so it is geometrically above the horizon for some
   interval after sunset.

The app displays these as:

```text
Moon birth UTC
Next moon birth UTC
Sunset UTC
Moonset UTC
Moon lag minutes = moonset - sunset
Moon age at sunset
Born before sunset
Moonset after sunset
Geometry gate
```

`Geometry gate` is true only when both conditions are true. This is not a fatwa, calendar
decision, or official declaration. It is only the astronomical gate: conjunction before sunset
and moonset after sunset for the selected local date and observer location.

The displayed `Moon birth UTC` is selected relative to the local sunset being evaluated. If
the next conjunction happens after sunset, it will appear as `Next moon birth UTC`, and the
geometry gate will not treat that later conjunction as already born at sunset.

The Yallop and Odeh visibility criteria still matter after the gate because a crescent can be
geometrically present but too thin, too low, or too close to the Sun to be visible.

## Yallop Criterion

The Yallop implementation uses:

```text
q = (ARCV - (11.8371 - 6.3226W + 0.7319W^2 - 0.1018W^3)) / 10.3741
```

Where:

- `ARCV` is the Moon-Sun altitude difference in degrees.
- `W` is topocentric crescent width in arcminutes.

The app maps q to the standard Yallop-style categories:

| Score | Category | q range |
| --- | --- | --- |
| 6 | A: Easily visible | q > 0.216 |
| 5 | B: Visible under perfect conditions | -0.014 < q <= 0.216 |
| 4 | C: May need optical aid | -0.160 < q <= -0.014 |
| 3 | D: Will need optical aid | -0.232 < q <= -0.160 |
| 2 | E: Not visible with telescope | -0.293 < q <= -0.232 |
| 1 | F: Only photographic | -0.490 < q <= -0.293 |
| 0 | G: Not visible | q <= -0.490 |

## Odeh Criterion

The Odeh implementation uses:

```text
V = ARCV - (-0.1018W^3 + 0.7319W^2 - 6.3226W + 7.1651)
```

Where:

- `ARCV` is the Moon-Sun altitude difference in degrees.
- `W` is topocentric crescent width in arcminutes.

The app maps V to Odeh-style classes:

| Score | Category | V range |
| --- | --- | --- |
| 3 | A: Easily visible by naked eye | V >= 5.65 |
| 2 | B: Visible by optical aid, may be naked-eye | 2.00 <= V < 5.65 |
| 1 | C: Visible only with optical aid | -0.96 <= V < 2.00 |
| 0 | D: Not visible | V < -0.96 |

## Composite Index

Implemented in `visibility_engine.py`.

This is a project-specific exploratory 0-100 score. It blends:

- Moon altitude.
- Moon-Sun elongation.
- Illumination fraction.
- Sun darkness below the horizon.
- Moon age.

It is useful for smooth maps and comparisons, but it is not a published criterion.

## Legacy Heuristic Models

The following entries remain in `models.py` for comparison with earlier project behavior:

- Ilyas heuristic: Moon altitude plus elongation thresholds.
- Shaukat heuristic: elongation, Moon altitude, and Moon age thresholds.
- SAAO heuristic: Moon age plus sunset-to-moonset lag thresholds.

They are not presented as canonical implementations.

## Controls

## Published Site Modes

The repository contains two user surfaces:

- `streamlit run app.py`: live local mode. This runs Skyfield and the visibility engine for
  arbitrary user-selected coordinates, dates, times, model choices, and map grids.
- GitHub Pages static mode. This is a browser-only dashboard generated by
  `scripts/build_pages_site.py`. It uses the same repository engine and formulas, but it samples
  a finite set of dates, evening times, preset locations, and global grid positions into
  `pages/data/site_data.json` because GitHub Pages cannot run Python at request time.

The static Pages site should therefore be read as a published interactive sample/report, while
the Streamlit app is the full live calculator.

### Use Current Date/Time

Sets the base date, time sweep, and UTC offset from the computer running the app.

### Use Browser Location + Time

Requests geolocation permission in the browser. If granted, it updates latitude, longitude,
local date, local time, and UTC offset.

### Base Date And Date Sweep

`Base date` is the anchor date. `Date sweep` moves backward or forward from that base date.
The app displays the active date.

### Time Sweep

Moves through the selected local day in five-minute increments.

### Visibility Metric

Controls which score colors the map and drives the chart y-axis.

The dropdown labels say whether each option is a real formula criterion, an exploratory score,
or a legacy heuristic:

- `Yallop q (real formula criterion)`.
- `Odeh V (real formula criterion)`.
- `Composite index (exploratory)`.
- `Ilyas/Shaukat/SAAO (legacy heuristic)`.

### Projection

Controls how Earth is projected:

- `Robinson`: balanced global overview.
- `Mollweide`: equal-area global projection.
- `Equal Earth`: equal-area projection with modern global shape.
- `Plate Carree`: simple latitude/longitude rectangular projection.
- `Orthographic`: globe-like view centered on the selected observer.

### Map Grid

Controls sampled visibility point spacing:

- `Coarse`: faster, lower detail.
- `Medium`: balanced default.
- `Fine`: more detail, slower.

## Map Tooltips

Hover over map points to inspect:

- latitude and longitude,
- selected score and label,
- Moon altitude,
- Sun altitude,
- elongation,
- ARCV,
- DAZ,
- W in arcminutes,
- Yallop q,
- Odeh V,
- illumination percent,
- Moon age,
- and each model label.

The top cards and Astronomy tab show the selected location's moon birth, sunset, moonset,
lag, and Islamic geometry gate for the selected local date.

## Implementation Boundaries

The current implementation still does not model:

- local weather,
- aerosols or haze,
- realistic twilight sky brightness,
- terrain horizon,
- human visual acuity,
- telescope/binocular effects beyond criterion classes,
- official local sighting rules,
- or calibrated local empirical datasets.

The Islamic gate uses astronomical conjunction and local horizon rise/set geometry only. It
does not decide whether a crescent was legally sighted, whether testimony is accepted, or
which jurisdictional rule applies.

## Recommended Next Steps

1. Add source-backed canonical implementations for any additional named criteria kept in the UI.
2. Add tests from published worked examples.
3. Add a best-observation-time search rather than evaluating only the user-selected time.
4. Optionally add atmospheric/refraction/horizon modules.
