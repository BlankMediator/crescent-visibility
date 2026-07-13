const state = {
  data: null,
  location: null,
  date: null,
  minute: null,
  metric: "yallop",
  projection: "equirectangular",
  hoverPoint: null,
};

const el = (id) => document.getElementById(id);

function fmt(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  if (typeof value === "number") return value.toFixed(digits);
  return String(value);
}

function metricValue(row, metric) {
  if (!row) return null;
  if (metric === "composite") return row.composite;
  return row[`${metric}_score`];
}

function metricLabel(row, metric) {
  if (!row) return "--";
  if (metric === "composite") {
    const score = row.composite / 25;
    if (score < 0.75) return "Not visible";
    if (score < 1.5) return "Marginal";
    if (score < 2.5) return "Possible";
    return "Visible";
  }
  if (row[`${metric}_label`]) return row[`${metric}_label`];
  const score = row[`${metric}_score`];
  if (metric === "yallop") {
    return ["G: Not visible", "F: Only photographic", "E: Not visible with telescope", "D: Will need optical aid", "C: May need optical aid", "B: Visible under perfect conditions", "A: Easily visible"][score] || "--";
  }
  if (metric === "odeh") {
    return ["D: Not visible", "C: Visible only with optical aid", "B: Visible by optical aid, may be naked-eye", "A: Easily visible by naked eye"][score] || "--";
  }
  if (score === 2) return "Legacy heuristic: Visible";
  if (score === 1) return "Legacy heuristic: Marginal";
  if (score === 0) return "Legacy heuristic: Not Visible";
  return "--";
}

function selectedRow() {
  return state.data.location_rows[state.location][state.date][String(state.minute)];
}

function selectedGrid() {
  return state.data.map_grids[state.date][String(state.minute)];
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

  const dateSelect = el("dateSelect");
  data.dates.forEach((date) => {
    const option = document.createElement("option");
    option.value = date;
    option.textContent = date;
    dateSelect.appendChild(option);
  });

  const metricSelect = el("metricSelect");
  Object.entries(data.metrics).forEach(([key, metric]) => {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = metric.label;
    metricSelect.appendChild(option);
  });

  state.location = data.locations[0].name;
  state.date = data.dates[2] || data.dates[0];
  state.minute = data.minutes[2] || data.minutes[0];

  locationSelect.value = state.location;
  dateSelect.value = state.date;
  metricSelect.value = state.metric;
  el("timeSlider").min = "0";
  el("timeSlider").max = String(data.minutes.length - 1);
  el("timeSlider").value = String(data.minutes.indexOf(state.minute));

  locationSelect.addEventListener("change", (event) => {
    state.location = event.target.value;
    render();
  });
  dateSelect.addEventListener("change", (event) => {
    state.date = event.target.value;
    render();
  });
  metricSelect.addEventListener("change", (event) => {
    state.metric = event.target.value;
    render();
  });
  el("projectionSelect").addEventListener("change", (event) => {
    state.projection = event.target.value;
    render();
  });
  el("timeSlider").addEventListener("input", (event) => {
    state.minute = data.minutes[Number(event.target.value)];
    render();
  });
  el("currentButton").addEventListener("click", useCurrent);
  document.querySelectorAll(".info").forEach((button) => {
    button.addEventListener("click", () => showInfo(button.dataset.info));
  });
}

function useCurrent() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const closestDate = state.data.dates.reduce((best, item) => {
    return Math.abs(Date.parse(item) - Date.parse(today)) < Math.abs(Date.parse(best) - Date.parse(today)) ? item : best;
  }, state.data.dates[0]);
  const minuteOfDay = now.getHours() * 60 + now.getMinutes();
  const closestMinute = state.data.minutes.reduce((best, item) => {
    return Math.abs(item - minuteOfDay) < Math.abs(best - minuteOfDay) ? item : best;
  }, state.data.minutes[0]);
  state.date = closestDate;
  state.minute = closestMinute;
  el("dateSelect").value = state.date;
  el("timeSlider").value = String(state.data.minutes.indexOf(state.minute));

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition((pos) => {
      const nearest = nearestLocation(pos.coords.latitude, pos.coords.longitude);
      state.location = nearest.name;
      el("locationSelect").value = state.location;
      render();
    }, render, { enableHighAccuracy: false, timeout: 5000 });
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
    alert(`${metric.label}\n\n${metric.status}`);
    return;
  }
  alert("Projection controls how the curved Earth is drawn on the flat map. Plate Carree preserves latitude/longitude as a rectangle; Orthographic gives a globe-like view centered on the selected location.");
}

