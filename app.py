from datetime import date, datetime, timedelta
from pathlib import Path

import altair as alt
import cartopy
from cartopy.io import shapereader
import pandas as pd
import streamlit as st
import streamlit.components.v1 as components
from shapely.geometry import mapping

from calculations import get_lunar_phase_events, get_solar_lunar_events
from visibility_engine import (
    METRIC_NAMES,
    build_date_series,
    build_position_series,
    build_time_series,
    build_world_grid,
    evaluate_datetime,
    islamic_sighting_context,
    local_to_utc,
    metric_label,
    metric_value,
    parse_utc,
)


APP_DIR = Path(__file__).resolve().parent
CARTOPY_DATA_DIR = APP_DIR / "cartopy_data"
cartopy.config["data_dir"] = str(CARTOPY_DATA_DIR)

LOCATION_PRESETS = {
    "Melbourne, AU": (-37.8136, 144.9631, 31, 10.0),
    "Mecca, SA": (21.3891, 39.8579, 277, 3.0),
    "Jakarta, ID": (-6.2088, 106.8456, 8, 7.0),
    "Kuala Lumpur, MY": (3.1390, 101.6869, 66, 8.0),
    "London, UK": (51.5072, -0.1276, 11, 0.0),
    "New York, US": (40.7128, -74.0060, 10, -5.0),
    "Custom": (-37.8136, 144.9631, 31, 10.0),
}

PROJECTION_TYPES = {
    "Robinson": "naturalEarth1",
    "Mollweide": "mollweide",
    "Equal Earth": "equalEarth",
    "Plate Carree": "equirectangular",
    "Orthographic": "orthographic",
}

GRID_RESOLUTIONS = {
    "Coarse": (15, 15),
    "Medium": (10, 10),
    "Fine": (5, 10),
}

CALCULATION_CACHE_VERSION = "birth-gates-v1"

METRIC_HELP = {
    "composite": (
        "Exploratory proxy: a 0-100 convenience index combining moon altitude, elongation, "
        "illumination, sun darkness, and moon age. Higher is better for naked-eye crescent visibility."
    ),
    "ilyas": "Legacy heuristic using moon altitude and moon-sun elongation; not a canonical implementation.",
    "yallop": "Formula-based Yallop q implementation using ARCV and topocentric crescent width W.",
    "odeh": "Formula-based Odeh V implementation using ARCV and topocentric crescent width W.",
    "shaukat": "Legacy heuristic using elongation, moon altitude, and moon age.",
    "saao": "Legacy heuristic using moon age and sunset-to-moonset lag.",
}

METRIC_LABELS = {
    "composite": "Composite index (exploratory)",
    "ilyas": "Ilyas (legacy heuristic)",
    "yallop": "Yallop q (real formula criterion)",
    "odeh": "Odeh V (real formula criterion)",
    "shaukat": "Shaukat (legacy heuristic)",
    "saao": "SAAO (legacy heuristic)",
}

PROJECTION_HELP = (
    "Map projections trade off shape, area, distance, and direction. Robinson and Equal Earth "
    "are good global overviews; Orthographic is globe-like and centered on the selected location."
)


def metric_display_name(value):
    return METRIC_LABELS.get(value, value.title())


st.set_page_config(page_title="Crescent Visibility", layout="wide")


def current_defaults():
    now = datetime.now().astimezone()
    utc_offset = now.utcoffset().total_seconds() / 3600.0
    rounded_minute = round((now.hour * 60 + now.minute) / 5) * 5
    if rounded_minute >= 24 * 60:
        rounded_minute = 24 * 60 - 5
    return now.date(), int(rounded_minute), float(utc_offset)


def query_value(name, default=None):
    value = st.query_params.get(name, default)
    if isinstance(value, list):
        return value[0] if value else default
    return value


def clamp(value, lower, upper):
    return max(lower, min(upper, value))


def apply_browser_query_params():
    if query_value("cv_apply") != "1":
        return

    try:
        st.session_state.lat = clamp(float(query_value("cv_lat")), -70.0, 70.0)
        st.session_state.lon = clamp(float(query_value("cv_lon")), -180.0, 180.0)
        st.session_state.utc_offset = clamp(float(query_value("cv_offset")), -12.0, 14.0)
        st.session_state.selected_date = date.fromisoformat(query_value("cv_date"))
        st.session_state.selected_minute = clamp(int(query_value("cv_minute")), 0, 24 * 60 - 5)
        st.session_state.preset = "Custom"
        st.session_state.last_preset = "Custom"
    except (TypeError, ValueError):
        st.session_state.location_error = "Browser location/time could not be applied."
    finally:
        st.query_params.clear()


