import { useMemo, useRef, useState } from "react";
import { Empty, Input, Tooltip, Typography, theme } from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import type { Integration } from "../api/client";

export interface ArgumentItem {
  token: string;
  short: string;
  label: string;
  description?: string;
  groupLabel: string;
}

const formControlMax = 360;

export function buildArgumentItems(
  clauses: { integration: string | null; trigger: string | null }[],
  integrations: Integration[],
): ArgumentItem[] {
  const items: ArgumentItem[] = [];
  const seen = new Set<string>();

  for (const clause of clauses) {
    if (!clause.integration || !clause.trigger) continue;

    const groupKey = `${clause.integration}:${clause.trigger}`;
    if (seen.has(groupKey)) continue;
    seen.add(groupKey);

    const integration = integrations.find((item) => item.id === clause.integration);
    const trigger = integration?.triggers?.find((item) => item.id === clause.trigger);
    if (!integration || !trigger?.outputs?.length) continue;

    for (const output of trigger.outputs) {
      items.push({
        token: `{{${integration.id}.${output.path}}}`,
        short: `${integration.id}.${output.path}`,
        label: output.label,
        description: output.description,
        groupLabel: `${integration.name} · ${trigger.label}`,
      });
    }
  }

  return items;
}

function insertAtCursor(
  current: string,
  token: string,
  selectionStart: number | null,
  selectionEnd: number | null,
) {
  const start = selectionStart ?? current.length;
  const end = selectionEnd ?? current.length;
  return {
    next: current.slice(0, start) + token + current.slice(end),
    caret: start + token.length,
  };
}

function getTextArea(ref: TextAreaRef | null): HTMLTextAreaElement | null {
  return ref?.resizableTextArea?.textArea ?? null;
}

/** Compact chips under a template field — click inserts the token at the caret. */
export function ArgumentInserter({
  items,
  onInsert,
}: {
  items: ArgumentItem[];
  onInsert: (token: string) => void;
}) {
  const { token } = theme.useToken();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) =>
      [item.label, item.short, item.token, item.description, item.groupLabel]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(q)),
    );
  }, [items, query]);

  if (items.length === 0) {
    return (
      <Typography.Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 8 }}>
        Add a data source to insert values like temperature or time.
      </Typography.Text>
    );
  }

  return (
    <div style={{ marginTop: 10, maxWidth: formControlMax }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 8,
        }}
      >
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Insert argument
        </Typography.Text>
        {items.length > 6 && (
          <Input
            allowClear
            size="small"
            placeholder="Filter…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: 140 }}
          />
        )}
      </div>

      {filtered.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`No match for “${query}”`} />
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {filtered.map((item) => (
            <Tooltip
              key={item.token}
              title={
                <div>
                  <div>{item.description ?? item.label}</div>
                  <div style={{ opacity: 0.85, fontSize: 12, marginTop: 4 }}>{item.token}</div>
                  <div style={{ opacity: 0.7, fontSize: 11, marginTop: 2 }}>{item.groupLabel}</div>
                </div>
              }
            >
              <button
                type="button"
                onClick={() => onInsert(item.token)}
                style={{
                  margin: 0,
                  padding: "4px 10px",
                  border: `1px solid ${token.colorBorderSecondary}`,
                  borderRadius: 999,
                  background: token.colorFillAlter,
                  color: token.colorText,
                  cursor: "pointer",
                  fontSize: 12,
                  lineHeight: 1.4,
                  transition: "border-color 0.15s ease, background 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = token.colorPrimary;
                  e.currentTarget.style.background = token.colorPrimaryBg;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = token.colorBorderSecondary;
                  e.currentTarget.style.background = token.colorFillAlter;
                }}
              >
                {item.label}
              </button>
            </Tooltip>
          ))}
        </div>
      )}
    </div>
  );
}

export function TemplateTextArea({
  value,
  onChange,
  placeholder,
  rows = 5,
  arguments: argumentItems,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  arguments: ArgumentItem[];
}) {
  const areaRef = useRef<TextAreaRef>(null);
  const selectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });

  function rememberSelection(target: HTMLTextAreaElement) {
    selectionRef.current = {
      start: target.selectionStart,
      end: target.selectionEnd,
    };
  }

  function handleInsert(token: string) {
    const { next, caret } = insertAtCursor(
      value,
      token,
      selectionRef.current.start,
      selectionRef.current.end,
    );
    onChange(next);
    requestAnimationFrame(() => {
      const el = getTextArea(areaRef.current);
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caret);
      selectionRef.current = { start: caret, end: caret };
    });
  }

  return (
    <div>
      <Input.TextArea
        ref={areaRef}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          rememberSelection(e.target);
          onChange(e.target.value);
        }}
        onSelect={(e) => rememberSelection(e.currentTarget)}
        onKeyUp={(e) => rememberSelection(e.currentTarget)}
        onClick={(e) => rememberSelection(e.currentTarget)}
        style={{ maxWidth: formControlMax, width: "100%" }}
      />
      <ArgumentInserter items={argumentItems} onInsert={handleInsert} />
    </div>
  );
}
