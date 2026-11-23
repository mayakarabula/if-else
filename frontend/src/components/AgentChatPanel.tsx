import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import {
  Alert,
  Button,
  Drawer,
  FloatButton,
  Input,
  Space,
  Typography,
  theme,
} from "antd";
import { ClearOutlined, RobotOutlined, SendOutlined } from "@ant-design/icons";
import {
  api,
  notifyDataChanged,
  type ChatMessage,
  type PageContext,
} from "../api/client";

const SESSION_KEY = "if-else.chat.sessionId";

function pageContextFromLocation(pathname: string, ruleId?: string): PageContext {
  if (pathname === "/" || pathname === "") {
    return { path: pathname || "/", page: "rules", label: "My Rules" };
  }
  if (pathname === "/create") {
    return { path: pathname, page: "create", label: "Create rule" };
  }
  if (pathname.startsWith("/rules/") && pathname.endsWith("/edit")) {
    return {
      path: pathname,
      page: "edit",
      ruleId,
      label: ruleId ? `Edit rule ${ruleId}` : "Edit rule",
    };
  }
  if (pathname.startsWith("/integrations")) {
    return { path: pathname, page: "integrations", label: "Integrations" };
  }
  if (pathname.startsWith("/activity")) {
    return { path: pathname, page: "activity", label: "Activity" };
  }
  return { path: pathname, page: "other" };
}

export function AgentChatPanel() {
  const { token } = theme.useToken();
  const location = useLocation();
  const params = useParams();
  const pageContext = useMemo(
    () => pageContextFromLocation(location.pathname, params.id),
    [location.pathname, params.id],
  );

  const [open, setOpen] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [providerLabel, setProviderLabel] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(SESSION_KEY);
    } catch {
      return null;
    }
  });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  function applyStatus(status: {
    configured: boolean;
    providerLabel?: string | null;
  }) {
    setConfigured(status.configured);
    setProviderLabel(status.providerLabel ?? null);
  }

  useEffect(() => {
    api
      .getChatStatus()
      .then(applyStatus)
      .catch(() => {
        setConfigured(false);
        setProviderLabel(null);
      });
  }, []);

  useEffect(() => {
    function onDataChanged(event: Event) {
      const detail = (event as CustomEvent<{ mutations?: string[] }>).detail;
      if (detail?.mutations?.includes("integrations")) {
        api.getChatStatus().then(applyStatus).catch(() => undefined);
      }
    }
    window.addEventListener("if-else:data-changed", onDataChanged);
    return () => window.removeEventListener("if-else:data-changed", onDataChanged);
  }, []);

  useEffect(() => {
    if (!open || !sessionId) return;
    api
      .getChatSession(sessionId)
      .then((session) => {
        setMessages(session.messages);
        applyStatus(session);
      })
      .catch(() => {
        setSessionId(null);
        try {
          localStorage.removeItem(SESSION_KEY);
        } catch {
          // ignore
        }
      });
  }, [open, sessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open, sending]);

  async function handleSend() {
    const text = draft.trim();
    if (!text || sending) return;

    setSending(true);
    setError(null);
    setDraft("");
    setMessages((current) => [
      ...current,
      {
        id: `local-${Date.now()}`,
        role: "user",
        content: text,
        createdAt: new Date().toISOString(),
      },
    ]);

    try {
      const result = await api.sendChat({
        sessionId: sessionId ?? undefined,
        message: text,
        pageContext,
      });
      setSessionId(result.sessionId);
      try {
        localStorage.setItem(SESSION_KEY, result.sessionId);
      } catch {
        // ignore
      }
      setMessages(result.messages);
      applyStatus(result);
      notifyDataChanged(result.mutations);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chat failed");
    } finally {
      setSending(false);
    }
  }

  async function handleClear() {
    if (sessionId) {
      try {
        await api.clearChatSession(sessionId);
      } catch {
        // ignore
      }
    }
    setSessionId(null);
    setMessages([]);
    setError(null);
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      // ignore
    }
  }

  const suggestions =
    pageContext.page === "integrations"
      ? ["Help me configure Telegram", "What's missing in my integrations?"]
      : pageContext.page === "edit"
        ? ["Explain this rule", "Add a Catch that notifies me on errors"]
        : pageContext.page === "create"
          ? ["Create a daily weather alert to Telegram", "Add a Time → Every 15m poll condition"]
          : ["List my rules", "Create a rule that emails me when it's cold"];

  return (
    <>
      <FloatButton
        icon={<RobotOutlined />}
        type="primary"
        tooltip="Agent"
        onClick={() => setOpen(true)}
        style={{ right: 24, bottom: 24 }}
      />

      <Drawer
        title={
          <Space>
            <RobotOutlined />
            <span>Agent</span>
          </Space>
        }
        placement="right"
        width={400}
        open={open}
        onClose={() => setOpen(false)}
        styles={{ body: { display: "flex", flexDirection: "column", gap: 12, paddingBottom: 16 } }}
        extra={
          <Button type="text" icon={<ClearOutlined />} onClick={handleClear} disabled={sending}>
            New chat
          </Button>
        }
      >
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Context: {pageContext.label ?? pageContext.page} · {pageContext.path}
          {providerLabel ? ` · ${providerLabel}` : ""}
        </Typography.Text>

        {configured === false && (
          <Alert
            type="warning"
            showIcon
            message="Agent chat needs setup"
            description={
              <span>
                Configure a provider under{" "}
                <Link to="/integrations" onClick={() => setOpen(false)}>
                  Integrations → Agent chat
                </Link>
                . OpenAI-compatible and Cursor Agent are supported.
              </span>
            }
          />
        )}

        {error && <Alert type="error" showIcon message={error} />}

        <div
          style={{
            flex: 1,
            minHeight: 280,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            paddingBlock: 4,
          }}
        >
          {messages.length === 0 && (
            <div style={{ display: "grid", gap: 8 }}>
              <Typography.Text type="secondary">
                Ask me to create or edit rules, configure integrations, or explain this page.
              </Typography.Text>
              <Space wrap>
                {suggestions.map((item) => (
                  <Button
                    key={item}
                    size="small"
                    onClick={() => setDraft(item)}
                    disabled={configured === false}
                  >
                    {item}
                  </Button>
                ))}
              </Space>
            </div>
          )}

          {messages.map((message) => {
            const mine = message.role === "user";
            return (
              <div
                key={message.id}
                style={{
                  alignSelf: mine ? "flex-end" : "flex-start",
                  maxWidth: "92%",
                  background: mine ? token.colorPrimary : token.colorFillSecondary,
                  color: mine ? token.colorTextLightSolid : token.colorText,
                  borderRadius: 12,
                  padding: "8px 12px",
                  whiteSpace: "pre-wrap",
                  fontSize: 13,
                  lineHeight: 1.45,
                }}
              >
                {message.content}
              </div>
            );
          })}

          {sending && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Thinking…
            </Typography.Text>
          )}
          <div ref={bottomRef} />
        </div>

        <Space.Compact style={{ width: "100%" }}>
          <Input.TextArea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Message the agent…"
            autoSize={{ minRows: 1, maxRows: 5 }}
            disabled={sending || configured === false}
            onPressEnter={(e) => {
              if (!e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={() => void handleSend()}
            loading={sending}
            disabled={!draft.trim() || configured === false}
            style={{ height: "auto" }}
          />
        </Space.Compact>
      </Drawer>
    </>
  );
}
