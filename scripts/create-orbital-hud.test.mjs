import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { enhanceProfileSvg, fetchContributionTotals } from './create-orbital-hud.mjs';

test('enhancement preserves counts and embedded character on rerun', () => {
  const svg = readFileSync(new URL('../profile-3d-contrib/profile-gitblock.svg', import.meta.url), 'utf8');
  const stats = Object.assign([{ name: 'Commit', value: 12 }, { name: 'Issue', value: 2 }, { name: 'PullReq', value: 3 }, { name: 'Review', value: 4 }, { name: 'Repo', value: 1 }], { total: 122, privateCount: 100 });
  const first = enhanceProfileSvg(svg, stats);
  const second = enhanceProfileSvg(first);
  assert.equal(second.trim(), first.trim());
  assert.equal((second.match(/id="profile-character"/g) ?? []).length, 1);
  assert.match(second, /href="data:image\/png;base64,/);
  assert.doesNotMatch(second, /JavaScript|<script[\s>]/);
  assert.match(second, /id="count-total"/);
});

test('removes language chart without removing graph or footer', () => {
  const svg = '<svg><g id="graph"><path/></g><g transform="translate(40, 520)"><g><text>JavaScript</text></g></g><g id="footer"><text>contributions</text></g></svg>';
  const result = enhanceProfileSvg(svg);
  assert.doesNotMatch(result, /JavaScript/);
  assert.match(result, /id="graph"/);
  assert.match(result, /id="footer"/);
});

test('fetches requested user and aggregates ranges longer than one year', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ data: { user: { contributionsCollection: {
      totalCommitContributions: 12, totalIssueContributions: 2, totalPullRequestContributions: 3,
      totalPullRequestReviewContributions: 4, totalRepositoryContributions: 1,
      restrictedContributionsCount: 100, contributionCalendar: { totalContributions: 122 },
    } } } }) };
  });
  const stats = await fetchContributionTotals('AltesHaus', 'test-token', '2025-09-07', '2026-09-11');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].variables.login, 'AltesHaus');
  assert.equal(calls[0].variables.from, '2025-09-12T00:00:00.000Z');
  assert.equal(calls[1].variables.to, '2025-09-11T23:59:59.000Z');
  assert.equal(stats.total, 244);
  assert.equal(stats.privateCount, 200);
  assert.equal(stats[0].value, 24);
});

test('GraphQL errors fail instead of publishing zero counts', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ errors: [{ message: 'Denied' }] }) }));
  await assert.rejects(fetchContributionTotals('AltesHaus', 'test-token', '2026-01-01', '2026-09-11'), /Denied/);
});
