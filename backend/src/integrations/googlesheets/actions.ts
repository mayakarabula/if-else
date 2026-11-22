import { google } from "googleapis";
import { failStep } from "../errors.js";
import { COMMON_ERROR_CALLBACK, createGoogleAuth, interpolate } from "../google/auth.js";
import type { ActionDefinition } from "../types.js";

const SHEETS_ERROR_CALLBACK = [
  ...COMMON_ERROR_CALLBACK,
  { path: "spreadsheetId", label: "Spreadsheet ID" },
  { path: "range", label: "Range" },
];

function resolveSpreadsheetId(
  config: Record<string, unknown>,
  integrationConfig: Record<string, unknown>,
  triggerData: Record<string, unknown>,
  step: ActionDefinition,
): string {
  const raw = String(config.spreadsheetId ?? integrationConfig.defaultSpreadsheetId ?? "").trim();
  const spreadsheetId = interpolate(raw, triggerData).trim();
  if (!spreadsheetId) {
    failStep({
      message: "Spreadsheet ID is empty — set it on the action or a default in Integrations",
      code: "googlesheets.missing_spreadsheet",
      integration: "googlesheets",
      step: step.id,
      stepLabel: step.label,
      kind: "action",
      plan: step.actionPlan,
      extras: { spreadsheetId: "", range: "" },
    });
  }
  return spreadsheetId;
}

function parseCsvRow(raw: string): string[] {
  const row: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === '"') {
      if (inQuotes && raw[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      row.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  row.push(current.trim());
  return row;
}

export const appendRow: ActionDefinition = {
  id: "append_row",
  label: "Append a row",
  description: "Append a CSV row to a Google Sheet tab/range.",
  actionPlan: [
    "Load Google OAuth credentials from Integrations",
    "Resolve spreadsheet ID and range",
    "Append the interpolated CSV values as a new row",
  ],
  errorCallback: SHEETS_ERROR_CALLBACK,
  fields: [
    {
      key: "spreadsheetId",
      label: "Spreadsheet ID",
      type: "text",
      required: false,
      placeholder: "From the Sheet URL (or use Integrations default)",
    },
    {
      key: "range",
      label: "Tab / range",
      type: "text",
      required: true,
      placeholder: "Sheet1",
      default: "Sheet1",
    },
    {
      key: "values",
      label: "Row values (CSV)",
      type: "textarea",
      required: true,
      placeholder: "{{time.time}}, {{weather.temp}}, ok",
    },
  ],
  async execute(config, context) {
    const auth = createGoogleAuth(context.integrationConfig, "googlesheets", appendRow, "action");
    const spreadsheetId = resolveSpreadsheetId(
      config,
      context.integrationConfig,
      context.triggerData,
      appendRow,
    );
    const range =
      interpolate(String(config.range ?? "Sheet1"), context.triggerData).trim() || "Sheet1";
    const values = parseCsvRow(interpolate(String(config.values ?? ""), context.triggerData));
    const sheets = google.sheets({ version: "v4", auth });

    try {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range,
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [values] },
      });
    } catch (err) {
      failStep({
        message: err instanceof Error ? err.message : "Google Sheets append failed",
        code: "googlesheets.append_failed",
        integration: "googlesheets",
        step: appendRow.id,
        stepLabel: appendRow.label,
        kind: "action",
        plan: appendRow.actionPlan,
        extras: { spreadsheetId, range },
      });
    }
  },
};

export const updateRange: ActionDefinition = {
  id: "update_range",
  label: "Update a range",
  description: "Write values into a Google Sheet range (A1 notation).",
  actionPlan: [
    "Load Google OAuth credentials from Integrations",
    "Resolve spreadsheet ID and A1 range",
    "Write the interpolated CSV row into that range",
  ],
  errorCallback: SHEETS_ERROR_CALLBACK,
  fields: [
    {
      key: "spreadsheetId",
      label: "Spreadsheet ID",
      type: "text",
      required: false,
      placeholder: "From the Sheet URL (or use Integrations default)",
    },
    {
      key: "range",
      label: "Range (A1)",
      type: "text",
      required: true,
      placeholder: "Sheet1!A1:C1",
    },
    {
      key: "values",
      label: "Values (CSV)",
      type: "textarea",
      required: true,
      placeholder: "status, {{weather.temp}}, done",
    },
  ],
  async execute(config, context) {
    const auth = createGoogleAuth(context.integrationConfig, "googlesheets", updateRange, "action");
    const spreadsheetId = resolveSpreadsheetId(
      config,
      context.integrationConfig,
      context.triggerData,
      updateRange,
    );
    const range = interpolate(String(config.range ?? ""), context.triggerData).trim();
    if (!range) {
      failStep({
        message: "Range is required (e.g. Sheet1!A1:C1)",
        code: "googlesheets.missing_range",
        integration: "googlesheets",
        step: updateRange.id,
        stepLabel: updateRange.label,
        kind: "action",
        plan: updateRange.actionPlan,
        extras: { spreadsheetId, range: "" },
      });
    }
    const values = parseCsvRow(interpolate(String(config.values ?? ""), context.triggerData));
    const sheets = google.sheets({ version: "v4", auth });

    try {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [values] },
      });
    } catch (err) {
      failStep({
        message: err instanceof Error ? err.message : "Google Sheets update failed",
        code: "googlesheets.update_failed",
        integration: "googlesheets",
        step: updateRange.id,
        stepLabel: updateRange.label,
        kind: "action",
        plan: updateRange.actionPlan,
        extras: { spreadsheetId, range },
      });
    }
  },
};
