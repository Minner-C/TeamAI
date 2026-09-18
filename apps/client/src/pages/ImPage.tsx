import { useCallback, useEffect, useRef, useState } from "react";
import {
  Avatar,
  Badge,
  Button,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Popover,
  Radio,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import { RobotOutlined, PlusOutlined, TeamOutlined, PaperClipOutlined, FileOutlined } from "@ant-design/icons";
import { api, type AiRoleView, type ChannelView, type ImMessage, type SessionUser } from "../api";
import { useAppStore } from "../store/appStore";

function formatSize(size?: number): string {
  if (size == null) return "";
  if (size < 1024) return `${size}B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)}KB`;
  return `${(size / 1024 / 1024).toFixed(1)}MB`;
}

function MessageBody({ m }: { m: ImMessage }) {
  if (m.type === "image" && m.payload?.fileId) {
    return (
      <div className="im-msg-content">
        <img
          src={api.fileUrl(m.payload.fileId)}
          alt={m.payload.name ?? "图片"}
          style={{ maxWidth: 320, maxHeight: 240, borderRadius: 6, display: "block" }}
        />
        <div style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>{m.content}</div>
      </div>
    );
  }
  if (m.type === "file" && m.payload?.fileId) {
    return (
      <div className="im-msg-content">
        <Typography.Link href={api.fileUrl(m.payload.fileId)} target="_blank">
          <FileOutlined /> {m.payload.name ?? m.content}（{formatSize(m.payload.size)}）
        </Typography.Link>
      </div>
    );
  }
  return <div className="im-msg-content">{m.content}</div>;
}

export default function ImPage() {
  const { user, feedToAgent } = useAppStore();
  const [channels, setChannels] = useState<ChannelView[]>([]);
  const [active, setActive] = useState<ChannelView | null>(null);
  const [messages, setMessages] = useState<ImMessage[]>([]);
  const [input, setInput] = useState("");
  const [typingUsers, setTypingUsers] = useState<Record<string, number>>({});
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const typingSentAt = useRef(0);
  const [users, setUsers] = useState<SessionUser[]>([]);
  const [models, setModels] = useState<Array<{ model: string }>>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [rolesOpen, setRolesOpen] = useState(false);
  const [roles, setRoles] = useState<AiRoleView[]>([]);
  const [form] = Form.useForm();
  const [roleForm] = Form.useForm();
  const bottomRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<string | null>(null);

  const refreshChannels = useCallback(() => {
    api.listChannels().then(setChannels).catch((e) => message.error(e.message));
  }, []);

  useEffect(() => {
    refreshChannels();
    api.listUsers().then(setUsers).catch(() => {});
    api.listModels().then(setModels).catch(() => {});
    const off = api.connectIm((ev) => {
      if (ev.type === "message:new") {
        setTypingUsers((prev) => {
          if (!ev.message.senderUserId || !(ev.message.senderUserId in prev)) return prev;
          const next = { ...prev };
          delete next[ev.message.senderUserId];
          return next;
        });
        if (ev.message.channelId === activeRef.current) {
          setMessages((prev) =>
            prev.some((m) => m.id === ev.message.id) ? prev : [...prev, ev.message],
          );
        }
        refreshChannels();
      }
      if (ev.type === "typing" && ev.channelId === activeRef.current && ev.userId !== user?.id) {
        setTypingUsers((prev) => ({ ...prev, [ev.userId]: Date.now() + 3500 }));
        setTimeout(() => {
          setTypingUsers((prev) => {
            if ((prev[ev.userId] ?? 0) > Date.now()) return prev;
            const next = { ...prev };
            delete next[ev.userId];
            return next;
          });
        }, 3600);
      }
    });
    return off;
  }, [refreshChannels, user?.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function openChannel(ch: ChannelView) {
    setActive(ch);
    activeRef.current = ch.id;
    setTypingUsers({});
    try {
      const msgs = await api.listMessages(ch.id);
      setMessages(msgs);
      setHasMore(msgs.length >= 50);
      await api.markRead(ch.id);
      refreshChannels();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
    }
  }

  async function loadEarlier() {
    if (!active || !messages.length || loadingMore) return;
    setLoadingMore(true);
    try {
      const older = await api.listMessages(active.id, messages[0].createdAt);
      setMessages((prev) => [...older.filter((o) => !prev.some((m) => m.id === o.id)), ...prev]);
      setHasMore(older.length >= 50);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoadingMore(false);
    }
  }

  function onInputChange(value: string) {
    setInput(value);
    if (active && value && Date.now() - typingSentAt.current > 2000) {
      typingSentAt.current = Date.now();
      api.sendTyping(active.id);
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || !active) return;
    setInput("");
    try {
      const sent = await api.sendMessage(active.id, text);
      setMessages((prev) => (prev.some((m) => m.id === sent.id) ? prev : [...prev, sent]));
      refreshChannels();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "发送失败");
      setInput(text);
    }
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !active) return;
    const hide = message.loading(`正在上传 ${file.name}…`, 0);
    try {
      const info = await api.uploadFile(file);
      const type = info.mime.startsWith("image/") ? "image" : "file";
      const sent = await api.sendMessage(active.id, info.name, type, {
        fileId: info.id,
        name: info.name,
        size: info.size,
        mime: info.mime,
      });
      setMessages((prev) => (prev.some((m) => m.id === sent.id) ? prev : [...prev, sent]));
      refreshChannels();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "上传失败");
    } finally {
      hide();
    }
  }

  async function onCreateChannel(values: { type: "dm" | "group"; name?: string; memberIds: string[] }) {
    try {
      await api.createChannel(values);
      setCreateOpen(false);
      form.resetFields();
      refreshChannels();
      message.success("会话已创建");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "创建失败");
    }
  }

  async function openRoles() {
    if (!active) return;
    try {
      setRoles(await api.listRoles(active.id));
      setRolesOpen(true);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
    }
  }

  async function onCreateRole(values: {
    name: string;
    model: string;
    personaPrompt?: string;
    trigger?: string;
    keywords?: string[];
  }) {
    if (!active) return;
    try {
      await api.createRole(active.id, values);
      setRoles(await api.listRoles(active.id));
      roleForm.resetFields();
      const hint =
        values.trigger === "keyword"
          ? "消息命中关键词即触发回复"
          : values.trigger === "auto"
            ? "将自动回复群内每条消息"
            : "@它即可触发回复";
      message.success(`AI 角色「${values.name}」已加入，${hint}`);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "创建失败");
    }
  }

  async function onToggleRole(r: AiRoleView) {
    await api.updateRole(r.id, { enabled: !r.enabled });
    if (active) setRoles(await api.listRoles(active.id));
  }

  return (
    <div className="page-card im-page">
      <div className="im-sidebar">
        <div className="im-sidebar-header">
          <Typography.Text strong>会话</Typography.Text>
          <Button size="small" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)} />
        </div>
        <List
          size="small"
          dataSource={channels}
          locale={{ emptyText: <Empty description="暂无会话，点右上角新建" /> }}
          renderItem={(ch) => (
            <List.Item
              className={`im-channel ${active?.id === ch.id ? "im-channel-active" : ""}`}
              onClick={() => openChannel(ch)}
            >
              <Space>
                <Avatar size="small" icon={ch.type === "group" ? <TeamOutlined /> : undefined}>
                  {ch.type === "dm" ? ch.name[0] : null}
                </Avatar>
                <span className="im-channel-name">{ch.name}</span>
              </Space>
              <Badge count={ch.unread} size="small" />
            </List.Item>
          )}
        />
      </div>

      <div className="im-main">
        {!active ? (
          <Empty description="选择一个会话开始聊天" style={{ marginTop: 120 }} />
        ) : (
          <>
            <div className="im-header">
              <Typography.Text strong>{active.name}</Typography.Text>
              {active.type === "group" && (
                <Button size="small" icon={<RobotOutlined />} onClick={openRoles}>
                  AI 角色
                </Button>
              )}
            </div>

            <div className="im-messages">
              {hasMore && (
                <div style={{ textAlign: "center", paddingBottom: 8 }}>
                  <Button size="small" type="link" loading={loadingMore} onClick={() => void loadEarlier()}>
                    加载更早消息
                  </Button>
                </div>
              )}
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`im-msg ${m.senderUserId === user?.id ? "im-msg-mine" : ""}`}
                >
                  <div className="im-msg-meta">
                    {m.senderName}
                    {m.senderRoleId && <Tag color="purple" style={{ marginLeft: 6 }}>AI</Tag>}
                    <span className="im-msg-time">
                      {new Date(m.createdAt).toLocaleTimeString("zh-CN")}
                    </span>
                    <Tooltip title="喂给 AI">
                      <Button
                        type="text"
                        size="small"
                        className="im-feed-btn"
                        onClick={() => feedToAgent(m.content)}
                      >
                        喂给 AI
                      </Button>
                    </Tooltip>
                  </div>
                  <MessageBody m={m} />
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {Object.keys(typingUsers).length > 0 && (
              <div style={{ fontSize: 12, color: "#8c8c8c", padding: "2px 4px 6px" }}>
                {Object.keys(typingUsers)
                  .map((uid) => users.find((u) => u.id === uid)?.name ?? "对方")
                  .join("、")}{" "}
                正在输入…
              </div>
            )}

            <Space.Compact style={{ width: "100%" }}>
              <label className="ant-btn" style={{ display: "flex", alignItems: "center", cursor: "pointer" }}>
                <PaperClipOutlined />
                <input type="file" hidden onChange={(e) => void onPickFile(e)} />
              </label>
              <Input.TextArea
                value={input}
                onChange={(e) => onInputChange(e.target.value)}
                onPressEnter={(e) => {
                  if (!e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder="Enter 发送；群聊中 @AI角色名 可触发 AI 回复"
                autoSize={{ minRows: 1, maxRows: 4 }}
              />
              <Button type="primary" onClick={send}>
                发送
              </Button>
            </Space.Compact>
          </>
        )}
      </div>

      <Modal
        title="新建会话"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.submit()}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={onCreateChannel} initialValues={{ type: "dm" }}>
          <Form.Item name="type" label="类型">
            <Radio.Group
              options={[
                { value: "dm", label: "单聊" },
                { value: "group", label: "群组" },
              ]}
              optionType="button"
            />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(a, b) => a.type !== b.type}>
            {({ getFieldValue }) =>
              getFieldValue("type") === "group" ? (
                <Form.Item name="name" label="群名称" rules={[{ required: true, message: "请输入群名称" }]}>
                  <Input placeholder="研发群" />
                </Form.Item>
              ) : null
            }
          </Form.Item>
          <Form.Item name="memberIds" label="成员" rules={[{ required: true, message: "请选择成员" }]}>
            <Select
              mode="multiple"
              options={users
                .filter((u) => u.id !== user?.id)
                .map((u) => ({ value: u.id, label: `${u.name}（${u.email}）` }))}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`「${active?.name}」AI 角色`}
        open={rolesOpen}
        onCancel={() => setRolesOpen(false)}
        footer={null}
        width={560}
      >
        <List
          size="small"
          dataSource={roles}
          locale={{ emptyText: "还没有 AI 角色" }}
          renderItem={(r) => (
            <List.Item
              actions={[
                <Button key="toggle" size="small" type="text" onClick={() => onToggleRole(r)}>
                  {r.enabled ? "停用" : "启用"}
                </Button>,
                <Popconfirm key="del" title="移除该角色？" onConfirm={() => api.deleteRole(r.id).then(openRoles)}>
                  <Button size="small" danger type="text">
                    移除
                  </Button>
                </Popconfirm>,
              ]}
            >
              <Space>
                <Tag color="purple">AI</Tag>
                <Typography.Text strong delete={!r.enabled}>
                  {r.name}
                </Typography.Text>
                <Typography.Text type="secondary">{r.model}</Typography.Text>
                <Tag>
                  {r.trigger_kind === "keyword"
                    ? `关键词：${r.trigger_keywords}`
                    : r.trigger_kind === "auto"
                      ? "自动回复"
                      : "@提及"}
                </Tag>
                <Popover content={r.persona_prompt || "无人设"}>
                  <Typography.Link>人设</Typography.Link>
                </Popover>
              </Space>
            </List.Item>
          )}
        />
        <Form
          form={roleForm}
          layout="vertical"
          onFinish={onCreateRole}
          style={{ marginTop: 16, borderTop: "1px solid #f0f0f0", paddingTop: 16 }}
        >
          <Space.Compact block>
            <Form.Item name="name" rules={[{ required: true, message: "角色名" }]} style={{ flex: 1 }}>
              <Input placeholder="角色名，如：小助手" />
            </Form.Item>
            <Form.Item name="model" rules={[{ required: true, message: "模型" }]} style={{ flex: 1 }}>
              <Select
                placeholder="模型"
                options={models.map((m) => ({ value: m.model, label: m.model }))}
              />
            </Form.Item>
          </Space.Compact>
          <Form.Item name="trigger" initialValue="mention">
            <Select
              options={[
                { value: "mention", label: "触发方式：@提及角色名" },
                { value: "keyword", label: "触发方式：命中关键词" },
                { value: "auto", label: "触发方式：自动回复每条消息" },
              ]}
            />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(a, b) => a.trigger !== b.trigger}>
            {({ getFieldValue }) =>
              getFieldValue("trigger") === "keyword" ? (
                <Form.Item name="keywords" rules={[{ required: true, message: "请输入至少一个关键词" }]}>
                  <Select mode="tags" placeholder="关键词，回车添加多个" tokenSeparators={[",", "，", " "]} />
                </Form.Item>
              ) : null
            }
          </Form.Item>
          <Form.Item name="personaPrompt">
            <Input.TextArea placeholder="人设 prompt，如：你是资深前端工程师，回答简洁专业" autoSize={{ minRows: 2 }} />
          </Form.Item>
          <Button type="primary" htmlType="submit">
            添加角色
          </Button>
        </Form>
      </Modal>
    </div>
  );
}
