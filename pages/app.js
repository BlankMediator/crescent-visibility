const state = {
  data: null,
  location: null,
  date: null,
  minute: null,
  metric: "yallop",
  projection: "equirectangular",
  mapView: "day",
  timezoneMode: "browser",
  browserTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Browser local",
  browserOffsetHours: -new Date().getTimezoneOffset() / 60,
  customLocation: null,
  searchTimer: null,
  lastLocalSuggestions: [],
  today: new Date().toLocaleDateString("en-CA"),
};

const el = (id) => document.getElementById(id);

const DEFINITIONS = {
  "ARCV": "Arc of vision: Moon altitude minus Sun altitude, in degrees. Higher ARCV generally means the crescent is vertically farther from the Sun.",
  "DAZ": "Difference in azimuth: the absolute horizontal angle between the Moon and Sun, in degrees.",
  "Crescent width W": "Topocentric illuminated crescent width in arcminutes, estimated from Moon apparent semidiameter and phase angle.",
  "Elongation": "Angular separation between the apparent Moon and Sun positions.",
  "Illumination": "Fraction of the lunar disc illuminated from the observer's apparent geometry.",
  "Moon age": "Time since astronomical new moon/conjunction. The app uses the computed conjunction where available.",
  "Moon altitude": "Apparent Moon height above or below the local horizon.",
  "Sun altitude": "Apparent Sun height above or below the local horizon.",
  "Yallop q": "Published Yallop formula criterion using ARCV and crescent width W.",
  "Odeh V": "Published Odeh formula criterion using ARCV and crescent width W.",
  "Moon lag": "Moonset minus sunset. Positive lag means the Moon sets after the Sun.",
  "Geometry gate": "Basic Islamic sighting geometry: conjunction before sunset and moonset after sunset.",
};

const ROBINSON_X = [1.0, 0.9986, 0.9954, 0.99, 0.9822, 0.973, 0.96, 0.9427, 0.9216, 0.8962, 0.8679, 0.835, 0.7986, 0.7597, 0.7186, 0.6732, 0.6213, 0.5722, 0.5322];
const ROBINSON_Y = [0.0, 0.062, 0.124, 0.186, 0.248, 0.31, 0.372, 0.434, 0.4958, 0.5571, 0.6176, 0.6769, 0.7346, 0.7903, 0.8435, 0.8936, 0.9394, 0.9761, 1.0];
const FIRST_STATUS = ["ok", "moonset_before_sunset", "before_conjunction", "no_event"];
const FIRST_BANDS = [
  { label: "F: Below Danjon limit", color: "#ffffff" },
  { label: "E: Not visible by conventional telescope", color: "#ff7f50" },
  { label: "D: Only visible with binoculars or telescope", color: "#fff200" },
  { label: "C: Visible after found with optical aid", color: "#78f06f" },
  { label: "B: Visible under perfect atmospheric conditions", color: "#a7ff4f" },
  { label: "A: Easily visible to the unaided eye", color: "#00f000" },
];
const FIRST_MASKS = {
  moonset_before_sunset: { label: "Moonset before sunset", color: "#f00000" },
  before_conjunction: { label: "Before conjunction", color: "#9c1bb4" },
  no_event: { label: "No local sunset/moonset event", color: "#94a3b8" },
};

function fmt(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  if (typeof value === "number") return value.toFixed(digits);
  return String(value);
}

function selectedLocation() {
  if (state.customLocation) return state.customLocation;
  return state.data.locations.find((item) => item.name === state.location) || state.data.locations[0];
}

function selectedRow() {
  if (!state.customLocation) return state.data.location_rows[state.location][state.date][String(state.minute)];
  return customLocationRow(state.date, state.minute);
}

function selectedEventRow(dateText = state.date, minute = state.minute) {
  if (state.data.location_rows[state.location]?.[dateText]?.[String(minute)]) {
    return state.data.location_rows[state.location][dateText][String(minute)];
  }
  const loc = selectedLocation();
  const nearest = nearestLocation(loc.latitude, loc.longitude);
  return state.data.location_rows[nearest.name]?.[dateText]?.[String(minute)] || selectedRow();
}

function metricValue(row, metric = state.metric) {
  if (!row) return null;
  return metric === "yallop" ? row.yallop_score : row.odeh_score;
}

function metricRawValue(row, metric = state.metric) {
  if (!row) return null;
  return metric === "yallop" ? row.yallop_q : row.odeh_v;
}

function metricLabel(row, metric = state.metric) {
  if (!row) return "--";
  if (metric === "yallop") return row.yallop_label || bandName(row, metric);
  return row.odeh_label || bandName(row, metric);
}

function bandName(row, metric = state.metric) {
  if (row?.first_visibility_status !== undefined) return firstBandName(row);
  const score = metricValue(row, metric);
  if (metric === "yallop") {
    return ["Not visible", "Photographic only", "Not visible by telescope", "Needs optical aid", "May need optical aid", "Visible in perfect conditions", "Easily visible"][score] || "--";
  }
  return ["Not visible", "Optical aid only", "Optical aid; maybe naked eye", "Easily naked-eye visible"][score] || "--";
}

function colorFor(row, metric = state.metric) {
  if (row?.first_visibility_status !== undefined) return firstColorFor(row);
  const score = metricValue(row, metric);
  if (score === null || score === undefined) return "#94a3b8";
  if (metric === "yallop") {
    return ["#7f1d1d", "#b42318", "#dc2626", "#f97316", "#eab308", "#2f9e44", "#087443"][score] || "#94a3b8";
  }
  return ["#7f1d1d", "#f97316", "#eab308", "#087443"][score] || "#94a3b8";
}

function firstBandName(row) {
  const status = FIRST_STATUS[row.first_visibility_status] || "no_event";
  if (status !== "ok") return FIRST_MASKS[status]?.label || "No first-visibility sample";
  return FIRST_BANDS[row.van_gent_score]?.label || "--";
}

function firstColorFor(row) {
  const status = FIRST_STATUS[row.first_visibility_status] || "no_event";
  if (status !== "ok") return FIRST_MASKS[status]?.color || "#94a3b8";
  return FIRST_BANDS[row.van_gent_score]?.color || "#94a3b8";
}

