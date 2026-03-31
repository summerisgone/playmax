import { Bot } from "grammy";

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

if (!BOT_TOKEN) throw new Error("BOT_TOKEN env var is required");
if (!CHAT_ID) throw new Error("CHAT_ID env var is required");

const bot = new Bot(BOT_TOKEN);

const result = await bot.api.sendMessage(CHAT_ID, "Test message from grammy");
console.log(JSON.stringify(result, null, 2));
