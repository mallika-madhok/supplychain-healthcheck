// Canadian Apparel Import Pressure Monitor — client-side app.
// No backend: DuckDB-Wasm runs real SQL in the browser against the pipeline's own
// published Parquet files. Profile state lives in the URL.

import * as duckdb from "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.28.0/+esm";

// Parquet files are published next to the page (docs/data/, copied there by the weekly
// pipeline), so the fetch is same-origin: no CORS issue and no CDN cache lag.
const DATA_BASE = "data";
const PARQUET_FILES = [
  "mart_freight_pressure",
  "mart_currency_exposure",
  "mart_origin_concentration",
  "mart_country_shares",
];

// Countries a visitor can allocate spend to (ISO2 codes, as CIMT reports them).
// Anything else is grouped as "Other" and treated as fully diversified.
const COUNTRIES = [
  { code: "CN", label: "China" },
  { code: "VN", label: "Vietnam" },
  { code: "BD", label: "Bangladesh" },
  { code: "IN", label: "India" },
  { code: "KH", label: "Cambodia" },
  { code: "ID", label: "Indonesia" },
  { code: "TR", label: "Türkiye" },
  { code: "PK", label: "Pakistan" },
  { code: "LK", label: "Sri Lanka" },
  { code: "IT", label: "Italy" },
  { code: "MX", label: "Mexico" },
  { code: "US", label: "United States" },
  { code: "OTHER", label: "Other" },
];
const NAMED_CODES = COUNTRIES.filter((c) => c.code !== "OTHER").map((c) => c.code);

const PRESETS = {
  typical: { CN: 35, BD: 20, VN: 15, KH: 10, IN: 10, OTHER: 10 },
  concentrated: { CN: 70, VN: 10, BD: 10, OTHER: 10 },
  diversified: { CN: 15, VN: 15, BD: 15, IN: 15, KH: 10, ID: 10, TR: 5, PK: 5, OTHER: 10 },
};

const DEFAULT_CATEGORY = "ch61";
const DEFAULT_USD = 80;

let conn = null;
let categories = [];
let baseline = null; // composite for the profile the visitor arrived with
let renderToken = 0;

// ---------- profile <-> URL ----------

function sharesFrom(preset) {
  const shares = {};
  COUNTRIES.forEach((c) => (shares[c.code] = preset[c.code] || 0));
  return shares;
}

function readProfileFromUrl() {
  const params = new URLSearchParams(location.search);
  const shares = sharesFrom(PRESETS.typical);
  if (COUNTRIES.some((c) => params.has("s_" + c.code))) {
    COUNTRIES.forEach((c) => (shares[c.code] = Number(params.get("s_" + c.code)) || 0));
  }
  return {
    category: params.get("category") || DEFAULT_CATEGORY,
    usd: params.has("usd") ? Number(params.get("usd")) : DEFAULT_USD,
    shares,
  };
}

function writeStateToUrl(profile, tab) {
  const params = new URLSearchParams();
  params.set("category", profile.category);
  params.set("usd", String(profile.usd));
  COUNTRIES.forEach((c) => {
    if (profile.shares[c.code]) params.set("s_" + c.code, String(profile.shares[c.code]));
  });
  if (tab && tab !== "results") params.set("tab", tab);
  history.replaceState(null, "", "?" + params.toString());
}

// ---------- small helpers ----------

function classifyZ(z) {
  if (z === null || z === undefined || isNaN(z)) return { label: "n/a", color: "var(--text-muted)" };
  if (z > 2) return { label: "High", color: "var(--status-critical)" };
  if (z > 1) return { label: "Elevated", color: "var(--status-warning)" };
  return { label: "Low", color: "var(--status-good)" };
}

function fmt(n, digits = 2) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return Number(n).toFixed(digits);
}

