// Canadian Apparel Import Pressure Monitor — client-side app.
// No backend: DuckDB-Wasm runs real SQL in the browser against the pipeline's own
// published Parquet files. The visitor's profile lives in the URL.

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
const COUNTRY_NAME = Object.fromEntries(COUNTRIES.map((c) => [c.code, c.label]));

const PRESETS = {
  typical: { CN: 35, BD: 20, VN: 15, KH: 10, IN: 10, OTHER: 10 },
  concentrated: { CN: 70, VN: 10, BD: 10, OTHER: 10 },
  diversified: { CN: 15, VN: 15, BD: 15, IN: 15, KH: 10, ID: 10, TR: 5, PK: 5, OTHER: 10 },
};

const DEFAULT_CATEGORY = "ch61";
const DEFAULT_USD = 80;
const DEFAULT_BUDGET = 30000;

let conn = null;
let categories = [];
let renderToken = 0;
let refreshFn = () => {};
let visibleCountries = new Set();

// Show sliders only for countries the visitor buys from (plus "Other").
function resetVisible(profile) {
  visibleCountries = new Set(COUNTRIES.filter((c) => c.code === "OTHER" || profile.shares[c.code] > 0).map((c) => c.code));
}

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
    budget: params.has("budget") ? Number(params.get("budget")) || 0 : DEFAULT_BUDGET,
    shares,
  };
}

function writeStateToUrl(profile, tab) {
  const params = new URLSearchParams();
  params.set("category", profile.category);
  params.set("usd", String(profile.usd));
  params.set("budget", String(profile.budget));
  COUNTRIES.forEach((c) => {
    if (profile.shares[c.code]) params.set("s_" + c.code, String(profile.shares[c.code]));
  });
  if (tab && tab !== "results") params.set("tab", tab);
  history.replaceState(null, "", "?" + params.toString());
}

// ---------- small helpers ----------

function classifyZ(z) {
  if (z === null || z === undefined || isNaN(z)) return { label: "n/a", color: "var(--text-muted)" };
  if (z > 2) return { label: "Much worse than usual", phrase: "much worse than usual", color: "var(--status-critical)" };
  if (z > 1) return { label: "Worse than usual", phrase: "worse than usual", color: "var(--status-warning)" };
  return { label: "Normal", phrase: "normal", color: "var(--status-good)" };
}

function fmt(n, digits = 2) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return Number(n).toFixed(digits);
}

function fmtSigned(n, digits = 2) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(digits);
}

function money(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return (n < 0 ? "−" : "") + "$" + Math.round(Math.abs(n)).toLocaleString("en-CA");
}

function monthName(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-CA", { month: "long", year: "numeric" });
}

