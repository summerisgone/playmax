import { chromium } from "@playwright/test";
import {
  cleanupStaleChromeProfileLocks,
  getPersistentContextOptions,
  USER_DATA_DIR,
} from "./runtime";

export async function login() {
  cleanupStaleChromeProfileLocks(USER_DATA_DIR);
  const context = await chromium.launchPersistentContext(
    USER_DATA_DIR,
    getPersistentContextOptions({
      headless: false,
    }),
  );

  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto("https://web.max.ru/");

  console.log("Log in, then press Ctrl+C to save the session and exit.");

  await new Promise(() => {});
}
