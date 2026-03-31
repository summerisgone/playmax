import { chromium } from '@playwright/test';
import path from 'path';

const userDataDir = path.join(__dirname, 'chrome-profile');

(async () => {
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    channel: 'chrome',
    args: ['--remote-debugging-port=9222'],
  });

  const page = context.pages()[0] ?? await context.newPage();
  await page.goto('about:blank');

  console.log('Browser is open. Press Ctrl+C to exit.');

  // keep process alive
  await new Promise(() => {});
})();
