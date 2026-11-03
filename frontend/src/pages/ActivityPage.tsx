import { useEffect, useState } from "react";
import { Alert, Card, Table, Tag, Typography, Spin } from "antd";
import { api, type RunLog } from "../api/client";

function statusColor(status: RunLog["status"]): string {
  switch (status) {
    case "success":
      return "success";
    case "error":
      return "error";
    default:
      return "default";
  }
}

export function ActivityPage() {
  const [runs, setRuns] = useState<RunLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getRuns()
      .then(setRuns)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load activity"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <Typography.Title level={2} style={{ marginBottom: 8 }}>
        Activity
      </Typography.Title>
      <Typography.Paragraph type="secondary">Recent rule evaluations and action runs.</Typography.Paragraph>

      <Card styles={{ body: { padding: 0 } }}>
        {error ? (
          <div style={{ padding: 24 }}>
            <Alert type="error" message={error} showIcon />
          </div>
        ) : (
          <Table
            loading={loading}
            rowKey="id"
            dataSource={runs}
            locale={{ emptyText: loading ? <Spin /> : "No activity yet." }}
            pagination={{ pageSize: 20 }}
            columns={[
              {
                title: "Rule",
                dataIndex: "ruleName",
                key: "ruleName",
                render: (value: string) => <Typography.Text strong>{value}</Typography.Text>,
              },
              {
                title: "Message",
                dataIndex: "message",
                key: "message",
              },
              {
                title: "Time",
                dataIndex: "timestamp",
                key: "timestamp",
                width: 200,
                render: (value: string) => new Date(value).toLocaleString(),
              },
              {
                title: "Status",
                dataIndex: "status",
                key: "status",
                width: 120,
                render: (status: RunLog["status"]) => (
                  <Tag color={statusColor(status)}>{status.toUpperCase()}</Tag>
                ),
              },
            ]}
          />
        )}
      </Card>
    </div>
  );
}
