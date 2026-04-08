import fs from "fs";
import path from "path";
import { Bot } from "grammy";
import { getUnanalyzedMessages, markAnalyzed, getChats } from "./db";
import { prepareImageForLlm } from "./llm-images";
import { STATE_DIR } from "./runtime";

// --- Telegram formatting ---

const categoryIcon: Record<string, string> = {
  money: "\u{1F4B0}",
  event: "\u{1F4C5}",
  vote: "\u{1F5F3}",
  olympiad: "\u{1F3C6}",
  announcement: "\u{1F4E2}",
  document: "\u{1F4C4}",
  deadline: "\u{23F0}",
};
const urgencyIcon: Record<string, string> = {
  high: "\u{1F534}",
  medium: "\u{1F7E1}",
};

function esc(text: string): string {
  return text.replace(
    /[<>&]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!,
  );
}

interface LLMEvent {
  category: string;
  summary: string;
  details: { amount?: string; date?: string; action_required?: string };
  urgency: string;
  source_quotes?: string[];
  url?: string;
  source?: string;
}

function formatEvents(
  chatName: string,
  events: LLMEvent[],
  chatUrl?: string,
): string {
  const sorted = [...events].sort((a, b) => {
    const order: Record<string, number> = { high: 0, medium: 1 };
    return (order[a.urgency] ?? 2) - (order[b.urgency] ?? 2);
  });

  const header = chatUrl
    ? `<b>\u{1F4CB} <a href="${esc(chatUrl)}">${esc(chatName)}</a></b>`
    : `<b>\u{1F4CB} ${esc(chatName)}</b>`;
  const lines: string[] = [`${header}\n`];

  for (const ev of sorted) {
    const cat = categoryIcon[ev.category] ?? "\u{2022}";
    const urg = urgencyIcon[ev.urgency] ?? "";
    lines.push(`${urg} ${cat} <b>${esc(ev.summary)}</b>`);
    if (ev.details.date) lines.push(`  \u{1F4C6} ${esc(ev.details.date)}`);
    if (ev.details.amount) lines.push(`  \u{1F4B5} ${esc(ev.details.amount)}`);
    if (ev.details.action_required)
      lines.push(`  \u{2705} <i>${esc(ev.details.action_required)}</i>`);
    if (ev.url && ev.source)
      lines.push(`  \u{1F517} <a href="${esc(ev.url)}">${esc(ev.source)}</a>`);
    lines.push("");
  }

  return lines.join("\n").trim();
}

// --- Main ---

