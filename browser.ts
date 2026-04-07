import { chromium } from "@playwright/test";
import type { BrowserContext } from "@playwright/test";
import {
  cleanupStaleChromeProfileLocks,
  getPersistentContextOptions,
  USER_DATA_DIR,
} from "./runtime";

type LaunchPersistentContextOptions = Parameters<
  typeof chromium.launchPersistentContext
>[1];

export async function launchBrowser(
  overrides: LaunchPersistentContextOptions = {},
): Promise<BrowserContext> {
  cleanupStaleChromeProfileLocks(USER_DATA_DIR);
  return chromium.launchPersistentContext(
    USER_DATA_DIR,
    getPersistentContextOptions(overrides),
  );
}

async function main(): Promise<void> {
  const context = await launchBrowser({
    headless: false,
    args: ["--remote-debugging-port=9222"],
  });

  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto("about:blank");

  console.log("Browser is open. Press Ctrl+C to exit.");

  // keep process alive
  await new Promise(() => {});
}

if (import.meta.main) {
  await main();
}
