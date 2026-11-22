import { failStep } from "../errors.js";
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

const COMMON_ERROR_CALLBACK = [
  { path: "message", label: "Error message" },
  { path: "code", label: "Error code" },
  { path: "integration", label: "Integration id" },
  { path: "step", label: "Step id" },
  { path: "stepLabel", label: "Step label" },
  { path: "kind", label: "Step kind", description: "trigger or action" },
  { path: "plan", label: "Action plan", description: "Planned steps joined with →" },
];

const TELEGRAM_ERROR_CALLBACK = [
  ...COMMON_ERROR_CALLBACK,
  { path: "chatId", label: "Chat ID", description: "Telegram chat that was targeted" },
];

function resolveChatId(
  config: Record<string, unknown>,
  integrationConfig: Record<string, unknown>,
  step: ActionDefinition,
): string {
  const chatId = String(config.chatId ?? integrationConfig.chatId ?? "").trim();
  if (!chatId) {
    failStep({
      message: "Telegram chat ID is not configured — add it in Integrations",
      code: "telegram.missing_chat_id",
      integration: "telegram",
      step: step.id,
      stepLabel: step.label,
      kind: "action",
      plan: step.actionPlan,
      extras: { chatId: "" },
    });
  }
  return chatId;
}

function requireBotToken(integrationConfig: Record<string, unknown>, step: ActionDefinition): string {
  const botToken = String(integrationConfig.botToken ?? "");
  if (!botToken) {
    failStep({
      message: "Telegram bot token is not configured",
      code: "telegram.missing_bot_token",
      integration: "telegram",
      step: step.id,
      stepLabel: step.label,
      kind: "action",
      plan: step.actionPlan,
      extras: { chatId: "" },
    });
  }
  return botToken;
}

async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
  step: ActionDefinition,
) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });

  if (!res.ok) {
    const body = await res.text();
    failStep({
      message: `Telegram API error: ${res.status} ${body}`,
      code: "telegram.api_error",
      integration: "telegram",
      step: step.id,
      stepLabel: step.label,
      kind: "action",
      plan: step.actionPlan,
      extras: { chatId, status: res.status },
    });
  }
}

export const sendMessage: ActionDefinition = {
  id: "send_message",
  label: "Send a message",
  description: "Send a message to a Telegram chat.",
  actionPlan: [
    "Load bot token and chat ID from Integrations",
    "Interpolate template variables into the message",
    "Call Telegram sendMessage and confirm delivery",
  ],
  errorCallback: TELEGRAM_ERROR_CALLBACK,
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
    const botToken = requireBotToken(context.integrationConfig, sendMessage);
    const chatId = resolveChatId(config, context.integrationConfig, sendMessage);
    const template = String(config.text ?? "");
    const text = interpolate(template, context.triggerData);
    await sendTelegramMessage(botToken, chatId, text, sendMessage);
  },
};

export const sendWeatherReport: ActionDefinition = {
  id: "send_weather_report",
  label: "Send weather report",
  description: "Fetch current weather and send a formatted report to Telegram.",
  actionPlan: [
    "Load bot token and chat ID from Integrations",
    "Validate the selected place has coordinates",
    "Fetch weather from Open-Meteo and format a report",
    "Send the report to Telegram",
  ],
  errorCallback: [
    ...TELEGRAM_ERROR_CALLBACK,
    { path: "location", label: "Location", description: "Place used for the weather report" },
  ],
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
    const botToken = requireBotToken(context.integrationConfig, sendWeatherReport);
    const chatId = resolveChatId(config, context.integrationConfig, sendWeatherReport);
    const location = String(config.location ?? "Unknown");
    const lat = Number(config.latitude);
    const lon = Number(config.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      failStep({
        message: "Pick a place so latitude and longitude are set",
        code: "telegram.missing_place",
        integration: "telegram",
        step: "send_weather_report",
        stepLabel: sendWeatherReport.label,
        kind: "action",
        plan: sendWeatherReport.actionPlan,
        extras: { chatId, location },
      });
    }

    let report: string;
    try {
      const snapshot = await fetchWeatherSnapshot(lat, lon, location);
      report = formatWeatherReport(snapshot);
    } catch (err) {
      failStep({
        message: err instanceof Error ? err.message : "Weather fetch failed",
        code: "telegram.weather_fetch_failed",
        integration: "telegram",
        step: "send_weather_report",
        stepLabel: sendWeatherReport.label,
        kind: "action",
        plan: sendWeatherReport.actionPlan,
        extras: { chatId, location },
      });
    }

    const header = context.triggerData.time
      ? `☀️ Good morning! (${context.triggerData.time} ${context.triggerData.timezone ?? ""})\n\n`
      : "";

    await sendTelegramMessage(botToken, chatId, `${header}${report}`, sendWeatherReport);
  },
};