function renderCards(row) {
  const value = metricValue(row, state.metric);
  const metric = state.data.metrics[state.metric];
  el("scoreCard").textContent = state.metric === "composite" ? fmt(value, 1) : fmt(value, 2);
  el("labelCard").textContent = `${metric.label}: ${metricLabel(row, state.metric)}`;
  el("birthCard").textContent = row.moon_birth_utc || "--";
  el("nextBirthCard").textContent = `Next birth: ${row.next_moon_birth_utc || "--"}`;
  el("setCard").textContent = `${row.sunset_utc || "--"} / ${row.moonset_utc || "--"}`;
  el("lagCard").textContent = `Moon lag: ${fmt(row.moon_lag_minutes, 1)} min`;
  el("gateCard").textContent = row.islamic_geometry_gate ? "Pass" : "Fail";
  el("gateCard").style.color = row.islamic_geometry_gate ? "var(--ok)" : "var(--bad)";
  el("gateDetailCard").textContent = `Born before sunset: ${row.moon_born_before_sunset ? "yes" : "no"}; moonset after sunset: ${row.moonset_after_sunset ? "yes" : "no"}`;
}

function renderDetails(row) {
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
  ];
  el("positionText").textContent = `${state.location}, ${state.date} ${state.data.minute_labels[String(state.minute)]} local`;
  el("detailList").innerHTML = details.map(([key, value]) => `<dt>${key}</dt><dd>${value}</dd>`).join("");
}

