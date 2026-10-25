// Canadian Apparel Import Pressure Monitor — client-side app.
// No backend: DuckDB-Wasm runs real SQL in the browser against the pipeline's own
// published Parquet files, fetched straight from GitHub. Profile state lives in the URL.

import * as duckdb from "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.28.0/+esm";

// raw.githubusercontent.com doesn't send CORS headers, so a browser fetch from a
// different origin (this GitHub Pages site) fails silently. jsDelivr's GitHub proxy
// serves the same repo files with Access-Control-Allow-Origin: * — verified live
// before using it here.
const REPO_RAW_BASE =
  "https://cdn.jsdelivr.net/gh/mallika-madhok/supplychain-healthcheck@master/data";

const CATEGORY_LABELS = { "61": "Knit apparel", "62": "Woven apparel", "64": "Footwear" };

const COUNTRIES = [
  { code: "bangladesh", label: "Bangladesh" },
  { code: "cambodia", label: "Cambodia" },
  { code: "china", label: "China" },
  { code: "india", label: "India" },
  { code: "indonesia", label: "Indonesia" },
  { code: "vietnam", label: "Vietnam" },
  { code: "other", label: "Other" },
];

const DEFAULT_SHARES = {
  china: 40, bangladesh: 20, vietnam: 15, cambodia: 10, india: 10, indonesia: 5, other: 0,
};

let conn = null;

function readProfileFromUrl() {
  const params = new URLSearchParams(location.search);
  const category = params.get("category") || "61";
  const shares = {};
  COUNTRIES.forEach((c) => {
    const v = params.get("s_" + c.code);
    shares[c.code] = v !== null ? Number(v) : DEFAULT_SHARES[c.code];
  });
  return { category, shares };
}

function writeProfileToUrl(profile) {
  const params = new URLSearchParams();
  params.set("category", profile.category);
  COUNTRIES.forEach((c) => params.set("s_" + c.code, String(profile.shares[c.code])));
  history.replaceState(null, "", "?" + params.toString());
}

function classifyZ(z) {
  if (z === null || z === undefined || isNaN(z)) return { label: "—", color: "var(--text-muted)" };
  if (z > 1) return { label: "High", color: "var(--status-critical)" };
  if (z > 0) return { label: "Elevated", color: "var(--status-warning)" };
  return { label: "Low", color: "var(--status-good)" };
}

function fmt(n, digits = 2) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return n.toFixed(digits);
}

async function registerParquet(conn, db, name) {
  const url = `${REPO_RAW_BASE}/${name}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${name}: ${res.status}`);
  const buf = await res.arrayBuffer();
  await db.registerFileBuffer(name, new Uint8Array(buf));
}

async function initDuckDB() {
  const bundles = duckdb.getJsDelivrBundles();
  const bundle = await duckdb.selectBundle(bundles);
  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" })
  );
  const worker = new Worker(workerUrl);
  const logger = new duckdb.ConsoleLogger();
  const db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(workerUrl);

  await registerParquet(null, db, "mart_freight_pressure.parquet");
  await registerParquet(null, db, "mart_currency_exposure.parquet");
  await registerParquet(null, db, "mart_origin_concentration.parquet");

  return db.connect();
}