function fmtSigned(n, digits = 2) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(digits);
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function sqlStr(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

function cleanRow(r) {
  const out = {};
  for (const [k, v] of Object.entries(r)) {
    out[k] = typeof v === "bigint" ? Number(v) : v;
  }
  return out;
}

async function runQuery(sql) {
  const result = await conn.query(sql);
  return result.toArray().map((r) => cleanRow(r.toJSON()));
}

function show(sqlId, tableId, sql, rows, limit = 12) {
  document.getElementById(sqlId).textContent = sql.trim();
  const el = document.getElementById(tableId);
  const tail = rows.slice(-limit);
  if (tail.length === 0) {
    el.innerHTML = "<tr><td>No rows</td></tr>";
    return;
  }
  const cols = Object.keys(tail[0]);
  el.innerHTML =
    "<tr>" + cols.map((c) => `<th>${c}</th>`).join("") + "</tr>" +
    tail.map((row) => "<tr>" + cols.map((c) => `<td>${formatCell(row[c])}</td>`).join("") + "</tr>").join("");
}

function formatCell(v) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return Number.isInteger(v) ? v : v.toFixed(4);
  return String(v);
}

// ---------- charts ----------

const plotConfig = { responsive: true, displayModeBar: false };

function baseLayout(extra) {
  const grid = cssVar("--border");
  return Object.assign(
    {
      margin: { l: 48, r: 16, t: 10, b: 34 },
      paper_bgcolor: "transparent",
      plot_bgcolor: "transparent",
      font: { family: "IBM Plex Sans, sans-serif", color: cssVar("--text-secondary"), size: 12 },
      xaxis: { gridcolor: grid, zeroline: false, showline: false },
      yaxis: { gridcolor: grid, zeroline: true, zerolinecolor: grid },
      legend: { orientation: "h", y: 1.15, x: 0, font: { size: 11 } },
      hovermode: "x unified",
    },
    extra || {}
  );
}

function zAxis(title) {
  return { gridcolor: cssVar("--border"), zeroline: true, zerolinecolor: cssVar("--text-muted"), title };
}

// Horizontal reference lines at the Elevated / High thresholds.
function zBandShapes() {
  const c = cssVar("--text-muted");
  return [1, 2].map((y) => ({
    type: "line", xref: "paper", x0: 0, x1: 1, y0: y, y1: y,
    line: { color: c, width: 1, dash: "dot" },
  }));
}

function line(x, y, name, color, extra) {
  return Object.assign(
    { x, y, name, type: "scatter", mode: "lines", line: { color, width: 2 },
      hovertemplate: "%{y:.2f}<extra>" + name + "</extra>" },
    extra || {}
  );
}

function plot(id, traces, layout) {
  Plotly.newPlot(id, traces, layout, plotConfig);
}

function sparkline(id, x, y, color) {
  plot(
    id,
    [{ x, y, type: "scatter", mode: "lines", line: { color, width: 1.6 }, hoverinfo: "skip" }],
    {
      margin: { l: 0, r: 0, t: 2, b: 2 },
      paper_bgcolor: "transparent", plot_bgcolor: "transparent",
      xaxis: { visible: false }, yaxis: { visible: false, zeroline: false },
      showlegend: false,
      shapes: [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: 0, y1: 0, line: { color: cssVar("--border"), width: 1 } }],
    }
  );
}

// ---------- DuckDB ----------

async function initDuckDB() {
  const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" })
  );
  const worker = new Worker(workerUrl);
  const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(workerUrl);

  await Promise.all(
    PARQUET_FILES.map(async (name) => {
      const res = await fetch(`${DATA_BASE}/${name}.parquet`);
      if (!res.ok) throw new Error(`Failed to fetch ${name}.parquet: ${res.status}`);
      await db.registerFileBuffer(`${name}.parquet`, new Uint8Array(await res.arrayBuffer()));
    })
  );
  return db.connect();
}

// ---------- profile math ----------

function totalShare(profile) {
  return COUNTRIES.reduce((sum, c) => sum + profile.shares[c.code], 0);
}

