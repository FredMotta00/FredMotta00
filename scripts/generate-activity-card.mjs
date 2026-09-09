import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const LOGIN = "FredMotta00";
const TIME_ZONE = "America/Sao_Paulo";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTRIBUTIONS_URL = `https://github.com/users/${LOGIN}/contributions`;
const PROFILE_URL = `https://api.github.com/users/${LOGIN}`;

function decodeEntities(value) {
  return value
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function stripHtml(value) {
  return decodeEntities(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function attribute(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tag.match(new RegExp(`\\b${escaped}=(?:"([^"]*)"|'([^']*)')`, "i"));
  return match?.[1] ?? match?.[2] ?? null;
}

function numericCount(value) {
  const digits = value.replace(/[^0-9]/g, "");
  if (!digits) throw new Error(`Could not parse contribution count from: ${value}`);
  return Number(digits);
}

export function parseContributionHtml(html) {
  const plainText = stripHtml(html);
  const totalMatch = plainText.match(/([0-9][0-9.,]*)\s+contributions?\s+in\s+the\s+last\s+year/i);
  if (!totalMatch) throw new Error("GitHub contribution total was not found");
  const total = numericCount(totalMatch[1]);

  const tooltipCounts = new Map();
  for (const match of html.matchAll(/<tool-tip\b([^>]*)>([\s\S]*?)<\/tool-tip>/gi)) {
    const target = attribute(match[1], "for");
    if (!target) continue;
    const label = stripHtml(match[2]);
    const countMatch = label.match(/^([0-9][0-9,]*)\s+contributions?\b/i);
    tooltipCounts.set(target, countMatch ? numericCount(countMatch[1]) : 0);
  }

  const byDate = new Map();
  for (const match of html.matchAll(/<td\b[^>]*\bContributionCalendar-day\b[^>]*>/gi)) {
    const tag = match[0];
    const id = attribute(tag, "id");
    const date = attribute(tag, "data-date");
    if (!id || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const count = tooltipCounts.get(id);
    if (count === undefined) throw new Error(`GitHub tooltip is missing for ${date}`);
    byDate.set(date, { date, count });
  }

  const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (days.length < 350 || days.length > 371) {
    throw new Error(`Expected a complete GitHub calendar, received ${days.length} days`);
  }

  const dailyTotal = days.reduce((sum, day) => sum + day.count, 0);
  if (dailyTotal !== total) {
    throw new Error(`GitHub total mismatch: heading=${total}, calendar=${dailyTotal}`);
  }

  return { total, days };
}

export function parseProfile(payload) {
  if (!payload || payload.login !== LOGIN || !Number.isInteger(payload.public_repos)) {
    throw new Error("GitHub profile response is incomplete");
  }
  const createdAt = new Date(payload.created_at);
  if (Number.isNaN(createdAt.getTime())) throw new Error("GitHub profile creation date is invalid");
  return {
    login: payload.login,
    name: payload.name || payload.login,
    publicRepos: payload.public_repos,
    joinedYear: createdAt.getUTCFullYear(),
  };
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function cardDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function displayDate(isoDate) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${isoDate}T12:00:00Z`));
}

function chartGeometry(days) {
  const chart = { x: 535, y: 105, width: 790, height: 185 };
  const baseline = chart.y + chart.height;
  const max = Math.max(1, ...days.map((day) => day.count));
  const points = days.map((day, index) => {
    const x = chart.x + (index / Math.max(1, days.length - 1)) * chart.width;
    const ratio = Math.sqrt(day.count / max);
    const y = baseline - ratio * chart.height;
    return { ...day, x, y };
  });
  const line = points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
  const area = `${line} L${(chart.x + chart.width).toFixed(2)},${baseline} L${chart.x},${baseline} Z`;

  const monthLabels = [];
  let previousMonth = "";
  for (const point of points) {
    const date = new Date(`${point.date}T00:00:00Z`);
    const monthKey = point.date.slice(0, 7);
    if (monthKey !== previousMonth && date.getUTCDate() <= 7) {
      monthLabels.push({
        x: point.x,
        label: new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(date),
      });
      previousMonth = monthKey;
    }
  }
  return { chart, baseline, max, line, area, monthLabels };
}

export function renderSvg({ profile, total, days, backgroundDataUri, updatedDate }) {
  const geometry = chartGeometry(days);
  const totalLabel = new Intl.NumberFormat("en-US").format(total);
  const repoLabel = `${profile.publicRepos} public ${profile.publicRepos === 1 ? "repository" : "repositories"}`;
  const markers = geometry.monthLabels.map(({ x, label }) => `
    <line x1="${x.toFixed(2)}" y1="${geometry.chart.y}" x2="${x.toFixed(2)}" y2="${geometry.baseline}" stroke="#f7ef8a" stroke-opacity="0.12" />
    <text x="${x.toFixed(2)}" y="320" class="month">${escapeXml(label)}</text>`).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="400" viewBox="0 0 1400 400" role="img">
  <title>${escapeXml(profile.name)} GitHub activity</title>
  <desc>${totalLabel} contributions in the last year, updated ${escapeXml(displayDate(updatedDate))}.</desc>
  <defs>
    <linearGradient id="overlay" x1="0" x2="1">
      <stop offset="0" stop-color="#160000" stop-opacity="0.78" />
      <stop offset="0.48" stop-color="#260000" stop-opacity="0.58" />
      <stop offset="1" stop-color="#150000" stop-opacity="0.74" />
    </linearGradient>
    <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff5a8" stop-opacity="0.88" />
      <stop offset="1" stop-color="#d99b22" stop-opacity="0.08" />
    </linearGradient>
    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="4" result="blur" />
      <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
    </filter>
    <clipPath id="card"><rect x="2" y="2" width="1396" height="396" rx="30" /></clipPath>
    <clipPath id="plot"><rect x="535" y="105" width="790" height="185" rx="12" /></clipPath>
    <style>
      text { font-family: Inter, "Segoe UI", Arial, sans-serif; }
      .eyebrow { fill: #e0aa3e; font-size: 18px; font-weight: 700; letter-spacing: 2px; }
      .name { fill: #fff7b2; font-size: 42px; font-weight: 750; }
      .handle { fill: #e0aa3e; font-size: 21px; }
      .total { fill: #fff7b2; font-size: 58px; font-weight: 800; }
      .label { fill: #e8bb55; font-size: 20px; }
      .meta { fill: #f3d77d; font-size: 17px; }
      .month { fill: #e8bb55; font-size: 15px; text-anchor: middle; }
      .line { animation: draw 1.4s ease-out both; }
      @keyframes draw { from { stroke-dasharray: 1; stroke-dashoffset: 1; } to { stroke-dasharray: 1; stroke-dashoffset: 0; } }
    </style>
  </defs>
  <g clip-path="url(#card)">
    <image href="${backgroundDataUri}" width="1400" height="400" preserveAspectRatio="xMidYMid slice" />
    <rect width="1400" height="400" fill="url(#overlay)" />
    <rect x="500" y="62" width="865" height="286" rx="22" fill="#180000" fill-opacity="0.58" stroke="#e0aa3e" stroke-opacity="0.24" />
  </g>
  <rect x="2" y="2" width="1396" height="396" rx="30" fill="none" stroke="#dca633" stroke-opacity="0.6" stroke-width="3" />

  <text x="68" y="67" class="eyebrow">GITHUB ACTIVITY</text>
  <text x="68" y="120" class="name">${escapeXml(profile.name)}</text>
  <text x="68" y="154" class="handle">@${escapeXml(profile.login)}</text>
  <text x="68" y="235" class="total">${totalLabel}</text>
  <text x="68" y="269" class="label">contributions in the last year</text>
  <text x="68" y="315" class="meta">${escapeXml(repoLabel)}  •  Member since ${profile.joinedYear}</text>
  <text x="68" y="351" class="meta">Updated daily  •  ${escapeXml(displayDate(updatedDate))}</text>

  <text x="535" y="89" class="eyebrow">LAST 12 MONTHS</text>
  <text x="1325" y="89" class="meta" text-anchor="end">Peak: ${geometry.max} contributions/day</text>
  <g clip-path="url(#plot)">
    <path d="${geometry.area}" fill="url(#area)" />
    <path d="${geometry.line}" class="line" pathLength="1" fill="none" stroke="#fff18a" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow)" />
  </g>${markers}
  <line x1="535" y1="290" x2="1325" y2="290" stroke="#f7ef8a" stroke-opacity="0.5" />
</svg>
`;
}

export function replaceCacheVersion(markdown, version) {
  const pattern = /(assets\/github-activity\.svg\?v=)\d{4}-\d{2}-\d{2}/;
  if (!pattern.test(markdown)) throw new Error("README activity-card cache marker was not found");
  return markdown.replace(pattern, `$1${version}`);
}

async function fetchText(url, accept) {
  const response = await fetch(url, {
    headers: { Accept: accept, "User-Agent": "FredMotta00-profile-card/1.0" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.text();
}

async function main() {
  const [contributionHtml, profileJson, background] = await Promise.all([
    fetchText(CONTRIBUTIONS_URL, "text/html"),
    fetchText(PROFILE_URL, "application/vnd.github+json"),
    readFile(path.join(ROOT, "assets", "github-activity-background.png")),
  ]);
  const contributionData = parseContributionHtml(contributionHtml);
  const profile = parseProfile(JSON.parse(profileJson));
  const updatedDate = cardDate();
  const backgroundDataUri = `data:image/png;base64,${background.toString("base64")}`;
  const svg = renderSvg({ ...contributionData, profile, backgroundDataUri, updatedDate });

  const svgPath = path.join(ROOT, "assets", "github-activity.svg");
  const readmePath = path.join(ROOT, "README.md");
  const readme = await readFile(readmePath, "utf8");
  const updatedReadme = replaceCacheVersion(readme, updatedDate);

  await writeFile(svgPath, svg, "utf8");
  if (updatedReadme !== readme) await writeFile(readmePath, updatedReadme, "utf8");
  console.log(`Generated ${path.relative(ROOT, svgPath)} with ${contributionData.total} contributions across ${contributionData.days.length} calendar days.`);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
