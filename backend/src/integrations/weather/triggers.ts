import { failStep } from "../errors.js";
import type { TriggerDefinition } from "../types.js";
import { fetchCurrentTemp, fetchWeatherSnapshot, formatWeatherReport, weatherEmoji } from "./client.js";

const placeField = {
  key: "location",
  label: "Place",
  type: "place" as const,
  required: true,
  placeholder: "Search for a city…",
};

const COMMON_ERROR_CALLBACK = [
  { path: "message", label: "Error message" },
  { path: "code", label: "Error code" },
  { path: "integration", label: "Integration id" },
  { path: "step", label: "Step id" },
  { path: "stepLabel", label: "Step label" },
  { path: "kind", label: "Step kind", description: "trigger or action" },
  { path: "plan", label: "Action plan", description: "Planned steps joined with →" },
];

const WEATHER_ERROR_CALLBACK = [
  ...COMMON_ERROR_CALLBACK,
  { path: "location", label: "Location", description: "Place that failed to load" },
];

function requireCoords(config: Record<string, unknown>, step: TriggerDefinition) {
  const lat = Number(config.latitude);
  const lon = Number(config.longitude);
  const location = String(config.location ?? "Unknown");
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    failStep({
      message: "Pick a place so latitude and longitude are set",
      code: "weather.missing_place",
      integration: "weather",
      step: step.id,
      stepLabel: step.label,
      kind: "trigger",
      plan: step.actionPlan,
      extras: { location },
    });
  }
  return { lat, lon, location };
}

export const fetchData: TriggerDefinition = {
  id: "fetch_data",
  label: "Fetch weather data",
  description: "Loads weather data for actions. Does not block the rule on its own.",
  kind: "data",
  actionPlan: [
    "Validate the selected place has coordinates",
    "Fetch the current weather snapshot from Open-Meteo",
    "Format a report and expose temperature, humidity, wind, and emoji",
  ],
  errorCallback: WEATHER_ERROR_CALLBACK,
  fields: [placeField],
  outputs: [
    { path: "report", label: "Weather report", description: "Formatted multi-line weather summary" },
    { path: "location", label: "Location name" },
    { path: "temp", label: "Temperature (°C)" },
    { path: "humidity", label: "Humidity (%)" },
    { path: "windSpeed", label: "Wind speed (km/h)" },
    { path: "high", label: "Today's high (°C)" },
    { path: "low", label: "Today's low (°C)" },
    { path: "emoji", label: "Weather emoji" },
    { path: "weatherCode", label: "Weather code" },
  ],
  async evaluate(config) {
    const { lat, lon, location } = requireCoords(config, fetchData);

    try {
      const snapshot = await fetchWeatherSnapshot(lat, lon, location);
      return {
        fired: true,
        data: {
          ...snapshot,
          emoji: weatherEmoji(snapshot.weatherCode),
          report: formatWeatherReport(snapshot),
        },
      };
    } catch (err) {
      failStep({
        message: err instanceof Error ? err.message : "Weather fetch failed",
        code: "weather.fetch_failed",
        integration: "weather",
        step: "fetch_data",
        stepLabel: fetchData.label,
        kind: "trigger",
        plan: fetchData.actionPlan,
        extras: { location },
      });
    }
  },
};

export const temperatureBelow: TriggerDefinition = {
  id: "temperature_below",
  label: "Temperature drops below",
  description: "Fires when the current temperature is below a threshold.",
  actionPlan: [
    "Validate the selected place has coordinates",
    "Fetch the current temperature from Open-Meteo",
    "Compare against the threshold and fire when colder",
  ],
  errorCallback: WEATHER_ERROR_CALLBACK,
  fields: [
    placeField,
    { key: "threshold", label: "Threshold (°C)", type: "number", required: true, default: 10 },
  ],
  outputs: [
    { path: "temp", label: "Temperature (°C)" },
    { path: "location", label: "Location name" },
    { path: "threshold", label: "Threshold (°C)" },
  ],
  async evaluate(config) {
    const { lat, lon, location } = requireCoords(config, temperatureBelow);
    const threshold = Number(config.threshold);

    try {
      const temp = await fetchCurrentTemp(lat, lon);
      return {
        fired: temp < threshold,
        data: { temp, location, threshold },
      };
    } catch (err) {
      failStep({
        message: err instanceof Error ? err.message : "Weather fetch failed",
        code: "weather.fetch_failed",
        integration: "weather",
        step: "temperature_below",
        stepLabel: temperatureBelow.label,
        kind: "trigger",
        plan: temperatureBelow.actionPlan,
        extras: { location },
      });
    }
  },
};

export const temperatureAbove: TriggerDefinition = {
  id: "temperature_above",
  label: "Temperature rises above",
  description: "Fires when the current temperature is above a threshold.",
  actionPlan: [
    "Validate the selected place has coordinates",
    "Fetch the current temperature from Open-Meteo",
    "Compare against the threshold and fire when warmer",
  ],
  errorCallback: WEATHER_ERROR_CALLBACK,
  fields: [
    placeField,
    { key: "threshold", label: "Threshold (°C)", type: "number", required: true, default: 25 },
  ],
  outputs: [
    { path: "temp", label: "Temperature (°C)" },
    { path: "location", label: "Location name" },
    { path: "threshold", label: "Threshold (°C)" },
  ],
  async evaluate(config) {
    const { lat, lon, location } = requireCoords(config, temperatureAbove);
    const threshold = Number(config.threshold);

    try {
      const temp = await fetchCurrentTemp(lat, lon);
      return {
        fired: temp > threshold,
        data: { temp, location, threshold },
      };
    } catch (err) {
      failStep({
        message: err instanceof Error ? err.message : "Weather fetch failed",
        code: "weather.fetch_failed",
        integration: "weather",
        step: "temperature_above",
        stepLabel: temperatureAbove.label,
        kind: "trigger",
        plan: temperatureAbove.actionPlan,
        extras: { location },
      });
    }
  },
};