function compactToRow(point, values, minute = state.minute) {
  return {
    ...point,
    yallop_score: values[0],
    odeh_score: values[1],
    yallop_q: values[2],
    odeh_v: values[3],
    moon_altitude_deg: values[4],
    sun_altitude_deg: values[5],
    moon_sun_separation_deg: values[6],
    moon_arc_of_vision_deg: values[7],
    moon_relative_azimuth_deg: values[8],
    moon_crescent_width_arcmin: values[9],
    moon_illumination_fraction: values[10],
    moon_age_days: values[11],
    best_minute: minute,
    utc_minute: minute,
  };
}

function compactToFirstVisibilityRow(point, values) {
  return {
    ...point,
    first_visibility_status: values[0],
    van_gent_score: values[1],
    yallop_q: values[2],
    moon_altitude_deg: values[3],
    sun_altitude_deg: values[4],
    moon_sun_separation_deg: values[5],
    moon_arc_of_vision_deg: values[6],
    moon_relative_azimuth_deg: values[7],
    moon_crescent_width_arcmin: values[8],
    moon_illumination_fraction: values[9],
    moon_age_hours: values[10],
    best_datetime_utc: values[11],
    sunset_utc: values[12],
    moonset_utc: values[13],
    moon_birth_utc: values[14],
    moon_lag_minutes: values[15],
    utc_date: String(values[11] || "").slice(0, 10) || state.date,
    utc_minute: minuteFromUtcText(values[11]),
  };
}

function localToUtcParts(dateText, minute, offsetHours) {
  const [year, month, day] = dateText.split("-").map(Number);
  const ms = Date.UTC(year, month - 1, day, 0, minute) - offsetHours * 3600 * 1000;
  const dt = new Date(ms);
  const date = dt.toISOString().slice(0, 10);
  const utcMinute = dt.getUTCHours() * 60 + dt.getUTCMinutes();
  const nearest = nearestMinute(utcMinute);
  return { date, minute: nearest };
}

function nearestMinute(minute) {
  return state.data.minutes.reduce((best, item) => Math.abs(item - minute) < Math.abs(best - minute) ? item : best, state.data.minutes[0]);
}

function minuteAtOrAfter(minute) {
  return state.data.minutes.find((item) => item >= minute) ?? state.data.minutes[state.data.minutes.length - 1];
}

function nearestMapMinute(minute) {
  const minutes = state.data.map_minutes || state.data.minutes;
  return minutes.reduce((best, item) => Math.abs(item - minute) < Math.abs(best - minute) ? item : best, minutes[0]);
}

function minuteFromUtcText(utcText) {
  if (!utcText) return null;
  const dt = new Date(utcText);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.getUTCHours() * 60 + dt.getUTCMinutes();
}

function mapRowsForUtc(dateText, minute) {
  const day = state.data.map_values[dateText];
  if (!day) return [];
  const mapMinute = nearestMapMinute(minute);
  const values = day[String(mapMinute)] || [];
  return values.map((value, index) => ({ ...compactToRow(state.data.points[index], value, mapMinute), utc_date: dateText, utc_minute: mapMinute }));
}

function firstVisibilityRows() {
  const values = state.data.first_visibility_values?.[state.date] || [];
  return values.map((value, index) => compactToFirstVisibilityRow(state.data.points[index], value));
}

function instantRows() {
  const loc = selectedLocation();
  const utc = localToUtcParts(state.date, state.minute, loc.utc_offset_hours);
  return mapRowsForUtc(utc.date, utc.minute);
}

function dayRows() {
  const best = new Map();
  const constrained = new Map();
  const mapMinutes = state.data.map_minutes || state.data.minutes;
  mapMinutes.forEach((minute) => {
    mapRowsForUtc(state.date, minute).forEach((row) => {
      const current = best.get(row.id);
      const value = metricValue(row);
      if (!current || value > metricValue(current)) {
        best.set(row.id, { ...row, best_minute: minute, best_utc_date: state.date, utc_date: state.date, utc_minute: minute });
      }
      if (isConstrainedSample(row)) {
        const currentConstrained = constrained.get(row.id);
        if (!currentConstrained || value > metricValue(currentConstrained)) {
          constrained.set(row.id, { ...row, constrained_best_minute: minute, constrained_best_utc_date: state.date });
        }
      }
    });
  });
  return [...best.values()].map((row) => {
    const constrainedRow = constrained.get(row.id);
    return constrainedRow
      ? {
          ...row,
          constrained_best_minute: constrainedRow.constrained_best_minute,
          constrained_best_utc_date: constrainedRow.constrained_best_utc_date,
          constrained_best_score: metricValue(constrainedRow),
          constrained_best_label: bandName(constrainedRow),
        }
      : row;
  });
}

function isConstrainedSample(row) {
  return row
    && Number(row.moon_altitude_deg) > 0
    && Number(row.sun_altitude_deg) < 0
    && Number(row.moon_age_days) >= 0;
}

function nearestMapRow(rows, lat, lon) {
  return rows.reduce((best, item) => {
    const d = Math.hypot(item.latitude - lat, item.longitude - lon);
    const bd = best ? Math.hypot(best.latitude - lat, best.longitude - lon) : Infinity;
    return d < bd ? item : best;
  }, null);
}

function customLocationRow(dateText, minute) {
  const loc = selectedLocation();
  const utc = localToUtcParts(dateText, minute, loc.utc_offset_hours);
  const row = nearestMapRow(mapRowsForUtc(utc.date, utc.minute), loc.latitude, loc.longitude) || {};
  return {
    ...row,
    name: loc.name,
    latitude: loc.latitude,
    longitude: loc.longitude,
    local_date: dateText,
    local_time: state.data.minute_labels[String(minute)],
    datetime_utc: `${utc.date}T${state.data.minute_labels[String(utc.minute)]}:00Z`,
  };
}

function currentMapRows() {
  if (state.mapView === "first") return firstVisibilityRows();
  if (state.mapView === "day") return dayRows();
  const rows = instantRows();
  if (state.mapView !== "slice") return rows;
  return rows;
}

