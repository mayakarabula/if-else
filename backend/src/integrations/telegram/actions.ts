import type { ActionDefinition } from "../types.js";
import { fetchWeatherSnapshot, formatWeatherReport } from "../weather/client.js";

function interpolate(template: string, data: Record<string, unknown>): string {
  const context = { ...data, trigger: data };
  return template.replace(/\{\{([^}]+)\}\}/g, (_, path: string) => {
    const keys = path.trim().split(".");
    let value: unknown = context;
    for (const key of keys) {
      if (value && typeof value === "object" && key in (value as object)) {
        value = (value as Record<string, unknown>)[key];
      } else {
        return "";
      }
    }
    return String(value ?? "");
  });
}

function resolveChatId(
  config: Record<string, unknown>,
  integrationConfig: Record<string, unknown>,
): string {
  const chatId = String(config.chatId ?? integrationConfig.chatId ?? "").trim();
  if (!chatId) {
    throw new Error("Telegram chat ID is not configured — add it in Integrations");
  }
  return chatId;
}

async function sendTelegramMessage(botToken: string, chatId: string, text: string) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram API error: ${res.status} ${body}`);
  }
}

export const sendMessage: ActionDefinition = {
  id: "send_message",
  label: "Send a message",
  description: "Send a message to a Telegram chat.",
  fields: [
    {
      key: "text",
      label: "Message",
      type: "textarea",
      required: true,
      placeholder: "Good morning! {{weather.report}}",
    },
  ],
  async execute(config, context) {
    const botToken = String(context.integrationConfig.botToken ?? "");
    if (!botToken) {
      throw new Error("Telegram bot token is not configured");
    }

    const chatId = resolveChatId(config, context.integrationConfig);
    const template = String(config.text ?? "");
    const text = interpolate(template, context.triggerData);

    await sendTelegramMessage(botToken, chatId, text);
  },
};

export const sendWeatherReport: ActionDefinition = {
  id: "send_weather_report",
  label: "Send weather report",
  description: "Fetch current weather and send a formatted report to Telegram.",
  fields: [
    {
      key: "location",
      label: "Place",
      type: "place",
      required: true,
      placeholder: "Search for a city…",
    },
  ],
  async execute(config, context) {
    const botToken = String(context.integrationConfig.botToken ?? "");
    if (!botToken) {
      throw new Error("Telegram bot token is not configured");
    }

    const chatId = resolveChatId(config, context.integrationConfig);
    const location = String(config.location ?? "Unknown");
    const lat = Number(config.latitude);
    const lon = Number(config.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new Error("Pick a place so latitude and longitude are set");
    }

    const snapshot = await fetchWeatherSnapshot(lat, lon, location);
    const report = formatWeatherReport(snapshot);
    const header = context.triggerData.time
      ? `☀️ Good morning! (${context.triggerData.time} ${context.triggerData.timezone ?? ""})\n\n`
      : "";

    await sendTelegramMessage(botToken, chatId, `${header}${report}`);
  },
};
