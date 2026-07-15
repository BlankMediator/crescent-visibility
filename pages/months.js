const FIRST_STATUS = ["ok", "moonset_before_sunset", "before_conjunction", "no_event"];
const FIRST_BANDS = [
  { label: "F", full: "Below Danjon limit", color: "#ffffff" },
  { label: "E", full: "Not visible by conventional telescope", color: "#ff7f50" },
  { label: "D", full: "Only visible with binoculars or telescope", color: "#fff200" },
  { label: "C", full: "Visible after found with optical aid", color: "#78f06f" },
  { label: "B", full: "Visible under perfect atmospheric conditions", color: "#a7ff4f" },
  { label: "A", full: "Easily visible to the unaided eye", color: "#00f000" },
];
const MASKS = {
  moonset_before_sunset: { label: "Moonset before sunset", color: "#f00000" },
  before_conjunction: { label: "Before conjunction", color: "#9c1bb4" },
  no_event: { label: "No event", color: "#94a3b8" },
};

function el(id) {
  return document.getElementById(id);
}

function fmt(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return Number(value).toFixed(digits);
}

function nextDate(dateText) {
  const d = new Date(`${dateText}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function compact(point, values) {
  return {
    ...point,
    status: FIRST_STATUS[values[0]] || "no_event",
    score: values[1],
    q: values[2],
    moonAgeHours: values[10],
    bestUtc: values[11],
    sunsetUtc: values[12],
    moonsetUtc: values[13],
    moonBirthUtc: values[14],
    lagMinutes: values[15],
  };
}

function bandFor(row) {
  if (row.status !== "ok") return MASKS[row.status] || MASKS.no_event;
  return FIRST_BANDS[row.score] || FIRST_BANDS[0];
}

function summariseDate(data, date) {
  const rows = (data.first_visibility_values[date] || []).map((values, index) => compact(data.points[index], values));
  const grid = rows.filter((row) => row.type === "grid");
  const okRows = grid.filter((row) => row.status === "ok");
  const best = okRows.sort((a, b) => b.score - a.score || b.q - a.q)[0] || grid[0];
  const counts = new Map();
  grid.forEach((row) => {
    const key = row.status === "ok" ? FIRST_BANDS[row.score]?.label || "?" : row.status;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const nakedEye = okRows.some((row) => row.score >= 4);
  const instrument = okRows.some((row) => row.score >= 2);
  return {
    date,
    rows: grid,
    best,
    counts,
    nakedEye,
    instrument,
    commencement: nakedEye ? nextDate(date) : null,
    label: nakedEye ? "Likely naked-eye commencement" : instrument ? "Instrument-only visibility" : "No reliable sighting zone",
  };
}

function hijriAnchor(month) {
  if (month === "2026-07") return "Safar 1448 AH";
  return "Current payload month";
}

function renderSummaries(data, summaries) {
  const firstNaked = summaries.find((item) => item.nakedEye);
  const firstInstrument = summaries.find((item) => item.instrument);
  el("monthsSummary").innerHTML = [
    ["Payload", data.month],
    ["Hijri anchor", hijriAnchor(data.month)],
    ["First naked-eye night", firstNaked ? firstNaked.date : "--"],
    ["Modelled commencement", firstNaked ? firstNaked.commencement : "--"],
    ["First instrument zone", firstInstrument ? firstInstrument.date : "--"],
  ].map(([label, value]) => `<article><span>${label}</span><strong>${value}</strong></article>`).join("");
}

function renderCards(summaries) {
  const interesting = summaries.filter((item) => item.instrument || item.best?.status === "before_conjunction").slice(0, 8);
  el("sightingCards").innerHTML = interesting.map((item) => {
    const band = bandFor(item.best || {});
    const bar = [...item.counts.entries()].map(([key, count]) => {
      const color = FIRST_BANDS.find((entry) => entry.label === key)?.color || MASKS[key]?.color || "#94a3b8";
      const width = Math.max(2, count / Math.max(1, item.rows.length) * 100);
      return `<span style="width:${width}%; background:${color}" title="${key}: ${count}"></span>`;
    }).join("");
    return `
      <article class="sighting-card" style="border-color:${band.color}">
        <div>
          <strong>${item.date}</strong>
          <span>${item.label}</span>
        </div>
        <div class="stacked-band">${bar}</div>
        <dl>
          <dt>Best point</dt><dd>${item.best?.name || "--"}</dd>
          <dt>Best band</dt><dd>${band.label}: ${band.full || band.label}</dd>
          <dt>Best UTC</dt><dd>${item.best?.bestUtc || "--"}</dd>
          <dt>Moon age</dt><dd>${fmt(item.best?.moonAgeHours)} h</dd>
          <dt>Moon lag</dt><dd>${fmt(item.best?.lagMinutes)} min</dd>
        </dl>
      </article>
    `;
  }).join("");
}

function renderTable(summaries) {
  el("monthsTable").innerHTML = `
    <thead>
      <tr>
        <th>Gregorian evening</th>
        <th>Best band</th>
        <th>Best point</th>
        <th>Moon birth UTC</th>
        <th>Best time UTC</th>
        <th>Commencement if accepted</th>
      </tr>
    </thead>
    <tbody>
      ${summaries.map((item) => {
        const band = bandFor(item.best || {});
        return `
          <tr>
            <td>${item.date}</td>
            <td><span class="mini-swatch" style="background:${band.color}"></span>${band.label}: ${band.full || band.label}</td>
            <td>${item.best?.name || "--"}</td>
            <td>${item.best?.moonBirthUtc || "--"}</td>
            <td>${item.best?.bestUtc || "--"}</td>
            <td>${item.commencement || "--"}</td>
          </tr>
        `;
      }).join("")}
    </tbody>
  `;
}

async function init() {
  const response = await fetch("data/site_data.json");
  const data = await response.json();
  const summaries = data.dates.map((date) => summariseDate(data, date));
  renderSummaries(data, summaries);
  renderCards(summaries);
  renderTable(summaries);
}

init().catch((error) => {
  document.body.innerHTML = `<main><section class="panel"><h1>Unable to load month data</h1><p>${error}</p></section></main>`;
});
