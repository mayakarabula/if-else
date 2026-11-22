import { google } from "googleapis";
import { failStep } from "../errors.js";
import { COMMON_ERROR_CALLBACK, createGoogleAuth, interpolate } from "../google/auth.js";
import type { TriggerDefinition } from "../types.js";

const SHEETS_ERROR_CALLBACK = [
  ...COMMON_ERROR_CALLBACK,
  { path: "spreadsheetId", label: "Spreadsheet ID" },
  { path: "range", label: "Range" },
];

export const fetchRange: TriggerDefinition = {
  id: "fetch_range",
  label: "Fetch a range",
  description: "Loads values from a Google Sheet range into templates. Does not block the rule on its own.",
  kind: "data",
  actionPlan: [
    "Load Google OAuth credentials from Integrations",
    "Read the A1 range via the Sheets API",
    "Expose CSV text and first-cell helpers for templates",
  ],
  errorCallback: SHEETS_ERROR_CALLBACK,
  fields: [
    {
      key: "spreadsheetId",
      label: "Spreadsheet ID",
      type: "text",
      required: true,
      placeholder: "From the Sheet URL",
    },
    {
      key: "range",
      label: "Range (A1)",
      type: "text",
      required: true,
      placeholder: "Sheet1!A1:C10",
    },
  ],
  outputs: [
    { path: "spreadsheetId", label: "Spreadsheet ID" },
    { path: "range", label: "Range" },
    { path: "csv", label: "Values as CSV" },
    { path: "firstCell", label: "First cell value" },
    { path: "rowCount", label: "Row count" },
  ],
  async evaluate(config, context) {
    const auth = createGoogleAuth(context.integrationConfig, "googlesheets", fetchRange, "trigger");
    const spreadsheetId = interpolate(
      String(config.spreadsheetId ?? context.integrationConfig.defaultSpreadsheetId ?? ""),
      {},
    ).trim();
    const range = interpolate(String(config.range ?? ""), {}).trim();
    if (!spreadsheetId || !range) {
      failStep({
        message: "Spreadsheet ID and range are required",
        code: "googlesheets.missing_range",
        integration: "googlesheets",
        step: fetchRange.id,
        stepLabel: fetchRange.label,
        kind: "trigger",
        plan: fetchRange.actionPlan,
        extras: { spreadsheetId, range },
      });
    }

    try {
      const sheets = google.sheets({ version: "v4", auth });
      const result = await sheets.spreadsheets.values.get({ spreadsheetId, range });
      const rows = (result.data.values ?? []) as string[][];
      const csv = rows.map((row) => row.map((cell) => String(cell ?? "")).join(",")).join("\n");
      return {
        fired: true,
        data: {
          spreadsheetId,
          range,
          csv,
          firstCell: rows[0]?.[0] ?? "",
          rowCount: rows.length,
        },
      };
    } catch (err) {
      failStep({
        message: err instanceof Error ? err.message : "Google Sheets fetch failed",
        code: "googlesheets.fetch_failed",
        integration: "googlesheets",
        step: fetchRange.id,
        stepLabel: fetchRange.label,
        kind: "trigger",
        plan: fetchRange.actionPlan,
        extras: { spreadsheetId, range },
      });
    }
  },
};