def initialize_session_defaults():
    default_date, default_minute, default_offset = current_defaults()
    st.session_state.setdefault("preset", "Melbourne, AU")
    st.session_state.setdefault("lat", LOCATION_PRESETS["Melbourne, AU"][0])
    st.session_state.setdefault("lon", LOCATION_PRESETS["Melbourne, AU"][1])
    st.session_state.setdefault("elevation", float(LOCATION_PRESETS["Melbourne, AU"][2]))
    st.session_state.setdefault("utc_offset", default_offset)
    st.session_state.setdefault("selected_date", default_date)
    st.session_state.setdefault("selected_minute", default_minute)
    st.session_state.setdefault("last_preset", st.session_state.preset)


def use_current_date_time():
    default_date, default_minute, default_offset = current_defaults()
    st.session_state.selected_date = default_date
    st.session_state.selected_minute = default_minute
    st.session_state.utc_offset = default_offset


@st.cache_data(show_spinner=False)
def load_app_docs(docs_mtime):
    docs_path = APP_DIR / "docs" / "CRESCENT_VISIBILITY.md"
    if docs_path.exists():
        return docs_path.read_text(encoding="utf-8")
    return "Documentation file is missing."


def render_app_docs():
    docs_path = APP_DIR / "docs" / "CRESCENT_VISIBILITY.md"
    docs_mtime = docs_path.stat().st_mtime if docs_path.exists() else 0
    st.markdown(load_app_docs(docs_mtime))


@st.cache_data(show_spinner=False)
def load_country_geojson():
    shp_path = shapereader.natural_earth(
        resolution="110m",
        category="cultural",
        name="admin_0_countries",
    )
    features = []
    for record in shapereader.Reader(shp_path).records():
        properties = record.attributes
        features.append({
            "type": "Feature",
            "properties": {
                "name": properties.get("NAME") or properties.get("ADMIN") or "Country",
                "admin": properties.get("ADMIN") or properties.get("NAME") or "Country",
            },
            "geometry": mapping(record.geometry),
        })
    return {"type": "FeatureCollection", "features": features}


@st.cache_data(show_spinner=False)
def cached_world_grid(elevation, dt_utc, lat_step, lon_step, metric, cache_version):
    return build_world_grid(elevation, dt_utc, lat_step=lat_step, lon_step=lon_step, metric=metric)


@st.cache_data(show_spinner=False)
def cached_time_series(lat, lon, elevation, local_day, utc_offset, step_minutes, cache_version):
    return build_time_series(lat, lon, elevation, local_day, utc_offset, step_minutes=step_minutes)


@st.cache_data(show_spinner=False)
def cached_date_series(lat, lon, elevation, start_day, days, minute_of_day, utc_offset, cache_version):
    return build_date_series(lat, lon, elevation, start_day, days, minute_of_day, utc_offset)


@st.cache_data(show_spinner=False)
def cached_position_series(lat, lon, elevation, dt_utc, mode, step_degrees, metric, cache_version):
    return build_position_series(lat, lon, elevation, dt_utc, mode, step_degrees=step_degrees, metric=metric)


@st.cache_data(show_spinner=False)
def cached_local_sighting_context(lat, lon, elevation, local_day, utc_offset, dt_utc, cache_version):
    events = get_solar_lunar_events(
        lat,
        lon,
        elevation,
        local_day.year,
        local_day.month,
        local_day.day,
        utc_offset_hours=utc_offset,
    )
    sunset_dt = parse_utc(events.get("sunset_utc")) or dt_utc
    phases = get_lunar_phase_events(
        sunset_dt.year,
        sunset_dt.month,
        sunset_dt.day,
        sunset_dt.hour,
        sunset_dt.minute,
    )
    return islamic_sighting_context(events, phases)


def yes_no(value):
    return "Yes" if bool(value) else "No"


def display_value(value, suffix=""):
    if value is None:
        return "N/A"
    if isinstance(value, float) and pd.isna(value):
        return "N/A"
    if isinstance(value, float):
        return f"{value:.2f}{suffix}"
    return value