// HHI of the visitor's named countries. "Other" is treated as spread across many
// suppliers, so it adds nothing to concentration.
function userHhi(profile) {
  const total = totalShare(profile);
  if (!total) return null;
  return NAMED_CODES.reduce((sum, code) => {
    const f = profile.shares[code] / total;
    return sum + f * f;
  }, 0);
}

function categoryLabel(code) {
  const c = categories.find((x) => x.category_code === code);
  return c ? c.category_label : code;
}

// ---------- queries ----------

const FREIGHT_SQL = `select strftime(month, '%Y-%m-%d') as month, gscpi_value, gscpi_zscore
from read_parquet('mart_freight_pressure.parquet')
order by month`;

const CURRENCY_SQL = `select strftime(date, '%Y-%m-%d') as date, usd_cad_rate, level_change_zscore, volatility_zscore
from read_parquet('mart_currency_exposure.parquet')
where level_change_zscore is not null and volatility_zscore is not null
order by date`;

function originSql(profile) {
  return `select strftime(month, '%Y-%m-%d') as month, category_label, country_count,
       hhi, hhi_zscore, hhi
from read_parquet('mart_origin_concentration.parquet')
where category_code = ${sqlStr(profile.category)}
order by month`;
}

function compositeSql(profile, hhi) {
  const usd = (profile.usd / 100).toFixed(2);
  return `-- Your profile: ${categoryLabel(profile.category)}, ${profile.usd}% USD-invoiced, mix HHI ${fmt(hhi, 3)}
with freight as (
  select date_trunc('month', month) as m, gscpi_zscore as freight_z
  from read_parquet('mart_freight_pressure.parquet')
),
currency as (
  select date_trunc('month', date) as m,
         avg((level_change_zscore + volatility_zscore) / 2) as currency_z
  from read_parquet('mart_currency_exposure.parquet')
  where level_change_zscore is not null and volatility_zscore is not null
  group by 1
),
benchmark as (  -- how concentrated Canadian apparel import sourcing is across product lines, last 12 months
  select avg(hhi) as hhi_mean, stddev_samp(hhi) as hhi_stdev
  from read_parquet('mart_origin_concentration.parquet')
  where category_level = 'heading'
    and month > (select max(month) from read_parquet('mart_origin_concentration.parquet')) - interval 12 month
),
origin as (  -- your mix's HHI vs. that benchmark
  select (${fmt(hhi, 6)} - hhi_mean) / hhi_stdev as origin_z from benchmark
)
select strftime(f.m, '%Y-%m') as month,
       f.freight_z,
       c.currency_z,
       c.currency_z * ${usd} as currency_exposed_z,
       o.origin_z,
       (f.freight_z + c.currency_z * ${usd} + coalesce(o.origin_z, 0)) / 3 as composite_z
from freight f
join currency c using (m)
cross join origin o
order by f.m`;
}

function mixSql(profile) {
  const named = NAMED_CODES.map(sqlStr).join(", ");
  return `-- Canada's imports of this category, latest 12 months of data, by country of origin
with latest as (
  select max(month) as last_month
  from read_parquet('mart_country_shares.parquet')
  where category_code = ${sqlStr(profile.category)}
),
totals as (
  select case when country in (${named}) then country else 'OTHER' end as country,
         sum(import_value_cad) as value
  from read_parquet('mart_country_shares.parquet'), latest
  where category_code = ${sqlStr(profile.category)}
    and month > last_month - interval 12 month
  group by 1
)
select country, round(100 * value / sum(value) over (), 1) as canada_share_pct
from totals
order by canada_share_pct desc`;
}

// ---------- rendering ----------

function statTile(label, value, z, note) {
  const c = classifyZ(z);
  const tag = z === undefined ? "" : `<span class="stat-tag" style="background:${c.color}">${c.label}</span>`;
  const tile = document.createElement("div");
  tile.className = "stat";
  tile.innerHTML =
    `<div class="stat-label">${label}</div>` +
    `<div class="stat-value">${value}${tag}</div>` +
    (note ? `<div class="stat-note">${note}</div>` : "");
  return tile;
}

