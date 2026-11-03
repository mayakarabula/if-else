import type { TriggerDefinition } from "../types.js";
import { fetchCurrentTemp, fetchWeatherSnapshot, formatWeatherReport, weatherEmoji } from "./client.js";

const placeField = {
  key: "location",
  label: "Place",
  type: "place" as const,
  required: true,
  placeholder: "Search for a city…",
};

export const fetchData: TriggerDefinition = {
  id: "fetch_data",
  label: "Fetch weather data",
  description: "Loads weather data for actions. Does not block the rule on its own.",
  kind: "data",
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
    const lat = Number(config.latitude);
    const lon = Number(config.longitude);
    const location = String(config.location ?? "Unknown");
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new Error("Pick a place so latitude and longitude are set");
    }

    const snapshot = await fetchWeatherSnapshot(lat, lon, location);

    return {
      fired: true,
      data: {
        ...snapshot,
        emoji: weatherEmoji(snapshot.weatherCode),
        report: formatWeatherReport(snapshot),
      },
    };
  },
};

export const temperatureBelow: TriggerDefinition = {
  id: "temperature_below",
  label: "Temperature drops below",
  description: "Fires when the current temperature is below a threshold.",
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
    const lat = Number(config.latitude);
    const lon = Number(config.longitude);
    const threshold = Number(config.threshold);
    const location = String(config.location ?? "Unknown");
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new Error("Pick a place so latitude and longitude are set");
    }

    const temp = await fetchCurrentTemp(lat, lon);
    const fired = temp < threshold;

    return {
      fired,
      data: {
        temp,
        location,
        threshold,
      },
    };
  },
};

export const temperatureAbove: TriggerDefinition = {
  id: "temperature_above",
  label: "Temperature rises above",
  description: "Fires when the current temperature is above a threshold.",
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
    const lat = Number(config.latitude);
    const lon = Number(config.longitude);
    const threshold = Number(config.threshold);
    const location = String(config.location ?? "Unknown");
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new Error("Pick a place so latitude and longitude are set");
    }

    const temp = await fetchCurrentTemp(lat, lon);
    const fired = temp > threshold;

    return {
      fired,
      data: {
        temp,
        location,
        threshold,
      },
    };
  },
};