function setupControls() {
  const data = state.data;
  const locationSelect = el("locationSelect");
  data.locations.forEach((location) => {
    const option = document.createElement("option");
    option.value = location.name;
    option.textContent = location.name;
    locationSelect.appendChild(option);
  });

  data.dates.forEach((date) => {
    const option = document.createElement("option");
    option.value = date;
    option.textContent = date;
    el("dateSelect").appendChild(option);
  });

  data.minutes.forEach((minute) => {
    const option = document.createElement("option");
    option.value = String(minute);
    option.textContent = data.minute_labels[String(minute)];
    el("timeSelect").appendChild(option);
  });

  Object.entries(data.metrics).forEach(([key, metric]) => {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = metric.label;
    el("metricSelect").appendChild(option);
  });

  state.location = data.locations[0].name;
  applyBrowserDateTime();
  setPreferredSightingMinute();

  locationSelect.value = state.location;
  el("dateSelect").value = state.date;
  el("metricSelect").value = state.metric;
  el("timezoneSelect").value = state.timezoneMode;
  el("timeSlider").min = "0";
  el("timeSlider").max = String(data.minutes.length - 1);
  syncTimeControls();

  locationSelect.addEventListener("change", (event) => {
    state.customLocation = null;
    state.location = event.target.value;
    el("remoteSuggestions").hidden = true;
    event.target.blur();
    setPreferredSightingMinute();
    render();
  });
  el("locationSearch").addEventListener("change", applyLocationSearch);
  el("locationSearch").addEventListener("input", scheduleRemoteSearch);
  el("locationSearch").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      applyLocationSearch();
    }
  });
  el("dateSelect").addEventListener("change", (event) => {
    state.date = event.target.value;
    setPreferredSightingMinute();
    render();
  });
  el("metricSelect").addEventListener("change", (event) => {
    state.metric = event.target.value;
    render();
  });
  el("projectionSelect").addEventListener("change", (event) => {
    state.projection = event.target.value;
    render();
  });
  el("timezoneSelect").addEventListener("change", (event) => {
    state.timezoneMode = event.target.value;
    render();
  });
  el("timeSlider").addEventListener("input", (event) => setTimeByIndex(event.target.value));
  el("timeSlider").addEventListener("change", (event) => setTimeByIndex(event.target.value));
  el("timeSelect").addEventListener("change", (event) => setTimeByMinute(event.target.value));
  el("timePrev").addEventListener("click", () => setTimeByIndex(data.minutes.indexOf(state.minute) - 1));
  el("timeNext").addEventListener("click", () => setTimeByIndex(data.minutes.indexOf(state.minute) + 1));
  el("currentButton").addEventListener("click", useCurrent);
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".search-field")) {
      el("remoteSuggestions").hidden = true;
    }
  });
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.mapView = button.dataset.view;
      document.querySelectorAll(".tab-button").forEach((item) => item.classList.toggle("active", item === button));
      render();
    });
  });
}

function applyBrowserDateTime() {
  const now = new Date();
  state.today = now.toLocaleDateString("en-CA");
  state.date = closestDate(state.today);
  state.minute = nearestMinute(now.getHours() * 60 + now.getMinutes());
  state.timezoneMode = "browser";
  el("timezoneSelect").value = "browser";
}

function setPreferredSightingMinute(dateText = state.date) {
  const eventRow = selectedEventRow(dateText, state.data.minutes[0]);
  const sunsetMinute = localEventMinute(eventRow.sunset_utc, dateText);
  const moonsetMinute = localEventMinute(eventRow.moonset_utc, dateText);
  if (sunsetMinute === null || sunsetMinute === undefined) return;
  const afterSunset = minuteAtOrAfter(sunsetMinute);
  const beforeMoonset = state.data.minutes.find((minute) => minute >= sunsetMinute && (moonsetMinute === null || moonsetMinute === undefined || minute <= moonsetMinute));
  state.minute = beforeMoonset ?? afterSunset;
  syncTimeControls();
}

function closestDate(dateText) {
  return state.data.dates.reduce((best, item) => Math.abs(Date.parse(item) - Date.parse(dateText)) < Math.abs(Date.parse(best) - Date.parse(dateText)) ? item : best, state.data.dates[0]);
}

function applyLocationSearch() {
  const query = el("locationSearch").value.trim().toLowerCase();
  if (!query) return;
  const location = state.data.locations.find((item) => item.name.toLowerCase() === query)
    || state.data.locations.find((item) => `${item.name} ${item.search}`.toLowerCase().includes(query));
  if (location) {
    state.customLocation = null;
    state.location = location.name;
    el("locationSelect").value = state.location;
    el("remoteSuggestions").hidden = true;
    el("locationSearch").blur();
    el("locationSearchStatus").textContent = `Using ${location.name}`;
    render();
    return;
  }
  const point = state.data.points.find((item) => item.type !== "grid" && `${item.name} ${item.country} ${item.search}`.toLowerCase().includes(query));
  if (point) {
    const nearest = nearestLocation(point.latitude, point.longitude);
    state.customLocation = null;
    state.location = nearest.name;
    el("locationSelect").value = state.location;
    el("remoteSuggestions").hidden = true;
    el("locationSearch").blur();
    el("locationSearchStatus").textContent = `${point.name} is a map calculation point; using nearest preset ${nearest.name} for charts.`;
    render();
    return;
  }
  el("locationSearchStatus").textContent = "Searching live address suggestions...";
  fetchRemoteSuggestions(el("locationSearch").value.trim(), true);
}

function scheduleRemoteSearch(event) {
  window.clearTimeout(state.searchTimer);
  const query = event.target.value.trim();
  if (query.length < 3) {
    state.lastLocalSuggestions = [];
    el("remoteSuggestions").hidden = true;
    return;
  }
  renderLocalSuggestions(query);
  state.searchTimer = window.setTimeout(() => fetchRemoteSuggestions(query), 350);
}

function localSuggestionItems(query) {
  const q = query.toLowerCase();
  const locations = state.data.locations
    .filter((item) => `${item.name} ${item.search}`.toLowerCase().includes(q))
    .slice(0, 6)
    .map((item) => ({ type: "location", label: item.name, detail: item.country || "Preset location", item }));
  const points = state.data.points
    .filter((item) => item.type !== "grid" && `${item.name} ${item.country} ${item.search}`.toLowerCase().includes(q))
    .slice(0, 6)
    .map((item) => ({ type: "point", label: item.name, detail: `${item.type} point`, item }));
  return [...locations, ...points].slice(0, 8);
}