function pctText(frac, digits = 1) {
  return (Math.abs(frac) * 100).toFixed(digits) + "%";
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function sqlStr(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

function cleanRow(r) {
  const out = {};
  for (const [k, v] of Object.entries(r)) out[k] = typeof v === "bigint" ? Number(v) : v;
  return out;
}

async function runQuery(sql) {
  const result = await conn.query(sql);
  return result.toArray().map((r) => cleanRow(r.toJSON()));
}

function formatCell(v) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return Number.isInteger(v) ? v : v.toFixed(4);
  return String(v);
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

// ---------- charts ----------

const plotConfig = { responsive: true, displayModeBar: false };
const FONT = "Segoe UI, Open Sans, system-ui, sans-serif";

function baseLayout(extra) {
  const grid = cssVar("--border");
  return Object.assign(
    {
      margin: { l: 48, r: 16, t: 10, b: 34 },
      paper_bgcolor: "transparent",
      plot_bgcolor: "transparent",
      font: { family: FONT, color: cssVar("--text-secondary"), size: 12 },
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

// Background bands matching the status labels: Normal (below 1), Worse (1 to 2), Much worse (above 2).
function zoneShapes() {
  return [
    { lo: -20, hi: 1, color: "--status-good", opacity: 0.08 },
    { lo: 1, hi: 2, color: "--status-warning", opacity: 0.16 },
    { lo: 2, hi: 20, color: "--status-critical", opacity: 0.1 },
  ].map((z) => ({
    type: "rect", xref: "paper", x0: 0, x1: 1, y0: z.lo, y1: z.hi, layer: "below",
    fillcolor: cssVar(z.color), opacity: z.opacity, line: { width: 0 },
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
function hhiOf(shares) {
  const total = COUNTRIES.reduce((sum, c) => sum + (shares[c.code] || 0), 0);
  if (!total) return null;
  return NAMED_CODES.reduce((sum, code) => {
    const f = (shares[code] || 0) / total;
    return sum + f * f;
  }, 0);
}

function userHhi(profile) {
  return hhiOf(profile.shares);
}

function categoryLabel(code) {
  const c = categories.find((x) => x.category_code === code);
  return c ? c.category_label : code;
}

// Pick the move that most simply cuts concentration: shift some share from the biggest
// supplier to the largest Canadian import source the visitor leans on least.
function suggestShift(profile, canadaPct) {
  const total = totalShare(profile);
  if (!total) return null;
  const pct = {};
  COUNTRIES.forEach((c) => (pct[c.code] = (100 * profile.shares[c.code]) / total));
  const top = NAMED_CODES.slice().sort((a, b) => pct[b] - pct[a])[0];
  if (pct[top] < 30) return null;
  const to = NAMED_CODES
    .filter((c) => c !== top && (canadaPct[c] || 0) >= 3 && pct[c] < pct[top] - 10)
    .sort((a, b) => (canadaPct[b] || 0) - (canadaPct[a] || 0))[0];
  if (!to) return null;
  const move = Math.max(1, Math.min(10, Math.round(pct[top] / 3)));
  const next = {};
  COUNTRIES.forEach((c) => (next[c.code] = Math.round(pct[c.code])));
  next[top] -= move;
  next[to] += move;
  const drift = 100 - COUNTRIES.reduce((s, c) => s + next[c.code], 0);
  next[top] += drift;
  return { from: top, to, move, shares: next, before: hhiOf(profile.shares), after: hhiOf(next), topShare: pct[top] };
}

// ---------- queries ----------

const FREIGHT_SQL = `select strftime(month, '%Y-%m-%d') as month, gscpi_value, gscpi_zscore
from read_parquet('mart_freight_pressure.parquet')
order by month`;

const CURRENCY_SQL = `select strftime(date, '%Y-%m-%d') as date, usd_cad_rate, level_change_zscore, volatility_zscore
from read_parquet('mart_currency_exposure.parquet')
where level_change_zscore is not null and volatility_zscore is not null
order by date`;

function shipSql() {
  return `-- Where shipping pressure stands today, and how it ranks against every month since 1998
with ranked as (
  select month, gscpi_value, gscpi_zscore,
         percent_rank() over (order by gscpi_zscore) as pct,
         lag(gscpi_zscore, 3) over (order by month) as z_3_months_ago
  from read_parquet('mart_freight_pressure.parquet')
)
select strftime(month, '%Y-%m') as month, gscpi_value, gscpi_zscore,
       round(100 * pct) as percentile, z_3_months_ago
from ranked
order by month desc
limit 1`;
}

function fxImpactSql(spend) {
  return `-- What the exchange rate means for your USD purchases (spend = monthly purchases x USD share)
with fx as (
  select date, usd_cad_rate, level_change_30d
  from read_parquet('mart_currency_exposure.parquet')
),
latest as (select max(date) as d from fx),
now_rate as (select usd_cad_rate as r from fx, latest where date = d),
year_ago as (
  select usd_cad_rate as r from fx, latest
  where date <= d - interval 1 year order by date desc limit 1
),
swing as (select stddev_samp(level_change_30d) as s from fx)
select strftime((select d from latest), '%Y-%m-%d') as as_of,
       now_rate.r as rate_now,
       year_ago.r as rate_year_ago,
       now_rate.r / year_ago.r - 1 as change_vs_year_ago,
       swing.s as typical_six_week_swing,
       ${Math.round(spend)} as monthly_usd_purchases_cad,
       ${Math.round(spend)} * (now_rate.r / year_ago.r - 1) as extra_cost_vs_year_ago,
       ${Math.round(spend)} * swing.s as cost_of_a_typical_swing
from now_rate, year_ago, swing`;
}

function originSql(profile) {
  return `select strftime(month, '%Y-%m-%d') as month, category_label, country_count,
       hhi, hhi_zscore
from read_parquet('mart_origin_concentration.parquet')
where category_code = ${sqlStr(profile.category)}
order by month`;
}

function compositeSql(profile, hhi) {
  return `-- The three readings, month by month. Your mix: ${categoryLabel(profile.category)}, concentration ${fmt(hhi, 3)}
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
origin as (  -- your mix's concentration vs. that benchmark
  select (${fmt(hhi, 6)} - hhi_mean) / hhi_stdev as origin_z from benchmark
)
select strftime(f.m, '%Y-%m') as month,
       f.freight_z,
       c.currency_z,
       o.origin_z
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

// ---------- plain-language readings ----------

function shippingReading(ship) {
  const z = ship.gscpi_zscore;
  const pct = ship.percentile;
  const delta = ship.z_3_months_ago === null ? 0 : z - ship.z_3_months_ago;
  const trend = delta > 0.3 ? "rising" : delta < -0.3 ? "easing" : "holding steady";
  const state =
    z > 2 ? "under heavy strain" : z > 1 ? "tighter than normal" : z > -0.5 ? "close to normal" : "looser than normal";
  const rank = pct >= 50
    ? `Tighter than ${pct}% of months since 1998`
    : `Easier than ${100 - pct}% of months since 1998`;
  let consider;
  if (z > 1 && delta > 0.3) {
    consider = "Place orders for your next season earlier than usual and add a few weeks to the delivery dates you plan around. Ask suppliers to confirm ship dates now.";
  } else if (z > 1 && trend === "easing") {
    consider = "Shipping is easing but still strained. Keep a few extra weeks of buffer on time-sensitive orders, like seasonal launches, but there is no need to rush everything forward.";
  } else if (z > 1) {
    consider = "Keep a few extra weeks of buffer on time-sensitive orders, like seasonal launches, and ask suppliers to confirm ship dates.";
  } else if (delta > 0.3) {
    consider = "Shipping is normal but tightening. If a big order is coming up, placing it sooner rather than later is a cheap safeguard.";
  } else {
    consider = "Order on your usual schedule. Nothing here calls for pulling orders forward.";
  }
  return { z, state, rank, trend, consider, pct, delta };
}

function currencyReading(fx, currencyZ, profile) {
  const spend = (profile.budget * profile.usd) / 100;
  const change = fx.change_vs_year_ago;
  const dir = change >= 0 ? "more" : "less";
  const swingCost = fx.cost_of_a_typical_swing;
  if (profile.usd === 0) {
    return {
      z: 0, exposed: false, spend,
      headline: "You are not exposed to US dollar swings",
      detail: "You said none of your purchases are paid in US dollars. If that changes, update the slider above.",
      consider: "If your suppliers quote in US dollars indirectly (through an agent, for example), set the share higher to see the effect.",
    };
  }
  const z = currencyZ;
  const dollars = profile.budget > 0;
  const flat = Math.abs(change) < 0.005;
  const headline = flat
    ? "Your US dollar purchases cost about the same as a year ago"
    : `Your US dollar purchases cost ${pctText(change)} ${dir} than a year ago`;
  const detail = dollars
    ? (flat ? `The exchange rate is within half a percent of where it was a year ago, on ${money(spend)} of USD purchases. `
            : `That is about ${money(Math.abs(fx.extra_cost_vs_year_ago))} a month ${dir} on ${money(spend)} of USD purchases. `) +
      `In a typical six-week stretch the rate moves ${pctText(fx.typical_six_week_swing)}, or about ${money(swingCost)} a month for you.`
    : `In a typical six-week stretch the rate moves ${pctText(fx.typical_six_week_swing)}. Enter your monthly purchases to see this in dollars.`;
  const cushion = dollars
    ? `about ${pctText(fx.typical_six_week_swing, 0)} (${money(swingCost)} a month)`
    : `about ${pctText(fx.typical_six_week_swing, 0)}`;
  let consider =
    z > 1
      ? `Before your next big US dollar invoice, ask your bank about locking in a rate (a forward contract), and budget a cushion of ${cushion} in case it keeps moving.`
      : `Budget a cushion of ${cushion} for normal currency swings.`;
  if (change >= 0.03) {
    consider = `Your US dollar costs are up ${pctText(change)} on last year, so check that your retail prices still cover it. ` + consider;
  }
  return { z, exposed: true, spend, headline, detail, consider };
}

function supplierReading(profile, hhi, marketHhi, originZ, shift) {
  const total = totalShare(profile);
  if (!total) {
    return { z: null, headline: "Add your countries to see this", detail: "Set the sliders for where your purchases come from.", consider: "" };
  }
  const named = NAMED_CODES.slice().sort((a, b) => profile.shares[b] - profile.shares[a])[0];
  const share = Math.round((100 * profile.shares[named]) / total);
  const headline = `${COUNTRY_NAME[named]} supplies ${share}% of your buying`;
  const detail =
    `Your concentration score is ${fmt(hhi, 2)}. ` +
    (marketHhi !== null ? `Canada's imports of this product score ${fmt(marketHhi, 2)}. ` : "") +
    "Lower means spread across more countries.";
  let consider;
  if (shift && originZ !== null && originZ > 1) {
    consider =
      `Start getting quotes from suppliers in ${COUNTRY_NAME[shift.to]}. Moving ${shift.move} points of your buying there from ${COUNTRY_NAME[shift.from]} ` +
      `would lower your score from ${fmt(shift.before, 2)} to ${fmt(shift.after, 2)}, so one tariff change, port strike or factory shutdown reaches less of your stock.`;
  } else if (originZ !== null && originZ > 1) {
    consider = "Start sampling a second supplier country, so a single tariff change or port strike can't hit most of your stock at once.";
  } else {
    consider = "Your mix is already well spread. Keep it that way when you add new suppliers.";
  }
  return { z: originZ, headline, detail, consider };
}

// ---------- rendering ----------

// Where today sits on the Normal / Worse / Much worse scale (z from -2 to 4).
function gauge(z) {
  const min = -2, max = 4;
  const dot = z === null || z === undefined || isNaN(z)
    ? ""
    : `<div class="gauge-dot" style="left:${((Math.max(min, Math.min(max, z)) - min) / (max - min)) * 100}%"><span>Today</span></div>`;
  return `<div class="gauge" title="Where today sits compared with this signal's own history">` +
    `<div class="gauge-bar"><div class="gz ok"></div><div class="gz warn"></div><div class="gz bad"></div>${dot}</div>` +
    `<div class="gauge-labels"><span>Normal</span><span>Worse</span><span>Much worse</span></div></div>`;
}

function signalCard({ title, z, headline, detail, consider, tab }) {
  const c = classifyZ(z);
  const el = document.createElement("div");
  el.className = "signal";
  el.innerHTML =
    `<div class="signal-head"><span class="signal-title">${title}</span>` +
    `<span class="stat-tag" style="background:${c.color}">${c.label}</span></div>` +
    `<div class="signal-headline">${headline}</div>` +
    gauge(z) +
    (consider ? `<div class="consider"><span class="consider-label">What you can do</span>${consider}</div>` : "") +
    `<div class="signal-detail">${detail}</div>` +
    `<a href="#" data-goto="${tab}">More on ${title.toLowerCase()} &rarr;</a>`;
  return el;
}

function note(x, y, text, ay = -34) {
  return {
    x, y, text, showarrow: true, arrowhead: 0, arrowcolor: cssVar("--text-muted"), ax: 0, ay,
    font: { family: FONT, size: 11, color: cssVar("--text-primary") },
    bgcolor: cssVar("--surface"), bordercolor: cssVar("--border"), borderpad: 3,
  };
}

function renderStaticCharts(freightRows, currencyRows) {
  const months = freightRows.map((r) => r.month);
  const fz = freightRows.map((r) => r.gscpi_zscore);
  const peak = fz.indexOf(Math.max(...fz));
  const lastF = fz.length - 1;
  plot(
    "chart-freight",
    [line(months, fz, "Shipping", cssVar("--maroon-line"), { hovertemplate: "%{x|%b %Y}: %{y:.2f}<extra></extra>" })],
    baseLayout({
      showlegend: false,
      yaxis: { ...zAxis("tighter than usual →"), range: [Math.min(...fz) - 0.3, Math.max(...fz) + 0.6] },
      shapes: zoneShapes(),
      annotations: [
        note(months[peak], fz[peak], "2021–22 shipping crisis", -26),
        note(months[lastF], fz[lastF], "Today", -40),
      ],
    })
  );

  const dates = currencyRows.map((r) => r.date);
  const lz = currencyRows.map((r) => r.level_change_zscore);
  const vz = currencyRows.map((r) => r.volatility_zscore);
  const all = lz.concat(vz);
  plot(
    "chart-currency",
    [
      line(dates, lz, "Moved a lot lately", cssVar("--series-1")),
      line(dates, vz, "Been jumpy", cssVar("--series-2")),
    ],
    baseLayout({ yaxis: { ...zAxis("more unusual →"), range: [Math.min(...all) - 0.3, Math.max(...all) + 0.3] }, shapes: zoneShapes() })
  );

  // Exchange rate, last five years, with today and a year ago marked.
  const lastDate = new Date(dates[dates.length - 1]);
  const fiveYears = new Date(lastDate); fiveYears.setFullYear(lastDate.getFullYear() - 5);
  const yearAgo = new Date(lastDate); yearAgo.setFullYear(lastDate.getFullYear() - 1);
  const recent = currencyRows.filter((r) => new Date(r.date) >= fiveYears);
  const ago = currencyRows.filter((r) => new Date(r.date) <= yearAgo).pop();
  const now = currencyRows[currencyRows.length - 1];
  plot(
    "chart-rate",
    [
      line(recent.map((r) => r.date), recent.map((r) => r.usd_cad_rate), "CAD per USD", cssVar("--series-3"),
        { hovertemplate: "%{x|%d %b %Y}: %{y:.3f} CAD<extra></extra>" }),
      { x: [ago.date, now.date], y: [ago.usd_cad_rate, now.usd_cad_rate], type: "scatter", mode: "markers",
        marker: { size: 9, color: cssVar("--maroon-line") }, hoverinfo: "skip" },
    ],
    baseLayout({
      showlegend: false,
      yaxis: { gridcolor: cssVar("--border"), title: "Canadian dollars per US dollar" },
      annotations: [
        note(ago.date, ago.usd_cad_rate, `A year ago: ${fmt(ago.usd_cad_rate, 3)}`, 36),
        note(now.date, now.usd_cad_rate, `Today: ${fmt(now.usd_cad_rate, 3)}`, -36),
      ],
    })
  );
}

function kvTable(pairs) {
  return `<table class="kv">${pairs.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("")}</table>`;
}

function renderShipDetail(ship, r) {
  const c = classifyZ(r.z);
  document.getElementById("ship-detail").innerHTML =
    `<p class="lead">Global shipping is <strong>${r.state}</strong>. <span class="stat-tag" style="background:${c.color}">${c.label}</span></p>` +
    kvTable([
      ["Latest reading", `${ship.month}`],
      ["How far from normal", `${fmtSigned(r.z)} (1 is unusual, 2 is rare)`],
      ["How it ranks", r.rank],
      ["Last 3 months", r.trend.charAt(0).toUpperCase() + r.trend.slice(1)],
    ]) +
    `<div class="consider"><span class="consider-label">What you can do</span>${r.consider}</div>`;
}

function renderFxDetail(fx, r, profile) {
  const c = classifyZ(r.z);
  const dollars = profile.budget > 0 && profile.usd > 0;
  document.getElementById("fx-detail").innerHTML =
    `<p class="lead">${r.headline}. ${r.exposed ? `<span class="stat-tag" style="background:${c.color}">${c.label}</span>` : ""}</p>` +
    (r.exposed
      ? kvTable([
          ["Exchange rate today", `${fmt(fx.rate_now, 3)} Canadian dollars per US dollar`],
          ["A year ago", `${fmt(fx.rate_year_ago, 3)}`],
          ["Change", `${fx.change_vs_year_ago >= 0 ? "+" : "−"}${pctText(fx.change_vs_year_ago)}`],
          ["Your USD purchases", dollars ? `${money(r.spend)} a month` : "Enter monthly purchases on the Overview tab"],
          ["Extra cost vs. a year ago", dollars ? `${money(fx.extra_cost_vs_year_ago)} a month` : "—"],
          ["A typical six-week swing", dollars ? `${pctText(fx.typical_six_week_swing)}, about ${money(fx.cost_of_a_typical_swing)} a month` : pctText(fx.typical_six_week_swing)],
        ]) +
        `<div class="consider"><span class="consider-label">What you can do</span>${r.consider}</div>`
      : `<p class="desc">${r.detail}</p>`);
}

function renderShiftCard(profile, shift, hhi, marketHhi, originZ) {
  const el = document.getElementById("shift-card");
  const c = classifyZ(originZ);
  if (!totalShare(profile)) {
    el.innerHTML = `<p class="desc">Set where your purchases come from on the Overview tab.</p>`;
    return;
  }
  let html =
    `<p class="lead">Your concentration score is <strong>${fmt(hhi, 2)}</strong> against <strong>${fmt(marketHhi, 2)}</strong> for Canada's imports of this product. ` +
    `<span class="stat-tag" style="background:${c.color}">${c.label}</span></p>` +
    `<p class="desc">The score runs from near 0 (spread across many countries) to 1 (one country supplies everything). ` +
    `The status compares your score with how concentrated sourcing typically is across Canadian apparel product lines.</p>`;
  if (shift) {
    const needed = originZ !== null && originZ > 1;
    html +=
      `<div class="consider"><span class="consider-label">${needed ? "What you can do" : "Optional"}</span>` +
      (needed ? "" : "Your mix is fine as it is. If you want to spread it further: ") +
      `Moving ${shift.move} points of your buying from <strong>${COUNTRY_NAME[shift.from]}</strong> (${Math.round(shift.topShare)}% today) ` +
      `to <strong>${COUNTRY_NAME[shift.to]}</strong>, one of the largest sources of Canadian imports of this product, would lower your score from ` +
      `${fmt(shift.before, 2)} to ${fmt(shift.after, 2)}.` +
      `<div><button type="button" class="btn" id="apply-shift">Try that change</button></div></div>`;
  } else {
    html += `<div class="consider"><span class="consider-label">What you can do</span>` +
      (originZ !== null && originZ > 1
        ? "Your mix is more concentrated than usual. Adding a second or third supplier country would cut the risk of a single disruption."
        : "Your mix is already well spread. No change needed.") + `</div>`;
  }
  el.innerHTML = html;
  const btn = document.getElementById("apply-shift");
  if (btn) {
    btn.addEventListener("click", () => {
      profile.shares = shift.shares;
      resetVisible(profile);
      syncControls(profile);
      refreshFn();
    });
  }
}

function renderOriginCharts(profile, hhi, originRows, mix) {
  document.getElementById("origin-cat-name").textContent = categoryLabel(profile.category);
  show("sql-origin", "table-origin", originSql(profile), originRows);

  const x = originRows.map((r) => r.month);
  const traces = [line(x, originRows.map((r) => r.hhi), "Canada's imports", cssVar("--series-3"), {
    mode: "lines+markers", marker: { size: 4 }, hovertemplate: "%{y:.3f}<extra>Canada</extra>",
  })];
  if (hhi !== null && x.length) {
    traces.push({
      x: [x[0], x[x.length - 1]], y: [hhi, hhi], name: "Your mix", type: "scatter", mode: "lines",
      line: { color: cssVar("--series-2"), width: 2, dash: "dash" },
      hovertemplate: "%{y:.3f}<extra>Your mix</extra>",
    });
  }
  plot("chart-origin", traces, baseLayout({ yaxis: { gridcolor: cssVar("--border"), title: "Concentration score" } }));

  show("sql-mix", "table-mix", mixSql(profile), mix, 20);
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
}

async function renderResults(profile) {
  const token = ++renderToken;
  const hhi = userHhi(profile);
  const spend = (profile.budget * profile.usd) / 100;
  const compSql = compositeSql(profile, hhi ?? 0);
  const [rows, shipRows, fxRows, originRows, mix] = await Promise.all([
    runQuery(compSql),
    runQuery(shipSql()),
    runQuery(fxImpactSql(spend)),
    runQuery(originSql(profile)),
    runQuery(mixSql(profile)),
  ]);
  if (token !== renderToken) return; // a newer slider move superseded this render

  show("sql-composite", "table-composite", compSql, rows);
  show("sql-ship", "table-ship", shipSql(), shipRows);
  show("sql-fx", "table-fx", fxImpactSql(spend), fxRows);

  const last = rows[rows.length - 1];
  const ship = shipRows[0];
  const fx = fxRows[0];
  const lastOrigin = originRows[originRows.length - 1];
  const marketHhi = lastOrigin ? lastOrigin.hhi : null;
  const originZ = last.origin_z;
  const canadaPct = Object.fromEntries(mix.map((r) => [r.country, r.canada_share_pct]));
  const shift = suggestShift(profile, canadaPct);

  const shipR = shippingReading(ship);
  const fxR = currencyReading(fx, last.currency_z, profile);
  const supR = supplierReading(profile, hhi, marketHhi, originZ, shift);

  // Overall sentence
  const ranked = [
    { label: "shipping", z: shipR.z },
    { label: "the exchange rate", z: fxR.exposed ? fxR.z : -9 },
    { label: "your supplier mix", z: supR.z ?? -9 },
  ].sort((a, b) => b.z - a.z);
  const top = ranked[0];
  const topBand = classifyZ(top.z);
  const when = monthName(ship.month);
  document.getElementById("glance-summary").textContent =
    topBand.label === "Normal"
      ? `All three are normal for ${when}. Keep ordering and budgeting as usual.`
      : `For ${when}, the one to deal with first is ${top.label} (${topBand.phrase}). Start with the steps on that card.`;

  // Cards
  const signals = document.getElementById("signals");
  signals.innerHTML = "";
  const cards = [
    { key: "freight", title: "Shipping", tab: "freight", z: shipR.z,
      headline: `Global shipping is ${shipR.state}`,
      detail: `${shipR.rank}, and ${shipR.trend} over the last three months.`, consider: shipR.consider },
    { key: "currency", title: "Currency", tab: "currency", z: fxR.exposed ? fxR.z : 0,
      headline: fxR.headline, detail: fxR.detail, consider: fxR.consider },
    { key: "origin", title: "Suppliers", tab: "origin", z: supR.z,
      headline: supR.headline, detail: supR.detail, consider: supR.consider },
  ];
  cards.forEach((c) => signals.appendChild(signalCard(c)));
  signals.querySelectorAll("a[data-goto]").forEach((a) =>
    a.addEventListener("click", (e) => {
      e.preventDefault();
      switchTab(a.dataset.goto);
    })
  );

  // Detail tabs
  renderShipDetail(ship, shipR);
  renderFxDetail(fx, fxR, profile);
  renderShiftCard(profile, shift, hhi, marketHhi, originZ);

  renderOriginCharts(profile, hhi, originRows, mix);
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
    field.id = `field-${c.code}`;
    field.innerHTML =
      `<label for="slider-${c.code}"><span>${c.label}` +
      (c.code === "OTHER" ? "" : ` <button type="button" class="remove" aria-label="Remove ${c.label}">remove</button>`) +
      `</span><span class="field-value" id="val-${c.code}"></span></label>` +
      `<input type="range" min="0" max="100" step="1" id="slider-${c.code}">`;
    container.appendChild(field);
    const remove = field.querySelector(".remove");
    if (remove) {
      remove.addEventListener("click", () => {
        profile.shares[c.code] = 0;
        visibleCountries.delete(c.code);
        syncControls(profile);
        onChange();
      });
    }
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
    document.getElementById(`field-${c.code}`).hidden = !visibleCountries.has(c.code);
    document.getElementById(`slider-${c.code}`).value = profile.shares[c.code];
    document.getElementById(`val-${c.code}`).textContent = profile.shares[c.code] + "%";
  });
  document.getElementById("slider-usd").value = profile.usd;
  document.getElementById("val-usd").textContent = profile.usd + "%";
  document.getElementById("category-select").value = profile.category;
  const budget = document.getElementById("budget-input");
  if (document.activeElement !== budget) budget.value = profile.budget;
  const add = document.getElementById("add-country");
  const hidden = COUNTRIES.filter((c) => !visibleCountries.has(c.code));
  add.hidden = hidden.length === 0;
  add.innerHTML = `<option value="">+ Add a country</option>` +
    hidden.map((c) => `<option value="${c.code}">${c.label}</option>`).join("");
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

// Canada's own import mix for a category (latest 12 months), as whole-number shares.
async function canadaMix(category) {
  const rows = await runQuery(mixSql({ category }));
  const shares = sharesFrom({});
  rows.forEach((r) => (shares[r.country] = Math.round(r.canada_share_pct)));
  const drift = 100 - totalShare({ shares });
  shares.OTHER = Math.max(0, shares.OTHER + drift);
  return shares;
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
  writeStateToUrl(window.__profile, tab);
  window.scrollTo({ top: 0 });
}

// ---------- main ----------

async function main() {
  const loading = document.getElementById("loading");
  try {
    conn = await initDuckDB();
  } catch (err) {
    loading.textContent = "Could not load the data engine or the data files: " + err.message;
    return;
  }
  loading.style.display = "none";

  categories = await runQuery(`select distinct category_code, category_label, category_level
    from read_parquet('mart_origin_concentration.parquet')`);
  buildCategorySelect();

  const profile = readProfileFromUrl();
  if (!categories.some((c) => c.category_code === profile.category)) profile.category = DEFAULT_CATEGORY;
  window.__profile = profile;

  refreshFn = () => {
    writeStateToUrl(profile, currentTab);
    return renderResults(profile);
  };

  resetVisible(profile);
  buildCountrySliders(profile, refreshFn);
  syncControls(profile);
  document.getElementById("add-country").addEventListener("change", (e) => {
    const code = e.target.value;
    if (!code) return;
    visibleCountries.add(code);
    syncControls(profile);
    document.getElementById(`slider-${code}`).focus();
  });

  document.getElementById("slider-usd").addEventListener("input", (e) => {
    profile.usd = Number(e.target.value);
    syncControls(profile);
    refreshFn();
  });
  document.getElementById("budget-input").addEventListener("input", (e) => {
    profile.budget = Math.max(0, Number(e.target.value) || 0);
    refreshFn();
  });
  document.getElementById("category-select").addEventListener("change", (e) => {
    profile.category = e.target.value;
    refreshFn();
  });
  document.querySelectorAll("[data-preset]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      profile.shares =
        btn.dataset.preset === "canada" ? await canadaMix(profile.category) : sharesFrom(PRESETS[btn.dataset.preset]);
      resetVisible(profile);
      syncControls(profile);
      refreshFn();
    })
  );

  // Static (profile-independent) series
  const [freightRows, currencyRows] = await Promise.all([runQuery(FREIGHT_SQL), runQuery(CURRENCY_SQL)]);
  show("sql-freight", "table-freight", FREIGHT_SQL, freightRows);
  show("sql-currency", "table-currency", CURRENCY_SQL, currencyRows);
  renderStaticCharts(freightRows, currencyRows);

  document.getElementById("data-through").textContent =
    `Shipping data through ${freightRows[freightRows.length - 1].month.slice(0, 7)}; exchange rates through ${currencyRows[currencyRows.length - 1].date}.`;

  document.querySelectorAll("nav.tabs button").forEach((btn) =>
    btn.addEventListener("click", () => switchTab(btn.dataset.tab))
  );
  // Charts inside a collapsed section have no width until it is opened.
  document.querySelectorAll("details").forEach((d) =>
    d.addEventListener("toggle", () => d.querySelectorAll(".chart").forEach((el) => el.data && Plotly.Plots.resize(el)))
  );

  await renderResults(profile);
  const initialTab = new URLSearchParams(location.search).get("tab");
  if (initialTab && document.getElementById("view-" + initialTab)) switchTab(initialTab);
}

main();