def metric_frame(df, metric):
    out = df.copy()
    out["metric_value"] = out.apply(lambda row: metric_value(row, metric), axis=1)
    out["metric_label"] = out.apply(lambda row: metric_label(row, metric), axis=1)
    out["score_display"] = out["metric_value"].round(2)
    out["moon_altitude_display"] = out["moon_altitude_deg"].round(2)
    out["sun_altitude_display"] = out["sun_altitude_deg"].round(2)
    out["elongation_display"] = out["moon_sun_separation_deg"].round(2)
    out["arcv_display"] = out["moon_arc_of_vision_deg"].round(2)
    out["daz_display"] = out["moon_relative_azimuth_deg"].round(2)
    out["illumination_percent"] = (out["moon_illumination_fraction"] * 100.0).round(2)
    out["moon_age_display"] = out["moon_age_days"].round(2)
    out["crescent_width_arcmin_display"] = out["moon_crescent_width_arcmin"].round(3)
    out["yallop_q_display"] = out["yallop_q"].round(3)
    out["odeh_v_display"] = out["odeh_v"].round(3)
    return out


def time_label(minute):
    return f"{minute // 60:02d}:{minute % 60:02d}"


def projection_kwargs(projection_name, lat, lon):
    kwargs = {"type": PROJECTION_TYPES[projection_name]}
    if projection_name == "Orthographic":
        kwargs["rotate"] = [-float(lon), -float(lat), 0]
    return kwargs


def render_world_map(df, lat, lon, metric, projection_name, current):
    plot_df = metric_frame(df, metric)
    country_geojson = load_country_geojson()
    country_data = alt.Data(values=country_geojson["features"])
    if metric == "composite":
        point_domain = [0, 100]
    elif metric == "yallop":
        point_domain = [0, 6]
    elif metric == "odeh":
        point_domain = [0, 3]
    else:
        point_domain = [0, 2]
    y_title = metric_display_name(metric)

    sphere = alt.Chart(alt.sphere()).mark_geoshape(fill="#dcecf4", stroke="#8aa5b4", strokeWidth=0.8)
    graticule = alt.Chart(alt.graticule(step=[30, 15])).mark_geoshape(
        stroke="#7f95a1",
        strokeWidth=0.4,
        opacity=0.42,
    )
    countries = alt.Chart(country_data).mark_geoshape(
        fill="#eef0dc",
        stroke="#596a55",
        strokeWidth=0.45,
    ).encode(
        tooltip=[
            alt.Tooltip("properties.admin:N", title="Country"),
        ],
    )
    visibility_points = alt.Chart(plot_df).mark_circle(
        size=92,
        opacity=0.78,
        stroke="#ffffff",
        strokeWidth=0.35,
    ).encode(
        longitude="longitude:Q",
        latitude="latitude:Q",
        color=alt.Color(
            "metric_value:Q",
            title=y_title,
            scale=alt.Scale(domain=point_domain, scheme="redyellowgreen"),
        ),
        tooltip=[
            alt.Tooltip("latitude:Q", title="Latitude", format=".2f"),
            alt.Tooltip("longitude:Q", title="Longitude", format=".2f"),
            alt.Tooltip("score_display:Q", title=y_title, format=".2f"),
            alt.Tooltip("metric_label:N", title="Visibility"),
            alt.Tooltip("moon_altitude_display:Q", title="Moon altitude", format=".2f"),
            alt.Tooltip("sun_altitude_display:Q", title="Sun altitude", format=".2f"),
            alt.Tooltip("elongation_display:Q", title="Elongation", format=".2f"),
            alt.Tooltip("arcv_display:Q", title="ARCV", format=".2f"),
            alt.Tooltip("daz_display:Q", title="DAZ", format=".2f"),
            alt.Tooltip("crescent_width_arcmin_display:Q", title="W arcmin", format=".3f"),
            alt.Tooltip("yallop_q_display:Q", title="Yallop q", format=".3f"),
            alt.Tooltip("odeh_v_display:Q", title="Odeh V", format=".3f"),
            alt.Tooltip("illumination_percent:Q", title="Illumination %", format=".2f"),
            alt.Tooltip("moon_age_display:Q", title="Moon age days", format=".2f"),
            alt.Tooltip("ilyas_label:N", title="Ilyas"),
            alt.Tooltip("yallop_label:N", title="Yallop"),
            alt.Tooltip("odeh_label:N", title="Odeh"),
            alt.Tooltip("shaukat_label:N", title="Shaukat"),
            alt.Tooltip("saao_label:N", title="SAAO"),
        ],
    )
    selected_point = alt.Chart(pd.DataFrame([{
        "latitude": lat,
        "longitude": lon,
        "label": metric_label(current, metric),
        "score": metric_value(current, metric),
    }])).mark_point(
        shape="diamond",
        size=220,
        filled=True,
        color="#101828",
        stroke="#ffffff",
        strokeWidth=1.1,
    ).encode(
        longitude="longitude:Q",
        latitude="latitude:Q",
        tooltip=[
            alt.Tooltip("latitude:Q", title="Selected latitude", format=".2f"),
            alt.Tooltip("longitude:Q", title="Selected longitude", format=".2f"),
            alt.Tooltip("score:Q", title=y_title, format=".2f"),
            alt.Tooltip("label:N", title="Visibility"),
        ],
    )

    return alt.layer(
        sphere,
        graticule,
        countries,
        visibility_points,
        selected_point,
    ).project(
        **projection_kwargs(projection_name, lat, lon)
    ).properties(
        height=540,
        title="Earth Projection",
    ).configure_view(
        strokeWidth=0,
    )