function renderLocalSuggestions(query) {
  const items = localSuggestionItems(query);
  state.lastLocalSuggestions = items;
  const box = el("remoteSuggestions");
  if (!items.length) {
    box.hidden = true;
    return;
  }
  box.innerHTML = items.map((entry, index) => `<button type="button" data-local-index="${index}">${entry.label}<small>${entry.detail}</small></button>`).join("");
  box.hidden = false;
  box.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => selectLocalSuggestion(items[Number(button.dataset.localIndex)])));
}

function selectLocalSuggestion(entry) {
  if (!entry) return;
  if (entry.type === "location") {
    state.customLocation = null;
    state.location = entry.item.name;
    el("locationSelect").value = state.location;
    el("locationSearch").value = entry.item.name;
    el("locationSearchStatus").textContent = `Using ${entry.item.name}`;
  } else {
    const nearest = nearestLocation(entry.item.latitude, entry.item.longitude);
    state.customLocation = null;
    state.location = nearest.name;
    el("locationSelect").value = state.location;
    el("locationSearch").value = entry.item.name;
    el("locationSearchStatus").textContent = `${entry.item.name} is a map calculation point; using nearest preset ${nearest.name} for event times.`;
  }
  el("remoteSuggestions").hidden = true;
  el("locationSearch").blur();
  setPreferredSightingMinute();
  render();
}

