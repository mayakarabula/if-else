export interface PlaceSuggestion {
  id: number;
  label: string;
  location: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
}

interface GeocodeResult {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
  country_code?: string;
}

function formatPlaceLabel(result: GeocodeResult) {
  const parts = [result.name, result.admin1, result.country].filter(Boolean);
  return parts.join(", ");
}

export async function searchPlaces(query: string): Promise<PlaceSuggestion[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", trimmed);
  url.searchParams.set("count", "6");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Place search failed: ${res.status}`);
  }

  const data = (await res.json()) as { results?: GeocodeResult[] };
  return (data.results ?? []).map((result) => ({
    id: result.id,
    label: formatPlaceLabel(result),
    location: result.name,
    latitude: result.latitude,
    longitude: result.longitude,
    country: result.country,
    admin1: result.admin1,
  }));
}
