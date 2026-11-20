import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  App,
  Button,
  Form,
  Input,
  Space,
  Spin,
  Switch,
  Typography,
  theme,
} from "antd";
import { api, type Integration } from "../api/client";
import { GraphNodeConfigModal } from "../components/GraphNodeConfigModal";
import { RuleGraph } from "../components/RuleGraph";
import { FieldInput, formLayout } from "../components/ui";
import {
  addChild,
  createEmptyGraph,
  graphToRulePayload,
  graphValidation,
  isConditionKind,
  refineGraphSlots,
  removeNode,
  ruleToGraph,
  updateNode,
  type GraphNode,
  type GraphNodeKind,
  type GraphState,
} from "../lib/graph";

export function RuleFormPage() {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const { id } = useParams();
  const isEditing = Boolean(id);

  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(isEditing);
  const [name, setName] = useState("New automation");
  const [enabled, setEnabled] = useState(true);
  const [graph, setGraph] = useState<GraphState>(createEmptyGraph);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id) return;
    api.getIntegrations().then(setIntegrations);
    const empty = createEmptyGraph();
    setGraph(empty);
    setSelectedId(empty.nodes[0]?.id ?? null);
  }, [id]);

  useEffect(() => {
    if (!id) return;

    setLoading(true);
    setError(null);

    Promise.all([api.getRule(id), api.getIntegrations()])
      .then(([rule, integrationsData]) => {
        setIntegrations(integrationsData);
        setName(rule.name);
        setEnabled(rule.enabled);
        const next = refineGraphSlots(ruleToGraph(rule), integrationsData);
        setGraph(next);
        setSelectedId(next.nodes[0]?.id ?? null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load rule");
      })
      .finally(() => setLoading(false));
  }, [id]);

  const selected = useMemo(
    () => graph.nodes.find((n) => n.id === selectedId) ?? null,
    [graph.nodes, selectedId],
  );

  const validation = graphValidation(graph);
  const hasTimeClause = graph.nodes.some(
    (n) => isConditionKind(n.kind) && n.integration === "time" && n.trigger,
  );

  function handleAddChild(parentId: string, kind: GraphNodeKind) {
    setGraph((current) => {
      const next = addChild(current, parentId, kind);
      const added = next.nodes.find((n) => !current.nodes.some((c) => c.id === n.id));
      if (added) {
        setSelectedId(added.id);
        setConfigOpen(true);
      }
      return next;
    });
  }

  function handleRemove(nodeId: string) {
    setGraph((current) => removeNode(current, nodeId));
    setSelectedId((current) => {
      if (current !== nodeId) return current;
      setConfigOpen(false);
      return graph.nodes.find((n) => n.kind === "if")?.id ?? null;
    });
  }

  function handleConfigure(nodeId: string) {
    setSelectedId(nodeId);
    setConfigOpen(true);
  }

  function patchSelected(patch: Partial<GraphNode>) {
    if (!selected) return;
    setGraph((current) => {
      const next = updateNode(current, selected.id, patch);
      return refineGraphSlots(next, integrations);
    });
  }

  async function handleSave() {
    const check = graphValidation(graph);
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
    const payload = {
      name: name.trim(),
      enabled,
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
        Start from an IF node, then grow the flow with AND / OR conditions and THEN / ELSE actions.
        Use the gear on a node to configure it.
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

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 20,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <Typography.Text strong>Run automatically</Typography.Text>
            <div>
              <Typography.Text type="secondary">
                {enabled
                  ? "On — evaluates when your If conditions match."
                  : "Off — saved paused until you turn it on."}
              </Typography.Text>
            </div>
          </div>
          <Switch
            checked={enabled}
            onChange={setEnabled}
            checkedChildren="On"
            unCheckedChildren="Off"
          />
        </div>

        {!hasTimeClause && (
          <Form
            layout="horizontal"
            labelAlign="left"
            colon={false}
            requiredMark={false}
            labelCol={{ flex: `0 0 ${formLayout.labelWidth}px` }}
            wrapperCol={{ flex: "1 1 auto" }}
            style={{ maxWidth: formLayout.labelWidth + formLayout.controlWidth + 24 }}
          >
            <FieldInput
              field={{ key: "pollInterval", label: "Check every", type: "text", placeholder: "15m" }}
              value={graph.pollInterval}
              onChange={(value) => setGraph((current) => ({ ...current, pollInterval: String(value) }))}
              compact
            />
          </Form>
        )}
      </div>

      <RuleGraph
        state={graph}
        integrations={integrations}
        selectedId={selectedId}
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
        onClose={() => setConfigOpen(false)}
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
      {!validation.ok && validation.message && (
        <div style={{ marginTop: 8 }}>
          <Typography.Text type="secondary">{validation.message}</Typography.Text>
        </div>
      )}
    </div>
  );
}
