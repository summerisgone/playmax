import { afterAll, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import sharp from "sharp";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "playmax-analyze-"));

const { prepareImageForLlm } = await import("../llm-images");

afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("prepareImageForLlm converts webp images to png", async () => {
  const webpPath = path.join(tempDir, "fixture.webp");
  await sharp({
    create: {
      width: 4,
      height: 3,
      channels: 3,
      background: { r: 255, g: 0, b: 0 },
    },
  })
    .webp()
    .toFile(webpPath);

  const prepared = await prepareImageForLlm(webpPath, "message-media/fixture.webp");

  expect(prepared.mimeType).toBe("image/png");
  expect(prepared.data.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
});
