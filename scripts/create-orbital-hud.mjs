#!/usr/bin/env node
/**
 * Replaces the default radar chart in github-profile-3d-contrib SVGs
 * with an animated "Orbital Stat Monolith" HUD — stacked Lego pillars,
 * neon orbital rings, orbiting particles, and a sweeping scan line.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const RADAR_X = 720;
const RADAR_Y = 70;
const RADAR_W = 520;
const RADAR_H = 390;

const STAT_COLORS = {
  Commit: { top: '#3db840', left: '#2d8a30', right: '#1f6b22', glow: '#3db840' },
  Issue: { top: '#ff0040', left: '#cc0033', right: '#990026', glow: '#ff0040' },
  PullReq: { top: '#4d4dff', left: '#3333cc', right: '#222299', glow: '#4d4dff' },
  Review: { top: '#ffd700', left: '#ccac00', right: '#997f00', glow: '#ffd700' },
  Repo: { top: '#ff6b35', left: '#cc5529', right: '#99401f', glow: '#ff6b35' },
};

const BRICK_H = 14;

const toLevel = (value) => {
  if (value < 1) return 1;
  return Math.min(Math.ceil(Math.log10(value + 1) * 2.2), 8);
};

const formatValue = (value) => {
  if (value >= 10000) return `${Math.round(value / 1000)}K`;
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(value);
};

const extractDateRange = (svg) => {
  const match = svg.match(/(\d{4}-\d{2}-\d{2})\s*\/\s*(\d{4}-\d{2}-\d{2})/);
  return match ? { from: match[1], to: match[2] } : null;
};

const extractStats = (svg) => {
  const stats = [];
  const axisRegex =
    /<g class="axis">[\s\S]*?<text[^>]*>([^<]+)<title>(\d+)<\/title>/g;
  let match;
  while ((match = axisRegex.exec(svg)) !== null) {
    stats.push({ name: match[1].trim(), value: Number(match[2]) });
  }
  if (stats.length === 5) return stats;

  return [
    { name: 'Commit', value: 0 },
    { name: 'Issue', value: 0 },
    { name: 'PullReq', value: 0 },
    { name: 'Review', value: 0 },
    { name: 'Repo', value: 0 },
  ];
};

const githubSearchCount = async (endpoint, query, token) => {
  const params = new URLSearchParams({ q: query, per_page: '1' });
  const url = `https://api.github.com/search/${endpoint}?${params}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept:
      endpoint === 'commits'
        ? 'application/vnd.github.cloak-preview'
        : 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`GitHub search/${endpoint} failed (${response.status})`);
  }
  const data = await response.json();
  return data.total_count ?? 0;
};

const fetchRepoContributions = async (token, from, to) => {
  const query = `
    query {
      viewer {
        contributionsCollection(from: "${from}T00:00:00Z", to: "${to}T23:59:59Z") {
          totalRepositoryContributions
        }
      }
    }`.replace(/\s+/g, ' ');

  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) {
    throw new Error(`GitHub GraphQL failed (${response.status})`);
  }
  const data = await response.json();
  return data.data?.viewer?.contributionsCollection?.totalRepositoryContributions ?? 0;
};

export const fetchLiveStats = async (username, token, from, to) => {
  const created = `created:${from}..${to}`;
  const commitDate = `committer-date:${from}..${to}`;

  const [commits, pullReqs, issues, reviews, repos] = await Promise.all([
    githubSearchCount('commits', `author:${username} ${commitDate}`, token),
    githubSearchCount('issues', `author:${username} type:pr ${created}`, token),
    githubSearchCount('issues', `author:${username} type:issue ${created}`, token),
    githubSearchCount('issues', `reviewed-by:${username} type:pr ${created}`, token),
    fetchRepoContributions(token, from, to),
  ]);

  return [
    { name: 'Commit', value: commits },
    { name: 'Issue', value: issues },
    { name: 'PullReq', value: pullReqs },
    { name: 'Review', value: reviews },
    { name: 'Repo', value: repos },
  ];
};

const removeExistingHud = (svg) => {
  const start = svg.indexOf('<!-- orbital-hud-start -->');
  const end = svg.indexOf('<!-- orbital-hud-end -->');
  if (start !== -1 && end !== -1) {
    return svg.slice(0, start) + svg.slice(end + '<!-- orbital-hud-end -->'.length);
  }

  const hudIdx = svg.indexOf('id="orbital-stat-hud"');
  if (hudIdx === -1) return svg;
  return removeOutermostGroupContaining(svg, hudIdx, 'orbital-stat-hud');
};

const removeRadarChart = (svg) => {
  const radarClassIdx = svg.indexOf('class="radar"');
  if (radarClassIdx !== -1) {
    return removeOutermostGroupContaining(svg, radarClassIdx, 'class="radar"');
  }

  const axisIdx = svg.indexOf('class="axis"');
  if (axisIdx !== -1) {
    return removeOutermostGroupContaining(svg, axisIdx, 'class="axis"');
  }

  return svg;
};

const findGroupBounds = (svg, markerIdx) => {
  const groupStart = svg.lastIndexOf('<g', markerIdx);
  if (groupStart === -1) return null;

  const openTagEnd = svg.indexOf('>', groupStart);
  let depth = 1;
  let pos = openTagEnd + 1;

  while (depth > 0 && pos < svg.length) {
    const nextOpen = svg.indexOf('<g', pos);
    const nextClose = svg.indexOf('</g>', pos);
    if (nextClose === -1) return null;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1;
      pos = nextOpen + 2;
    } else {
      depth -= 1;
      if (depth === 0) {
        return { start: groupStart, end: nextClose + 4 };
      }
      pos = nextClose + 4;
    }
  }
  return null;
};

const removeOutermostGroupContaining = (svg, markerIdx, needle) => {
  let bounds = findGroupBounds(svg, markerIdx);
  if (!bounds) return svg;

  while (bounds.start > 0) {
    const parentBounds = findGroupBounds(svg, bounds.start - 1);
    if (!parentBounds) break;
    const parentContent = svg.slice(parentBounds.start, parentBounds.end);
    if (!parentContent.includes(needle)) break;
    bounds = parentBounds;
  }

  return svg.slice(0, bounds.start) + svg.slice(bounds.end);
};

const isoBrick = (x, y, w, colors, delay = 0) => {
  const hw = w / 2;
  const hh = w * 0.18;
  const h = BRICK_H;
  const top = `${x},${y} ${x + hw},${y - hh} ${x + w},${y} ${x + hw},${y + hh}`;
  const left = `${x},${y} ${x + hw},${y + hh} ${x + hw},${y + hh + h} ${x},${y + h}`;
  const right = `${x + hw},${y + hh} ${x + w},${y} ${x + w},${y + h} ${x + hw},${y + hh + h}`;
  const studs = `${x + hw * 0.55},${y - hh * 0.55} ${x + hw * 1.45},${y - hh * 0.55} ${x + hw * 1.45},${y - hh * 0.15} ${x + hw * 0.55},${y - hh * 0.15}`;

  return `
    <g>
      <polygon points="${left}" fill="${colors.left}"/>
      <polygon points="${right}" fill="${colors.right}"/>
      <polygon points="${top}" fill="${colors.top}"/>
      <polygon points="${studs}" fill="${colors.top}" opacity="0.85"/>
    </g>`;
};

const stackedPillar = (cx, baseY, levels, colors, statIdx) => {
  const w = 32;
  const x = cx - w / 2;
  const bricks = [];
  for (let i = 0; i < levels; i += 1) {
    const y = baseY - (i + 1) * BRICK_H;
    bricks.push(isoBrick(x, y, w, colors, statIdx * 0.15 + i * 0.08));
  }
  return `<g filter="url(#hud-glow-${statIdx})">${bricks.join('')}</g>`;
};

const createHudFragment = (stats) => {
  const cx = RADAR_X + RADAR_W / 2;
  const cy = RADAR_Y + RADAR_H * 0.46;
  const orbitRx = 168;
  const orbitRy = 52;
  const nodeRadius = 128;
  const baseY = cy + 38;

  const nodes = stats.map((stat, i) => {
    const angle = (i / stats.length) * Math.PI * 2 - Math.PI / 2;
    return {
      ...stat,
      x: cx + Math.cos(angle) * nodeRadius,
      y: cy + Math.sin(angle) * nodeRadius * 0.52,
      angle,
      levels: toLevel(stat.value),
      colors: STAT_COLORS[stat.name] ?? STAT_COLORS.Commit,
    };
  });

  const glowFilters = Array.from({ length: 5 }, (_, i) => `
    <filter id="hud-glow-${i}" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="2.5" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>`).join('');

  const pillars = nodes
    .map((node, i) => stackedPillar(node.x, baseY, node.levels, node.colors, i))
    .join('\n');

  const orbitDots = nodes
    .map(
      (node, i) => `
    <g>
      <circle cx="${node.x.toFixed(1)}" cy="${(node.y - 6).toFixed(1)}" r="7" fill="none" stroke="${node.colors.glow}" stroke-width="1.5" opacity="0.5">
        <animate attributeName="r" values="5;9;5" dur="${2.2 + i * 0.25}s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0.3;0.7;0.3" dur="${2.2 + i * 0.25}s" repeatCount="indefinite"/>
      </circle>
      <circle cx="${node.x.toFixed(1)}" cy="${(node.y - 6).toFixed(1)}" r="3.5" fill="${node.colors.top}"/>
    </g>`,
    )
    .join('\n');

  const labels = nodes
    .map(
      (node) => `
    <g transform="translate(${node.x.toFixed(1)}, ${(baseY + 18).toFixed(1)})">
      <text text-anchor="middle" fill="#111133" font-size="10" font-weight="700" letter-spacing="0.5" font-family="Ubuntu, Helvetica, Arial, sans-serif">${node.name.toUpperCase()}</text>
      <text y="15" text-anchor="middle" fill="${node.colors.top}" font-size="14" font-weight="800" font-family="Ubuntu, Helvetica, Arial, sans-serif">${formatValue(node.value)}</text>
    </g>`,
    )
    .join('\n');

  const connectors = nodes
    .map(
      (node) =>
        `<line x1="${cx}" y1="${cy}" x2="${node.x.toFixed(1)}" y2="${(node.y - 6).toFixed(1)}" stroke="${node.colors.glow}" stroke-width="1.2" opacity="0.12" stroke-dasharray="2 5"/>`,
    )
    .join('\n');

  const particles = [0, 1, 2, 3, 4].map((i) => {
    const dur = 6 + i * 1.5;
    const r = orbitRx * (0.55 + i * 0.12);
    const ry = orbitRy * (0.55 + i * 0.12);
    const colors = ['#3db840', '#4d4dff', '#ffd700', '#ff0040', '#ff6b35'];
    return `
    <circle r="2.5" fill="${colors[i]}" opacity="0.8">
      <animateMotion dur="${dur}s" repeatCount="indefinite" path="M ${-r},0 A ${r},${ry} 0 1,1 ${r},0 A ${r},${ry} 0 1,1 ${-r},0"/>
    </circle>`;
  }).join('\n');

  return `
  <defs>
    ${glowFilters}
    <linearGradient id="scan-gradient" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#4d4dff" stop-opacity="0"/>
      <stop offset="40%" stop-color="#3db840" stop-opacity="0.5"/>
      <stop offset="60%" stop-color="#ffd700" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="#4d4dff" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="core-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#3db840" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#3db840" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <g id="orbital-stat-hud">
    <g opacity="0.06">
      ${Array.from({ length: 9 }, (_, i) => {
        const y = RADAR_Y + 35 + i * 40;
        return `<line x1="${RADAR_X + 15}" y1="${y}" x2="${RADAR_X + RADAR_W - 15}" y2="${y}" stroke="#111133" stroke-width="1"/>`;
      }).join('\n')}
    </g>

    <g transform="translate(${cx}, ${cy})">
      <ellipse rx="${orbitRx}" ry="${orbitRy}" fill="none" stroke="#111133" stroke-width="0.7" opacity="0.1" stroke-dasharray="8 10">
        <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="30s" repeatCount="indefinite"/>
      </ellipse>
      <ellipse rx="${orbitRx * 0.68}" ry="${orbitRy * 0.68}" fill="none" stroke="#4d4dff" stroke-width="1" opacity="0.2" stroke-dasharray="5 7">
        <animateTransform attributeName="transform" type="rotate" from="360" to="0" dur="22s" repeatCount="indefinite"/>
      </ellipse>
      <ellipse rx="${orbitRx * 0.38}" ry="${orbitRy * 0.38}" fill="none" stroke="#3db840" stroke-width="1.5" opacity="0.3">
        <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="14s" repeatCount="indefinite"/>
      </ellipse>

      <circle r="${orbitRx * 0.55}" fill="url(#core-glow)">
        <animate attributeName="r" values="${orbitRx * 0.45};${orbitRx * 0.6};${orbitRx * 0.45}" dur="4s" repeatCount="indefinite"/>
      </circle>

      <g>${particles}</g>

      <circle r="10" fill="#3db840" opacity="0.6">
        <animate attributeName="r" values="7;13;7" dur="3s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0.4;0.85;0.4" dur="3s" repeatCount="indefinite"/>
      </circle>
      <circle r="4" fill="#ffffff"/>
    </g>

    ${connectors}
    ${pillars}
    ${orbitDots}
    ${labels}

    <rect x="${RADAR_X + 10}" y="${RADAR_Y + 28}" width="${RADAR_W - 20}" height="2" fill="url(#scan-gradient)" opacity="0.7" rx="1">
      <animate attributeName="y" values="${RADAR_Y + 28};${RADAR_Y + RADAR_H - 36};${RADAR_Y + 28}" dur="5s" repeatCount="indefinite"/>
    </rect>

    <text x="${RADAR_X + RADAR_W / 2}" y="${RADAR_Y + 20}" text-anchor="middle" fill="#111133" font-size="9" font-weight="800" letter-spacing="4" font-family="Ubuntu, Helvetica, Arial, sans-serif" opacity="0.35">◈ ACTIVITY ORBIT ◈</text>
  </g>`;
};

const injectHud = (svg, hudFragment) => {
  const closeIdx = svg.lastIndexOf('</svg>');
  if (closeIdx !== -1) {
    return `${svg.slice(0, closeIdx)}\n<!-- orbital-hud-start -->\n${hudFragment}\n<!-- orbital-hud-end -->\n${svg.slice(closeIdx)}`;
  }
  return `${svg}\n<!-- orbital-hud-start -->\n${hudFragment}\n<!-- orbital-hud-end -->`;
};

const appendHudStyles = (svg) => {
  const styleExtra = `
    @keyframes hud-fade-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
    #orbital-stat-hud { animation: hud-fade-in 1.4s ease-out; }`;

  if (svg.includes('<style>')) {
    return svg.replace('</style>', `${styleExtra}\n  </style>`);
  }
  return svg;
};

export const enhanceProfileSvg = (svgContent, statsOverride = null) => {
  const stats = statsOverride ?? extractStats(svgContent);
  let svg = svgContent;

  if (svg.includes('id="orbital-stat-hud"')) {
    svg = removeExistingHud(svg);
  } else {
    svg = removeRadarChart(svg);
  }

  const hud = createHudFragment(stats);
  svg = injectHud(svg, hud);
  svg = appendHudStyles(svg);
  return svg;
};

const resolveUsername = () =>
  process.env.PROFILE_USERNAME ??
  process.env.GITHUB_REPOSITORY_OWNER ??
  process.env.GITHUB_ACTOR ??
  null;

const resolveStats = async (svg) => {
  const username = resolveUsername();
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  const range = extractDateRange(svg);
  const svgStats = extractStats(svg);
  const svgLooksEmpty = svgStats.every((stat) => stat.value <= 1);

  if (username && token && range && (svgLooksEmpty || process.env.FORCE_LIVE_STATS === '1')) {
    try {
      const liveStats = await fetchLiveStats(username, token, range.from, range.to);
      console.log(
        `Live stats for ${username} (${range.from} → ${range.to}): ${liveStats.map((s) => `${s.name}=${s.value}`).join(', ')}`,
      );
      return liveStats;
    } catch (error) {
      console.warn(`Live stats fetch failed, using SVG values: ${error.message}`);
    }
  }

  if (!username) {
    console.warn('No GitHub username found. Set PROFILE_USERNAME or GITHUB_REPOSITORY_OWNER.');
  }

  return svgStats;
};

const main = async () => {
  const target = process.argv[2] ?? 'profile-3d-contrib/profile-gitblock.svg';
  const filePath = resolve(process.cwd(), target);

  let svg;
  try {
    svg = readFileSync(filePath, 'utf8');
  } catch {
    console.error(`Could not read ${filePath}. Run github-profile-3d-contrib first.`);
    process.exit(1);
  }

  const hasRadar = svg.includes('class="axis"') || svg.includes('class="radar"');
  const hasHud = svg.includes('id="orbital-stat-hud"');

  if (!hasRadar && !hasHud) {
    console.log(`No radar chart found in ${target}, skipping.`);
    process.exit(0);
  }

  const stats = await resolveStats(svg);
  const enhanced = enhanceProfileSvg(svg, stats);
  writeFileSync(filePath, enhanced, 'utf8');
  console.log(`Enhanced ${target} with Orbital Stat Monolith HUD.`);
};

const isMainModule =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMainModule) {
  main();
}
