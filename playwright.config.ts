import { defineConfig, devices } from '@playwright/test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    ...devices['Desktop Chrome'],
    channel: process.env.VIVACOACH_BROWSER_CHANNEL || undefined,
    baseURL: 'http://localhost:4173',
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: './node_modules/.bin/tsx server/index.ts',
    url: 'http://localhost:4173/api/status',
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      PORT: '4173',
      VIVACOACH_HOST: '127.0.0.1',
      VIVACOACH_LIVE_AI: 'false',
      OPENAI_API_KEY: '',
      ELEVENLABS_API_KEY: '',
      VIVACOACH_DB_PATH: join(tmpdir(), `vivacoach-e2e-${process.pid}.sqlite`),
    },
  },
});
