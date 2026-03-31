import { chromium } from '@playwright/test';
import path from 'path';

const userDataDir = path.join(__dirname, 'chrome-profile');
const [,, url, limitArg] = process.argv;

if (!url) {
  process.stderr.write('Usage: npx tsx read-history.ts <url> [limit]\n');
  process.stderr.write('  limit: message count (number) or date cutoff (YYYY-MM-DD)\n');
  process.exit(1);
}

let messageLimit = Infinity;
let dateLimit: Date | null = null;

if (limitArg) {
  if (/^\d+$/.test(limitArg)) {
    messageLimit = parseInt(limitArg, 10);
  } else {
    dateLimit = new Date(limitArg);
    if (isNaN(dateLimit.getTime())) {
      process.stderr.write('Invalid limit: use a number or YYYY-MM-DD\n');
      process.exit(1);
    }
  }
}

const MONTHS: Record<string, number> = {
  'января': 0, 'февраля': 1, 'марта': 2, 'апреля': 3,
  'мая': 4, 'июня': 5, 'июля': 6, 'августа': 7,
  'сентября': 8, 'октября': 9, 'ноября': 10, 'декабря': 11,
};

function parseRuDate(s: string): Date | null {
  const parts = s.trim().split(' ');
  if (parts.length !== 3) return null;
  const month = MONTHS[parts[1]];
  if (month === undefined) return null;
  return new Date(+parts[2], month, +parts[0]);
}

(async () => {
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    channel: 'chrome',
  });

  const page = context.pages()[0] ?? await context.newPage();
  await page.goto(url);
  await page.waitForSelector('.history.svelte-3850xr', { timeout: 60000 });
  await page.waitForTimeout(1500);

  // scroll up to load messages until limit or date cutoff reached
  const SCROLLER = '.history.svelte-3850xr .scrollable.scrollListScrollable';
  while (true) {
    const state = await page.evaluate(`(() => {
      const items = document.querySelectorAll('.history.svelte-3850xr .item');
      let oldestDate = null;
      for (const item of items) {
        const cap = item.querySelector('.capsule');
        if (cap) { oldestDate = cap.textContent.trim(); break; }
      }
      return { count: items.length, oldestDate };
    })()`) as { count: number; oldestDate: string | null };

    process.stderr.write(`Loaded: ${state.count}, oldest day: ${state.oldestDate ?? 'unknown'}\n`);

    let done = false;
    if (messageLimit < Infinity && state.count >= messageLimit) done = true;
    if (dateLimit && state.oldestDate) {
      const d = parseRuDate(state.oldestDate);
      if (d && d < dateLimit) done = true;
    }
    if (done) break;

    await page.evaluate(`document.querySelector('${SCROLLER}').scrollTop = 0`);
    await page.waitForTimeout(1500);

    const newCount = await page.evaluate(
      `document.querySelectorAll('.history.svelte-3850xr .item').length`
    ) as number;
    if (newCount === state.count) {
      process.stderr.write('No more messages to load.\n');
      break;
    }
  }

  // extract all messages from current DOM
  const messages = await page.evaluate(`(() => {
    const MONTHS = {
      'января': 0, 'февраля': 1, 'марта': 2, 'апреля': 3,
      'мая': 4, 'июня': 5, 'июля': 6, 'августа': 7,
      'сентября': 8, 'октября': 9, 'ноября': 10, 'декабря': 11
    };
    function toISO(raw) {
      if (!raw) return null;
      const s = raw.trim();
      const today = new Date();
      let d;
      if (s === 'Сегодня') {
        d = today;
      } else if (s === 'Вчера') {
        d = new Date(today); d.setDate(d.getDate() - 1);
      } else {
        const parts = s.split(' ');
        if (parts.length !== 3) return s;
        const m = MONTHS[parts[1]];
        if (m === undefined) return s;
        d = new Date(+parts[2], m, +parts[0]);
      }
      const y = d.getFullYear();
      const mo = String(d.getMonth() + 1).padStart(2, '0');
      const da = String(d.getDate()).padStart(2, '0');
      return y + '-' + mo + '-' + da;
    }

    const items = document.querySelectorAll('.history.svelte-3850xr .item');
    const out = [];
    let curDate = null;

    for (const item of items) {
      const cap = item.querySelector('.capsule');
      if (cap) curDate = toISO(cap.textContent);

      const block = item.querySelector('.block');
      if (!block) continue;

      const author = block.querySelector('.header .name .text')?.textContent?.trim() ?? '';
      const text = block.querySelector('.bubble > span.text')?.textContent?.trim() ?? '';
      const time = block.querySelector('.meta .text')?.textContent?.replace(/\\s+/g, ' ').trim() ?? '';

      out.push({ date: curDate, time, author, text });
    }
    return out;
  })()`) as any[];

  let result: any[] = messages;

  // filter by date cutoff (dates are now ISO YYYY-MM-DD strings)
  if (dateLimit) {
    const cutoff = dateLimit.toISOString().slice(0, 10);
    result = result.filter(m => !m.date || m.date >= cutoff);
  }

  // take last N (most recent) if count limit
  if (messageLimit < Infinity) {
    result = result.slice(-messageLimit);
  }

  console.log(JSON.stringify(result, null, 2));
  await context.close();
})();