function renderStaticCharts(freightRows, currencyRows) {
  const months = freightRows.map((r) => r.month);
  plot(
    "chart-freight",
    [line(months, freightRows.map((r) => r.gscpi_zscore), "GSCPI z-score", cssVar("--series-1"))],
    baseLayout({ showlegend: false, yaxis: zAxis("z-score"), shapes: zBandShapes() })
  );

  const dates = currencyRows.map((r) => r.date);
  plot(
    "chart-currency",
    [
      line(dates, currencyRows.map((r) => r.level_change_zscore), "30d level change (z)", cssVar("--series-1")),
      line(dates, currencyRows.map((r) => r.volatility_zscore), "90d volatility (z)", cssVar("--series-2")),
    ],
    baseLayout({ yaxis: zAxis("z-score"), shapes: zBandShapes() })
  );
  plot(
    "chart-rate",
    [line(dates, currencyRows.map((r) => r.usd_cad_rate), "CAD per USD", cssVar("--series-3"))],
    baseLayout({ showlegend: false, yaxis: { gridcolor: cssVar("--border"), title: "CAD per USD" } })
  );
}

async function renderOrigin(profile, hhi) {
  document.getElementById("origin-cat-name").textContent = categoryLabel(profile.category);

  const sql = originSql(profile);
  const rows = await runQuery(sql);
  show("sql-origin", "table-origin", sql, rows);

  const x = rows.map((r) => r.month);
  const traces = [line(x, rows.map((r) => r.hhi), "Canada's import mix", cssVar("--series-3"), {
    mode: "lines+markers", marker: { size: 4 },
    hovertemplate: "%{y:.3f}<extra>Canada</extra>",
  })];
  if (hhi !== null && x.length) {
    traces.push({
      x: [x[0], x[x.length - 1]], y: [hhi, hhi], name: "Your mix", type: "scatter", mode: "lines",
      line: { color: cssVar("--series-2"), width: 2, dash: "dash" },
      hovertemplate: "%{y:.3f}<extra>Your mix</extra>",
    });
  }
  plot("chart-origin", traces, baseLayout({ yaxis: { gridcolor: cssVar("--border"), title: "HHI" } }));

  const mixQuery = mixSql(profile);
  const mix = await runQuery(mixQuery);
  show("sql-mix", "table-mix", mixQuery, mix, 20);
  const canada = Object.fromEntries(mix.map((r) => [r.country, r.canada_share_pct]));
  const total = totalShare(profile) || 1;
  const labels = COUNTRIES.map((c) => c.label);
  plot(
    "chart-mix",
    [
      { x: labels, y: COUNTRIES.map((c) => (100 * profile.shares[c.code]) / total), type: "bar", name: "Your mix",
        marker: { color: cssVar("--series-2") }, hovertemplate: "%{y:.0f}%<extra>You</extra>" },
      { x: labels, y: COUNTRIES.map((c) => canada[c.code] || 0), type: "bar", name: "Canada's imports",
        marker: { color: cssVar("--series-3") }, hovertemplate: "%{y:.0f}%<extra>Canada</extra>" },
    ],
    baseLayout({ barmode: "group", yaxis: { gridcolor: cssVar("--border"), title: "% of total" }, margin: { l: 48, r: 16, t: 10, b: 70 } })
  );
  return rows;
}