async function runQuery(sql) {
  const result = await conn.query(sql);
  return result.toArray().map((r) => r.toJSON());
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function renderTable(elId, rows, limit = 15) {
  const el = document.getElementById(elId);
  const tail = rows.slice(-limit);
  if (tail.length === 0) {
    el.innerHTML = "<tr><td>No rows</td></tr>";
    return;
  }
  const cols = Object.keys(tail[0]);
  const head = "<tr>" + cols.map((c) => `<th>${c}</th>`).join("") + "</tr>";
  const body = tail
    .map((row) => "<tr>" + cols.map((c) => `<td>${formatCell(row[c])}</td>`).join("") + "</tr>")
    .join("");
  el.innerHTML = head + body;
}

function formatCell(v) {
  if (typeof v === "number") return Number.isInteger(v) ? v : v.toFixed(4);
  if (v && typeof v === "object" && "toString" in v) return v.toString();
  return String(v);
}

function baseLayout(extra) {
  const text = cssVar("--text-secondary");
  const grid = cssVar("--border");
  return Object.assign(
    {
      margin: { l: 44, r: 16, t: 10, b: 32 },
      paper_bgcolor: "transparent",
      plot_bgcolor: "transparent",
      font: { family: "IBM Plex Sans, sans-serif", color: text, size: 12 },
      xaxis: { gridcolor: grid, zeroline: false, showline: false },
      yaxis: { gridcolor: grid, zeroline: true, zerolinecolor: grid },
      legend: { orientation: "h", y: 1.18, x: 0, font: { size: 11 } },
      hovermode: "x unified",
    },
    extra || {}
  );
}
const plotConfig = { responsive: true, displayModeBar: false };

function statTile(label, value, z) {
  const c = classifyZ(z);
  const tile = document.createElement("div");
  tile.className = "stat";
  tile.innerHTML =
    `<div class="stat-label">${label}</div>` +
    `<div class="stat-value">${value}<span class="stat-tag" style="background:${c.color}">${c.label}</span></div>`;
  return tile;
}

function buildCountrySliders(container, profile, onChange) {
  container.innerHTML = "";
  COUNTRIES.forEach((c) => {
    const field = document.createElement("div");
    field.className = "field";
    const value = profile.shares[c.code];
    field.innerHTML =
      `<label>${c.label} <span class="field-value" id="val-${c.code}">${value}%</span></label>` +
      `<input type="range" min="0" max="100" step="1" value="${value}" id="slider-${c.code}">`;
    container.appendChild(field);
  });
  COUNTRIES.forEach((c) => {
    document.getElementById(`slider-${c.code}`).addEventListener("input", (e) => {
      profile.shares[c.code] = Number(e.target.value);
      document.getElementById(`val-${c.code}`).textContent = profile.shares[c.code] + "%";
      updateShareTotal(profile);
      onChange(profile);
    });
  });
}

function updateShareTotal(profile) {
  const total = COUNTRIES.reduce((sum, c) => sum + profile.shares[c.code], 0);
  const el = document.getElementById("share-total");
  el.textContent = `Total: ${total}%` + (total !== 100 ? " — adjust so shares add to 100%" : "");
  el.className = "share-total" + (total !== 100 ? " warn" : "");
  return total;
}

function userHhi(profile) {
  const total = COUNTRIES.reduce((sum, c) => sum + profile.shares[c.code], 0) || 1;
  return COUNTRIES.reduce((sum, c) => {
    const frac = profile.shares[c.code] / total;
    return sum + frac * frac;
  }, 0);
}

async function main() {
  const loading = document.getElementById("loading");
  try {
    conn = await initDuckDB();
  } catch (err) {
    loading.textContent = "Could not load DuckDB-Wasm or fetch the pipeline data: " + err.message;
    return;
  }
  loading.style.display = "none";

  const freightSql = `select month, gscpi_value, gscpi_zscore from read_parquet('mart_freight_pressure.parquet') order by month`;
  const currencySql = `select date, usd_cad_rate, level_change_zscore, volatility_zscore from read_parquet('mart_currency_exposure.parquet') where level_change_zscore is not null order by date`;

  document.getElementById("sql-freight").textContent = freightSql;
  document.getElementById("sql-currency").textContent = currencySql;

  const freightRows = await runQuery(freightSql);
  const currencyRows = await runQuery(currencySql);

  renderTable("table-freight", freightRows);
  renderTable("table-currency", currencyRows);

  Plotly.newPlot(
    "chart-freight",
    [{
      x: freightRows.map((r) => r.month), y: freightRows.map((r) => r.gscpi_zscore),
      type: "scatter", mode: "lines",
      line: { color: cssVar("--series-1"), width: 2, shape: "spline", smoothing: 0.3 },
      hovertemplate: "%{x|%Y-%m}: %{y:.2f}σ<extra></extra>",
    }],
    baseLayout({ showlegend: false, yaxis: { gridcolor: cssVar("--border"), zeroline: true, zerolinecolor: cssVar("--border"), title: "z-score" } }),
    plotConfig
  );

  Plotly.newPlot(
    "chart-currency",
    [
      {
        x: currencyRows.map((r) => r.date), y: currencyRows.map((r) => r.level_change_zscore),
        type: "scatter", mode: "lines", name: "30d level change (z)",
        line: { color: cssVar("--series-1"), width: 1.6 },
        hovertemplate: "%{y:.2f}σ<extra></extra>",
      },
      {
        x: currencyRows.map((r) => r.date), y: currencyRows.map((r) => r.volatility_zscore),
        type: "scatter", mode: "lines", name: "90d volatility (z)",
        line: { color: cssVar("--series-2"), width: 1.6 },
        hovertemplate: "%{y:.2f}σ<extra></extra>",
      },
    ],
    baseLayout({ yaxis: { gridcolor: cssVar("--border"), zeroline: true, zerolinecolor: cssVar("--border"), title: "z-score" } }),
    plotConfig
  );

  const lastFreight = freightRows[freightRows.length - 1];
  const lastCurrency = currencyRows[currencyRows.length - 1];

  const profile = readProfileFromUrl();

  const categorySelect = document.getElementById("category-select");
  categorySelect.value = profile.category;
  buildCountrySliders(document.getElementById("country-sliders"), profile, () => {
    writeProfileToUrl(profile);
    renderResults(lastFreight, lastCurrency, profile);
  });
  updateShareTotal(profile);

  categorySelect.addEventListener("change", (e) => {
    profile.category = e.target.value;
    writeProfileToUrl(profile);
    renderOrigin(profile);
    renderResults(lastFreight, lastCurrency, profile);
  });

  writeProfileToUrl(profile);
  await renderOrigin(profile);
  renderResults(lastFreight, lastCurrency, profile);

  // tabs
  document.querySelectorAll("nav.tabs button").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("nav.tabs button").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll("section.view").forEach((v) => v.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("view-" + btn.dataset.tab).classList.add("active");
    });
  });
}

