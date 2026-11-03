import { useEffect, useMemo, useState } from "react";
import { AutoComplete, Form, Typography } from "antd";
import { EnvironmentOutlined } from "@ant-design/icons";
import { searchPlaces, type PlaceSuggestion } from "../lib/geocode";
import { formLayout } from "./ui";

export function PlaceField({
  label,
  required,
  placeholder,
  values,
  onChange,
}: {
  label: string;
  required?: boolean;
  placeholder?: string;
  values: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const location = values.location === undefined || values.location === null ? "" : String(values.location);
  const latitude = typeof values.latitude === "number" ? values.latitude : Number(values.latitude);
  const longitude = typeof values.longitude === "number" ? values.longitude : Number(values.longitude);
  const hasCoords = Number.isFinite(latitude) && Number.isFinite(longitude);

  const [query, setQuery] = useState(location);
  const [options, setOptions] = useState<{ value: string; label: string; place: PlaceSuggestion }[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    setQuery(location);
  }, [location]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setOptions([]);
      return;
    }

    if (trimmed === location.trim() && hasCoords) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const results = await searchPlaces(trimmed);
        if (cancelled) return;
        setOptions(
          results.map((place) => ({
            value: place.label,
            label: place.label,
            place,
          })),
        );
      } catch {
        if (!cancelled) setOptions([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 280);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, location, hasCoords]);

  const coordsHint = useMemo(() => {
    if (!hasCoords) return "Search and pick a place to set coordinates";
    return `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`;
  }, [hasCoords, latitude, longitude]);

  return (
    <Form.Item label={label} required={required} style={{ marginBottom: 0 }}>
      <AutoComplete
        value={query}
        options={options}
        style={{ width: "100%", maxWidth: formLayout.controlWidth }}
        placeholder={placeholder ?? "Search for a city…"}
        notFoundContent={
          searching ? "Searching…" : query.trim().length < 2 ? "Type at least 2 characters" : "No places found"
        }
        onSearch={setQuery}
        onChange={(value) => setQuery(value)}
        onSelect={(_value, option) => {
          const place = (option as { place?: PlaceSuggestion }).place;
          if (!place) return;
          setQuery(place.label);
          onChange({
            location: place.location,
            latitude: place.latitude,
            longitude: place.longitude,
          });
        }}
        allowClear
        onClear={() => {
          setQuery("");
          setOptions([]);
          onChange({
            location: "",
            latitude: undefined,
            longitude: undefined,
          });
        }}
      />
      <Typography.Text
        type="secondary"
        style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 6, fontSize: 12 }}
      >
        <EnvironmentOutlined />
        {coordsHint}
      </Typography.Text>
    </Form.Item>
  );
}