function summaryText(profile, comp, drivers, hhi, marketHhi) {
  const band = classifyZ(comp).label.toLowerCase();
  const top = drivers[0];
  const dir = top.z > 0 ? "above" : "below";
  const parts = [
    `Overall pressure on your ${categoryLabel(profile.category).toLowerCase()} sourcing is <strong>${band}</strong> (${fmtSigned(comp)}σ).`,
    `The biggest driver is <strong>${top.label.toLowerCase()}</strong>, at ${fmt(Math.abs(top.z))} standard deviations ${dir} its historical norm.`,
  ];
  if (hhi !== null && marketHhi !== null) {
    const rel = hhi > marketHhi ? "more" : "less";
    parts.push(
      `Your country mix is ${rel} concentrated than Canada's overall imports of this category (HHI ${fmt(hhi, 2)} vs ${fmt(marketHhi, 2)}).`
    );
  }
  return parts.join(" ");
}

async function renderResults(profile) {
  const token = ++renderToken;
  const hhi = userHhi(profile);
  const sql = compositeSql(profile, hhi ?? 0);
  const [rows, originRows] = await Promise.all([runQuery(sql), runQuery(originSql(profile))]);
  if (token !== renderToken) return; // a newer slider move superseded this render

  show("sql-composite", "table-composite", sql, rows);

  const last = rows[rows.length - 1];
  const prev = rows[rows.length - 2];
  const lastOrigin = originRows[originRows.length - 1];
  const marketHhi = lastOrigin ? lastOrigin.hhi : null;

  if (baseline === null) baseline = last.composite_z;
  const vsStart = last.composite_z - baseline;

  // Hero
  const band = classifyZ(last.composite_z);
  const hero = document.getElementById("hero");
  const originZ = last.origin_z;
  const drivers = [
    { key: "freight", label: "Freight & delay", z: last.freight_z, tab: "freight", color: "--series-1",
      desc: "NY Fed Global Supply Chain Pressure Index vs. its own history.", series: rows.map((r) => r.freight_z) },
    { key: "currency", label: "Currency exposure", z: last.currency_exposed_z, tab: "currency", color: "--series-2",
      desc: `USD/CAD 30-day change and 90-day volatility, scaled to your ${profile.usd}% USD exposure.`,
      series: rows.map((r) => r.currency_exposed_z) },
    { key: "origin", label: "Origin concentration", z: originZ, tab: "origin", color: "--series-3",
      desc: "How concentrated your country mix is vs. typical sourcing concentration across Canadian apparel product lines.",
      series: originRows.map((r) => r.hhi_zscore), seriesX: originRows.map((r) => r.month) },
  ].sort((a, b) => Math.abs(b.z ?? 0) - Math.abs(a.z ?? 0));

  hero.innerHTML =
    `<div class="hero-main">` +
    `<div><div class="stat-label">Composite pressure — ${last.month}</div>` +
    `<div class="hero-score" style="color:${band.color}">${fmtSigned(last.composite_z)}<span class="hero-unit">σ</span>` +
    `<span class="stat-tag" style="background:${band.color}">${band.label}</span></div>` +
    `<div class="hero-deltas">` +
    (prev ? `<span>${fmtSigned(last.composite_z - prev.composite_z)} vs. last month</span>` : "") +
    `<span>${fmtSigned(vsStart)} vs. the profile you started with</span></div></div>` +
    `<p class="hero-summary">${summaryText(profile, last.composite_z, drivers, hhi, marketHhi)}</p>` +
    `</div>`;

  // Tiles
  const statsEl = document.getElementById("stats");
  statsEl.innerHTML = "";
  statsEl.appendChild(statTile("Freight & delay", fmtSigned(last.freight_z) + "σ", last.freight_z, "Global, same for everyone"));
  statsEl.appendChild(statTile("Currency (scaled to USD share)", fmtSigned(last.currency_exposed_z) + "σ", last.currency_exposed_z, `${fmtSigned(last.currency_z)}σ before scaling`));
  statsEl.appendChild(statTile("Origin concentration", originZ === null ? "—" : fmtSigned(originZ) + "σ", originZ, "Your mix vs. typical product line"));
  statsEl.appendChild(
    statTile(`Your mix HHI vs. Canada (${categoryLabel(profile.category)})`, `${fmt(hhi, 2)} / ${fmt(marketHhi, 2)}`, undefined, "Lower = more diversified")
  );

  // Composite history chart
  const x = rows.map((r) => r.month);
  plot(
    "chart-composite",
    [
      line(x, rows.map((r) => r.composite_z), "Composite", cssVar("--text-primary"), { line: { color: cssVar("--text-primary"), width: 2.4 } }),
      line(x, rows.map((r) => r.freight_z), "Freight", cssVar("--series-1"), { line: { color: cssVar("--series-1"), width: 1.2 }, opacity: 0.7 }),
      line(x, rows.map((r) => r.currency_exposed_z), "Currency (scaled)", cssVar("--series-2"), { line: { color: cssVar("--series-2"), width: 1.2 }, opacity: 0.7 }),
    ],
    baseLayout({ yaxis: zAxis("z-score"), shapes: zBandShapes() })
  );

  // Driver cards
  const driverEl = document.getElementById("driver-cards");
  driverEl.innerHTML = "";
  drivers.forEach((d, i) => {
    const c = classifyZ(d.z);
    const row = document.createElement("div");
    row.className = "driver";
    row.innerHTML =
      `<div class="driver-rank">${i + 1}</div>` +
      `<div class="driver-text"><strong>${d.label}</strong><div class="driver-desc">${d.desc}</div>` +
      `<a href="#" data-goto="${d.tab}">See ${d.label.toLowerCase()} detail &rarr;</a></div>` +
      `<div class="driver-spark" id="spark-${d.key}"></div>` +
      `<div class="stat-value driver-value">${fmtSigned(d.z)}σ<span class="stat-tag" style="background:${c.color}">${c.label}</span></div>`;
    driverEl.appendChild(row);
    const ys = d.series.slice(-60);
    const xs = (d.seriesX || x).slice(-60);
    sparkline(`spark-${d.key}`, xs, ys, cssVar(d.color));
  });
  driverEl.querySelectorAll("a[data-goto]").forEach((a) =>
    a.addEventListener("click", (e) => {
      e.preventDefault();
      switchTab(a.dataset.goto);
    })
  );

  await renderOrigin(profile, hhi);
}

