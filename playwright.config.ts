import { defineConfig, devices } from '@playwright/test';

// E2E runs against the production static build, served under the same sub-path as GitHub Pages.
// Each browser context has its own on-device storage, so your real data is never touched.
const PORT = 4317;
const BASE = '/fitness-dashboard';
// Uses your installed Google Chrome. Without Chrome: `npx playwright install chromium` and set PW_CHANNEL=''.
const channel = process.env.PW_CHANNEL ?? 'chrome';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}${BASE}/`, trace: 'retain-on-failure', channel: channel || undefined },
  projects: [
    { name: 'desktop', testMatch: /.*\.spec\.ts/, use: { viewport: { width: 1280, height: 900 }, colorScheme: 'light' } },
    { name: 'iphone-dark', testMatch: /responsive\.spec\.ts/, use: { ...devices['iPhone 14'], browserName: 'chromium', channel: channel || undefined, colorScheme: 'dark' } },
  ],
  webServer: {
    command: `npm run build && node scripts/serve.mjs`,
    url: `http://localhost:${PORT}${BASE}/`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { NEXT_PUBLIC_BASE_PATH: BASE, PORT: String(PORT), NEXT_TELEMETRY_DISABLED: '1' },
  },
});
