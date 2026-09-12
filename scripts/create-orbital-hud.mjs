#!/usr/bin/env node
/** Removes the upstream charts and adds the floating profile character. */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const extractDateRange = (svg) => {
  const match = svg.match(/(\d{4}-\d{2}-\d{2})\s*\/\s*(\d{4}-\d{2}-\d{2})/);
  return match ? { from: match[1], to: match[2] } : null;
};

const extractStats = (svg) => {
  const saved = svg.match(/<metadata id="profile-stats">([^<]+)<\/metadata>/);
  if (saved) {
    const data = JSON.parse(saved[1]);
    return Object.assign(data.stats, { total: data.total, privateCount: data.privateCount, activityRange: data.activityRange });
  }
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

// Use the profile contribution collection, including its private aggregate.
// Search counts are not contribution counts and omit inaccessible activity.
export const fetchContributionTotals = async (username, token, from, to) => {
  const end = new Date(`${to}T23:59:59Z`);
  const earliest = new Date(end);
  earliest.setUTCFullYear(earliest.getUTCFullYear() - 1);
  earliest.setUTCDate(earliest.getUTCDate() + 1);
  earliest.setUTCHours(0, 0, 0, 0);
  const start = new Date(Math.max(new Date(`${from}T00:00:00Z`), earliest));
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `query($login: String!, $from: DateTime!, $to: DateTime!) {
        user(login: $login) { contributionsCollection(from: $from, to: $to) {
          totalCommitContributions totalIssueContributions totalPullRequestContributions
          totalPullRequestReviewContributions totalRepositoryContributions
          restrictedContributionsCount contributionCalendar { totalContributions }
        } }
      }`,
      variables: { login: username, from: start.toISOString(), to: end.toISOString() },
    }),
  });
  const data = await response.json();
  const collection = data.data?.user?.contributionsCollection;
  if (!response.ok || data.errors?.length || !collection) {
    throw new Error(`GitHub contribution lookup failed: ${JSON.stringify(data.errors ?? response.status)}`);
  }
  const stats = ['Commit', 'Issue', 'PullRequest', 'PullRequestReview', 'Repository'].map((name, i) => ({
    name: ['Commit', 'Issue', 'PullReq', 'Review', 'Repo'][i],
    value: collection[`total${name}Contributions`],
  }));
  stats.privateCount = collection.restrictedContributionsCount;
  stats.total = collection.contributionCalendar.totalContributions;
  if (new Date(`${from}T00:00:00Z`) < earliest) {
    const previousEnd = new Date(earliest.getTime() - 1).toISOString().slice(0, 10);
    const earlier = await fetchContributionTotals(username, token, from, previousEnd);
    stats.forEach((stat, i) => { stat.value += earlier[i].value; });
    stats.privateCount += earlier.privateCount;
    stats.total += earlier.total;
  }
  return stats;
};

const character = readFileSync(new URL('../assets/profile-character.png', import.meta.url)).toString('base64');

const animatedCount = (value, id, color, size = 14) => {
  const label = Number(value).toLocaleString('en-US');
  const frames = Array.from({ length: 18 }, (_, i) => {
    const count = Math.round(value * (1 - (1 - i / 18) ** 3)).toLocaleString('en-US');
    return `<text visibility="hidden" aria-hidden="true">${count}<set attributeName="visibility" to="visible" begin="${i / 15}s" dur="${1 / 15}s"/></text>`;
  }).join('');
  return `<g id="count-${id}" text-anchor="middle" fill="${color}" font-size="${size}" font-weight="800" font-family="Ubuntu, Helvetica, Arial, sans-serif" aria-label="${label}">
    <text>${label}<set attributeName="visibility" to="hidden" begin="0s" dur="1.2s"/></text>${frames}</g>`;
};

