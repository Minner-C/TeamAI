import { useState } from "react";
import { Button, Divider, Form, Input, Typography, message } from "antd";
import { ApiOutlined, DesktopOutlined } from "@ant-design/icons";
import { useAppStore } from "../store/appStore";
import { api } from "../api";

export default function LoginPage() {
  const { serverUrl, setServerUrl, setAuth, setOffline } = useAppStore();
  const [form] = Form.useForm<{ email: string; password: string; server?: string }>();
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);

  async function testConnection() {
    const input = (form.getFieldValue("server") ?? serverUrl).trim();
    if (!input) {
      message.warning("请先填写服务端地址");
      return;
    }
    setTesting(true);
    try {
      await api.setServerUrl(input);
      const ok = await api.checkServerHealth();
      if (ok) message.success("连接成功，服务端在线");
      else message.error("连接失败：服务端无响应，请确认地址正确且服务端已启动");
    } finally {
      setTesting(false);
    }
  }

  async function onFinish(values: { email: string; password: string; server?: string }) {
    const server = (values.server ?? "").trim().replace(/\/+$/, "");
    if (api.isElectron && !server) {
      message.warning("请填写服务端地址，或选择离线模式");
      return;
    }
    setLoading(true);
    try {
      if (api.isElectron) {
        setServerUrl(server);
        await api.setServerUrl(server);
      }
      const { token, user } = await api.login(values.email, values.password);
      setAuth(token, user);
      message.success(`欢迎，${user.name}`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "登录失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">T</div>
        <div className="login-title">TeamAI</div>
        <div className="login-sub">
          {api.isElectron
            ? "连接到团队的 TeamAI 服务端"
            : "浏览器模式（与当前站点同源，无需配置地址）"}
        </div>
        <Form
          form={form}
          layout="vertical"
          onFinish={onFinish}
          initialValues={{ server: serverUrl }}
        >
          {api.isElectron && (
            <Form.Item
              label="服务端地址"
              name="server"
              rules={[{ required: true, message: "请输入服务端地址" }]}
              extra={
                <Button size="small" type="link" style={{ padding: 0 }} loading={testing} onClick={() => void testConnection()}>
                  测试连接
                </Button>
              }
            >
              <Input placeholder="http://192.168.1.10:8787" prefix={<ApiOutlined />} />
            </Form.Item>
          )}
          <Form.Item label="邮箱" name="email" rules={[{ required: true, message: "请输入邮箱" }]}>
            <Input placeholder="admin@teamai.local" autoFocus={!api.isElectron} />
          </Form.Item>
          <Form.Item label="密码" name="password" rules={[{ required: true, message: "请输入密码" }]}>
            <Input.Password />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading}>
            连接并登录
          </Button>
        </Form>
        {api.isElectron && (
          <>
            <Divider plain style={{ margin: "16px 0 12px" }}>
              或
            </Divider>
            <Button block icon={<DesktopOutlined />} onClick={() => setOffline(true)}>
              暂不连接，仅使用本地 Agent CLI
            </Button>
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8 }}>
              离线模式下客户端独立运行：本地 CLI（Kimi / Claude）可直接使用，团队消息、仓库等功能将在连接服务端后可用。
            </Typography.Paragraph>
          </>
        )}
      </div>
    </div>
  );
}
