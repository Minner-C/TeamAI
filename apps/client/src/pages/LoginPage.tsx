import { useState } from "react";
import { Button, Card, Form, Input, Typography, message } from "antd";
import { useAppStore } from "../store/appStore";
import { api } from "../api";

export default function LoginPage() {
  const { serverUrl, setAuth } = useAppStore();
  const [loading, setLoading] = useState(false);

  async function onFinish(values: { email: string; password: string }) {
    setLoading(true);
    try {
      await api.setServerUrl(serverUrl);
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
      <Card style={{ width: 380 }}>
        <Typography.Title level={3} style={{ textAlign: "center" }}>
          TeamAI 登录
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ textAlign: "center" }}>
          {api.isElectron ? serverUrl : "浏览器预览模式（经 Vite 代理连接服务端）"}
        </Typography.Paragraph>
        <Form layout="vertical" onFinish={onFinish}>
          <Form.Item label="邮箱" name="email" rules={[{ required: true, message: "请输入邮箱" }]}>
            <Input placeholder="admin@teamai.local" autoFocus />
          </Form.Item>
          <Form.Item label="密码" name="password" rules={[{ required: true, message: "请输入密码" }]}>
            <Input.Password />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading}>
            登录
          </Button>
        </Form>
      </Card>
    </div>
  );
}
