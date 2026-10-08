import { useCallback, useEffect, useState } from "react";
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
  Timeline,
  Typography,
  message,
} from "antd";
import { CopyOutlined, CloudDownloadOutlined, ApiOutlined } from "@ant-design/icons";
import { api, type RepoView, type WebhookView } from "../api";
import { useAppStore } from "../store/appStore";

interface Commit {
  hash: string;
  author: string;
  at: number;
  message: string;
}

export default function ReposPage() {
  const user = useAppStore((s) => s.user);
  const [repos, setRepos] = useState<RepoView[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [commits, setCommits] = useState<Commit[] | null>(null);
  const [commitsRepo, setCommitsRepo] = useState("");
  const [commitsRepoId, setCommitsRepoId] = useState("");
  const [branches, setBranches] = useState<string[]>([]);
  const [branch, setBranch] = useState("");
  const [hooksRepo, setHooksRepo] = useState<RepoView | null>(null);
  const [hooks, setHooks] = useState<WebhookView[]>([]);
  const [hookUrl, setHookUrl] = useState("");
  const [hookSecret, setHookSecret] = useState("");
  const [hookBusy, setHookBusy] = useState(false);
  const [form] = Form.useForm();

  const refresh = useCallback(() => {
    api
      .listRepos()
      .then(setRepos)
      .catch((err) => message.error(err.message));
  }, []);

  useEffect(refresh, [refresh]);

  async function onCreate(values: { name: string; group?: string; visibility?: string }) {
    try {
      await api.createRepo(values.name, values.group || "default", values.visibility || "team");
      message.success("仓库已创建");
      setCreateOpen(false);
      form.resetFields();
      refresh();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "创建失败");
    }
  }

  async function onClone(repo: RepoView) {
    try {
      const url = await api.repoRemoteUrl(repo.group, repo.name, user?.email ?? "");
      if (!api.isElectron) {
        await navigator.clipboard.writeText(`git clone ${url}`);
        message.success("克隆命令已复制到剪贴板（含临时凭证，注意保密）");
        return;
      }
      const dir = await api.pickDir();
      if (!dir) return;
      await api.gitClone(url, `${dir}/${repo.name}`);
      message.success(`已克隆到 ${dir}/${repo.name}`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "克隆失败");
    }
  }

  async function showCommits(repo: RepoView, ref?: string) {
    try {
      setCommitsRepo(`${repo.group}/${repo.name}`);
      setCommitsRepoId(repo.id);
      const [commitsData, branchList] = await Promise.all([
        api.repoCommits(repo.id, ref),
        api.repoBranches(repo.id).catch(() => [] as string[]),
      ]);
      setCommits(commitsData);
      setBranches(branchList);
      setBranch(ref ?? "");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载失败");
    }
  }

  async function openHooks(repo: RepoView) {
    setHooksRepo(repo);
    setHookUrl("");
    setHookSecret("");
    try {
      setHooks(await api.listWebhooks(repo.id));
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载 Webhook 失败");
    }
  }

  async function reloadHooks() {
    if (!hooksRepo) return;
    setHooks(await api.listWebhooks(hooksRepo.id));
  }

  async function onAddHook() {
    if (!hooksRepo || !hookUrl.trim()) return;
    setHookBusy(true);
    try {
      await api.addWebhook(hooksRepo.id, hookUrl.trim(), hookSecret.trim() || undefined);
      message.success("Webhook 已添加");
      setHookUrl("");
      setHookSecret("");
      await reloadHooks();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "添加失败");
    } finally {
      setHookBusy(false);
    }
  }

  async function onTestHook(webhookId: string) {
    if (!hooksRepo) return;
    try {
      const r = await api.testWebhook(hooksRepo.id, webhookId);
      if (r.ok) message.success(`投递成功（HTTP ${r.status}）`);
      else message.warning(`投递失败：${r.error ?? `HTTP ${r.status}`}`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "测试失败");
    }
  }

  return (
    <div className="page-card">
      <Space style={{ marginBottom: 16, width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          项目仓库
        </Typography.Title>
        <Button type="primary" onClick={() => setCreateOpen(true)}>
          新建仓库
        </Button>
      </Space>

      <Table
        size="middle"
        pagination={false}
        dataSource={repos.map((r) => ({ ...r, key: r.id }))}
        columns={[
          {
            title: "仓库",
            render: (_, r: RepoView) => (
              <Space>
                <Typography.Text strong>
                  {r.group}/{r.name}
                </Typography.Text>
                {r.visibility === "private" && <Tag color="orange">私有</Tag>}
              </Space>
            ),
          },
          {
            title: "创建时间",
            dataIndex: "createdAt",
            render: (v: number) => new Date(v).toLocaleString("zh-CN"),
          },
          {
            title: "操作",
            render: (_, r: RepoView) => (
              <Space>
                <Button size="small" onClick={() => showCommits(r)}>
                  提交历史
                </Button>
                {(r.ownerId === user?.id || user?.role === "admin") && (
                  <Button size="small" icon={<ApiOutlined />} onClick={() => void openHooks(r)}>
                    Webhook
                  </Button>
                )}
                <Button
                  size="small"
                  icon={api.isElectron ? <CloudDownloadOutlined /> : <CopyOutlined />}
                  onClick={() => onClone(r)}
                >
                  {api.isElectron ? "克隆" : "复制克隆命令"}
                </Button>
                <Popconfirm title="删除仓库？磁盘上的 git 数据将一并删除" onConfirm={() => api.deleteRepo(r.id).then(refresh)}>
                  <Button size="small" danger>
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title="新建仓库"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.submit()}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={onCreate}>
          <Form.Item label="分组" name="group" initialValue="default">
            <Input placeholder="default" />
          </Form.Item>
          <Form.Item label="可见性" name="visibility" initialValue="team">
            <Select
              options={[
                { value: "team", label: "团队可见（全部成员可读写）" },
                { value: "private", label: "私有（仅仓库成员，可在控制台管理）" },
              ]}
            />
          </Form.Item>
          <Form.Item
            label="仓库名"
            name="name"
            rules={[
              { required: true, message: "请输入仓库名" },
              { pattern: /^[a-zA-Z0-9._-]{1,64}$/, message: "仅限字母数字 . _ -" },
            ]}
          >
            <Input placeholder="my-project" />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={`${commitsRepo} 提交历史`}
        open={commits !== null}
        onClose={() => setCommits(null)}
        width={480}
      >
        {branches.length > 0 && (
          <Select
            style={{ width: 200, marginBottom: 16 }}
            placeholder="选择分支"
            value={branch || undefined}
            onChange={(ref) => {
              const repo = repos.find((r) => r.id === commitsRepoId);
              if (repo) void showCommits(repo, ref);
            }}
            options={branches.map((b) => ({ value: b, label: b }))}
          />
        )}
        {commits?.length === 0 && <Tag>空仓库，暂无提交</Tag>}
        <Timeline
          items={(commits ?? []).map((c) => ({
            key: c.hash,
            children: (
              <>
                <Typography.Text code>{c.hash}</Typography.Text> {c.message}
                <br />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {c.author} · {new Date(c.at * 1000).toLocaleString("zh-CN")}
                </Typography.Text>
              </>
            ),
          }))}
        />
      </Drawer>

      <Modal
        title={hooksRepo ? `${hooksRepo.group}/${hooksRepo.name} · Webhook` : "Webhook"}
        open={hooksRepo !== null}
        onCancel={() => setHooksRepo(null)}
        footer={null}
        width={560}
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          push 到该仓库时，会向以下地址 POST JSON 事件（event=push，含仓库与推送人信息）；配置 secret 后请求头附带
          X-TeamAI-Signature（HMAC-SHA256）用于验签。
        </Typography.Paragraph>
        <Space direction="vertical" style={{ width: "100%" }} size={12}>
          {hooks.length === 0 && <Tag>尚未配置 Webhook</Tag>}
          {hooks.map((h) => (
            <Space key={h.id} style={{ width: "100%", justifyContent: "space-between" }}>
              <Space>
                <Typography.Text code style={{ fontSize: 12 }}>{h.url}</Typography.Text>
                {h.hasSecret && <Tag color="blue">已验签</Tag>}
              </Space>
              <Space>
                <Button size="small" onClick={() => void onTestHook(h.id)}>
                  测试
                </Button>
                <Popconfirm
                  title="删除该 Webhook？"
                  onConfirm={() =>
                    api
                      .deleteWebhook(hooksRepo!.id, h.id)
                      .then(reloadHooks)
                      .catch((err) => message.error(err instanceof Error ? err.message : "删除失败"))
                  }
                >
                  <Button size="small" danger>
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            </Space>
          ))}
          <Space.Compact style={{ width: "100%" }}>
            <Input placeholder="https://ci.example.com/hook" value={hookUrl} onChange={(e) => setHookUrl(e.target.value)} />
            <Input.Password
              placeholder="secret（可选，用于 HMAC 验签）"
              style={{ width: 220 }}
              value={hookSecret}
              onChange={(e) => setHookSecret(e.target.value)}
            />
            <Button type="primary" loading={hookBusy} disabled={!hookUrl.trim()} onClick={() => void onAddHook()}>
              添加
            </Button>
          </Space.Compact>
        </Space>
      </Modal>
    </div>
  );
}