async function fetchRemoteSuggestions(query, autoPick = false) {
  try {
    const response = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=6`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = await response.json();
    const features = (json.features || []).filter((feature) => Array.isArray(feature.geometry?.coordinates));
    if (!features.length) {
      el("locationSearchStatus").textContent = "No address suggestions found.";
      return;
    }
    renderRemoteSuggestions(features);
    if (autoPick && features.length === 1) selectRemoteFeature(features[0]);
  } catch (error) {
    el("locationSearchStatus").textContent = "Live address suggestions are unavailable; offline city/country matching still works.";
  }
}

function featureName(feature) {
  const p = feature.properties || {};
  return [p.name, p.street, p.city, p.state, p.country].filter(Boolean).filter((value, index, arr) => arr.indexOf(value) === index).join(", ") || "Selected address";
}

function renderRemoteSuggestions(features) {
  const box = el("remoteSuggestions");
  const existing = box.hidden ? "" : box.innerHTML;
  const remote = features.map((feature, index) => {
    const p = feature.properties || {};
    return `<button type="button" data-index="${index}">${featureName(feature)}<small>${[p.osm_value, p.postcode].filter(Boolean).join(" ")}</small></button>`;
  }).join("");
  box.innerHTML = `${existing}${existing ? '<div class="suggestion-divider">Address suggestions</div>' : ""}${remote}`;
  box.hidden = false;
  box.querySelectorAll("button[data-local-index]").forEach((button) => {
    button.addEventListener("click", () => selectLocalSuggestion(state.lastLocalSuggestions[Number(button.dataset.localIndex)]));
  });
  box.querySelectorAll("button[data-index]").forEach((button) => button.addEventListener("click", () => selectRemoteFeature(features[Number(button.dataset.index)])));
}

function selectRemoteFeature(feature) {
  const [lon, lat] = feature.geometry.coordinates;
  const name = featureName(feature);
  state.customLocation = {
    id: "custom-location",
    name,
    country: feature.properties?.country || "",
    latitude: Number(lat),
    longitude: Number(lon),
    elevation_m: 0,
    utc_offset_hours: state.browserOffsetHours,
    search: name,
  };
  state.location = name;
  setCustomLocationOption(name);
  el("locationSearch").value = name;
  el("remoteSuggestions").hidden = true;
  el("locationSearch").blur();
  el("locationSearchStatus").textContent = `Using address result near ${fmt(lat, 4)}, ${fmt(lon, 4)}; time zone uses your browser offset.`;
  setPreferredSightingMinute();
  render();
}

function syncTimeControls() {
  const index = Math.max(0, state.data.minutes.indexOf(state.minute));
  el("timeSlider").value = String(index);
  el("timeSelect").value = String(state.minute);
  el("timeLabel").textContent = state.data.minute_labels[String(state.minute)];
  el("timePrev").disabled = index <= 0;
  el("timeNext").disabled = index >= state.data.minutes.length - 1;
}

function setTimeByIndex(index) {
  const clamped = Math.max(0, Math.min(state.data.minutes.length - 1, Number(index)));
  state.minute = state.data.minutes[clamped];
  render();
}

function setTimeByMinute(minute) {
  const index = state.data.minutes.indexOf(Number(minute));
  if (index >= 0) setTimeByIndex(index);
}

function useCurrent() {
  applyBrowserDateTime();
  el("dateSelect").value = state.date;
  setPreferredSightingMinute();
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition((pos) => {
      const nearest = nearestLocation(pos.coords.latitude, pos.coords.longitude);
      state.customLocation = {
        id: "browser-location",
        name: "Browser current location",
        country: "",
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        elevation_m: pos.coords.altitude || 0,
        utc_offset_hours: state.browserOffsetHours,
        search: "current browser geolocation",
      };
      state.location = nearest.name;
      setCustomLocationOption(state.customLocation.name);
      el("locationSearchStatus").textContent = `Using browser position; nearest preset is ${nearest.name}`;
      setPreferredSightingMinute();
      render();
    }, () => render(), { enableHighAccuracy: false, timeout: 6000 });
  } else {
    render();
  }
}

function setCustomLocationOption(name) {
  const select = el("locationSelect");
  let option = select.querySelector("option[data-custom='true']");
  if (!option) {
    option = document.createElement("option");
    option.dataset.custom = "true";
    select.appendChild(option);
  }
  option.value = name;
  option.textContent = name;
  select.value = name;
}

function nearestLocation(lat, lon) {
  return state.data.locations.reduce((best, item) => {
    const d = Math.hypot(item.latitude - lat, item.longitude - lon);
    const bd = Math.hypot(best.latitude - lat, best.longitude - lon);
    return d < bd ? item : best;
  }, state.data.locations[0]);
}

function displayTime(utcText, offsetHours = selectedLocation().utc_offset_hours) {
  if (!utcText) return "--";
  const utc = new Date(utcText.replace("Z", "Z"));
  if (state.timezoneMode === "utc") return `${utcText.replace("T", " ").replace("Z", "")} UTC`;
  if (state.timezoneMode === "browser") {
    return `${utc.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })} ${state.browserTimezone}`;
  }
  const local = new Date(utc.getTime() + offsetHours * 3600 * 1000);
  return `${local.toISOString().slice(0, 16).replace("T", " ")} location`;
}

function utcToLocalParts(utcText, offsetHours = selectedLocation().utc_offset_hours) {
  if (!utcText) return null;
  const text = utcText.endsWith("Z") ? utcText : `${utcText}Z`;
  const utc = new Date(text);
  if (Number.isNaN(utc.getTime())) return null;
  const local = new Date(utc.getTime() + offsetHours * 3600 * 1000);
  return {
    date: local.toISOString().slice(0, 10),
    minute: local.getUTCHours() * 60 + local.getUTCMinutes(),
    label: local.toISOString().slice(11, 16),
  };
}

function localEventMinute(utcText, dateText = state.date) {
  const parts = utcToLocalParts(utcText);
  return parts && parts.date === dateText ? parts.minute : null;
}

function shortEventTime(utcText) {
  const parts = utcToLocalParts(utcText);
  if (!parts) return "--";
  return parts.date === state.date ? parts.label : `${parts.date.slice(5)} ${parts.label}`;
}

function definitionButton(term) {
  return `<span class="def-tip" tabindex="0" role="button" data-tip="${DEFINITIONS[term]}" aria-label="${term} definition">i</span>`;
}

function renderCards(row) {
  const events = selectedEventRow();
  el("bandCard").textContent = bandName(row);
  el("bandCard").style.color = colorFor(row);
  el("labelCard").textContent = `${state.data.metrics[state.metric].label}: ${metricLabel(row)} (${state.metric === "yallop" ? "q" : "V"} ${fmt(metricRawValue(row), 3)})`;
  el("birthCard").textContent = displayTime(events.moon_birth_utc);
  el("nextBirthCard").textContent = `Next birth: ${displayTime(events.next_moon_birth_utc)}`;
  el("setCard").textContent = `${displayTime(events.sunset_utc)} / ${displayTime(events.moonset_utc)}`;
  el("lagCard").textContent = `Moon lag: ${fmt(events.moon_lag_minutes, 1)} min`;
  el("gateCard").textContent = events.islamic_geometry_gate ? "Pass" : "Fail";
  el("gateCard").style.color = events.islamic_geometry_gate ? "var(--ok)" : "var(--bad)";
  el("gateDetailCard").textContent = `Born before sunset: ${events.moon_born_before_sunset ? "yes" : "no"}; moonset after sunset: ${events.moonset_after_sunset ? "yes" : "no"}`;
}

function renderDetails(row) {
  const loc = selectedLocation();
  const utc = localToUtcParts(state.date, state.minute, loc.utc_offset_hours);
  const events = selectedEventRow();
  const details = [
    ["Latitude", fmt(row.latitude, 3)],
    ["Longitude", fmt(row.longitude, 3)],
    ["Moon altitude", `${fmt(row.moon_altitude_deg, 2)} deg`],
    ["Sun altitude", `${fmt(row.sun_altitude_deg, 2)} deg`],
    ["Elongation", `${fmt(row.moon_sun_separation_deg, 2)} deg`],
    ["ARCV", `${fmt(row.moon_arc_of_vision_deg, 2)} deg`],
    ["DAZ", `${fmt(row.moon_relative_azimuth_deg, 2)} deg`],
    ["Crescent width W", `${fmt(row.moon_crescent_width_arcmin, 3)} arcmin`],
    ["Yallop q", fmt(row.yallop_q, 3)],
    ["Odeh V", fmt(row.odeh_v, 3)],
    ["Illumination", `${fmt((row.moon_illumination_fraction || 0) * 100, 2)}%`],
    ["Moon age", `${fmt(row.moon_age_days, 2)} days`],
    ["Moon birth", displayTime(events.moon_birth_utc)],
    ["Sunset", displayTime(events.sunset_utc)],
    ["Moonset", displayTime(events.moonset_utc)],
    ["Moon lag", `${fmt(events.moon_lag_minutes, 1)} min`],
    ["Geometry gate", events.islamic_geometry_gate ? "Pass" : "Fail"],
  ];
  el("positionText").textContent = `${state.location}, ${state.date} ${state.data.minute_labels[String(state.minute)]} location time; map UTC ${utc.date} ${state.data.minute_labels[String(utc.minute)]}`;
  el("detailList").innerHTML = details.map(([key, value]) => `<dt>${key} ${DEFINITIONS[key] ? definitionButton(key) : ""}</dt><dd>${value}</dd>`).join("");
}

function project(lon, lat, width, height) {
  if (state.projection === "orthographic") return orthographic(lon, lat, width, height);
  if (state.projection === "mollweide") return mollweide(lon, lat, width, height);
  if (state.projection === "equalEarth") return equalEarth(lon, lat, width, height);
  if (state.projection === "robinson") return robinson(lon, lat, width, height);
  return [(lon + 180) / 360 * width, (90 - lat) / 180 * height];
}

function orthographic(lon, lat, width, height) {
  const location = selectedLocation();
  const lon0 = location.longitude * Math.PI / 180;
  const lat0 = location.latitude * Math.PI / 180;
  const lambda = lon * Math.PI / 180;
  const phi = lat * Math.PI / 180;
  const cosc = Math.sin(lat0) * Math.sin(phi) + Math.cos(lat0) * Math.cos(phi) * Math.cos(lambda - lon0);
  if (cosc < 0) return null;
  const r = Math.min(width, height) * 0.45;
  return [
    width / 2 + r * Math.cos(phi) * Math.sin(lambda - lon0),
    height / 2 - r * (Math.cos(lat0) * Math.sin(phi) - Math.sin(lat0) * Math.cos(phi) * Math.cos(lambda - lon0)),
  ];
}

function mollweide(lon, lat, width, height) {
  const lambda = lon * Math.PI / 180;
  const phi = lat * Math.PI / 180;
  let theta = phi;
  for (let i = 0; i < 8; i++) {
    const delta = (2 * theta + Math.sin(2 * theta) - Math.PI * Math.sin(phi)) / (2 + 2 * Math.cos(2 * theta));
    theta -= delta;
    if (Math.abs(delta) < 1e-6) break;
  }
  const x = (2 * Math.SQRT2 / Math.PI) * lambda * Math.cos(theta);
  const y = Math.SQRT2 * Math.sin(theta);
  return [width / 2 + x * width / 5.7, height / 2 - y * height / 2.9];
}

function equalEarth(lon, lat, width, height) {
  const A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796;
  const lambda = lon * Math.PI / 180;
  const phi = lat * Math.PI / 180;
  const theta = Math.asin(Math.sqrt(3) / 2 * Math.sin(phi));
  const theta2 = theta * theta;
  const theta6 = theta2 * theta2 * theta2;
  const x = 2 * Math.sqrt(3) * lambda * Math.cos(theta) / (3 * (A1 + 3 * A2 * theta2 + 7 * A3 * theta6 + 9 * A4 * theta6 * theta2));
  const y = A1 * theta + A2 * theta ** 3 + A3 * theta ** 7 + A4 * theta ** 9;
  return [width / 2 + x * width / 5.4, height / 2 - y * height / 2.6];
}

function robinson(lon, lat, width, height) {
  const absLat = Math.abs(lat);
  const i = Math.min(17, Math.floor(absLat / 5));
  const t = (absLat - i * 5) / 5;
  const xCoef = ROBINSON_X[i] + (ROBINSON_X[i + 1] - ROBINSON_X[i]) * t;
  const yCoef = ROBINSON_Y[i] + (ROBINSON_Y[i + 1] - ROBINSON_Y[i]) * t;
  const x = lon / 180 * xCoef;
  const y = Math.sign(lat) * yCoef;
  return [width / 2 + x * width * 0.47, height / 2 - y * height * 0.47];
}

function drawGeometry(ctx, geometry, width, height) {
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  polys.forEach((poly) => {
    poly.forEach((ring) => {
      let started = false;
      ctx.beginPath();
      ring.forEach(([lon, lat]) => {
        const xy = project(lon, lat, width, height);
        if (!xy) {
          started = false;
          return;
        }
        if (!started) {
          ctx.moveTo(xy[0], xy[1]);
          started = true;
        } else {
          ctx.lineTo(xy[0], xy[1]);
        }
      });
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    });
  });
}

function drawMap() {
  const canvas = el("mapCanvas");
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#d9eef5";
  ctx.fillRect(0, 0, width, height);

  if (state.projection === "orthographic") {
    ctx.save();
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, Math.min(width, height) * 0.45, 0, Math.PI * 2);
    ctx.clip();
  }

  ctx.fillStyle = "#e5dccb";
  ctx.strokeStyle = "rgba(91, 103, 117, 0.55)";
  ctx.lineWidth = 0.65;
  state.data.countries.features.forEach((feature) => drawGeometry(ctx, feature.geometry, width, height));

  drawGraticule(ctx, width, height);

  currentMapRows().filter((point) => point.type === "grid").forEach((point) => {
    const xy = project(point.longitude, point.latitude, width, height);
    if (!xy) return;
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = colorFor(point);
    ctx.fillRect(xy[0] - 10, xy[1] - 10, 20, 20);
    ctx.restore();
  });

  currentMapRows().forEach((point) => {
    const xy = project(point.longitude, point.latitude, width, height);
    if (!xy) return;
    const radius = point.type === "city" ? 4.7 : point.type === "country" ? 3.7 : 2.8;
    ctx.beginPath();
    ctx.fillStyle = colorFor(point);
    ctx.globalAlpha = point.type === "grid" ? 0.72 : 0.94;
    ctx.arc(xy[0], xy[1], radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 0.8;
    ctx.stroke();
  });

  const loc = selectedLocation();
  const marker = project(loc.longitude, loc.latitude, width, height);
  if (marker) {
    ctx.beginPath();
    ctx.fillStyle = "#111827";
    ctx.arc(marker[0], marker[1], 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  if (state.projection === "orthographic") ctx.restore();
}

function drawGraticule(ctx, width, height) {
  ctx.save();
  ctx.strokeStyle = "rgba(15, 23, 42, 0.20)";
  ctx.fillStyle = "rgba(15, 23, 42, 0.52)";
  ctx.lineWidth = 0.55;
  ctx.font = "11px system-ui, sans-serif";
  for (let lon = -180; lon <= 180; lon += 15) {
    ctx.beginPath();
    let started = false;
    for (let lat = -75; lat <= 75; lat += 5) {
      const xy = project(lon, lat, width, height);
      if (!xy) {
        started = false;
        continue;
      }
      if (!started) {
        ctx.moveTo(xy[0], xy[1]);
        started = true;
      } else {
        ctx.lineTo(xy[0], xy[1]);
      }
    }
    ctx.stroke();
    if (lon % 45 === 0) {
      const label = project(lon, -72, width, height);
      if (label) ctx.fillText(`${lon} deg`, label[0] + 2, label[1] - 2);
    }
  }
  for (let lat = -60; lat <= 60; lat += 15) {
    ctx.beginPath();
    let started = false;
    for (let lon = -180; lon <= 180; lon += 5) {
      const xy = project(lon, lat, width, height);
      if (!xy) {
        started = false;
        continue;
      }
      if (!started) {
        ctx.moveTo(xy[0], xy[1]);
        started = true;
      } else {
        ctx.lineTo(xy[0], xy[1]);
      }
    }
    ctx.stroke();
    const label = project(-178, lat, width, height);
    if (label) ctx.fillText(`${lat} deg`, label[0] + 3, label[1] - 3);
  }
  ctx.restore();
}

function nearestMapPoint(event) {
  const canvas = el("mapCanvas");
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = (event.clientX - rect.left) * scaleX;
  const y = (event.clientY - rect.top) * scaleY;
  let best = null;
  let bestDistance = Infinity;
  currentMapRows().forEach((point) => {
    const xy = project(point.longitude, point.latitude, canvas.width, canvas.height);
    if (!xy) return;
    const d = Math.hypot(x - xy[0], y - xy[1]);
    if (d < bestDistance) {
      bestDistance = d;
      best = point;
    }
  });
  return bestDistance <= 18 ? { point: best, x: event.clientX - rect.left, y: event.clientY - rect.top } : null;
}

function attachMapTooltip() {
  const canvas = el("mapCanvas");
  const tooltip = el("tooltip");
  const show = (event) => {
    const nearest = nearestMapPoint(event);
    if (!nearest) {
      tooltip.hidden = true;
      return;
    }
    const p = nearest.point;
    tooltip.hidden = false;
    tooltip.style.left = `${Math.min(nearest.x + 16, canvas.clientWidth - 300)}px`;
    tooltip.style.top = `${Math.max(nearest.y + 16, 16)}px`;
    if (p.first_visibility_status !== undefined) {
      tooltip.innerHTML = `
        <strong>${p.name}</strong><br>
        ${p.type} point: ${fmt(p.latitude, 1)}, ${fmt(p.longitude, 1)}<br>
        First visibility Yallop: ${firstBandName(p)}<br>
        Best time UTC ${p.best_datetime_utc || "--"}<br>
        Sunset ${displayTime(p.sunset_utc)}; moonset ${displayTime(p.moonset_utc)}<br>
        Moon birth ${displayTime(p.moon_birth_utc)}<br>
        q ${fmt(p.yallop_q, 3)}; age ${fmt(p.moon_age_hours, 1)} h<br>
        Moon alt ${fmt(p.moon_altitude_deg, 1)} deg; Sun alt ${fmt(p.sun_altitude_deg, 1)} deg<br>
        ARCV ${fmt(p.moon_arc_of_vision_deg, 2)} deg; DAZ ${fmt(p.moon_relative_azimuth_deg, 2)} deg<br>
        W ${fmt(p.moon_crescent_width_arcmin, 3)} arcmin
      `;
      return;
    }
    tooltip.innerHTML = `
      <strong>${p.name}</strong><br>
      ${p.type} point: ${fmt(p.latitude, 1)}, ${fmt(p.longitude, 1)}<br>
      UTC sample ${p.utc_date || state.date} ${state.data.minute_labels[String(p.utc_minute ?? p.best_minute ?? state.minute)]}<br>
      ${state.data.metrics[state.metric].label}: ${bandName(p)}<br>
      ${state.metric === "yallop" ? "q" : "V"} ${fmt(metricRawValue(p), 3)}<br>
      Moon alt ${fmt(p.moon_altitude_deg, 1)} deg; Sun alt ${fmt(p.sun_altitude_deg, 1)} deg<br>
      ARCV ${fmt(p.moon_arc_of_vision_deg, 2)} deg; DAZ ${fmt(p.moon_relative_azimuth_deg, 2)} deg<br>
      W ${fmt(p.moon_crescent_width_arcmin, 3)} arcmin${state.mapView === "day" ? `<br>Best UTC time ${p.best_utc_date || p.utc_date || state.date} ${state.data.minute_labels[String(p.best_minute)]}<br>Best constrained UTC ${p.constrained_best_minute !== undefined ? `${p.constrained_best_utc_date} ${state.data.minute_labels[String(p.constrained_best_minute)]} (${p.constrained_best_label})` : "none in sampled day"}` : ""}
    `;
  };
  canvas.addEventListener("mousemove", show);
  canvas.addEventListener("click", show);
  canvas.addEventListener("mouseleave", () => { tooltip.hidden = true; });
}

function chart(svg, rows, xLabels, valueFn = (row) => metricValue(row), options = {}) {
  const width = 760;
  const height = 320;
  const pad = { left: 48, right: 18, top: 18, bottom: 44 };
  const values = rows.map(valueFn).filter((v) => v !== null && v !== undefined);
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const x = (i) => pad.left + i * ((width - pad.left - pad.right) / Math.max(1, rows.length - 1));
  const y = (v) => height - pad.bottom - ((v - min) / Math.max(1, max - min)) * (height - pad.top - pad.bottom);
  const path = rows.map((row, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(valueFn(row) || 0)}`).join(" ");
  const circles = rows.map((row, i) => `<circle cx="${x(i)}" cy="${y(valueFn(row) || 0)}" r="4" fill="${colorFor(row)}"><title>${xLabels[i]}: ${bandName(row)}</title></circle>`).join("");
  const labels = xLabels.map((label, i) => i % Math.ceil(xLabels.length / 8) === 0 ? `<text x="${x(i)}" y="${height - 18}" text-anchor="middle" font-size="11" fill="#596675">${label}</text>` : "").join("");
  const eventMarkers = (options.events || []).map((event) => {
    if (event.minute === null || event.minute === undefined) return "";
    const markerX = pad.left + (event.minute / (24 * 60 - 60)) * (width - pad.left - pad.right);
    return `
      <line x1="${markerX}" y1="${pad.top}" x2="${markerX}" y2="${height - pad.bottom}" stroke="${event.color}" stroke-width="1.5" stroke-dasharray="4 4"/>
      <text x="${markerX + 4}" y="${pad.top + event.offset}" font-size="11" fill="${event.color}">${event.label}</text>
    `;
  }).join("");
  const bestNote = options.best
    ? `<text x="${pad.left}" y="14" font-size="11" fill="#18212f">${options.best}</text>`
    : "";
  const eventNote = options.eventNote
    ? `<text x="${width - pad.right}" y="14" text-anchor="end" font-size="11" fill="#596675">${options.eventNote}</text>`
    : "";
  svg.innerHTML = `
    <line x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}" stroke="#cbd5e1"/>
    <line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${height - pad.bottom}" stroke="#cbd5e1"/>
    ${eventMarkers}
    <path d="${path}" fill="none" stroke="#334155" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${circles}
    ${labels}
    ${bestNote}
    ${eventNote}
  `;
}