const createCharacter = (stats) => `<g id="profile-character" transform="translate(70 545)">
  <ellipse cx="120" cy="209" rx="90" ry="12" fill="#111133" opacity="0.08">
    <animate attributeName="rx" values="90;75;90" dur="4s" repeatCount="indefinite"/>
  </ellipse>
  <ellipse cx="120" cy="185" rx="125" ry="30" fill="none" stroke="#4d4dff" stroke-opacity="0.2" stroke-dasharray="5 8"/>
  <g><animateTransform attributeName="transform" type="translate" values="0 0;0 -12;0 0" dur="4s" repeatCount="indefinite"/>
    <image href="data:image/png;base64,${character}" x="25" y="0" width="190" height="190"/>
  </g>
  <circle r="5" fill="#3db840"><animateMotion dur="7s" repeatCount="indefinite" path="M -5,185 A 125,30 0 1,1 245,185 A 125,30 0 1,1 -5,185"/></circle>
  <g transform="translate(300 100)">${animatedCount(stats.total ?? stats.reduce((sum, stat) => sum + stat.value, 0), 'total', '#111133', 36)}
    <text y="27" text-anchor="middle" fill="#111133" font-size="12" font-family="Helvetica, Arial, sans-serif" letter-spacing="2">CONTRIBUTIONS</text>
    <text y="52" text-anchor="middle" fill="#6b6b80" font-size="11" font-family="Helvetica, Arial, sans-serif">${(stats.privateCount ?? 0).toLocaleString('en-US')} in private repositories</text>
  </g>
</g>`;

const removeExistingHud = (svg) => {
  const start = svg.indexOf('<!-- orbital-hud-start -->');
  const end = svg.indexOf('<!-- orbital-hud-end -->');
  if (start !== -1 && end !== -1) {
    return svg.slice(0, start).trimEnd() + svg.slice(end + '<!-- orbital-hud-end -->'.length).trimStart();
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

const createHudFragment = (stats) => `
  <metadata id="profile-stats">${JSON.stringify({ stats, total: stats.total, privateCount: stats.privateCount })}</metadata>
  ${createCharacter(stats)}`;

const injectHud = (svg, hudFragment) => {
  const closeIdx = svg.lastIndexOf('</svg>');
  if (closeIdx !== -1) {
    return `${svg.slice(0, closeIdx)}\n<!-- orbital-hud-start -->\n${hudFragment}\n<!-- orbital-hud-end -->\n${svg.slice(closeIdx)}`;
  }
  return `${svg}\n<!-- orbital-hud-start -->\n${hudFragment}\n<!-- orbital-hud-end -->`;
};

export const enhanceProfileSvg = (svgContent, statsOverride = null) => {
  const stats = statsOverride ?? extractStats(svgContent);
  let svg = svgContent;

  if (svg.includes('<!-- orbital-hud-start -->') || svg.includes('id="orbital-stat-hud"')) {
    svg = removeExistingHud(svg);
  } else {
    svg = removeRadarChart(svg);
  }

  // The upstream language donut and legend share this dedicated group.
  const language = svg.indexOf('<g transform="translate(40, 520)">');
  if (language !== -1) {
    const bounds = findGroupBounds(svg, language + 2);
    if (bounds) svg = svg.slice(0, bounds.start) + svg.slice(bounds.end);
  }
  if (stats.total != null) {
    svg = svg.replace(/(x="384" y="830"[^>]*>)[^<]+/, `$1${stats.total}`);
  }
  const hud = createHudFragment(stats);
  svg = injectHud(svg, hud);
  svg = svg.replace(/\s*@keyframes hud-fade-in \{[^\n]+\n\s*#orbital-stat-hud \{[^}]+\}/g, '');
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
      const liveStats = await fetchContributionTotals(username, token, range.from, range.to);
      console.log(
        `Live stats for ${username} (${range.from} → ${range.to}): ${liveStats.map((s) => `${s.name}=${s.value}`).join(', ')}`,
      );
      return liveStats;
    } catch (error) {
      throw error;
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
  const hasHud = svg.includes('<!-- orbital-hud-start -->') || svg.includes('id="orbital-stat-hud"');

  if (!hasRadar && !hasHud) {
    console.log(`No radar chart found in ${target}, skipping.`);
    process.exit(0);
  }

  const stats = await resolveStats(svg);
  const enhanced = enhanceProfileSvg(svg, stats);
  writeFileSync(filePath, enhanced, 'utf8');
  console.log(`Enhanced ${target} with the floating profile character.`);
};

const isMainModule =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMainModule) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
