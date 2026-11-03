import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Avatar, Button, Dropdown, Layout as AntLayout, Space, Typography, theme } from "antd";
import { LogoutOutlined, UserOutlined } from "@ant-design/icons";
import { useAuth } from "../auth/AuthContext";

const { Header, Content } = AntLayout;

const nav = [
  { to: "/", label: "My Rules", end: true },
  { to: "/create", label: "Create", matchEdit: true },
  { to: "/integrations", label: "Integrations" },
  { to: "/activity", label: "Activity" },
  { to: "/arena", label: "Queue", external: true },
] as const;

export function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const { user, logout } = useAuth();

  const editingRule =
    location.pathname.startsWith("/rules/") && location.pathname.endsWith("/edit");

  return (
    <AntLayout style={{ minHeight: "100vh", background: token.colorBgLayout }}>
      <Header
        style={{
          background: token.colorBgContainer,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          display: "flex",
          alignItems: "center",
          gap: 32,
          paddingInline: 24,
          height: 64,
          lineHeight: "normal",
        }}
      >
        <Link
          to="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 12,
            flexShrink: 0,
            color: "inherit",
            textDecoration: "none",
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: token.colorText,
              color: token.colorBgContainer,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
              fontSize: 13,
              lineHeight: 1,
            }}
          >
            if
          </div>
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 2 }}>
            <Typography.Text strong style={{ lineHeight: 1.1 }}>
              if-else
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12, lineHeight: 1.1 }}>
              Simple automations
            </Typography.Text>
          </div>
        </Link>

        <nav
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            flex: 1,
            minWidth: 0,
            height: "100%",
          }}
        >
          {nav.map((item) => {
            const linkStyle = (active: boolean) => ({
              display: "inline-flex" as const,
              alignItems: "center" as const,
              height: "100%",
              paddingInline: 14,
              color: active ? token.colorText : token.colorTextSecondary,
              fontWeight: active ? 600 : 500,
              textDecoration: "none" as const,
              borderBottom: `2px solid ${active ? token.colorPrimary : "transparent"}`,
              boxSizing: "border-box" as const,
            });

            if ("external" in item && item.external) {
              const active = location.pathname.startsWith(item.to);
              return (
                <a key={item.to} href={item.to} style={linkStyle(active)}>
                  {item.label}
                </a>
              );
            }

            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={"end" in item ? item.end : false}
                style={({ isActive }) => {
                  const active = isActive || ("matchEdit" in item && item.matchEdit && editingRule);
                  return linkStyle(active);
                }}
              >
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        {user && (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <Dropdown
              menu={{
                items: [
                  {
                    key: "email",
                    label: user.email,
                    disabled: true,
                  },
                  { type: "divider" },
                  {
                    key: "logout",
                    icon: <LogoutOutlined />,
                    label: "Sign out",
                    onClick: async () => {
                      await logout();
                      navigate("/login");
                    },
                  },
                ],
              }}
              placement="bottomRight"
            >
              <Button
                type="text"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  height: 40,
                  paddingInline: 8,
                }}
              >
                <Space size={8} align="center">
                  <Avatar size="small" src={user.picture} icon={<UserOutlined />} />
                  <Typography.Text style={{ maxWidth: 140, lineHeight: 1 }} ellipsis>
                    {user.name}
                  </Typography.Text>
                </Space>
              </Button>
            </Dropdown>
          </div>
        )}
      </Header>

      <Content style={{ maxWidth: 1152, width: "100%", margin: "0 auto", padding: "32px 24px" }}>
        <Outlet />
      </Content>
    </AntLayout>
  );
}
