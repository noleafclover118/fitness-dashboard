/** Copies the SQLite WebAssembly file into public/ and writes the web app manifest (base-path aware). */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

fs.copyFileSync(path.join(root, 'node_modules/sql.js/dist/sql-wasm-browser.wasm'), path.join(root, 'public/sql-wasm.wasm'));

const manifest = {
  name: 'Fitness',
  short_name: 'Fitness',
  description: 'Private body recomposition dashboard — your data stays on your phone.',
  id: `${base}/`,
  start_url: `${base}/`,
  scope: `${base}/`,
  display: 'standalone',
  orientation: 'portrait',
  background_color: '#f4f4f2',
  theme_color: '#111110',
  icons: [
    { src: `${base}/icons/icon-192.png`, sizes: '192x192', type: 'image/png' },
    { src: `${base}/icons/icon-512.png`, sizes: '512x512', type: 'image/png' },
    { src: `${base}/icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};
fs.writeFileSync(path.join(root, 'public/manifest.webmanifest'), JSON.stringify(manifest, null, 2));
