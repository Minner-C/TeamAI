import { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
  Drawer,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import {
  CaretRightOutlined,
  CodeOutlined,
  FileTextOutlined,
  PauseOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { api, type EnvView, type RepoView } from "../api";

export default function EnvsPage() {
  const [envs, setEnvs] = useState<EnvView[]>([]);
  const [repos, setRepos] = useState<RepoView[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [logsEnv, setLogsEnv] = useState<EnvView | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [execEnv, setExecEnv] = useState<EnvView | null>(null);
  const [execCmd, setExecCmd] = useState("");
  const [execOut, setExecOut] = useState("");
  const [execRunning, setExecRunning] = useState(false);
  const [form] = Form.useForm();
  const logTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(() => {
    api.listEnvs().then(setEnvs).catch((err) => message.error(err.message));
  }, []);

  useEffect(refresh, [refresh]);
  useEffect(() => {
    api.listRepos().then(setRepos).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!logsEnv) return;
    const pull = () =>
      api
        .envLogs(logsEnv.id)
        .then((r) => setLogs(r.lines))
        .catch(() => undefined);
    void pull();
    logTimer.current = setInterval(pull, 2000);
    return () => {
      if (logTimer.current) clearInterval(logTimer.current);
    };
  }, [logsEnv]);

  async function onCreate(values: { name: string; repoId?: string; runCmd?: string }) {
    try {
      await api.createEnv({ name: values.name, repoId: values.repoId || undefined, runCmd: values.runCmd || undefined });
      message.success("环境已创建");
      setCreateOpen(false);
      form.resetFields();
      refresh();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "创建失败");
    }
  }

  async function onAction(env: EnvView, action: "start" | "stop") {
    try {
      await api.envAction(env.id, action);
      message.success(action === "start" ? "已启动" : "已停止");
      refresh();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "操作失败");
    }
  }

  async function onExec() {
    if (!execEnv || !execCmd.trim()) return;
    setExecRunning(true);
    try {
      const r = await api.envExec(execEnv.id, execCmd.trim());
      setExecOut((prev) => `${prev}\n$ ${execCmd.trim()}\n${r.output}`.trim());
    } catch (err) {
      setExecOut((prev) => `${prev}\n$ ${execCmd.trim()}\n${err instanceof Error ? err.message : "执行失败"}`.trim());
    } finally {
      setExecRunning(false);
      setExecCmd("");
    }
  }

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
          新建环境
        </Button>
        <Button onClick={refresh}>刷新</Button>
      </Space>

      <Table
        rowKey="id"
        dataSource={envs}
        pagination={false}
        columns={[
          { title: "名称", dataIndex: "name", render: (v: string) => <b>{v}</b> },
          { title: "仓库", dataIndex: "repoName", render: (v: string | null) => v ?? "-" },
          { title: "启动命令", dataIndex: "runCmd", render: (v: string) => (v ? <Typography.Text code>{v}</Typography.Text> : "-") },
          {
            title: "状态",
            dataIndex: "status",
            render: (v: string) => (
              <Tag color={v === "running" ? "green" : v === "error" ? "red" : "default"}>{v}</Tag>
            ),
          },
          {
            title: "创建时间",
            dataIndex: "createdAt",
            render: (v: number) => new Date(v).toLocaleString("zh-CN"),
          },
          {
            title: "操作",
            render: (_, env) => (
              <Space>
                {env.status === "running" ? (
                  <Button size="small" icon={<PauseOutlined />} onClick={() => onAction(env, "stop")}>
                    停止
                  </Button>
                ) : (
                  <Button size="small" type="primary" ghost icon={<CaretRightOutlined />} onClick={() => onAction(env, "start")} disabled={!env.runCmd}>
                    启动
                  </Button>
                )}
                <Button size="small" icon={<FileTextOutlined />} onClick={() => setLogsEnv(env)}>
                  日志
                </Button>
                <Button size="small" icon={<CodeOutlined />} onClick={() => { setExecEnv(env); setExecOut(""); }}>
                  终端
                </Button>
                <Popconfirm title="删除环境？工作区将被清除" onConfirm={async () => { await api.deleteEnv(env.id); refresh(); }}>
                  <Button size="small" danger>删除</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title="新建在线环境"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.submit()}
        okText="创建"
      >
        <Form form={form} layout="vertical" onFinish={onCreate}>
          <Form.Item name="name" label="环境名" rules={[{ required: true, message: "请输入环境名" }]}>
            <Input placeholder="如：前端 dev 环境" />
          </Form.Item>
          <Form.Item name="repoId" label="从仓库克隆（可选）">
            <Select
              allowClear
              placeholder="不选则创建空工作区"
              options={repos.map((r) => ({ value: r.id, label: `${r.group}/${r.name}` }))}
            />
          </Form.Item>
          <Form.Item name="runCmd" label="启动命令（可选）">
            <Input placeholder="如：npm run dev" />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={`日志：${logsEnv?.name ?? ""}`}
        open={!!logsEnv}
        onClose={() => setLogsEnv(null)}
        width={560}
      >
        <pre style={{ background: "#111", color: "#0f0", padding: 12, borderRadius: 6, fontSize: 12, minHeight: 300 }}>
          {logs.join("\n") || "（暂无日志）"}
        </pre>
        <Typography.Text type="secondary">每 2 秒自动刷新</Typography.Text>
      </Drawer>

      <Drawer
        title={`终端：${execEnv?.name ?? ""}`}
        open={!!execEnv}
        onClose={() => setExecEnv(null)}
        width={560}
      >
        <pre style={{ background: "#111", color: "#ddd", padding: 12, borderRadius: 6, fontSize: 12, minHeight: 300, whiteSpace: "pre-wrap" }}>
          {execOut || "在下方输入命令，在工作区内执行"}
        </pre>
        <Space.Compact style={{ width: "100%" }}>
          <Input
            value={execCmd}
            onChange={(e) => setExecCmd(e.target.value)}
            onPressEnter={onExec}
            placeholder="如：ls -la"
            disabled={execRunning}
          />
          <Button type="primary" loading={execRunning} onClick={onExec}>
            执行
          </Button>
        </Space.Compact>
      </Drawer>
    </div>
  );
}
