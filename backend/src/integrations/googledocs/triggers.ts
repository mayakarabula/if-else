import { google } from "googleapis";
import { failStep } from "../errors.js";
import { COMMON_ERROR_CALLBACK, createGoogleAuth, interpolate } from "../google/auth.js";
import type { TriggerDefinition } from "../types.js";

const DOCS_ERROR_CALLBACK = [
  ...COMMON_ERROR_CALLBACK,
  { path: "documentId", label: "Document ID" },
];

function extractPlainText(document: {
  body?: { content?: Array<{ paragraph?: { elements?: Array<{ textRun?: { content?: string | null } | null }> | null } | null }> | null } | null;
}): string {
  const chunks: string[] = [];
  for (const block of document.body?.content ?? []) {
    for (const element of block.paragraph?.elements ?? []) {
      const content = element.textRun?.content;
      if (content) chunks.push(content);
    }
  }
  return chunks.join("").trim();
}

export const fetchDocument: TriggerDefinition = {
  id: "fetch_document",
  label: "Fetch document text",
  description: "Loads a Google Doc’s plain text into templates. Does not block the rule on its own.",
  kind: "data",
  actionPlan: [
    "Load Google OAuth credentials from Integrations",
    "GET the document via the Docs API",
    "Expose title and plain-text body for templates",
  ],
  errorCallback: DOCS_ERROR_CALLBACK,
  fields: [
    {
      key: "documentId",
      label: "Document ID",
      type: "text",
      required: true,
      placeholder: "From the Doc URL",
    },
  ],
  outputs: [
    { path: "documentId", label: "Document ID" },
    { path: "title", label: "Title" },
    { path: "text", label: "Plain text" },
  ],
  async evaluate(config, context) {
    const auth = createGoogleAuth(context.integrationConfig, "googledocs", fetchDocument, "trigger");
    const documentId = interpolate(
      String(config.documentId ?? context.integrationConfig.defaultDocumentId ?? ""),
      {},
    ).trim();
    if (!documentId) {
      failStep({
        message: "Document ID is required",
        code: "googledocs.missing_document",
        integration: "googledocs",
        step: fetchDocument.id,
        stepLabel: fetchDocument.label,
        kind: "trigger",
        plan: fetchDocument.actionPlan,
        extras: { documentId: "" },
      });
    }

    try {
      const docs = google.docs({ version: "v1", auth });
      const result = await docs.documents.get({ documentId });
      return {
        fired: true,
        data: {
          documentId,
          title: result.data.title ?? "",
          text: extractPlainText(result.data),
        },
      };
    } catch (err) {
      failStep({
        message: err instanceof Error ? err.message : "Google Docs fetch failed",
        code: "googledocs.fetch_failed",
        integration: "googledocs",
        step: fetchDocument.id,
        stepLabel: fetchDocument.label,
        kind: "trigger",
        plan: fetchDocument.actionPlan,
        extras: { documentId },
      });
    }
  },
};
