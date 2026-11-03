export interface WeatherSnapshot {
  location: string;
  temp: number;
  humidity: number;
  windSpeed: number;
  weatherCode: number;
  high: number;
  low: number;
}

const WEATHER_DESCRIPTIONS: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Foggy",
  48: "Foggy",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  80: "Rain showers",
  81: "Rain showers",
  82: "Heavy rain showers",
  95: "Thunderstorm",
};

const WEATHER_EMOJIS: Record<number, string> = {
  0: "☀️",
  1: "🌤️",
  2: "⛅",
  3: "☁️",
  45: "🌫️",
  48: "🌫️",
  51: "🌦️",
  53: "🌦️",
  55: "🌧️",
  61: "🌦️",
  63: "🌧️",
  65: "🌧️",
  71: "🌨️",
  73: "❄️",
  75: "❄️",
  80: "🌦️",
  81: "🌧️",
  82: "⛈️",
  95: "⛈️",
};

export function describeWeather(code: number): string {
  return WEATHER_DESCRIPTIONS[code] ?? "Unknown";
}

export function weatherEmoji(code: number): string {
  return WEATHER_EMOJIS[code] ?? "🌡️";
}

export async function fetchWeatherSnapshot(
  lat: number,
  lon: number,
  location: string,
): Promise<WeatherSnapshot> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("current", "temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code");
  url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,weather_code");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "1");

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Weather API error: ${res.status}`);
  }

  const data = (await res.json()) as {
    current: {
      temperature_2m: number;
      relative_humidity_2m: number;
      wind_speed_10m: number;
      weather_code: number;
    };
    daily: {
      temperature_2m_max: number[];
      temperature_2m_min: number[];
    };
  };

  return {
    location,
    temp: data.current.temperature_2m,
    humidity: data.current.relative_humidity_2m,
    windSpeed: data.current.wind_speed_10m,
    weatherCode: data.current.weather_code,
    high: data.daily.temperature_2m_max[0],
    low: data.daily.temperature_2m_min[0],
  };
}

export function formatWeatherReport(snapshot: WeatherSnapshot): string {
  const condition = describeWeather(snapshot.weatherCode);
  const emoji = weatherEmoji(snapshot.weatherCode);

  return [
    `${emoji} Weather report for ${snapshot.location}`,
    "",
    `${emoji} Now: ${Math.round(snapshot.temp)}°C, ${condition}`,
    `💧 Humidity: ${snapshot.humidity}%`,
    `💨 Wind: ${Math.round(snapshot.windSpeed)} km/h`,
    `🌡️ Today: ${Math.round(snapshot.low)}°C – ${Math.round(snapshot.high)}°C`,
  ].join("\n");
}

export async function fetchCurrentTemp(lat: number, lon: number): Promise<number> {
  const snapshot = await fetchWeatherSnapshot(lat, lon, "");
  return snapshot.temp;
}
