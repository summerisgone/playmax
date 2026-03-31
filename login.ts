import { chromium } from "@playwright/test";
import path from "path";

const userDataDir = path.join(__dirname, "chrome-profile");

export async function login() {
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    channel: "chrome",
  });

  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto("https://web.max.ru/");

  console.log("Log in, then press Ctrl+C to save the session and exit.");

  await new Promise(() => {});
}