let originRowsCache = {};

async function renderOrigin(profile) {
  const sql = `select month, hs2_chapter, hs2_label, hhi, hhi_zscore from read_parquet('mart_origin_concentration.parquet') where hs2_chapter = '${profile.category}' order by month`;
  document.getElementById("sql-origin").textContent = sql;
  const rows = await runQuery(sql);
  originRowsCache[profile.category] = rows;
  renderTable("table-origin", rows);

  Plotly.newPlot(
    "chart-origin",
    [{
      x: rows.map((r) => r.month), y: rows.map((r) => r.hhi_zscore),
      type: "scatter", mode: "lines+markers",
      line: { color: cssVar("--series-3"), width: 2 },
      marker: { color: cssVar("--series-3"), size: 5 },
      hovertemplate: "%{y:.2f}σ<extra></extra>",
    }],
    baseLayout({ showlegend: false, yaxis: { gridcolor: cssVar("--border"), zeroline: true, zerolinecolor: cssVar("--border"), title: "HHI z-score" } }),
    plotConfig
  );
}

function renderResults(lastFreight, lastCurrency, profile) {
  const originRows = originRowsCache[profile.category] || [];
  const lastOrigin = originRows[originRows.length - 1];

  const freightZ = lastFreight.gscpi_zscore;
  const currencyZ = (lastCurrency.level_change_zscore + lastCurrency.volatility_zscore) / 2;
  const originZ = lastOrigin ? lastOrigin.hhi_zscore : null;
  const composite =
    originZ !== null ? (freightZ + currencyZ + originZ) / 3 : (freightZ + currencyZ) / 2;

  const statsEl = document.getElementById("stats");
  statsEl.innerHTML = "";
  statsEl.appendChild(statTile("Composite pressure", fmt(composite) + "σ", composite));
  statsEl.appendChild(statTile("Freight (" + lastFreight.month.slice(0, 7) + ")", fmt(freightZ) + "σ", freightZ));
  statsEl.appendChild(statTile("Currency (avg of 2 signals)", fmt(currencyZ) + "σ", currencyZ));
  statsEl.appendChild(
    statTile(
      "Origin — " + CATEGORY_LABELS[profile.category] + " (market)",
      fmt(originZ) + "σ",
      originZ
    )
  );

  const yourHhi = userHhi(profile);
  const marketHhi = lastOrigin ? lastOrigin.hhi : null;
  const hhiTile = statTile(
    "Your mix HHI vs. market",
    fmt(yourHhi, 3) + " / " + (marketHhi !== null ? fmt(marketHhi, 3) : "—"),
    null
  );
  statsEl.appendChild(hhiTile);

  const drivers = [
    { label: "Freight & delay", z: freightZ, desc: "NY Fed GSCPI vs. its own history." },
    { label: "Currency exposure", z: currencyZ, desc: "USD/CAD 30d change & 90d volatility, averaged." },
    { label: "Origin concentration", z: originZ, desc: CATEGORY_LABELS[profile.category] + " import mix HHI vs. its own history." },
  ].sort((a, b) => Math.abs(b.z === null ? 0 : b.z) - Math.abs(a.z === null ? 0 : a.z));

  const driverEl = document.getElementById("driver-cards");
  driverEl.innerHTML = "";
  drivers.forEach((d) => {
    const c = classifyZ(d.z);
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.justifyContent = "space-between";
    row.style.alignItems = "center";
    row.style.padding = "10px 0";
    row.style.borderBottom = "1px solid var(--border)";
    row.innerHTML =
      `<div><strong>${d.label}</strong><div style="font-size:0.8rem;color:var(--text-secondary)">${d.desc}</div></div>` +
      `<div class="stat-value" style="font-size:1.1rem">${fmt(d.z)}σ<span class="stat-tag" style="background:${c.color}">${c.label}</span></div>`;
    driverEl.appendChild(row);
  });
}

main();
