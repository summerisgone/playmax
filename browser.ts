import { chromium } from "@playwright/test";
import {
  cleanupStaleChromeProfileLocks,
  getPersistentContextOptions,
  USER_DATA_DIR,
} from "./runtime";

(async () => {
  cleanupStaleChromeProfileLocks(USER_DATA_DIR);
  const context = await chromium.launchPersistentContext(
    USER_DATA_DIR,
    getPersistentContextOptions({
      headless: false,
      args: ["--remote-debugging-port=9222"],
    }),
  );

  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto("about:blank");

  console.log("Browser is open. Press Ctrl+C to exit.");

  // keep process alive
  await new Promise(() => {});
})();
