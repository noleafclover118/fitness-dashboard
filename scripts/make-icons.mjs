/** Renders the app icon (SVG) to the PNG sizes iOS/Android need. Uses Playwright + your Chrome. */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = path.join(root, 'public/icons');
fs.mkdirSync(dir, { recursive: true });
// Dumbbell mark on a near-black rounded square (iOS applies its own corner mask).
const svg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#111110"/>
  <g fill="#f5f5f3" transform="translate(256 256) rotate(-45)">
    <rect x="-120" y="-16" width="240" height="32" rx="10"/>
    <rect x="-150" y="-78" width="48" height="156" rx="18"/>
    <rect x="102" y="-78" width="48" height="156" rx="18"/>
    <rect x="-192" y="-50" width="34" height="100" rx="14"/>
    <rect x="158" y="-50" width="34" height="100" rx="14"/>
  </g>
</svg>`;
fs.writeFileSync(path.join(dir, 'icon.svg'), svg(512));
const b = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome' });
for (const [name, size] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]) {
  const p = await b.newPage({ viewport: { width: size, height: size } });
  await p.setContent(`<body style="margin:0">${svg(size)}</body>`);
  await p.screenshot({ path: path.join(dir, name), clip: { x: 0, y: 0, width: size, height: size } });
}
await b.close();
console.log('Icons written to public/icons/');
