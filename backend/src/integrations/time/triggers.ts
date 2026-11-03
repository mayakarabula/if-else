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

export const dailyAt: TriggerDefinition = {
  id: "daily_at",
  label: "Every day at",
  description: "Fires once per day at a specific time.",
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
    const now = getZonedTime(timezone);

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