def render_line_chart(df, x_field, x_title, metric, title):
    plot_df = metric_frame(df, metric)
    y_title = metric_display_name(metric)

    chart = (
        alt.Chart(plot_df)
        .mark_line(point=True)
        .encode(
            x=alt.X(x_field, title=x_title),
            y=alt.Y("metric_value:Q", title=y_title),
            tooltip=[
                alt.Tooltip(x_field, title=x_title),
                alt.Tooltip("metric_value:Q", title=y_title, format=".2f"),
                alt.Tooltip("metric_label:N", title="Label"),
                alt.Tooltip("moon_altitude_deg:Q", title="Moon altitude", format=".2f"),
                alt.Tooltip("sun_altitude_deg:Q", title="Sun altitude", format=".2f"),
                alt.Tooltip("moon_sun_separation_deg:Q", title="Elongation", format=".2f"),
            ],
        )
        .properties(height=260, title=title)
        .interactive()
    )
    st.altair_chart(chart, use_container_width=True)


def render_position_chart(df, mode, metric):
    axis = "latitude" if mode == "latitude" else "longitude"
    render_line_chart(df, f"{axis}:Q", axis.title(), metric, f"{axis.title()} Sweep")


initialize_session_defaults()
apply_browser_query_params()

with st.sidebar:
    st.header("Crescent Visibility")
    if st.button(
        "Use current date/time",
        use_container_width=True,
        help="Set the base date, time sweep, and UTC offset from this computer's current clock.",
    ):
        use_current_date_time()
        st.rerun()

    components.html(
        """
        <button id="use-location" style="
            width:100%;border:0;border-radius:6px;padding:0.62rem 0.75rem;
            color:white;background:#2f6f73;font-weight:600;cursor:pointer;">
            Use browser location + time
        </button>
        <div id="geo-status" style="font:12px sans-serif;margin-top:6px;color:#475467;"></div>
        <script>
        const button = document.getElementById("use-location");
        const status = document.getElementById("geo-status");
        function localDateString(now) {
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, "0");
            const day = String(now.getDate()).padStart(2, "0");
            return `${year}-${month}-${day}`;
        }
        button.addEventListener("click", () => {
            const now = new Date();
            const minute = Math.min(1435, Math.round((now.getHours() * 60 + now.getMinutes()) / 5) * 5);
            const offset = -now.getTimezoneOffset() / 60;
            if (!navigator.geolocation) {
                status.textContent = "Browser geolocation is not available.";
                return;
            }
            status.textContent = "Requesting location...";
            navigator.geolocation.getCurrentPosition((position) => {
                const params = new URLSearchParams(window.parent.location.search);
                params.set("cv_apply", "1");
                params.set("cv_lat", position.coords.latitude.toFixed(5));
                params.set("cv_lon", position.coords.longitude.toFixed(5));
                params.set("cv_offset", offset.toFixed(2));
                params.set("cv_date", localDateString(now));
                params.set("cv_minute", String(minute));
                window.parent.location.search = params.toString();
            }, (error) => {
                status.textContent = error.message || "Location permission was not granted.";
            }, {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 300000
            });
        });
        </script>
        """,
        height=78,
    )

    if "location_error" in st.session_state:
        st.warning(st.session_state.pop("location_error"))

    preset = st.selectbox(
        "Location",
        list(LOCATION_PRESETS.keys()),
        key="preset",
        help="Choose a preset observer location, or use Custom for slider/browser-geolocation coordinates.",
    )
    preset_lat, preset_lon, preset_elevation, preset_offset = LOCATION_PRESETS[preset]
    if preset != st.session_state.last_preset:
        st.session_state.lat = float(preset_lat)
        st.session_state.lon = float(preset_lon)
        st.session_state.elevation = float(preset_elevation)
        st.session_state.utc_offset = float(preset_offset)
        st.session_state.last_preset = preset

    lat = st.slider(
        "Latitude",
        -70.0,
        70.0,
        step=0.1,
        key="lat",
        help="Observer latitude in degrees. Negative values are south of the equator.",
    )
    lon = st.slider(
        "Longitude",
        -180.0,
        180.0,
        step=0.1,
        key="lon",
        help="Observer longitude in degrees. Negative values are west of Greenwich.",
    )
    elevation = st.number_input(
        "Elevation (m)",
        step=1.0,
        key="elevation",
        help="Observer elevation above sea level. This has a smaller effect than position and time.",
    )
    utc_offset = st.slider(
        "UTC offset",
        -12.0,
        14.0,
        step=0.5,
        key="utc_offset",
        help="Offset used to convert the local date/time controls into UTC for Skyfield calculations.",
    )

    selected_base_date = st.date_input(
        "Base date",
        key="selected_date",
        help="The date at the center of the date sweep.",
    )
    date_sweep_days = st.slider(
        "Date sweep",
        -45,
        45,
        0,
        help="Slide backward or forward from the base date. Zero means the base date itself.",
    )
    selected_date = selected_base_date + timedelta(days=int(date_sweep_days))
    st.caption(f"Active date: {selected_date.isoformat()}")

    selected_minute = st.select_slider(
        "Time sweep",
        options=list(range(0, 24 * 60, 5)),
        key="selected_minute",
        format_func=time_label,
        help="Sweep through the selected local day in five-minute increments.",
    )

    metric = st.selectbox(
        "Visibility metric",
        METRIC_NAMES,
        format_func=metric_display_name,
        help="Choose the score or rule set used to color the map and charts.",
    )
    st.caption(METRIC_HELP[metric])
    projection_name = st.selectbox(
        "Projection",
        list(PROJECTION_TYPES.keys()),
        help=PROJECTION_HELP,
    )
    grid_resolution = st.selectbox(
        "Map grid",
        list(GRID_RESOLUTIONS.keys()),
        index=1,
        help="Controls how many visibility sample points are drawn. Fine is more detailed but slower.",
    )

    time_step = st.selectbox(
        "Time chart step",
        [5, 10, 15, 30, 60],
        index=2,
        format_func=lambda value: f"{value} min",
        help="Sampling interval for the daily visibility chart.",
    )
    date_days = st.slider(
        "Date chart days",
        3,
        45,
        15,
        help="Number of days to plot starting from the active date.",
    )
    sweep_mode = st.selectbox(
        "Position sweep",
        ["latitude", "longitude"],
        format_func=str.title,
        help="Choose whether the position chart sweeps north-south or east-west through the selected point.",
    )
    sweep_step = st.selectbox(
        "Position step",
        [2.5, 5.0, 10.0],
        index=1,
        format_func=lambda value: f"{value:g} deg",
        help="Sampling interval for the position sweep chart.",
    )


