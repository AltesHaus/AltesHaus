#!/usr/bin/env node
/** Generates a local preview SVG for the Orbital Stat Monolith HUD. */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { enhanceProfileSvg } from './create-orbital-hud.mjs';

const mockSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="850" viewBox="0 0 1280 850">
  <style>
    .fill-bg { fill: #ffffff; }
    .fill-fg { fill: #00000f; }
    .fill-strong { fill: #111133; }
    .fill-weak { fill: gray; }
    .stroke-weak { stroke: gray; }
    .radar { fill: #47a042; opacity: 0.6; }
  </style>
  <rect x="0" y="0" width="1280" height="850" class="fill-bg"/>
  <text x="640" y="700" text-anchor="middle" class="fill-weak" font-size="14">Lego contribution graph renders here</text>
  <g transform="translate(980, 284.5)">
    <g class="axis"><line/><text>Commit<title>847</title></text></g>
    <g class="axis"><line/><text>Issue<title>23</title></text></g>
    <g class="axis"><line/><text>PullReq<title>156</title></text></g>
    <g class="axis"><line/><text>Review<title>42</title></text></g>
    <g class="axis"><line/><text>Repo<title>12</title></text></g>
    <polygon class="radar" points="0,0 1,1 2,2 3,3 4,4"/>
  </g>
  <text x="1260" y="20" text-anchor="end" class="fill-weak" font-size="16">2025-06-22 / 2026-06-23</text>
</svg>`;

const out = resolve(process.cwd(), 'scripts/preview-orbital-hud.svg');
writeFileSync(out, enhanceProfileSvg(mockSvg), 'utf8');
console.log(`Preview written to ${out}`);