export async function analyze(): Promise<void> {
  const OPENAI_API_BASE_URL = process.env.OPENAI_API_BASE_URL;
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const OPENAI_API_MODEL = process.env.OPENAI_API_MODEL;
  const BOT_TOKEN = process.env.BOT_TOKEN;
  const CHAT_ID = process.env.CHAT_ID;

  if (!OPENAI_API_BASE_URL)
    throw new Error("OPENAI_API_BASE_URL env var is required");
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY env var is required");
  if (!OPENAI_API_MODEL)
    throw new Error("OPENAI_API_MODEL env var is required");
  if (!BOT_TOKEN) throw new Error("BOT_TOKEN env var is required");
  if (!CHAT_ID) throw new Error("CHAT_ID env var is required");

  const MIN_NEW_MESSAGES = +(process.env.MIN_NEW_MESSAGES ?? 3);
  const MAX_MESSAGES_TO_ANALYZE = 500;
  const systemPrompt = fs.readFileSync(
    path.join(process.cwd(), "ANALYZE.md"),
    "utf-8",
  );
  const bot = new Bot(BOT_TOKEN);

  async function callLLM(
    userContent:
      | string
      | Array<
          | { type: "text"; text: string }
          | { type: "image_url"; image_url: { url: string } }
        >,
  ): Promise<string> {
    const url = `${OPENAI_API_BASE_URL!.replace(/\/$/, "")}/chat/completions`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_API_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        temperature: 0.2,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`LLM API error ${res.status}: ${body}`);
    }
    const json = (await res.json()) as any;
    return json.choices[0].message.content;
  }

  const allUnanalyzed = getUnanalyzedMessages();
  if (allUnanalyzed.length === 0) {
    process.stderr.write("No new messages to analyze.\n");
    return;
  }

  const byChatId = new Map<string, typeof allUnanalyzed>();
  for (const msg of allUnanalyzed) {
    let arr = byChatId.get(msg.chat_id);
    if (!arr) {
      arr = [];
      byChatId.set(msg.chat_id, arr);
    }
    arr.push(msg);
  }

  const chats = getChats();
  const chatNameMap = new Map(chats.map((c) => [c.id, c.name]));
  const chatUrlMap = new Map(chats.map((c) => [c.id, c.url]));

  for (const [chatId, messages] of byChatId) {
    if (messages.length < MIN_NEW_MESSAGES) {
      process.stderr.write(
        `Skipping ${chatId}: only ${messages.length} new messages (min ${MIN_NEW_MESSAGES})\n`,
      );
      continue;
    }

    const chatName = chatNameMap.get(chatId) ?? chatId;
    const chatUrl = chatUrlMap.get(chatId);

    const limited =
      messages.length > MAX_MESSAGES_TO_ANALYZE
        ? messages.slice(messages.length - MAX_MESSAGES_TO_ANALYZE)
        : messages;
    process.stderr.write(
      `Analyzing ${chatId} (${chatName}): ${limited.length}/${messages.length} new messages...\n`,
    );

    const userContent = await buildUserContent(limited);

    try {
      const raw = await callLLM(userContent);

      const jsonStr = raw
        .replace(/^```json\s*/, "")
        .replace(/\s*```$/, "")
        .trim();
      const parsed = JSON.parse(jsonStr) as { events: LLMEvent[] };

      if (parsed.events.length > 0) {
        const text = formatEvents(chatName, parsed.events, chatUrl);
        const result = await bot.api.sendMessage(CHAT_ID, text, {
          parse_mode: "HTML",
        });
        process.stderr.write(`Sent message_id: ${result.message_id}\n`);
      } else {
        process.stderr.write(`No important events found in ${chatId}.\n`);
      }

      markAnalyzed(limited.map((message) => message.id));
      process.stderr.write(`Marked ${limited.length} messages in ${chatId} as analyzed.\n`);
    } catch (e) {
      process.stderr.write(`Error analyzing ${chatId}: ${e}\n`);
      // Don't mark as analyzed - will retry next run
    }
  }
}

async function buildUserContent(
  messages: ReturnType<typeof getUnanalyzedMessages>,
): Promise<
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >
> {
  const imageParts: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = [];
  const lines: string[] = [];
  let imageIndex = 0;

  for (const message of messages) {
    const author = message.author || "Неизвестный автор";
    const body = message.text || "[в сообщении есть изображение]";

    if (message.image_path) {
      const absPath = path.join(STATE_DIR, message.image_path);
      if (fs.existsSync(absPath)) {
        try {
          const prepared = await prepareImageForLlm(absPath, message.image_path);
          imageIndex += 1;
          lines.push(`[${message.date} ${message.time}] ${author}: ${body} [image ${imageIndex}]`);
          imageParts.push({
            type: "image_url",
            image_url: {
              url: `data:${prepared.mimeType};base64,${prepared.data.toString("base64")}`,
            },
          });
        } catch (error) {
          lines.push(`[${message.date} ${message.time}] ${author}: ${body}`);
          lines.push(`[image_unreadable ${message.image_path}: ${String(error)}]`);
        }
      } else {
        lines.push(`[${message.date} ${message.time}] ${author}: ${body}`);
        lines.push(`[image_missing ${message.image_path}]`);
      }
    } else {
      lines.push(`[${message.date} ${message.time}] ${author}: ${body}`);
    }
  }

  const prompt = lines.join("\n");
  if (imageParts.length === 0) return prompt;

  const textBlock = `${prompt}\n\nИзображения приложены ниже в порядке пометок [image N].`;
  return [{ type: "text", text: textBlock }, ...imageParts];
}