dt_utc = local_to_utc(selected_date, selected_minute, utc_offset)
current = evaluate_datetime(lat, lon, elevation, dt_utc)
sighting_context = cached_local_sighting_context(
    lat,
    lon,
    elevation,
    selected_date,
    utc_offset,
    dt_utc,
    CALCULATION_CACHE_VERSION,
)

st.title("Crescent Visibility")
st.info(
    "Yallop and Odeh use ARCV/crescent-width formula criteria. The Islamic sighting gates below "
    "show moon birth, sunset, moonset, and whether the Moon is above the horizon after sunset.",
)

with st.expander("Documentation: metrics, controls, projections, and limitations", expanded=True):
    render_app_docs()

metric_cols = st.columns(5)
metric_cols[0].metric("UTC", dt_utc.strftime("%Y-%m-%d %H:%M"))
metric_cols[1].metric("Visibility", metric_label(current, metric))
metric_cols[2].metric(
    "Score",
    f"{metric_value(current, metric):.1f}" if metric == "composite" else int(metric_value(current, metric)),
)
metric_cols[3].metric("Moon altitude", f"{current['moon_altitude_deg']:.1f} deg")
metric_cols[4].metric("Elongation", f"{current['moon_sun_separation_deg']:.1f} deg")

sighting_cols = st.columns(4)
sighting_cols[0].metric("Moon birth UTC", display_value(sighting_context["moon_birth_utc"]))
sighting_cols[1].metric("Sunset UTC", display_value(sighting_context["sunset_utc"]))
sighting_cols[2].metric("Moonset UTC", display_value(sighting_context["moonset_utc"]))
sighting_cols[3].metric("Moon lag", display_value(sighting_context["moon_lag_minutes"], " min"))

