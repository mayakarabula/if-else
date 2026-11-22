import { failStep } from "../errors.js";
import type { TriggerDefinition } from "../types.js";

function getZonedTime(timezone: string, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  const hourRaw = get("hour");

  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(hourRaw === "24" ? "0" : hourRaw),
    minute: Number(get("minute")),
    label: `${hourRaw.padStart(2, "0")}:${get("minute")}`,
  };
}

const TIMEZONE_OPTIONS = Intl.supportedValuesOf("timeZone").map((timezone) => ({
  value: timezone,
  label: timezone.replaceAll("_", " "),
}));

const COMMON_ERROR_CALLBACK = [
  { path: "message", label: "Error message" },
  { path: "code", label: "Error code" },
  { path: "integration", label: "Integration id" },
  { path: "step", label: "Step id" },
  { path: "stepLabel", label: "Step label" },
  { path: "kind", label: "Step kind", description: "trigger or action" },
  { path: "plan", label: "Action plan", description: "Planned steps joined with →" },
];

const INTERVAL_OPTIONS = [
  { value: "30s", label: "Every 30 seconds" },
  { value: "1m", label: "Every 1 minute" },
  { value: "5m", label: "Every 5 minutes" },
  { value: "15m", label: "Every 15 minutes" },
  { value: "30m", label: "Every 30 minutes" },
  { value: "1h", label: "Every hour" },
  { value: "6h", label: "Every 6 hours" },
  { value: "12h", label: "Every 12 hours" },
  { value: "24h", label: "Every day" },
];

/** Interval poll — always passes when the scheduler runs the rule; interval drives enqueue cadence. */
export const every: TriggerDefinition = {
  id: "every",
  label: "Every",
  description: "Poll on an interval while the rule runs on a timer. Use this instead of a separate poll setting.",
  actionPlan: [
    "Read the configured poll interval",
    "The scheduler enqueues the rule on that cadence when Run when is On a timer",
    "This condition passes on each scheduled poll (and on manual / webhook runs)",
  ],
  errorCallback: COMMON_ERROR_CALLBACK,
  fields: [
    {
      key: "interval",
      label: "Interval",
      type: "select",
      required: true,
      default: "15m",
      options: INTERVAL_OPTIONS,
    },
  ],
  outputs: [
    { path: "interval", label: "Interval", description: "Configured poll interval, e.g. 15m" },
    { path: "time", label: "Current time (UTC)", description: "ISO timestamp when the rule ran" },
  ],
  async evaluate(config) {
    const interval = String(config.interval ?? "15m").trim() || "15m";
    return {
      fired: true,
      data: {
        interval,
        time: new Date().toISOString(),
      },
    };
  },
};

export const dailyAt: TriggerDefinition = {
  id: "daily_at",
  label: "Every day at",
  description: "Fires once per day at a specific time.",
  actionPlan: [
    "Read hour, minute, and timezone from the rule",
    "Resolve the current time in that timezone",
    "Fire once when the clock matches and it has not already fired today",
  ],
  errorCallback: [
    ...COMMON_ERROR_CALLBACK,
    { path: "timezone", label: "Timezone", description: "Timezone that failed to resolve" },
  ],
  fields: [
    { key: "hour", label: "Hour (0–23)", type: "number", required: true, default: 9 },
    { key: "minute", label: "Minute (0–59)", type: "number", required: true, default: 0 },
    {
      key: "timezone",
      label: "Timezone",
      type: "select",
      required: true,
      default: "Europe/Berlin",
      placeholder: "Search timezone…",
      options: TIMEZONE_OPTIONS,
    },
  ],
  outputs: [
    { path: "time", label: "Current time", description: "Local time when the rule ran, e.g. 09:00" },
    { path: "timezone", label: "Timezone" },
    { path: "date", label: "Date", description: "YYYY-MM-DD in the configured timezone" },
    { path: "scheduled", label: "Scheduled time", description: "Configured daily time, e.g. 09:00" },
  ],
  async evaluate(config, context) {
    const hour = Number(config.hour);
    const minute = Number(config.minute);
    const timezone = String(config.timezone ?? "Europe/Berlin");

    let now: ReturnType<typeof getZonedTime>;
    try {
      now = getZonedTime(timezone);
    } catch (err) {
      failStep({
        message: err instanceof Error ? err.message : "Invalid timezone",
        code: "time.invalid_timezone",
        integration: "time",
        step: "daily_at",
        stepLabel: "Every day at",
        kind: "trigger",
        plan: dailyAt.actionPlan,
        extras: { timezone },
      });
    }

    if (context.manual) {
      return {
        fired: true,
        data: {
          time: now.label,
          timezone,
          date: now.date,
          manual: true,
        },
      };
    }

    const lastFiredDate = context.lastState?.lastFiredDate as string | undefined;
    const matches = now.hour === hour && now.minute === minute;

    if (!matches || lastFiredDate === now.date) {
      return {
        fired: false,
        data: {
          time: now.label,
          timezone,
          date: now.date,
          scheduled: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
        },
        state: context.lastState,
      };
    }

    return {
      fired: true,
      data: {
        time: now.label,
        timezone,
        date: now.date,
        scheduled: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
      },
      state: { lastFiredDate: now.date },
    };
  },
};
