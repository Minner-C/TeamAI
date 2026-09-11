import { useEffect, useState } from "react";
import { Typography, Form, Input, Button, Table, Tag, message } from "antd";
import { useAppStore } from "../store/appStore";

interface CliRow {
  kind: string;
  command: string;
  channel: string;
  installed: boolean;
  version: string | null;
}

export default function SettingsPage() {
  const { serverUrl, setServerUrl, user, logout } = useAppStore();
  const [clis, setClis] = useState<CliRow[]>([]);

  useEffect(() => {
    window.teamai
      .detectClis()
      .then(setClis)
      .catch((err) => message.error(`CLI 检测失败：${err.message}`));
  }, []);

  return (
    <div className="page-card">
      <Typography.Title level={3}>设置</Typography.Title>
      <Form layout="vertical" style={{ maxWidth: 480 }}>
        <Form.Item label="服务端地址">
          <Input value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} />
        </Form.Item>
        <Form.Item label="当前用户">
          <Input value={`${user?.name ?? ""}（${user?.email ?? ""}）`} disabled />
        </Form.Item>
        <Button onClick={logout}>退出登录</Button>
      </Form>

      <Typography.Title level={5} style={{ marginTop: 32 }}>
        AI CLI 检测
      </Typography.Title>
      <Table
        size="small"
        pagination={false}
        dataSource={clis.map((c) => ({ ...c, key: c.kind }))}
        columns={[
          { title: "CLI", dataIndex: "kind" },
          { title: "命令", dataIndex: "command" },
          { title: "通道", dataIndex: "channel" },
          {
            title: "状态",
            render: (_, r: CliRow) =>
              r.installed ? <Tag color="success">{r.version}</Tag> : <Tag>未安装</Tag>,
          },
        ]}
      />
    </div>
  );
}
