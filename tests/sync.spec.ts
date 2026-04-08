import { expect, test } from "bun:test";

const { isSkippableMessageImageSrc } = await import("../sync");

test("skips inline emoji assets when detecting message images", () => {
  expect(isSkippableMessageImageSrc("https://st.max.ru/emojis/1F60A_32.webp")).toBe(true);
  expect(
    isSkippableMessageImageSrc(
      "https://i.oneme.ru/i?r=BTE2sh_eZW7g8kugOdIm2NotSEdoAfGn2bTRctjVB6MOhwnc4ulgepyb03DraHbRe60",
    ),
  ).toBe(false);
});
