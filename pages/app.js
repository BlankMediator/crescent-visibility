const state = {
  data: null,
  location: null,
  date: null,
  minute: null,
  metric: "yallop",
  projection: "equirectangular",
  mapView: "instant",
  timezoneMode: "location",
  browserTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Browser local",
  browserOffsetHours: -new Date().getTimezoneOffset() / 60,
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

function fmt(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  if (typeof value === "number") return value.toFixed(digits);
  return String(value);
}

function selectedLocation() {
  return state.data.locations.find((item) => item.name === state.location) || state.data.locations[0];
}

function selectedRow() {
  return state.data.location_rows[state.location][state.date][String(state.minute)];
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
  return metric === "yallop" ? row.yallop_label : row.odeh_label;
}

function bandName(row, metric = state.metric) {
  const score = metricValue(row, metric);
  if (metric === "yallop") {
    return ["Not visible", "Photographic only", "Not visible by telescope", "Needs optical aid", "May need optical aid", "Visible in perfect conditions", "Easily visible"][score] || "--";
  }
  return ["Not visible", "Optical aid only", "Optical aid; maybe naked eye", "Easily naked-eye visible"][score] || "--";
}

function colorFor(row, metric = state.metric) {
  const score = metricValue(row, metric);
  if (score === null || score === undefined) return "#94a3b8";
  if (metric === "yallop") {
    return ["#7f1d1d", "#b42318", "#dc2626", "#f97316", "#eab308", "#2f9e44", "#087443"][score] || "#94a3b8";
  }
  return ["#7f1d1d", "#f97316", "#eab308", "#087443"][score] || "#94a3b8";
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

function nearestMapMinute(minute) {
  const minutes = state.data.map_minutes || state.data.minutes;
  return minutes.reduce((best, item) => Math.abs(item - minute) < Math.abs(best - minute) ? item : best, minutes[0]);
}

function mapRowsForUtc(dateText, minute) {
  const day = state.data.map_values[dateText];
  if (!day) return [];
  const mapMinute = nearestMapMinute(minute);
  const values = day[String(mapMinute)] || [];
  return values.map((value, index) => compactToRow(state.data.points[index], value, mapMinute));
}

function instantRows() {
  const loc = selectedLocation();
  const utc = localToUtcParts(state.date, state.minute, loc.utc_offset_hours);
  return mapRowsForUtc(utc.date, utc.minute);
}

function dayRows() {
  const loc = selectedLocation();
  const best = new Map();
  state.data.minutes.forEach((minute) => {
    const utc = localToUtcParts(state.date, minute, loc.utc_offset_hours);
    mapRowsForUtc(utc.date, utc.minute).forEach((row) => {
      const current = best.get(row.id);
      const value = metricValue(row);
      if (!current || value > metricValue(current)) {
        best.set(row.id, { ...row, best_minute: minute });
      }
    });
  });
  return [...best.values()];
}

function currentMapRows() {
  if (state.mapView === "day") return dayRows();
  const rows = instantRows();
  if (state.mapView !== "slice") return rows;
  const loc = selectedLocation();
  return rows.filter((row) => row.type !== "grid" || Math.abs(row.latitude - loc.latitude) <= 10 || Math.abs(row.longitude - loc.longitude) <= 15);
}

function setupControls() {
  const data = state.data;
  const locationSelect = el("locationSelect");
  const suggestions = el("locationSuggestions");
  data.locations.forEach((location) => {
    const option = document.createElement("option");
    option.value = location.name;
    option.textContent = location.name;
    locationSelect.appendChild(option);

    const suggestion = document.createElement("option");
    suggestion.value = location.name;
    suggestions.appendChild(suggestion);
  });

  data.points.filter((point) => point.type !== "grid").slice(0, 260).forEach((point) => {
    const suggestion = document.createElement("option");
    suggestion.value = point.name;
    suggestions.appendChild(suggestion);
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

  locationSelect.value = state.location;
  el("dateSelect").value = state.date;
  el("metricSelect").value = state.metric;
  el("timeSlider").min = "0";
  el("timeSlider").max = String(data.minutes.length - 1);
  syncTimeControls();

  locationSelect.addEventListener("change", (event) => {
    state.location = event.target.value;
    render();
  });
  el("locationSearch").addEventListener("change", applyLocationSearch);
  el("locationSearch").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      applyLocationSearch();
    }
  });
  el("dateSelect").addEventListener("change", (event) => {
    state.date = event.target.value;
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
  document.querySelectorAll(".info").forEach((button) => button.addEventListener("click", () => showInfo(button.dataset.info)));
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
  const today = now.toISOString().slice(0, 10);
  state.date = closestDate(today);
  state.minute = nearestMinute(now.getHours() * 60 + now.getMinutes());
  state.timezoneMode = "browser";
  el("timezoneSelect").value = "browser";
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
    state.location = location.name;
    el("locationSelect").value = state.location;
    el("locationSearchStatus").textContent = `Using ${location.name}`;
    render();
    return;
  }
  const point = state.data.points.find((item) => item.type !== "grid" && `${item.name} ${item.country} ${item.search}`.toLowerCase().includes(query));
  if (point) {
    const nearest = nearestLocation(point.latitude, point.longitude);
    state.location = nearest.name;
    el("locationSelect").value = state.location;
    el("locationSearchStatus").textContent = `${point.name} is a map calculation point; using nearest preset ${nearest.name} for charts.`;
    render();
    return;
  }
  el("locationSearchStatus").textContent = "No offline match. Use browser location for precise current location.";
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
  syncTimeControls();
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition((pos) => {
      const nearest = nearestLocation(pos.coords.latitude, pos.coords.longitude);
      state.location = nearest.name;
      el("locationSelect").value = state.location;
      el("locationSearchStatus").textContent = `Browser position matched to ${nearest.name}`;
      render();
    }, () => render(), { enableHighAccuracy: false, timeout: 6000 });
  } else {
    render();
  }
}

function nearestLocation(lat, lon) {
  return state.data.locations.reduce((best, item) => {
    const d = Math.hypot(item.latitude - lat, item.longitude - lon);
    const bd = Math.hypot(best.latitude - lat, best.longitude - lon);
    return d < bd ? item : best;
  }, state.data.locations[0]);
}

function showInfo(kind) {
  if (kind === "metric") {
    const metric = state.data.metrics[state.metric];
    alert(`${metric.label}\n\n${metric.status}\n\nOnly Yallop and Odeh are shown for now; exploratory and legacy metrics were removed until they can be implemented as real published models.`);
    return;
  }
  alert("Projection controls the flat map view. Plate Carree is rectangular lat/lon; Robinson is a compromise world map; Mollweide and Equal Earth are equal-area; Orthographic is globe-like and centered on the selected location.");
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

function definitionButton(term) {
  return `<button class="def" type="button" data-def="${term}" aria-label="${term} definition">?</button>`;
}

function renderCards(row) {
  el("bandCard").textContent = bandName(row);
  el("bandCard").style.color = colorFor(row);
  el("labelCard").textContent = `${state.data.metrics[state.metric].label}: ${metricLabel(row)} (${state.metric === "yallop" ? "q" : "V"} ${fmt(metricRawValue(row), 3)})`;
  el("birthCard").textContent = row.moon_birth_utc || "--";
  el("nextBirthCard").textContent = `Next birth: ${row.next_moon_birth_utc || "--"}`;
  el("setCard").textContent = `${displayTime(row.sunset_utc)} / ${displayTime(row.moonset_utc)}`;
  el("lagCard").textContent = `Moon lag: ${fmt(row.moon_lag_minutes, 1)} min`;
  el("gateCard").textContent = row.islamic_geometry_gate ? "Pass" : "Fail";
  el("gateCard").style.color = row.islamic_geometry_gate ? "var(--ok)" : "var(--bad)";
  el("gateDetailCard").textContent = `Born before sunset: ${row.moon_born_before_sunset ? "yes" : "no"}; moonset after sunset: ${row.moonset_after_sunset ? "yes" : "no"}`;
}

function renderDetails(row) {
  const loc = selectedLocation();
  const utc = localToUtcParts(state.date, state.minute, loc.utc_offset_hours);
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
    ["Moon lag", `${fmt(row.moon_lag_minutes, 1)} min`],
    ["Geometry gate", row.islamic_geometry_gate ? "Pass" : "Fail"],
  ];
  el("positionText").textContent = `${state.location}, ${state.date} ${state.data.minute_labels[String(state.minute)]} location time; map UTC ${utc.date} ${state.data.minute_labels[String(utc.minute)]}`;
  el("detailList").innerHTML = details.map(([key, value]) => `<dt>${key} ${DEFINITIONS[key] ? definitionButton(key) : ""}</dt><dd>${value}</dd>`).join("");
  document.querySelectorAll(".def").forEach((button) => button.addEventListener("click", () => alert(`${button.dataset.def}\n\n${DEFINITIONS[button.dataset.def]}`)));
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
  canvas.addEventListener("mousemove", (event) => {
    const nearest = nearestMapPoint(event);
    if (!nearest) {
      tooltip.hidden = true;
      return;
    }
    const p = nearest.point;
    tooltip.hidden = false;
    tooltip.style.left = `${Math.min(nearest.x + 16, canvas.clientWidth - 300)}px`;
    tooltip.style.top = `${Math.max(nearest.y + 16, 16)}px`;
    tooltip.innerHTML = `
      <strong>${p.name}</strong><br>
      ${p.type} point: ${fmt(p.latitude, 1)}, ${fmt(p.longitude, 1)}<br>
      ${state.data.metrics[state.metric].label}: ${bandName(p)}<br>
      ${state.metric === "yallop" ? "q" : "V"} ${fmt(metricRawValue(p), 3)}<br>
      Moon alt ${fmt(p.moon_altitude_deg, 1)} deg; Sun alt ${fmt(p.sun_altitude_deg, 1)} deg<br>
      ARCV ${fmt(p.moon_arc_of_vision_deg, 2)} deg; DAZ ${fmt(p.moon_relative_azimuth_deg, 2)} deg<br>
      W ${fmt(p.moon_crescent_width_arcmin, 3)} arcmin${state.mapView === "day" ? `<br>Best time ${state.data.minute_labels[String(p.best_minute)]}` : ""}
    `;
  });
  canvas.addEventListener("mouseleave", () => { tooltip.hidden = true; });
}

function chart(svg, rows, xLabels, valueFn = (row) => metricValue(row)) {
  const width = 760;
  const height = 320;
  const pad = { left: 48, right: 18, top: 18, bottom: 44 };
  const values = rows.map(valueFn).filter((v) => v !== null && v !== undefined);
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const x = (i) => pad.left + i * ((width - pad.left - pad.right) / Math.max(1, rows.length - 1));
  const y = (v) => height - pad.bottom - ((v - min) / Math.max(1, max - min)) * (height - pad.top - pad.bottom);
  const circles = rows.map((row, i) => `<circle cx="${x(i)}" cy="${y(valueFn(row) || 0)}" r="4" fill="${colorFor(row)}"><title>${xLabels[i]}: ${bandName(row)}</title></circle>`).join("");
  const labels = xLabels.map((label, i) => i % Math.ceil(xLabels.length / 8) === 0 ? `<text x="${x(i)}" y="${height - 18}" text-anchor="middle" font-size="11" fill="#596675">${label}</text>` : "").join("");
  svg.innerHTML = `
    <line x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}" stroke="#cbd5e1"/>
    <line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${height - pad.bottom}" stroke="#cbd5e1"/>
    ${circles}
    ${labels}
  `;
}

function renderCharts() {
  const timeRows = state.data.minutes.map((minute) => state.data.location_rows[state.location][state.date][String(minute)]);
  chart(el("timeChart"), timeRows, state.data.minutes.map((minute) => state.data.minute_labels[String(minute)]));

  const loc = selectedLocation();
  const instant = instantRows();
  const latRows = instant
    .filter((row) => row.type === "grid" && Math.abs(row.longitude - Math.round(loc.longitude / 30) * 30) <= 1)
    .sort((a, b) => a.latitude - b.latitude);
  const lonRows = instant
    .filter((row) => row.type === "grid" && Math.abs(row.latitude - Math.round(loc.latitude / 20) * 20) <= 1)
    .sort((a, b) => a.longitude - b.longitude);
  chart(el("latChart"), latRows, latRows.map((row) => fmt(row.latitude, 0)));
  chart(el("lonChart"), lonRows, lonRows.map((row) => fmt(row.longitude, 0)));
}

function renderCalendar() {
  const rows = state.data.dates.map((date) => {
    const best = state.data.minutes
      .map((minute) => state.data.location_rows[state.location][date][String(minute)])
      .sort((a, b) => metricValue(b) - metricValue(a))[0];
    return { date, row: best };
  });
  const first = new Date(`${state.data.dates[0]}T00:00:00Z`).getUTCDay();
  const blanks = Array.from({ length: first }, () => `<div class="calendar-day empty"></div>`).join("");
  el("calendarGrid").innerHTML = `
    ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => `<strong>${d}</strong>`).join("")}
    ${blanks}
    ${rows.map(({ date, row }) => `
      <button class="calendar-day ${date === state.date ? "selected" : ""}" type="button" data-date="${date}" style="background:${colorFor(row)}">
        <span>${Number(date.slice(-2))}</span>
        <small>${state.data.minute_labels[String(row.local_time ? Number(row.local_time.slice(0, 2)) * 60 + Number(row.local_time.slice(3, 5)) : state.minute)] || ""}</small>
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
    slice: "Selected Date + Time Lat/Lon Sweep",
  };
  const subtitles = {
    instant: "Country, city, and grid points at the selected instant.",
    day: "Each point shows its best visibility band across the selected local calendar date.",
    slice: "Grid points near the selected latitude and longitude are emphasized.",
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
