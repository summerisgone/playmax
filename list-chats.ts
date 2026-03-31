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
  await page.goto('https://web.max.ru/');

  // click Сферум folder button
  await page.waitForSelector('.item.svelte-174ybgs', { timeout: 30000 });
  const sferumBtn = page.locator('.item.svelte-174ybgs').filter({ hasText: 'Сферум' }).first();
  await sferumBtn.click();

  // wait for chat list
  await page.waitForSelector('.item.svelte-rg2upy h3 .name .text', { timeout: 15000 });
  await page.waitForTimeout(1000);

  // intercept pushState and click each item to capture chat URLs
  const chats = await page.evaluate(/* js */`(async () => {
    const delay = ms => new Promise(r => setTimeout(r, ms));
    const origPush = history.pushState.bind(history);
    const folderUrl = String(location.href);
    const results = [];
    const items = Array.from(document.querySelectorAll('.item.svelte-rg2upy'));

    for (const item of items) {
      const name = item.querySelector('h3 .name .text')?.textContent?.trim();
      if (!name) continue;

      let capturedUrl = '';
      history.pushState = function(state, title, url) {
        if (!capturedUrl) capturedUrl = String(url);
        origPush(state, title, folderUrl);
      };

      item.querySelector('button.cell')?.click();
      await delay(250);

      history.pushState = origPush;
      origPush({}, '', folderUrl);
      await delay(100);

      const id = capturedUrl.replace('https://web.max.ru/', '');
      results.push({ name, id, url: capturedUrl || folderUrl });
    }

    history.pushState = origPush;
    return results;
  })()`).catch(e => { throw e; }) as any;

  console.log(JSON.stringify(chats, null, 2));

  await context.close();
})();
