// notify.js — Feishu group bot webhook notifications
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  try {
    const content = readFileSync(resolve(__dirname, ".env"), "utf-8");
    const env = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const [key, ...rest] = trimmed.split("=");
      env[key.trim()] = rest.join("=").trim();
    }
    return env;
  } catch {
    return {};
  }
}

const env = loadEnv();
const WEBHOOK_URL = env.FEISHU_WEBHOOK_URL;

/**
 * Send a notification to Feishu group bot.
 * @param {string} title - Card title
 * @param {string} content - Markdown content
 * @param {"red"|"orange"|"green"} color - Card header color
 */
let _webhookWarned = false;
export async function notify(title, content, color = "orange") {
  if (!WEBHOOK_URL) {
    if (!_webhookWarned) { console.log("  ⚠️  FEISHU_WEBHOOK_URL not set, skipping notifications"); _webhookWarned = true; }
    return;
  }

  const body = {
    msg_type: "interactive",
    card: {
      header: {
        title: { tag: "plain_text", content: title },
        template: color,
      },
      elements: [
        { tag: "markdown", content },
      ],
    },
  };

  try {
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (json.code !== 0) {
      console.error("  Webhook error:", json.msg);
    }
  } catch (err) {
    console.error("  Webhook failed:", err.message);
  }
}

/**
 * Send a batch alert (multiple items in one card).
 * @param {string} title
 * @param {Array<{emoji: string, text: string}>} items
 * @param {"red"|"orange"|"green"} color
 */
export async function notifyBatch(title, items, color = "orange") {
  if (!items.length) return;
  const content = items.map(i => `${i.emoji} ${i.text}`).join("\n");
  await notify(title, content, color);
}
