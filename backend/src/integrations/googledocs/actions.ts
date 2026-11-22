import { google } from "googleapis";
import { failStep } from "../errors.js";
import { COMMON_ERROR_CALLBACK, createGoogleAuth, interpolate } from "../google/auth.js";
import type { ActionDefinition } from "../types.js";

const DOCS_ERROR_CALLBACK = [
  ...COMMON_ERROR_CALLBACK,
  { path: "documentId", label: "Document ID" },
  { path: "title", label: "Document title" },
];

function resolveDocumentId(
  config: Record<string, unknown>,
  integrationConfig: Record<string, unknown>,
  triggerData: Record<string, unknown>,
  step: ActionDefinition,
): string {
  const raw = String(config.documentId ?? integrationConfig.defaultDocumentId ?? "").trim();
  const documentId = interpolate(raw, triggerData).trim();
  if (!documentId) {
    failStep({
      message: "Document ID is empty — set it on the action or a default in Integrations",
      code: "googledocs.missing_document",
      integration: "googledocs",
      step: step.id,
      stepLabel: step.label,
      kind: "action",
      plan: step.actionPlan,
      extras: { documentId: "", title: "" },
    });
  }
  return documentId;
}

export const appendText: ActionDefinition = {
  id: "append_text",
  label: "Append text",
  description: "Append text to the end of a Google Doc.",
  actionPlan: [
    "Load Google OAuth credentials from Integrations",
    "Resolve the document ID and interpolate the text",
    "Insert text at the end of the document body",
  ],
  errorCallback: DOCS_ERROR_CALLBACK,
  fields: [
    {
      key: "documentId",
      label: "Document ID",
      type: "text",
      required: false,
      placeholder: "From the Doc URL (or use Integrations default)",
    },
    {
      key: "text",
      label: "Text",
      type: "textarea",
      required: true,
      placeholder: "Alert: {{weather.report}}",
    },
  ],
  async execute(config, context) {
    const auth = createGoogleAuth(context.integrationConfig, "googledocs", appendText, "action");
    const documentId = resolveDocumentId(
      config,
      context.integrationConfig,
      context.triggerData,
      appendText,
    );
    const text = interpolate(String(config.text ?? ""), context.triggerData);
    const docs = google.docs({ version: "v1", auth });

    let endIndex = 1;
    try {
      const current = await docs.documents.get({ documentId });
      endIndex = Number(current.data.body?.content?.at(-1)?.endIndex ?? 2) - 1;
      await docs.documents.batchUpdate({
        documentId,
        requestBody: {
          requests: [
            {
              insertText: {
                location: { index: Math.max(1, endIndex) },
                text: text.endsWith("\n") ? text : `${text}\n`,
              },
            },
          ],
        },
      });
    } catch (err) {
      failStep({
        message: err instanceof Error ? err.message : "Google Docs append failed",
        code: "googledocs.append_failed",
        integration: "googledocs",
        step: appendText.id,
        stepLabel: appendText.label,
        kind: "action",
        plan: appendText.actionPlan,
        extras: { documentId, title: "" },
      });
    }
  },
};

export const createDocument: ActionDefinition = {
  id: "create_document",
  label: "Create a document",
  description: "Create a new Google Doc with a title and optional body text.",
  actionPlan: [
    "Load Google OAuth credentials from Integrations",
    "Create a document with the interpolated title",
    "Optionally insert the body text",
  ],
  errorCallback: DOCS_ERROR_CALLBACK,
  fields: [
    {
      key: "title",
      label: "Title",
      type: "text",
      required: true,
      placeholder: "Daily report {{time.time}}",
    },
    {
      key: "text",
      label: "Body",
      type: "textarea",
      required: false,
      placeholder: "{{weather.report}}",
    },
  ],
  async execute(config, context) {
    const auth = createGoogleAuth(context.integrationConfig, "googledocs", createDocument, "action");
    const title =
      interpolate(String(config.title ?? ""), context.triggerData).trim() || "Untitled";
    const text = interpolate(String(config.text ?? ""), context.triggerData);
    const docs = google.docs({ version: "v1", auth });

    try {
      const created = await docs.documents.create({
        requestBody: { title },
      });
      const documentId = created.data.documentId ?? "";
      if (text.trim() && documentId) {
        await docs.documents.batchUpdate({
          documentId,
          requestBody: {
            requests: [
              {
                insertText: {
                  location: { index: 1 },
                  text: text.endsWith("\n") ? text : `${text}\n`,
                },
              },
            ],
          },
        });
      }
    } catch (err) {
      failStep({
        message: err instanceof Error ? err.message : "Google Docs create failed",
        code: "googledocs.create_failed",
        integration: "googledocs",
        step: createDocument.id,
        stepLabel: createDocument.label,
        kind: "action",
        plan: createDocument.actionPlan,
        extras: { documentId: "", title },
      });
    }
  },
};
