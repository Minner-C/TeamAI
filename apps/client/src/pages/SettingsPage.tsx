import { useEffect, useState } from "react";
import { Typography, Form, Input, Button, Table, Tag, Modal, message } from "antd";
import { DownloadOutlined, ReloadOutlined } from "@ant-design/icons";
import { useAppStore } from "../store/appStore";
import { api } from "../api";

interface CliRow {
  kind: string;
  command: string;
  channel: string;
  installed: boolean;
  version: string | null;
}

export default function SettingsPage() {
  const { serverUrl, setServerUrl, user, logout, setOffline } = useAppStore();
  const [clis, setClis] = useState<CliRow[]>([]);
  const [installing, setInstalling] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  function refreshClis() {
    if (!api.isElectron) return;
    setRefreshing(true);
    api
      .detectClis()
      .then(setClis)
      .catch((err) => message.error(`CLI 检测失败：${err.message}`))
      .finally(() => setRefreshing(false));
  }

  useEffect(() => {
    refreshClis();
  }, []);

  async function installOne(kind: string) {
    setInstalling(kind);
    try {
      const res = await api.installCli(kind);
      if (res.ok) {
        message.success(`${kind} 安装完成（${res.version ?? "已就绪"}）`);
      } else {
        Modal.error({
          title: `${kind} 安装失败`,
          width: 560,
          content: <pre className="cli-install-log">{res.output}</pre>,
        });
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : "安装失败");
    } finally {
      setInstalling(null);
      refreshClis();
    }
  }

  return (
    <div className="page-card">
      <Typography.Title level={3}>设置</Typography.Title>
      <Form layout="vertical" style={{ maxWidth: 480 }}>
        <Form.Item label="服务端地址" extra="客户端与服务端是连接关系：地址保存在本机，可随时修改；留空则仅使用本地功能">
          <Input
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value.trim().replace(/\/+$/, ""))}
            placeholder="http://192.168.1.10:8787"
          />
        </Form.Item>
        {user ? (
          <>
            <Form.Item label="当前用户">
              <Input value={`${user.name}（${user.email}）`} disabled />
            </Form.Item>
            <Button onClick={logout}>退出登录</Button>
          </>
        ) : (
          <Form.Item label="连接状态">
            <Button type="primary" onClick={() => setOffline(false)}>
              连接服务端并登录
            </Button>
          </Form.Item>
        )}
      </Form>

      {user?.role === "admin" && (
        <>
          <Typography.Title level={5} style={{ marginTop: 32 }}>
            创建成员账号
          </Typography.Title>
          <Form
            layout="inline"
            style={{ maxWidth: 720 }}
            onFinish={async (v: { name: string; email: string; password: string }) => {
              try {
                await api.createUser(v.name, v.email, v.password);
                message.success(`成员「${v.name}」已创建`);
              } catch (err) {
                message.error(err instanceof Error ? err.message : "创建失败");
              }
            }}
          >
            <Form.Item name="name" rules={[{ required: true, message: "姓名" }]}>
              <Input placeholder="姓名" />
            </Form.Item>
            <Form.Item name="email" rules={[{ required: true, message: "邮箱" }]}>
              <Input placeholder="邮箱" />
            </Form.Item>
            <Form.Item name="password" rules={[{ required: true, message: "密码" }]}>
              <Input.Password placeholder="初始密码" />
            </Form.Item>
            <Button type="primary" htmlType="submit">
              创建
            </Button>
          </Form>
        </>
      )}

      <div style={{ display: "flex", alignItems: "center", marginTop: 32 }}>
        <Typography.Title level={5} style={{ margin: 0, flex: 1 }}>
          AI CLI 检测
        </Typography.Title>
        <Button size="small" icon={<ReloadOutlined />} loading={refreshing} onClick={refreshClis}>
          重新检测
        </Button>
      </div>
      <Table
        size="small"
        pagination={false}
        style={{ marginTop: 12 }}
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
          {
            title: "操作",
            render: (_, r: CliRow) =>
              r.installed ? null : (
                <Button
                  size="small"
                  type="primary"
                  ghost
                  icon={<DownloadOutlined />}
                  loading={installing === r.kind}
                  disabled={installing !== null}
                  onClick={() => void installOne(r.kind)}
                >
                  一键安装
                </Button>
              ),
          },
        ]}
      />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        一键安装通过 npm 全局安装官方 CLI 包，需要本机已安装 Node.js 且网络可访问 npm registry。
      </Typography.Text>
    </div>
  );
}
