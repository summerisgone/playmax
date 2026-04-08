import { launchBrowser } from "./browser";
import {
  describeBrowserTarget,
  getPreferredBrowserChannel,
  USER_DATA_DIR,
} from "./runtime";

export async function login() {
  const browserChannel = getPreferredBrowserChannel();
  const context = await launchBrowser({
    headless: false,
  });

  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto("https://web.max.ru/");

  console.log(`Opening ${describeBrowserTarget(browserChannel)}.`);
  console.log(`Profile directory: ${USER_DATA_DIR}`);
  console.log("Log in, then press Ctrl+C to save the session and exit.");

  await new Promise(() => {});
}
