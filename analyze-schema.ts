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
        additionalProperties: false,
        required: ["category", "summary", "details", "urgency"],
        properties: {
          category: {
            type: "string",
            enum: [...EVENT_CATEGORIES],
          },
          summary: {
            type: "string",
          },
          details: {
            type: "object",
            additionalProperties: false,
            properties: {
              amount: {
                type: "string",
              },
              date: {
                type: "string",
                pattern: "^\\d{4}-\\d{2}-\\d{2}$",
              },
              action_required: {
                type: "string",
              },
            },
          },
          urgency: {
            type: "string",
            enum: [...EVENT_URGENCIES],
          },
          source_quotes: {
            type: "array",
            items: {
              type: "string",
            },
          },
          url: {
            type: "string",
          },
          source: {
            type: "string",
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

export function parseAnalyzeResponse(raw: unknown): AnalyzeResponse {
  const value = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!validateAnalyzeResponse(value)) {
    const details = ajv.errorsText(validateAnalyzeResponse.errors, {
      separator: "; ",
    });
    throw new Error(`LLM response does not match analyze schema: ${details}`);
  }

  return value;
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