function bandGridChart(svg, rows, mode) {
  const width = 760;
  const height = 260;
  const pad = { left: 52, right: 18, top: 20, bottom: 36 };
  const gridRows = rows.filter((row) => row.type === "grid");
  const latitudes = [...new Set(gridRows.map((row) => row.latitude))].sort((a, b) => b - a);
  const longitudes = [...new Set(gridRows.map((row) => row.longitude))].sort((a, b) => a - b);
  const xValues = mode === "latitude" ? longitudes : [...latitudes].reverse();
  const yValues = mode === "latitude" ? latitudes : longitudes;
  const cellW = (width - pad.left - pad.right) / Math.max(1, xValues.length);
  const cellH = (height - pad.top - pad.bottom) / Math.max(1, yValues.length);
  const rowByCoord = new Map(gridRows.map((row) => [`${row.latitude},${row.longitude}`, row]));
  const cells = yValues.flatMap((yValue, yIndex) => xValues.map((xValue, xIndex) => {
    const lat = mode === "latitude" ? yValue : xValue;
    const lon = mode === "latitude" ? xValue : yValue;
    const row = rowByCoord.get(`${lat},${lon}`);
    if (!row) return "";
    return `<rect x="${pad.left + xIndex * cellW}" y="${pad.top + yIndex * cellH}" width="${Math.max(1, cellW)}" height="${Math.max(1, cellH)}" fill="${colorFor(row)}" opacity="0.9"><title>${lat} lat, ${lon} lon: ${bandName(row)}</title></rect>`;
  })).join("");
  const yLabels = yValues.map((value, i) => i % 2 === 0 ? `<text x="${pad.left - 7}" y="${pad.top + i * cellH + cellH * 0.7}" text-anchor="end" font-size="10" fill="#596675">${value}</text>` : "").join("");
  const xLabels = xValues.map((value, i) => i % 4 === 0 ? `<text x="${pad.left + i * cellW}" y="${height - 12}" text-anchor="middle" font-size="10" fill="#596675">${value}</text>` : "").join("");
  const title = mode === "latitude" ? "Latitude bands across all longitudes" : "Longitude bands across all latitudes";
  svg.innerHTML = `
    <text x="${pad.left}" y="13" font-size="12" fill="#18212f">${title}</text>
    ${cells}
    ${yLabels}
    ${xLabels}
  `;
}

