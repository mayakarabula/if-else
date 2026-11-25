import { useState } from "react";
import { Alert, Button, Form, Input, Space, Tooltip, Typography, theme } from "antd";
import {
  LockOutlined,
  MailOutlined,
  MoonOutlined,
  SunOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useThemeMode } from "../theme";

type Mode = "login" | "register";

export function LoginPage() {
  const { user, loading, refresh } = useAuth();
  const { token } = theme.useToken();
  const { mode: colorMode, toggleMode } = useThemeMode();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next");

  const [mode, setMode] = useState<Mode>("login");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function goAfterAuth() {
    if (next?.startsWith("/arena")) {
      window.location.assign(next);
      return;
    }
    navigate(next && next.startsWith("/") ? next : "/", { replace: true });
  }

  if (!loading && user) {
    if (next?.startsWith("/arena")) {
      window.location.replace(next);
      return null;
    }
    return <Navigate to={next && next.startsWith("/") ? next : "/"} replace />;
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: token.colorBgLayout,
        position: "relative",
      }}
    >
      <Tooltip title={colorMode === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
        <Button
          type="text"
          aria-label={colorMode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          icon={colorMode === "dark" ? <SunOutlined /> : <MoonOutlined />}
          onClick={toggleMode}
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            width: 40,
            height: 40,
          }}
        />
      </Tooltip>
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: token.colorBgContainer,
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: 12,
          padding: 28,
        }}
      >
        <Space direction="vertical" size="large" style={{ width: "100%" }}>
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 12,
                background: token.colorText,
                color: token.colorBgContainer,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 700,
                marginBottom: 16,
              }}
            >
              if
            </div>
            <Typography.Title level={3} style={{ margin: 0 }}>
              {mode === "login" ? "Sign in to if-else" : "Create your account"}
            </Typography.Title>
            <Typography.Text type="secondary">
              {mode === "login"
                ? "Use your email and password."
                : "Register with email and password to get started."}
            </Typography.Text>
          </div>

          {formError && <Alert type="error" showIcon message={formError} />}

          <Form
            layout="vertical"
            requiredMark={false}
            key={mode}
            onFinish={async (values: { email: string; password: string; name?: string }) => {
              setSubmitting(true);
              setFormError(null);
              try {
                if (mode === "register") {
                  await api.register({
                    email: values.email.trim(),
                    password: values.password,
                    name: values.name?.trim() || undefined,
                  });
                } else {
                  await api.login({
                    email: values.email.trim(),
                    password: values.password,
                  });
                }
                await refresh();
                goAfterAuth();
              } catch (err) {
                setFormError(err instanceof Error ? err.message : "Authentication failed.");
              } finally {
                setSubmitting(false);
              }
            }}
          >
            {mode === "register" && (
              <Form.Item name="name" label="Name">
                <Input size="large" prefix={<UserOutlined />} placeholder="Optional" />
              </Form.Item>
            )}
            <Form.Item
              name="email"
              label="Email"
              rules={[
                { required: true, message: "Enter your email" },
                { type: "email", message: "Enter a valid email" },
              ]}
            >
              <Input size="large" prefix={<MailOutlined />} placeholder="you@example.com" />
            </Form.Item>
            <Form.Item
              name="password"
              label="Password"
              rules={[
                { required: true, message: "Enter your password" },
                ...(mode === "register"
                  ? [{ min: 8, message: "Use at least 8 characters" }]
                  : []),
              ]}
            >
              <Input.Password size="large" prefix={<LockOutlined />} placeholder="••••••••" />
            </Form.Item>
            <Button type="primary" htmlType="submit" size="large" block loading={submitting}>
              {mode === "login" ? "Sign in" : "Create account"}
            </Button>
          </Form>

          <Typography.Paragraph style={{ margin: 0, textAlign: "center" }}>
            {mode === "login" ? (
              <>
                No account yet?{" "}
                <Typography.Link
                  onClick={() => {
                    setMode("register");
                    setFormError(null);
                  }}
                >
                  Create one
                </Typography.Link>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <Typography.Link
                  onClick={() => {
                    setMode("login");
                    setFormError(null);
                  }}
                >
                  Sign in
                </Typography.Link>
              </>
            )}
          </Typography.Paragraph>
        </Space>
      </div>
    </div>
  );
}
