import { Typography, Form, Input, Button } from "antd";
import { useAppStore } from "../store/appStore";

export default function SettingsPage() {
  const { serverUrl, setServerUrl } = useAppStore();

  return (
    <div className="page-card">
      <Typography.Title level={3}>设置</Typography.Title>
      <Form layout="vertical" style={{ maxWidth: 480 }}>
        <Form.Item label="服务端地址">
          <Input value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} />
        </Form.Item>
        <Form.Item label="登录令牌">
          <Input.Password placeholder="登录后自动填充" />
        </Form.Item>
        <Button type="primary" disabled>
          保存（开发中）
        </Button>
      </Form>
    </div>
  );
}
