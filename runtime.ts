import path from "path";
import fs from "fs";
import { chromium } from "@playwright/test";

type LaunchPersistentContextOptions = Parameters<
  typeof chromium.launchPersistentContext
>[1];

const DEFAULT_STATE_DIR = __dirname;
const LOCAL_CHROME_PATHS =
  process.platform === "darwin"
    ? [
        "/Applications/Google Chrome.app",
        path.join(process.env.HOME ?? "", "Applications/Google Chrome.app"),
      ]
    : [];

export const STATE_DIR = path.resolve(
  process.env.PLAYMAX_STATE_DIR ?? DEFAULT_STATE_DIR,
);
export const USER_DATA_DIR = path.join(STATE_DIR, "chrome-profile");
export const DB_PATH = path.join(STATE_DIR, "playmax.db");
export const MESSAGE_MEDIA_DIR = path.join(STATE_DIR, "message-media");

const CHROME_SINGLETON_FILES = [
  "SingletonLock",
  "SingletonCookie",
  "SingletonSocket",
];

function parseBool(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  return value === "1" || value.toLowerCase() === "true";
}

export function getPreferredBrowserChannel(): string | undefined {
  if (process.env.PLAYWRIGHT_IN_DOCKER === "1") return undefined;
  if (process.env.PLAYWRIGHT_BROWSER_CHANNEL) {
    return process.env.PLAYWRIGHT_BROWSER_CHANNEL;
  }
  for (const chromePath of LOCAL_CHROME_PATHS) {
    if (chromePath && fs.existsSync(chromePath)) return "chrome";
  }
  return undefined;
}

export function describeBrowserTarget(channel?: string): string {
  if (channel === "chrome") return "system Google Chrome";
  if (channel) return `Playwright browser channel \"${channel}\"`;
  return "Playwright bundled Chromium";
}

export function getPersistentContextOptions(
  overrides: LaunchPersistentContextOptions = {},
): LaunchPersistentContextOptions {
  const envHeadless = parseBool(process.env.PLAYWRIGHT_HEADLESS);
  const envChannel = getPreferredBrowserChannel();
  const headless = overrides.headless ?? envHeadless;
  const channel = overrides.channel ?? envChannel;
  const args = [...(overrides.args ?? [])];

  if (process.env.PLAYWRIGHT_IN_DOCKER === "1") {
    args.push(
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-software-rasterizer",
    );
  }

  return {
    ...overrides,
    ...(headless === undefined ? {} : { headless }),
    ...(channel ? { channel } : {}),
    args,
  };
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EPERM") return true;
    return false;
  }
}

export function cleanupStaleChromeProfileLocks(userDataDir: string): void {
  const lockPath = path.join(userDataDir, "SingletonLock");

  try {
    fs.lstatSync(lockPath);
  } catch {
    return;
  }

  let shouldCleanup = true;
  try {
    const link = fs.readlinkSync(lockPath);
    const pidMatch = link.match(/-(\d+)$/);
    if (pidMatch) shouldCleanup = !isProcessAlive(Number(pidMatch[1]));
  } catch {
    shouldCleanup = true;
  }

  if (!shouldCleanup) return;

  for (const file of CHROME_SINGLETON_FILES) {
    const filePath = path.join(userDataDir, file);
    try {
      fs.unlinkSync(filePath);
    } catch {}
  }
}
