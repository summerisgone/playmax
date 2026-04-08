import Ajv from "ajv";

export const EVENT_CATEGORIES = [
  "money",
  "event",
  "vote",
  "olympiad",
  "announcement",
  "deadline",
  "document",
] as const;

export const EVENT_URGENCIES = ["high", "medium", "low"] as const;

export interface LLMEvent {
  category: (typeof EVENT_CATEGORIES)[number];
  summary: string;
  emoji?: string;
  details: {
    amount?: string;
    date?: string;
    action_required?: string;
  };
  urgency: (typeof EVENT_URGENCIES)[number];
  source_quotes?: string[];
  url?: string;
  source?: string;
}

export interface AnalyzeResponse {
  events: LLMEvent[];
}

export type AnalyzeUserContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;

const ANALYZE_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["events"],
  properties: {
    events: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        properties: {
          category: {
            type: ["string", "null"],
          },
          summary: {
            type: ["string", "null"],
          },
          emoji: {
            type: ["string", "null"],
          },
          details: {
            type: ["object", "null"],
            additionalProperties: true,
            properties: {
              amount: {
                type: ["string", "number", "null"],
              },
              date: {
                type: ["string", "number", "null"],
              },
              action_required: {
                type: ["string", "null"],
              },
            },
          },
          urgency: {
            type: ["string", "null"],
          },
          source_quotes: {
            anyOf: [
              {
                type: "array",
                items: {
                  type: "string",
                },
              },
              {
                type: "string",
              },
              {
                type: "null",
              },
            ],
          },
          url: {
            type: ["string", "null"],
          },
          source: {
            type: ["string", "null"],
          },
        },
      },
    },
  },
} as const;

export const ANALYZE_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "school_chat_events",
    strict: true,
    schema: ANALYZE_RESPONSE_SCHEMA,
  },
} as const;

const ajv = new Ajv({
  allErrors: true,
  strict: false,
});

const validateAnalyzeResponse = ajv.compile<AnalyzeResponse>(ANALYZE_RESPONSE_SCHEMA);

const EVENT_CATEGORY_SET = new Set<string>(EVENT_CATEGORIES);
const EVENT_URGENCY_SET = new Set<string>(EVENT_URGENCIES);
const DEFAULT_CATEGORY: LLMEvent["category"] = "announcement";
const DEFAULT_URGENCY: LLMEvent["urgency"] = "medium";
const SUMMARY_PLACEHOLDERS = new Set([
  "без краткого описания",
  "без описания",
  "нет описания",
  "нет краткого описания",
  "не указано",
  "n/a",
  "na",
  "null",
  "none",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed : undefined;
}

function normalizeLooseString(value: unknown): string | undefined {
  if (typeof value === "number") return String(value);
  return normalizeString(value);
}

function normalizeSourceQuotes(value: unknown): string[] | undefined {
  if (typeof value === "string") {
    const quote = value.trim();
    return quote ? [quote] : undefined;
  }

  if (!Array.isArray(value)) return undefined;

  const quotes = value
    .map((item) => normalizeLooseString(item))
    .filter((item): item is string => Boolean(item));

  return quotes.length > 0 ? quotes : undefined;
}

function truncateText(value: string, maxLength = 120): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

function normalizeSummaryCandidate(value: unknown): string | undefined {
  const normalized = normalizeLooseString(value);
  if (!normalized) return undefined;

  const summary = truncateText(normalized);
  if (summary.length < 4) return undefined;
  if (SUMMARY_PLACEHOLDERS.has(summary.toLowerCase())) return undefined;

  return summary;
}

function extractEventCandidates(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return undefined;

  for (const key of ["events", "items", "result"]) {
    const candidate = value[key];
    if (Array.isArray(candidate)) return candidate;
  }

  if (isRecord(value.data)) {
    const nested = extractEventCandidates(value.data);
    if (nested) return nested;
  }

  if (isRecord(value.event)) {
    return [value.event];
  }

  return undefined;
}

function normalizeEvent(value: unknown): LLMEvent | undefined {
  const event = isRecord(value) ? value : {};
  const details = isRecord(event.details) ? event.details : {};
  const rawCategory = normalizeString(event.category);
  const rawUrgency = normalizeString(event.urgency);
  const sourceQuotes =
    normalizeSourceQuotes(event.source_quotes) ??
    normalizeSourceQuotes(event.source_quote);
  const category = EVENT_CATEGORY_SET.has(rawCategory ?? "")
    ? (rawCategory as LLMEvent["category"])
    : DEFAULT_CATEGORY;
  const amount =
    normalizeLooseString(details.amount) ??
    normalizeLooseString(details.sum) ??
    normalizeLooseString(details.price);
  const date = normalizeLooseString(details.date);
  const actionRequired =
    normalizeString(details.action_required) ??
    normalizeString(details.action) ??
    normalizeString(details.todo);
  const summary =
    normalizeSummaryCandidate(event.summary) ??
    normalizeSummaryCandidate(event.title) ??
    normalizeSummaryCandidate(event.text) ??
    normalizeSummaryCandidate(event.description) ??
    normalizeSummaryCandidate(event.name) ??
    normalizeSummaryCandidate(event.subject) ??
    normalizeSummaryCandidate(event.headline) ??
    normalizeSummaryCandidate(event.what) ??
    normalizeSummaryCandidate(details.summary) ??
    normalizeSummaryCandidate(details.title) ??
    normalizeSummaryCandidate(details.subject) ??
    normalizeSummaryCandidate(actionRequired) ??
    normalizeSummaryCandidate(sourceQuotes?.[0]) ??
    (category === "money" && amount
      ? normalizeSummaryCandidate(`Сбор ${amount}`)
      : undefined) ??
    (category === "deadline" && date
      ? normalizeSummaryCandidate(`Дедлайн до ${date}`)
      : undefined);

  if (!summary) return undefined;

  return {
    category,
    summary,
    emoji: normalizeString(event.emoji),
    details: {
      amount,
      date,
      action_required: actionRequired,
    },
    urgency: EVENT_URGENCY_SET.has(rawUrgency ?? "")
      ? (rawUrgency as LLMEvent["urgency"])
      : DEFAULT_URGENCY,
    source_quotes: sourceQuotes,
    url: normalizeString(event.url),
    source: normalizeString(event.source),
  };
}

export function parseAnalyzeResponse(raw: unknown): AnalyzeResponse {
  const value = typeof raw === "string" ? JSON.parse(raw) : raw;
  const candidates = extractEventCandidates(value);
  const schemaCandidate = Array.isArray(candidates) ? { events: candidates } : value;
  const normalizedFromCandidates = Array.isArray(candidates)
    ? candidates
        .map((event) => normalizeEvent(event))
        .filter((event): event is LLMEvent => Boolean(event))
    : [];

  if (!validateAnalyzeResponse(schemaCandidate)) {
    if (Array.isArray(candidates)) {
      return { events: normalizedFromCandidates };
    }

    const details = ajv.errorsText(validateAnalyzeResponse.errors, {
      separator: "; ",
    });
    throw new Error(`LLM response does not match analyze schema: ${details}`);
  }

  return {
    events: schemaCandidate.events
      .map((event: unknown) => normalizeEvent(event))
      .filter((event: LLMEvent | undefined): event is LLMEvent => Boolean(event)),
  };
}

export function buildAnalyzeRequestBody(
  systemPrompt: string,
  userContent: AnalyzeUserContent,
  model: string,
) {
  return {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    response_format: ANALYZE_RESPONSE_FORMAT,
    temperature: 0.2,
  };
}
