import { expect, test } from "bun:test";

import {
  ANALYZE_RESPONSE_FORMAT,
  buildAnalyzeRequestBody,
  parseAnalyzeResponse,
} from "../analyze-schema";

test("buildAnalyzeRequestBody sends strict json schema to chat completions", () => {
  const body = buildAnalyzeRequestBody(
    "system prompt",
    "user prompt",
    "gpt-test",
  );

  expect(body.model).toBe("gpt-test");
  expect(body.response_format).toEqual(ANALYZE_RESPONSE_FORMAT);
  expect(body.response_format.type).toBe("json_schema");
  expect(body.response_format.json_schema.strict).toBe(true);
  expect(body.response_format.json_schema.schema).toMatchObject({
    type: "object",
    required: ["events"],
    additionalProperties: false,
  });
});

test("parseAnalyzeResponse validates and keeps structured events", () => {
  const parsed = parseAnalyzeResponse(
    JSON.stringify({
      events: [
        {
          category: "money",
          summary: "Сдать 500 рублей на экскурсию.",
          details: {
            amount: "500 рублей",
            date: "2026-04-10",
            action_required: "Перевести деньги до пятницы",
          },
          urgency: "high",
          source_quotes: ["Сдаем по 500 рублей до пятницы"],
        },
      ],
    }),
  );

  expect(parsed.events).toHaveLength(1);
  expect(parsed.events[0]).toMatchObject({
    category: "money",
    urgency: "high",
    details: {
      amount: "500 рублей",
      date: "2026-04-10",
      action_required: "Перевести деньги до пятницы",
    },
    source_quotes: ["Сдаем по 500 рублей до пятницы"],
  });
});

test("parseAnalyzeResponse tolerates sparse and extended events", () => {
  const parsed = parseAnalyzeResponse({
    events: [
      {
        title: "Экскурсия",
        details: {
          date: "10 апреля 2026",
          place: "музей",
        },
        source_quotes: "Собираемся в музей в субботу",
        extra_field: true,
      },
    ],
  });

  expect(parsed.events).toEqual([
    {
      category: "announcement",
      summary: "Экскурсия",
      details: {
        amount: undefined,
        date: "10 апреля 2026",
        action_required: undefined,
      },
      urgency: "medium",
      source_quotes: ["Собираемся в музей в субботу"],
      url: undefined,
      source: undefined,
    },
  ]);
});

test("parseAnalyzeResponse still rejects payloads with invalid top-level shape", () => {
  expect(() =>
    parseAnalyzeResponse({
      result: [],
    }),
  ).toThrow(/does not match analyze schema/);
});
