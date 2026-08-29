import { defineConfig, devices } from '@playwright/test';

const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1];
const basePath = process.env.GITHUB_ACTIONS && repositoryName ? `/${repositoryName}/` : '/';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  use: {
    baseURL: `http://127.0.0.1:4173${basePath}`,
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'npm run preview -- --host 127.0.0.1',
      port: 4173,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm run dev:worker -- --ip 127.0.0.1',
      port: 8787,
      reuseExistingServer: !process.env.CI,
    },
  ],
  projects: [
    { name: 'mobile-390x844', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, hasTouch: true } },
    { name: 'desktop-1280x720', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } } },
  ],
});