function lonLatToXY(lon, lat, width, height) {
  if (state.projection === "orthographic") {
    const location = state.data.locations.find((item) => item.name === state.location);
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
  return [(lon + 180) / 360 * width, (90 - lat) / 180 * height];
}

function drawGeometry(ctx, geometry, width, height) {
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  polys.forEach((poly) => {
    poly.forEach((ring) => {
      let started = false;
      ctx.beginPath();
      ring.forEach(([lon, lat]) => {
        const xy = lonLatToXY(lon, lat, width, height);
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

function colorFor(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "#94a3b8";
  if (state.metric === "composite") {
    if (value >= 62.5) return "#087443";
    if (value >= 37.5) return "#d97706";
    if (value >= 18.75) return "#f59e0b";
    return "#b42318";
  }
  if (value >= 4) return "#087443";
  if (value >= 2) return "#d97706";
  if (value >= 1) return "#f59e0b";
  return "#b42318";
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
  ctx.lineWidth = 0.7;
  state.data.countries.features.forEach((feature) => drawGeometry(ctx, feature.geometry, width, height));

  selectedGrid().forEach((point) => {
    const xy = lonLatToXY(point.longitude, point.latitude, width, height);
    if (!xy) return;
    ctx.beginPath();
    ctx.fillStyle = colorFor(metricValue(point, state.metric));
    ctx.arc(xy[0], xy[1], 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1;
    ctx.stroke();
  });

  const row = selectedRow();
  const marker = lonLatToXY(row.longitude, row.latitude, width, height);
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
  selectedGrid().forEach((point) => {
    const xy = lonLatToXY(point.longitude, point.latitude, canvas.width, canvas.height);
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
    tooltip.style.left = `${Math.min(nearest.x + 16, canvas.clientWidth - 280)}px`;
    tooltip.style.top = `${Math.max(nearest.y + 16, 16)}px`;
    tooltip.innerHTML = `
      <strong>${fmt(p.latitude, 1)}, ${fmt(p.longitude, 1)}</strong><br>
      ${state.data.metrics[state.metric].label}: ${fmt(metricValue(p, state.metric), 2)}<br>
      ${metricLabel(p, state.metric)}<br>
      Moon alt ${fmt(p.moon_altitude_deg, 1)} deg; Sun alt ${fmt(p.sun_altitude_deg, 1)} deg<br>
      ARCV ${fmt(p.moon_arc_of_vision_deg, 2)} deg; W ${fmt(p.moon_crescent_width_arcmin, 3)} arcmin<br>
      Yallop q ${fmt(p.yallop_q, 3)}; Odeh V ${fmt(p.odeh_v, 3)}
    `;
  });
  canvas.addEventListener("mouseleave", () => { tooltip.hidden = true; });
}

function chart(svg, rows, xLabels) {
  const width = 720;
  const height = 320;
  const pad = { left: 54, right: 20, top: 18, bottom: 46 };
  const values = rows.map((row) => metricValue(row, state.metric)).filter((v) => v !== null && v !== undefined);
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const x = (i) => pad.left + i * ((width - pad.left - pad.right) / Math.max(1, rows.length - 1));
  const y = (v) => height - pad.bottom - ((v - min) / Math.max(1, max - min)) * (height - pad.top - pad.bottom);
  const path = rows.map((row, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(metricValue(row, state.metric) || 0)}`).join(" ");
  const circles = rows.map((row, i) => `<circle cx="${x(i)}" cy="${y(metricValue(row, state.metric) || 0)}" r="4" fill="${colorFor(metricValue(row, state.metric))}"><title>${xLabels[i]}: ${fmt(metricValue(row, state.metric), 2)} ${metricLabel(row, state.metric)}</title></circle>`).join("");
  const labels = xLabels.map((label, i) => `<text x="${x(i)}" y="${height - 18}" text-anchor="middle" font-size="11" fill="#596675">${label}</text>`).join("");
  svg.innerHTML = `
    <line x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}" stroke="#cbd5e1"/>
    <line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${height - pad.bottom}" stroke="#cbd5e1"/>
    <text x="10" y="${pad.top + 8}" font-size="11" fill="#596675">${fmt(max, 1)}</text>
    <text x="10" y="${height - pad.bottom}" font-size="11" fill="#596675">${fmt(min, 1)}</text>
    <path d="${path}" fill="none" stroke="#0f766e" stroke-width="3"/>
    ${circles}
    ${labels}
  `;
}

function renderCharts() {
  const timeRows = state.data.minutes.map((minute) => state.data.location_rows[state.location][state.date][String(minute)]);
  chart(el("timeChart"), timeRows, state.data.minutes.map((minute) => state.data.minute_labels[String(minute)]));

  const dateRows = state.data.dates.map((date) => state.data.location_rows[state.location][date][String(state.minute)]);
  chart(el("dateChart"), dateRows, state.data.dates.map((date) => date.slice(5)));
}

function renderModelStatus() {
  el("modelStatus").innerHTML = Object.entries(state.data.metrics).map(([key, metric]) => {
    return `<article><strong>${metric.label}</strong><span>${metric.status}</span></article>`;
  }).join("");
}

function render() {
  el("timeLabel").textContent = state.data.minute_labels[String(state.minute)];
  renderCards(selectedRow());
  renderDetails(selectedRow());
  drawMap();
  renderCharts();
  renderModelStatus();
}

async function init() {
  const [dataResponse, docsResponse] = await Promise.all([
    fetch("data/site_data.json"),
    fetch("docs/CRESCENT_VISIBILITY.md"),
  ]);
  state.data = await dataResponse.json();
  el("docsText").textContent = await docsResponse.text();
  setupControls();
  attachMapTooltip();
  render();
}

init().catch((error) => {
  document.body.innerHTML = `<main><section class="panel"><h1>Unable to load static data</h1><p>${error}</p></section></main>`;
});
