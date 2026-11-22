import { failStep } from "../errors.js";
import type { ActionDefinition } from "../types.js";

function interpolate(template: string, data: Record<string, unknown>): string {
  const context = { ...data, trigger: data };
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, path: string) => {
    const keys = path.trim().split(".");
    let value: unknown = context;
    for (const key of keys) {
      if (value && typeof value === "object" && key in (value as object)) {
        value = (value as Record<string, unknown>)[key];
      } else {
        return "";
      }
    }
    return String(value ?? "");
  });
}

const COMMON_ERROR_CALLBACK = [
  { path: "message", label: "Error message" },
  { path: "code", label: "Error code" },
  { path: "integration", label: "Integration id" },
  { path: "step", label: "Step id" },
  { path: "stepLabel", label: "Step label" },
  { path: "kind", label: "Step kind", description: "trigger or action" },
  { path: "plan", label: "Action plan", description: "Planned steps joined with →" },
];

const NOTION_ERROR_CALLBACK = [
  ...COMMON_ERROR_CALLBACK,
  { path: "pageId", label: "Page ID" },
  { path: "databaseId", label: "Database ID" },
];

const NOTION_VERSION = "2022-06-28";

function requireToken(integrationConfig: Record<string, unknown>, step: ActionDefinition): string {
  const token = String(integrationConfig.apiToken ?? "").trim();
  if (!token) {
    failStep({
      message: "Notion integration token is not configured — add it in Integrations",
      code: "notion.missing_token",
      integration: "notion",
      step: step.id,
      stepLabel: step.label,
      kind: "action",
      plan: step.actionPlan,
      extras: { pageId: "", databaseId: "" },
    });
  }
  return token;
}

async function notionFetch(
  token: string,
  path: string,
  init: RequestInit,
  step: ActionDefinition,
  extras: Record<string, unknown>,
) {
  let res: Response;
  try {
    res = await fetch(`https://api.notion.com/v1${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
  } catch (err) {
    failStep({
      message: err instanceof Error ? err.message : "Notion request failed",
      code: "notion.request_failed",
      integration: "notion",
      step: step.id,
      stepLabel: step.label,
      kind: "action",
      plan: step.actionPlan,
      extras,
    });
  }

  if (!res.ok) {
    const body = await res.text();
    failStep({
      message: `Notion API error ${res.status}: ${body}`,
      code: "notion.api_error",
      integration: "notion",
      step: step.id,
      stepLabel: step.label,
      kind: "action",
      plan: step.actionPlan,
      extras: { ...extras, status: res.status },
    });
  }

  return res.json() as Promise<Record<string, unknown>>;
}

function paragraphBlocks(text: string) {
  const chunks = text.split(/\n+/).filter((line) => line.trim().length > 0);
  const lines = chunks.length > 0 ? chunks : [""];
  return lines.map((line) => ({
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: [{ type: "text", text: { content: line.slice(0, 2000) } }],
    },
  }));
}

export const appendParagraph: ActionDefinition = {
  id: "append_paragraph",
  label: "Append paragraph",
  description: "Append text as paragraph blocks on a Notion page.",
  actionPlan: [
    "Load the Notion integration token",
    "Resolve the page ID",
    "Append paragraph blocks via the Notion API",
  ],
  errorCallback: NOTION_ERROR_CALLBACK,
  fields: [
    {
      key: "pageId",
      label: "Page ID",
      type: "text",
      required: false,
      placeholder: "Or use Integrations default page",
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
    const token = requireToken(context.integrationConfig, appendParagraph);
    const pageId = interpolate(
      String(config.pageId ?? context.integrationConfig.defaultPageId ?? ""),
      context.triggerData,
    ).trim();
    if (!pageId) {
      failStep({
        message: "Page ID is empty — set it on the action or a default in Integrations",
        code: "notion.missing_page",
        integration: "notion",
        step: appendParagraph.id,
        stepLabel: appendParagraph.label,
        kind: "action",
        plan: appendParagraph.actionPlan,
        extras: { pageId: "", databaseId: "" },
      });
    }
    const text = interpolate(String(config.text ?? ""), context.triggerData);
    await notionFetch(
      token,
      `/blocks/${encodeURIComponent(pageId)}/children`,
      { method: "PATCH", body: JSON.stringify({ children: paragraphBlocks(text) }) },
      appendParagraph,
      { pageId, databaseId: "" },
    );
  },
};

export const createPage: ActionDefinition = {
  id: "create_page",
  label: "Create a page",
  description: "Create a Notion page under a parent page or database.",
  actionPlan: [
    "Load the Notion integration token",
    "Resolve parent page or database ID",
    "Create the page with title and optional body",
  ],
  errorCallback: NOTION_ERROR_CALLBACK,
  fields: [
    {
      key: "parentType",
      label: "Parent type",
      type: "select",
      required: true,
      default: "page",
      options: [
        { value: "page", label: "Page" },
        { value: "database", label: "Database" },
      ],
    },
    {
      key: "parentId",
      label: "Parent ID",
      type: "text",
      required: false,
      placeholder: "Or use Integrations defaults",
    },
    {
      key: "title",
      label: "Title",
      type: "text",
      required: true,
      placeholder: "Daily report {{time.time}}",
    },
    {
      key: "titleProperty",
      label: "Title property",
      type: "text",
      required: false,
      placeholder: "Name (database title column)",
      default: "Name",
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
    const token = requireToken(context.integrationConfig, createPage);
    const parentType = String(config.parentType ?? "page");
    const parentId = interpolate(
      String(
        config.parentId ??
          (parentType === "database"
            ? context.integrationConfig.defaultDatabaseId
            : context.integrationConfig.defaultPageId) ??
          "",
      ),
      context.triggerData,
    ).trim();
    if (!parentId) {
      failStep({
        message: "Parent ID is empty — set it on the action or a default in Integrations",
        code: "notion.missing_parent",
        integration: "notion",
        step: createPage.id,
        stepLabel: createPage.label,
        kind: "action",
        plan: createPage.actionPlan,
        extras: {
          pageId: "",
          databaseId: parentType === "database" ? parentId : "",
        },
      });
    }

    const title =
      interpolate(String(config.title ?? ""), context.triggerData).trim() || "Untitled";
    const titleProperty =
      interpolate(String(config.titleProperty ?? "Name"), context.triggerData).trim() || "Name";
    const text = interpolate(String(config.text ?? ""), context.triggerData);
    const parent =
      parentType === "database" ? { database_id: parentId } : { page_id: parentId };
    const titleKey = parentType === "database" ? titleProperty : "title";

    const body: Record<string, unknown> = {
      parent,
      properties: {
        [titleKey]: {
          title: [{ type: "text", text: { content: title.slice(0, 2000) } }],
        },
      },
    };
    if (text.trim()) body.children = paragraphBlocks(text);

    await notionFetch(
      token,
      "/pages",
      { method: "POST", body: JSON.stringify(body) },
      createPage,
      {
        pageId: "",
        databaseId: parentType === "database" ? parentId : "",
      },
    );
  },
};