// ---------- profile controls ----------

function updateShareTotal(profile) {
  const total = totalShare(profile);
  const el = document.getElementById("share-total");
  el.textContent = `Total: ${total}%` + (total !== 100 ? " — shares are rescaled to 100% for the calculation" : "");
  el.className = "share-total" + (total !== 100 ? " warn" : "");
}

function buildCountrySliders(profile, onChange) {
  const container = document.getElementById("country-sliders");
  container.innerHTML = "";
  COUNTRIES.forEach((c) => {
    const field = document.createElement("div");
    field.className = "field";
    field.innerHTML =
      `<label for="slider-${c.code}">${c.label} <span class="field-value" id="val-${c.code}"></span></label>` +
      `<input type="range" min="0" max="100" step="1" id="slider-${c.code}">`;
    container.appendChild(field);
    const input = field.querySelector("input");
    input.addEventListener("input", () => {
      profile.shares[c.code] = Number(input.value);
      syncControls(profile);
      onChange();
    });
  });
}

function syncControls(profile) {
  COUNTRIES.forEach((c) => {
    document.getElementById(`slider-${c.code}`).value = profile.shares[c.code];
    document.getElementById(`val-${c.code}`).textContent = profile.shares[c.code] + "%";
  });
  document.getElementById("slider-usd").value = profile.usd;
  document.getElementById("val-usd").textContent = profile.usd + "%";
  document.getElementById("category-select").value = profile.category;
  updateShareTotal(profile);
}