function renderCharts() {
  const timeRows = state.data.minutes.map((minute) => state.customLocation ? customLocationRow(state.date, minute) : state.data.location_rows[state.location][state.date][String(minute)]);
  const eventRow = selectedEventRow();
  const bestRow = [...timeRows].sort((a, b) => metricValue(b) - metricValue(a))[0];
  const constrainedBest = timeRows.filter(isConstrainedSample).sort((a, b) => metricValue(b) - metricValue(a))[0];
  const eventOptions = {
    events: [
      { label: "Birth", minute: localEventMinute(eventRow.moon_birth_utc), color: "#0f766e", offset: 12 },
      { label: "Sunset", minute: localEventMinute(eventRow.sunset_utc), color: "#b45309", offset: 26 },
      { label: "Moonset", minute: localEventMinute(eventRow.moonset_utc), color: "#4f46e5", offset: 40 },
    ],
    best: `Best ${bestRow?.local_time || "--"}; constrained ${constrainedBest?.local_time || "--"}`,
    eventNote: `Birth ${shortEventTime(eventRow.moon_birth_utc)} | Sunset ${shortEventTime(eventRow.sunset_utc)} | Moonset ${shortEventTime(eventRow.moonset_utc)}`,
  };
  chart(el("timeChart"), timeRows, state.data.minutes.map((minute) => state.data.minute_labels[String(minute)]), (row) => metricValue(row), eventOptions);

  const instant = instantRows();
  const gridRows = instant.filter((row) => row.type === "grid");
  bandGridChart(el("latChart"), gridRows, "latitude");
  bandGridChart(el("lonChart"), gridRows, "longitude");
}

