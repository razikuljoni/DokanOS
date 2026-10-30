import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
const isLocalBaseURL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(baseURL);

export default defineConfig({
  testDir: './e2e',
  timeout: 45000,
  fullyParallel: false,
  retries: 1,
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  ...(isLocalBaseURL
    ? {
        webServer: {
          command: 'pnpm dev',
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      }
    : {}),
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