function buildCategorySelect() {
  const groups = [
    { prefix: ["61"], label: "Knit apparel" },
    { prefix: ["62"], label: "Woven apparel" },
    { prefix: ["64"], label: "Footwear" },
    { prefix: ["42", "65"], label: "Accessories" },
  ];
  const select = document.getElementById("category-select");
  select.innerHTML = "";
  groups.forEach((g) => {
    const members = categories.filter((c) => {
      const chapter = c.category_code.startsWith("ch") ? c.category_code.slice(2) : c.category_code.slice(0, 2);
      return g.prefix.includes(chapter) && c.category_code !== "ch42";
    });
    if (!members.length) return;
    const og = document.createElement("optgroup");
    og.label = g.label;
    members
      .sort((a, b) => (a.category_level === b.category_level ? a.category_code.localeCompare(b.category_code) : a.category_level === "chapter" ? -1 : 1))
      .forEach((m) => {
        const opt = document.createElement("option");
        opt.value = m.category_code;
        opt.textContent = m.category_label;
        og.appendChild(opt);
      });
    select.appendChild(og);
  });
}

// ---------- tabs ----------

let currentTab = "results";
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll("nav.tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll("section.view").forEach((v) => v.classList.toggle("active", v.id === "view-" + tab));
  // Charts drawn while their tab was hidden have no width; resize once visible.
  document.querySelectorAll(`#view-${tab} .chart`).forEach((el) => {
    if (el.data) Plotly.Plots.resize(el);
  });
  document.querySelectorAll(`#view-${tab} .driver-spark`).forEach((el) => {
    if (el.data) Plotly.Plots.resize(el);
  });
  writeStateToUrl(window.__profile, tab);
  window.scrollTo({ top: 0 });
}

// ---------- main ----------

async function main() {
  const loading = document.getElementById("loading");
  try {
    conn = await initDuckDB();
  } catch (err) {
    loading.textContent = "Could not load DuckDB-Wasm or fetch the pipeline data: " + err.message;
    return;
  }
  loading.style.display = "none";

  categories = await runQuery(`select distinct category_code, category_label, category_level
    from read_parquet('mart_origin_concentration.parquet')`);
  buildCategorySelect();

  const profile = readProfileFromUrl();
  if (!categories.some((c) => c.category_code === profile.category)) profile.category = DEFAULT_CATEGORY;
  window.__profile = profile;

  const refresh = () => {
    writeStateToUrl(profile, currentTab);
    return renderResults(profile);
  };

  buildCountrySliders(profile, refresh);
  syncControls(profile);

  document.getElementById("slider-usd").addEventListener("input", (e) => {
    profile.usd = Number(e.target.value);
    syncControls(profile);
    refresh();
  });
  document.getElementById("category-select").addEventListener("change", (e) => {
    profile.category = e.target.value;
    refresh();
  });
  document.querySelectorAll("[data-preset]").forEach((btn) =>
    btn.addEventListener("click", () => {
      profile.shares = sharesFrom(PRESETS[btn.dataset.preset]);
      syncControls(profile);
      refresh();
    })
  );

  // Static (profile-independent) series
  const [freightRows, currencyRows] = await Promise.all([runQuery(FREIGHT_SQL), runQuery(CURRENCY_SQL)]);
  document.getElementById("sql-freight").textContent = FREIGHT_SQL;
  document.getElementById("sql-currency").textContent = CURRENCY_SQL;
  show("sql-freight", "table-freight", FREIGHT_SQL, freightRows);
  show("sql-currency", "table-currency", CURRENCY_SQL, currencyRows);
  renderStaticCharts(freightRows, currencyRows);

  const through = freightRows[freightRows.length - 1].month.slice(0, 7);
  document.getElementById("data-through").textContent =
    `Freight data through ${through}; FX through ${currencyRows[currencyRows.length - 1].date}.`;

  document.querySelectorAll("nav.tabs button").forEach((btn) =>
    btn.addEventListener("click", () => switchTab(btn.dataset.tab))
  );

  await renderResults(profile);
  const initialTab = new URLSearchParams(location.search).get("tab");
  if (initialTab && document.getElementById("view-" + initialTab)) switchTab(initialTab);
}

main();