gate_cols = st.columns(3)
gate_cols[0].metric("Born before sunset", yes_no(sighting_context["moon_born_before_sunset"]))
gate_cols[1].metric("Moonset after sunset", yes_no(sighting_context["moonset_after_sunset"]))
gate_cols[2].metric("Geometry gate", yes_no(sighting_context["islamic_geometry_gate"]))

lat_step, lon_step = GRID_RESOLUTIONS[grid_resolution]
with st.spinner("Calculating projection grid..."):
    world_df = cached_world_grid(float(elevation), dt_utc, lat_step, lon_step, metric, CALCULATION_CACHE_VERSION)

st.altair_chart(render_world_map(world_df, lat, lon, metric, projection_name, current), use_container_width=True)

chart_tabs = st.tabs(["Time", "Date", "Position", "Astronomy", "Docs"])

with chart_tabs[0]:
    time_df = cached_time_series(lat, lon, elevation, selected_date, utc_offset, time_step, CALCULATION_CACHE_VERSION)
    render_line_chart(time_df, "local_time:T", "Local time", metric, "Visibility Through The Day")

with chart_tabs[1]:
    date_df = cached_date_series(
        lat,
        lon,
        elevation,
        selected_date,
        date_days,
        selected_minute,
        utc_offset,
        CALCULATION_CACHE_VERSION,
    )
    render_line_chart(date_df, "local_date:T", "Date", metric, "Visibility Across Dates")

with chart_tabs[2]:
    position_df = cached_position_series(
        lat,
        lon,
        elevation,
        dt_utc,
        sweep_mode,
        sweep_step,
        metric,
        CALCULATION_CACHE_VERSION,
    )
    render_position_chart(position_df, sweep_mode, metric)

with chart_tabs[3]:
    details = {
        "Sun altitude": current["sun_altitude_deg"],
        "Moon altitude": current["moon_altitude_deg"],
        "Moon-sun separation": current["moon_sun_separation_deg"],
        "Arc of vision (ARCV)": current["moon_arc_of_vision_deg"],
        "Relative azimuth (DAZ)": current["moon_relative_azimuth_deg"],
        "Illumination fraction": current["moon_illumination_fraction"],
        "Crescent width (arcmin)": current["moon_crescent_width_arcmin"],
        "Yallop q": current["yallop_q"],
        "Odeh V": current["odeh_v"],
        "Moon birth UTC": sighting_context["moon_birth_utc"],
        "Next moon birth UTC": sighting_context["next_moon_birth_utc"],
        "Sunrise UTC": sighting_context["sunrise_utc"],
        "Sunset UTC": sighting_context["sunset_utc"],
        "Moonrise UTC": sighting_context["moonrise_utc"],
        "Moonset UTC": sighting_context["moonset_utc"],
        "Moon lag minutes": sighting_context["moon_lag_minutes"],
        "Moon age at sunset hours": sighting_context["moon_age_at_sunset_hours"],
        "Moon age at sunset days": sighting_context["moon_age_at_sunset_days"],
        "Born before sunset": yes_no(sighting_context["moon_born_before_sunset"]),
        "Moonset after sunset": yes_no(sighting_context["moonset_after_sunset"]),
        "Islamic geometry gate": yes_no(sighting_context["islamic_geometry_gate"]),
        "Moon age at selected time hours": current["moon_age_since_birth_hours"],
        "Moon age at selected time days": current["moon_age_days"],
        "Moon phase angle": current["moon_phase_angle_deg"],
        "Moon distance": current["moon_distance_km"],
        "Sun distance": current["sun_distance_km"],
    }
    st.dataframe(
        [{"measure": key, "value": value} for key, value in details.items()],
        hide_index=True,
        use_container_width=True,
    )

    model_rows = [
        {"model": name.title(), "score": current[f"{name}_score"], "label": current[f"{name}_label"]}
        for name in ["ilyas", "yallop", "odeh", "shaukat", "saao"]
    ]
    st.dataframe(model_rows, hide_index=True, use_container_width=True)

with chart_tabs[4]:
    render_app_docs()