function renderCalendar() {
  const rows = state.data.dates.map((date) => {
    const best = state.data.minutes
      .map((minute) => state.customLocation ? customLocationRow(date, minute) : state.data.location_rows[state.location][date][String(minute)])
      .sort((a, b) => metricValue(b) - metricValue(a))[0];
    return { date, row: best };
  });
  const first = new Date(`${state.data.dates[0]}T00:00:00Z`).getUTCDay();
  const blanks = Array.from({ length: first }, () => `<div class="calendar-day empty"></div>`).join("");
  el("calendarGrid").innerHTML = `
    ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => `<strong>${d}</strong>`).join("")}
    ${blanks}
    ${rows.map(({ date, row }) => `
      <button class="calendar-day ${date === state.date ? "selected" : ""} ${date === state.today ? "today" : ""}" type="button" data-date="${date}" style="background:${colorFor(row)}">
        <span>${Number(date.slice(-2))}</span>
        <small>${date === state.today ? "Today " : ""}${state.data.minute_labels[String(row.local_time ? Number(row.local_time.slice(0, 2)) * 60 + Number(row.local_time.slice(3, 5)) : state.minute)] || ""}</small>
      </button>
    `).join("")}
  `;
  document.querySelectorAll(".calendar-day[data-date]").forEach((button) => {
    button.addEventListener("click", () => {
      state.date = button.dataset.date;
      el("dateSelect").value = state.date;
      render();
    });
  });
}

function renderLegend() {
  if (state.mapView === "first") {
    const bands = [...FIRST_BANDS].reverse().map((band) => `<span><i style="background:${band.color}; border:1px solid #94a3b8"></i>${band.label}</span>`).join("");
    const masks = Object.values(FIRST_MASKS).map((mask) => `<span><i style="background:${mask.color}"></i>${mask.label}</span>`).join("");
    el("legend").innerHTML = `${bands}${masks}`;
    return;
  }
  const scores = state.metric === "yallop" ? [6, 5, 4, 3, 2, 1, 0] : [3, 2, 1, 0];
  el("legend").innerHTML = scores.map((score) => {
    const row = state.metric === "yallop" ? { yallop_score: score } : { odeh_score: score };
    return `<span><i style="background:${colorFor(row)}"></i>${bandName(row)}</span>`;
  }).join("");
}

function renderMapText() {
  const titles = {
    instant: "Selected Date + Time Visibility",
    day: "Best Visibility Across Selected Date",
    slice: "Selected Date + Time Across All Lat/Lon",
    first: "First Visibility Yallop Map",
  };
  const subtitles = {
    instant: "Country, state, capital city, major city, and grid points at the selected instant.",
    day: "Each point shows its best visibility band across the selected UTC date from 00:00 to 24:00.",
    slice: "All precomputed country, state, capital, city, and 15 degree grid points at the selected UTC instant.",
    first: "Our Van Gent-style layer: Yallop at sunset plus 4/9 of the local sunset-to-moonset interval, with conjunction and moonset masks.",
  };
  el("mapTitle").textContent = titles[state.mapView];
  el("mapSubtitle").textContent = subtitles[state.mapView];
}

function render() {
  syncTimeControls();
  const row = selectedRow();
  renderLegend();
  renderCards(row);
  renderDetails(row);
  renderMapText();
  drawMap();
  renderCharts();
  renderCalendar();
}

async function init() {
  const response = await fetch("data/site_data.json");
  state.data = await response.json();
  setupControls();
  attachMapTooltip();
  render();
}

init().catch((error) => {
  document.body.innerHTML = `<main><section class="panel"><h1>Unable to load static data</h1><p>${error}</p></section></main>`;
});
