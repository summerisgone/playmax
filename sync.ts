import { chromium } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import path from "path";
import {
  saveChats,
  isChatsStale,
  getChats,
  CHAT_LIST_TTL_MS,
  saveMessages,
  isChatHistoryStale,
  markChatSynced,
  CHAT_HISTORY_TTL_MS,
  getLatestMessageDate,
} from "./db";

const userDataDir = path.join(__dirname, "chrome-profile");

const MONTHS: Record<string, number> = {
  января: 0,
  февраля: 1,
  марта: 2,
  апреля: 3,
  мая: 4,
  июня: 5,
  июля: 6,
  августа: 7,
  сентября: 8,
  октября: 9,
  ноября: 10,
  декабря: 11,
};

function parseRussianDate(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  const today = new Date();
  let d: Date;
  if (s === "Сегодня") {
    d = today;
  } else if (s === "Вчера") {
    d = new Date(today);
    d.setDate(d.getDate() - 1);
  } else {
    const parts = s.split(" ");
    if (parts.length !== 3) return null;
    const m = MONTHS[parts[1]];
    if (m === undefined) return null;
    d = new Date(+parts[2], m, +parts[0]);
  }
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

// --- chat list ---

async function fetchChats(
  page: Page,
  folderName: string,
): Promise<{ id: string; name: string; url: string }[]> {
  await page.goto("https://web.max.ru/");
  await page.waitForSelector(".item.svelte-174ybgs", { timeout: 30000 });
  const sferumBtn = page
    .locator(".item.svelte-174ybgs")
    .filter({ hasText: folderName })
    .first();
  await sferumBtn.click();
  await page.waitForSelector(".item.svelte-rg2upy h3 .name .text", {
    timeout: 15000,
  });
  await page.waitForTimeout(1000);

  const chats = (await page.evaluate(`(async () => {
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
  })()`)) as { id: string; name: string; url: string }[];

  saveChats(chats);
  return chats;
}

// --- message history ---

const MAX_MESSAGES_PER_CHAT = 500;

async function fetchHistory(
  page: Page,
  chatId: string,
  url: string,
  stopDate: string | null = null,
): Promise<void> {
  await page.goto(url);
  await page.waitForSelector(".history.svelte-3850xr", { timeout: 60000 });
  await page.waitForTimeout(1500);

  const SCROLLER = ".history.svelte-3850xr .scrollable.scrollListScrollable";

  while (true) {
    const state = (await page.evaluate(`(() => {
      const items = document.querySelectorAll('.history.svelte-3850xr .item');
      let oldestDate = null;
      for (const item of items) {
        const cap = item.querySelector('.capsule');
        if (cap) { oldestDate = cap.textContent.trim(); break; }
      }
      return { count: items.length, oldestDate };
    })()`)) as { count: number; oldestDate: string | null };

    const oldestISO = parseRussianDate(state.oldestDate);
    process.stderr.write(
      `[${chatId}] Loaded: ${state.count}, oldest: ${oldestISO ?? state.oldestDate ?? "unknown"}\n`,
    );

    if (stopDate && oldestISO && oldestISO <= stopDate) {
      process.stderr.write(`[${chatId}] Reached stop date ${stopDate}.\n`);
      break;
    }

    if (state.count >= MAX_MESSAGES_PER_CHAT) {
      process.stderr.write(
        `[${chatId}] Reached message limit ${MAX_MESSAGES_PER_CHAT}.\n`,
      );
      break;
    }

    await page.evaluate(`document.querySelector('${SCROLLER}').scrollTop = 0`);
    await page.waitForTimeout(1500);

    const newCount = (await page.evaluate(
      `document.querySelectorAll('.history.svelte-3850xr .item').length`,
    )) as number;
    if (newCount === state.count) {
      process.stderr.write(`[${chatId}] No more messages.\n`);
      break;
    }
  }

  const messages = (await page.evaluate(`(() => {
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
  })()`)) as {
    date: string | null;
    time: string;
    author: string;
    text: string;
  }[];

  saveMessages(chatId, messages);
  process.stderr.write(`[${chatId}] Saved ${messages.length} messages.\n`);
}

// --- sync entry point ---

export async function syncAll(): Promise<void> {
  const FOLDER_IN_MAX = process.env.FOLDER_IN_MAX ?? "Сферум";

  // Early exit if everything is cached
  if (!isChatsStale(CHAT_LIST_TTL_MS)) {
    const cached = getChats();
    if (cached.every((c) => !isChatHistoryStale(c.id, CHAT_HISTORY_TTL_MS))) {
      process.stderr.write("All data fresh, skipping browser launch.\n");
      return;
    }
  }

  const context: BrowserContext = await chromium.launchPersistentContext(
    userDataDir,
    {
      headless: true,
      channel: "chrome",
      args: ["--remote-debugging-port=9222"],
    },
  );

  const page = context.pages()[0] ?? (await context.newPage());

  let chats: { id: string; name: string; url: string }[];

  if (!isChatsStale(CHAT_LIST_TTL_MS)) {
    process.stderr.write("Using cached chat list.\n");
    chats = getChats();
  } else {
    process.stderr.write("Fetching chat list...\n");
    chats = await fetchChats(page, FOLDER_IN_MAX);
    process.stderr.write(`Found ${chats.length} chats.\n`);
  }

  for (const chat of chats) {
    if (!isChatHistoryStale(chat.id, CHAT_HISTORY_TTL_MS)) {
      process.stderr.write(`[${chat.id}] History fresh, skipping.\n`);
      continue;
    }
    process.stderr.write(`Syncing history: ${chat.name}\n`);
    const stopDate = getLatestMessageDate(chat.id);
    if (stopDate) process.stderr.write(`[${chat.id}] Stop date: ${stopDate}\n`);
    await fetchHistory(page, chat.id, chat.url, stopDate);
    markChatSynced(chat.id);
  }

  await context.close();
}
