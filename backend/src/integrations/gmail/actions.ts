import nodemailer from "nodemailer";
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

const GMAIL_ERROR_CALLBACK = [
  ...COMMON_ERROR_CALLBACK,
  { path: "from", label: "From address" },
  { path: "to", label: "To address" },
  { path: "subject", label: "Subject" },
];

function requireFromEmail(integrationConfig: Record<string, unknown>, step: ActionDefinition): string {
  const from = String(integrationConfig.email ?? "").trim();
  if (!from) {
    failStep({
      message: "Gmail address is not configured — add it in Integrations",
      code: "gmail.missing_email",
      integration: "gmail",
      step: step.id,
      stepLabel: step.label,
      kind: "action",
      plan: step.actionPlan,
      extras: { from: "", to: "", subject: "" },
    });
  }
  return from;
}

function requireAppPassword(integrationConfig: Record<string, unknown>, step: ActionDefinition): string {
  const password = String(integrationConfig.appPassword ?? "").replace(/\s+/g, "");
  if (!password) {
    failStep({
      message: "Gmail app password is not configured — create one in Google Account → Security",
      code: "gmail.missing_app_password",
      integration: "gmail",
      step: step.id,
      stepLabel: step.label,
      kind: "action",
      plan: step.actionPlan,
      extras: { from: "", to: "", subject: "" },
    });
  }
  return password;
}

function resolveTo(
  config: Record<string, unknown>,
  integrationConfig: Record<string, unknown>,
  triggerData: Record<string, unknown>,
  step: ActionDefinition,
): string {
  const raw = String(config.to ?? integrationConfig.defaultTo ?? "").trim();
  const to = interpolate(raw, triggerData).trim();
  if (!to) {
    failStep({
      message: "Recipient address is empty — set To on the action or a default in Integrations",
      code: "gmail.missing_to",
      integration: "gmail",
      step: step.id,
      stepLabel: step.label,
      kind: "action",
      plan: step.actionPlan,
      extras: { from: String(integrationConfig.email ?? ""), to: "", subject: "" },
    });
  }
  return to;
}

async function sendGmailMessage(options: {
  from: string;
  appPassword: string;
  to: string;
  subject: string;
  text: string;
  step: ActionDefinition;
}) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: options.from,
      pass: options.appPassword,
    },
  });

  try {
    await transporter.sendMail({
      from: options.from,
      to: options.to,
      subject: options.subject,
      text: options.text,
    });
  } catch (err) {
    failStep({
      message: err instanceof Error ? err.message : "Gmail send failed",
      code: "gmail.send_failed",
      integration: "gmail",
      step: options.step.id,
      stepLabel: options.step.label,
      kind: "action",
      plan: options.step.actionPlan,
      extras: {
        from: options.from,
        to: options.to,
        subject: options.subject,
      },
    });
  }
}

export const sendEmail: ActionDefinition = {
  id: "send_email",
  label: "Send an email",
  description: "Send an email through your Gmail account.",
  actionPlan: [
    "Load Gmail address and app password from Integrations",
    "Resolve To / Subject / Body with template variables",
    "Send via Gmail SMTP and confirm delivery",
  ],
  errorCallback: GMAIL_ERROR_CALLBACK,
  fields: [
    {
      key: "to",
      label: "To",
      type: "text",
      required: false,
      placeholder: "friend@example.com (or use Integrations default)",
    },
    {
      key: "subject",
      label: "Subject",
      type: "text",
      required: true,
      placeholder: "Alert from if-else",
    },
    {
      key: "body",
      label: "Body",
      type: "textarea",
      required: true,
      placeholder: "Good morning! {{weather.report}}",
    },
  ],
  async execute(config, context) {
    const from = requireFromEmail(context.integrationConfig, sendEmail);
    const appPassword = requireAppPassword(context.integrationConfig, sendEmail);
    const to = resolveTo(config, context.integrationConfig, context.triggerData, sendEmail);
    const subject = interpolate(String(config.subject ?? ""), context.triggerData).trim() || "(no subject)";
    const text = interpolate(String(config.body ?? ""), context.triggerData);

    await sendGmailMessage({
      from,
      appPassword,
      to,
      subject,
      text,
      step: sendEmail,
    });
  },
};

export const sendWeatherReport: ActionDefinition = {
  id: "send_weather_report",
  label: "Send weather report",
  description: "Fetch current weather and email a formatted report via Gmail.",
  actionPlan: [
    "Load Gmail address and app password from Integrations",
    "Validate the selected place has coordinates",
    "Fetch weather from Open-Meteo and format a report",
    "Email the report via Gmail SMTP",
  ],
  errorCallback: [
    ...GMAIL_ERROR_CALLBACK,
    { path: "location", label: "Location", description: "Place used for the weather report" },
  ],
  fields: [
    {
      key: "to",
      label: "To",
      type: "text",
      required: false,
      placeholder: "friend@example.com (or use Integrations default)",
    },
    {
      key: "subject",
      label: "Subject",
      type: "text",
      required: false,
      placeholder: "Weather report",
      default: "Weather report",
    },
    {
      key: "location",
      label: "Place",
      type: "place",
      required: true,
      placeholder: "Search for a city…",
    },
  ],
  async execute(config, context) {
    const from = requireFromEmail(context.integrationConfig, sendWeatherReport);
    const appPassword = requireAppPassword(context.integrationConfig, sendWeatherReport);
    const to = resolveTo(config, context.integrationConfig, context.triggerData, sendWeatherReport);
    const location = String(config.location ?? "Unknown");
    const lat = Number(config.latitude);
    const lon = Number(config.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      failStep({
        message: "Pick a place so latitude and longitude are set",
        code: "gmail.missing_place",
        integration: "gmail",
        step: sendWeatherReport.id,
        stepLabel: sendWeatherReport.label,
        kind: "action",
        plan: sendWeatherReport.actionPlan,
        extras: { from, to, subject: "", location },
      });
    }

    let report: string;
    try {
      const snapshot = await fetchWeatherSnapshot(lat, lon, location);
      report = formatWeatherReport(snapshot);
    } catch (err) {
      failStep({
        message: err instanceof Error ? err.message : "Weather fetch failed",
        code: "gmail.weather_fetch_failed",
        integration: "gmail",
        step: sendWeatherReport.id,
        stepLabel: sendWeatherReport.label,
        kind: "action",
        plan: sendWeatherReport.actionPlan,
        extras: { from, to, subject: "", location },
      });
    }

    const header = context.triggerData.time
      ? `Good morning! (${context.triggerData.time} ${context.triggerData.timezone ?? ""})\n\n`
      : "";
    const subject =
      interpolate(String(config.subject ?? "Weather report"), context.triggerData).trim() ||
      "Weather report";

    await sendGmailMessage({
      from,
      appPassword,
      to,
      subject,
      text: `${header}${report}`,
      step: sendWeatherReport,
    });
  },
};
