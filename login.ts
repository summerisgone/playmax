import { launchBrowser } from "./browser";

export async function login() {
  const context = await launchBrowser({
    headless: false,
  });

  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto("https://web.max.ru/");

  console.log("Log in, then press Ctrl+C to save the session and exit.");

  await new Promise(() => {});
}
