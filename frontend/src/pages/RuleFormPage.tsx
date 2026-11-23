import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  App,
  Button,
  Form,
  Input,
  Radio,
  Space,
  Spin,
  Typography,
  theme,
} from "antd";
import { CopyOutlined, ReloadOutlined } from "@ant-design/icons";
import { api, type Integration, type RuleRunTrigger } from "../api/client";
import { GraphNodeConfigModal } from "../components/GraphNodeConfigModal";
import { RuleGraph } from "../components/RuleGraph";
import { formLayout } from "../components/ui";
import {
  addChild,
  createEmptyGraph,
  ensureEventRoot,
  eventConfigFromGraph,
  eventSourceFromNode,
  graphToRulePayload,
  graphValidation,
  refineGraphSlots,
  removeNode,
  ruleToGraph,
  stripEventRoot,
  updateNode,
  type GraphNode,
  type GraphNodeKind,
  type GraphState,
} from "../lib/graph";
import { validateGraphSetup } from "../lib/graphIssues";

type RunMode = "off" | "timer" | "event";

function newWebhookToken() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

export function RuleFormPage() {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const { id } = useParams();
  const isEditing = Boolean(id);

  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(isEditing);
  const [name, setName] = useState("New automation");
  const [runMode, setRunMode] = useState<RunMode>("timer");
  const [webhookToken, setWebhookToken] = useState(() => newWebhookToken());
  const [graph, setGraph] = useState<GraphState>(createEmptyGraph);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Nodes eligible for red setup warnings. Edit mode preloads every node. */
  const [touchedIds, setTouchedIds] = useState<Set<string>>(() => new Set());
  const [saveAttempted, setSaveAttempted] = useState(false);

  function markTouched(nodeId: string) {
    setTouchedIds((current) => {
      if (current.has(nodeId)) return current;
      const next = new Set(current);
      next.add(nodeId);
      return next;
    });
  }

  useEffect(() => {
    if (id) return;
    api.getIntegrations().then(setIntegrations);
    const empty = createEmptyGraph();
    setGraph(empty);
    setSelectedId(empty.nodes[0]?.id ?? null);
    setTouchedIds(new Set());
    setSaveAttempted(false);
  }, [id]);

  function applyRule(rule: Awaited<ReturnType<typeof api.getRule>>, integrationsData: Integration[]) {
    setIntegrations(integrationsData);
    setName(rule.name);
    if (!rule.enabled) setRunMode("off");
    else setRunMode(rule.runTrigger === "event" || rule.runTrigger === "webhook" ? "event" : "timer");
    setWebhookToken(rule.webhookToken?.trim() || newWebhookToken());
    const next = refineGraphSlots(ruleToGraph(rule, integrationsData), integrationsData);
    setGraph(next);
    setSelectedId((current) =>
      current && next.nodes.some((node) => node.id === current)
        ? current
        : (next.nodes[0]?.id ?? null),
    );
    // Preexisting rules: show setup issues immediately on load.
    setTouchedIds(new Set(next.nodes.map((node) => node.id)));
    setSaveAttempted(false);
    setError(null);
  }

  useEffect(() => {
    if (!id) return;

    setLoading(true);
    setError(null);

    Promise.all([api.getRule(id), api.getIntegrations()])
      .then(([rule, integrationsData]) => {
        applyRule(rule, integrationsData);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load rule");
      })
      .finally(() => setLoading(false));
  }, [id]);

  // Reload immediately when agent chat (or another tab) mutates this rule.
  useEffect(() => {
    if (!id) return;

    function onDataChanged(event: Event) {
      const detail = (event as CustomEvent<{ mutations?: string[]; ruleId?: string }>).detail;
      if (!detail?.mutations?.includes("rules")) return;
      if (detail.ruleId && detail.ruleId !== id) return;

      void Promise.all([api.getRule(id!), api.getIntegrations()])
        .then(([rule, integrationsData]) => {
          applyRule(rule, integrationsData);
          message.info("Rule updated");
        })
        .catch((err) => {
          const text = err instanceof Error ? err.message : "Failed to reload rule";
          if (/not found/i.test(text)) {
            message.warning("Rule was deleted");
            navigate("/");
            return;
          }
          setError(text);
        });
    }

    window.addEventListener("if-else:data-changed", onDataChanged);
    return () => window.removeEventListener("if-else:data-changed", onDataChanged);
  }, [id, message, navigate]);

  const selected = useMemo(
    () => graph.nodes.find((n) => n.id === selectedId) ?? null,
    [graph.nodes, selectedId],
  );

  const validation = useMemo(
    () => validateGraphSetup(graph, integrations, graphValidation(graph)),
    [graph, integrations],
  );

  function handleAddChild(parentId: string, kind: GraphNodeKind) {
    setGraph((current) => {
      const next = addChild(current, parentId, kind);
      const added =
        next.nodes.find(
          (n) => n.kind === kind && !current.nodes.some((c) => c.id === n.id),
        ) ?? next.nodes.find((n) => !current.nodes.some((c) => c.id === n.id));
      if (added) {
        setSelectedId(added.id);
        setConfigOpen(true);
      }
      return next;
    });
  }

  function handleRemove(nodeId: string) {
    setGraph((current) => removeNode(current, nodeId));
    setTouchedIds((current) => {
      if (!current.has(nodeId)) return current;
      const next = new Set(current);
      next.delete(nodeId);
      return next;
    });
    setSelectedId((current) => {
      if (current !== nodeId) return current;
      setConfigOpen(false);
      return (
        graph.nodes.find((n) => n.kind === "event")?.id ??
        graph.nodes.find((n) => n.kind === "if")?.id ??
        null
      );
    });
  }

  function handleConfigure(nodeId: string) {
    setSelectedId(nodeId);
    setConfigOpen(true);
  }

  function handleConfigClose() {
    if (selectedId) markTouched(selectedId);
    setConfigOpen(false);
  }

  function patchSelected(patch: Partial<GraphNode>) {
    if (!selected) return;
    markTouched(selected.id);
    setGraph((current) => {
      const next = updateNode(current, selected.id, patch);
      return refineGraphSlots(next, integrations);
    });
  }

  async function handleSave() {
    setSaveAttempted(true);
    setTouchedIds(new Set(graph.nodes.map((node) => node.id)));
    const check = validateGraphSetup(graph, integrations, graphValidation(graph));
    if (!check.ok) {
      setError(check.message ?? "Complete the graph before saving");
      return;
    }
    if (!name.trim()) {
      setError("A name is required before saving.");
      return;
    }

    setSaving(true);
    setError(null);

    const flow = graphToRulePayload(graph);
    const token = webhookToken.trim() || newWebhookToken();
    const event = eventConfigFromGraph(graph) ?? { source: "webhook" as const };
    if (runMode === "event" && event.source === "webhook" && !webhookToken.trim()) {
      setWebhookToken(token);
    }
    const runTrigger: RuleRunTrigger = runMode === "event" ? "event" : "timer";
    const payload = {
      name: name.trim(),
      enabled: runMode !== "off",
      runTrigger,
      ...(runMode === "event"
        ? {
            event,
            ...(event.source === "webhook" ? { webhookToken: token } : {}),
          }
        : {}),
      ...flow,
    };

    try {
      if (isEditing && id) {
        await api.updateRule(id, payload);
      } else {
        await api.createRule(payload);
      }
      message.success(isEditing ? "Rule updated" : "Rule created");
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save rule");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
        <Spin size="large" tip="Loading rule..." />
      </div>
    );
  }

  if (isEditing && error && graph.nodes.length <= 1 && !graph.nodes[0]?.integration) {
    return (
      <Space direction="vertical">
        <Alert type="error" message={error} showIcon />
        <Button onClick={() => navigate("/")}>Back to rules</Button>
      </Space>
    );
  }

  return (
    <div>
      <Typography.Title level={2} style={{ marginBottom: 8 }}>
        {isEditing ? "Edit rule" : "Create rule"}
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ maxWidth: 640 }}>
        Timer rules start from IF. Event rules start from EVENT (webhook or Home Assistant), with
        optional IF filters and ACTION / ELSE / CATCH (Catch is optional). Use the gear on a node to
        configure it.
      </Typography.Paragraph>

      <div
        style={{
          display: "grid",
          gap: 20,
          maxWidth: formLayout.labelWidth + formLayout.controlWidth + 64,
          padding: 20,
          marginBottom: 20,
          borderRadius: token.borderRadiusLG,
          background: token.colorBgContainer,
          border: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <Form
          layout="horizontal"
          labelAlign="left"
          colon={false}
          requiredMark={false}
          labelCol={{ flex: `0 0 ${formLayout.labelWidth}px` }}
          wrapperCol={{ flex: "1 1 auto" }}
        >
          <Form.Item
            label="Rule name"
            required
            validateStatus={name.trim() ? undefined : "error"}
            help={name.trim() ? undefined : "A name is required before saving."}
            style={{ marginBottom: 16 }}
          >
            <Input
              value={name}
              placeholder="e.g. Cold morning Telegram alert"
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              style={{ maxWidth: formLayout.controlWidth, width: "100%" }}
            />
          </Form.Item>
        </Form>

        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <Typography.Text strong>Run when</Typography.Text>
            <div>
              <Typography.Text type="secondary">
                Choose a timer, an event (HTTP webhook or Home Assistant message), or keep the rule
                paused. Timer cadence comes from a Time → Every If condition (default 15m), or every
                30s when using Every day at.
              </Typography.Text>
            </div>
          </div>

          <Radio.Group
            value={runMode}
            onChange={(e) => {
              const next = e.target.value as RunMode;
              setRunMode(next);
              if (next === "event") {
                if (!webhookToken.trim()) setWebhookToken(newWebhookToken());
                setGraph((current) => {
                  const withEvent = ensureEventRoot(current);
                  const eventNode = withEvent.nodes.find((n) => n.kind === "event");
                  if (eventNode) setSelectedId(eventNode.id);
                  return withEvent;
                });
              } else if (next === "timer" || next === "off") {
                setGraph((current) => stripEventRoot(current));
              }
            }}
            optionType="button"
            buttonStyle="solid"
            options={[
              { label: "Paused", value: "off" },
              { label: "On a timer", value: "timer" },
              { label: "Event", value: "event" },
            ]}
          />

          {runMode === "event" &&
            eventSourceFromNode(graph.nodes.find((n) => n.kind === "event")) === "webhook" && (
            <div style={{ display: "grid", gap: 8 }}>
              <Typography.Text type="secondary">
                HTTP webhook URL for this event (GET or POST). Configure the Event node to switch to
                Home Assistant websocket messages. Payload is available as {"{{event.*}}"}.
              </Typography.Text>
              <Space.Compact style={{ width: "100%", maxWidth: 520 }}>
                <Input
                  readOnly
                  value={`${typeof window !== "undefined" ? window.location.origin : ""}/api/hooks/${webhookToken}`}
                />
                <Button
                  icon={<CopyOutlined />}
                  onClick={async () => {
                    const url = `${window.location.origin}/api/hooks/${webhookToken}`;
                    try {
                      await navigator.clipboard.writeText(url);
                      message.success("Event webhook URL copied");
                    } catch {
                      message.error("Could not copy URL");
                    }
                  }}
                >
                  Copy
                </Button>
                <Button
                  icon={<ReloadOutlined />}
                  onClick={() => setWebhookToken(newWebhookToken())}
                  title="Generate a new token"
                />
              </Space.Compact>
            </div>
          )}
        </div>
      </div>

      <RuleGraph
        state={graph}
        integrations={integrations}
        selectedId={selectedId}
        touchedIds={touchedIds}
        onSelect={setSelectedId}
        onConfigure={handleConfigure}
        onAddChild={handleAddChild}
        onRemove={handleRemove}
      />

      <GraphNodeConfigModal
        open={configOpen}
        node={selected}
        graph={graph}
        integrations={integrations}
        webhookUrl={
          runMode === "event"
            ? `${typeof window !== "undefined" ? window.location.origin : ""}/api/hooks/${webhookToken}`
            : undefined
        }
        onClose={handleConfigClose}
        onChange={patchSelected}
      />

      {error && (
        <Alert type="error" message={error} showIcon style={{ marginTop: 16 }} />
      )}

      <Space style={{ marginTop: 24 }}>
        <Button onClick={() => navigate("/")}>Cancel</Button>
        <Button type="primary" loading={saving} disabled={!validation.ok || !name.trim()} onClick={handleSave}>
          {isEditing ? "Save changes" : "Save rule"}
        </Button>
      </Space>
      {!validation.ok && validation.message && (isEditing || saveAttempted || touchedIds.size > 0) && (
        <Alert
          type="warning"
          showIcon
          message={validation.message}
          style={{ marginTop: 12 }}
        />
      )}
    </div>
  );
}
