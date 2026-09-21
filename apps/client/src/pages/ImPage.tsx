import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  FileOutlined,
  PaperClipOutlined,
  PictureOutlined,
  PlusOutlined,
  RobotOutlined,
  SearchOutlined,
  SendOutlined,
  SmileOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import {
  api,
  type AiRoleView,
  type ChannelMember,
  type ChannelView,
  type ImMessage,
  type SessionUser,
} from "../api";
import { useAppStore } from "../store/appStore";

const AVATAR_COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6"];

const EMOJIS =
  "😀 😄 😁 😂 🤣 😊 😍 🤔 😅 😭 😤 🥳 😴 🤝 👍 👎 👏 🙏 💪 🎉 🔥 ❤️ 💡 ✅ ❌ ⭐ 🚀 ☕ 🍚 🐛 💻 📌 ⏰ 👀 🤖 👌 😎 🥺 😱 🤯 💯 🔔 📎 🗂️ 📈 🛠️".split(" ");

function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function formatSize(size?: number): string {
  if (size == null) return "";
  if (size < 1024) return `${size}B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)}KB`;
  return `${(size / 1024 / 1024).toFixed(1)}MB`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function fmtListTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ts >= today) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (ts >= today - 86400000) return "昨天";
  const week = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  if (ts >= today - 6 * 86400000) return week[d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function fmtDivider(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (ts >= today) return hm;
  if (ts >= today - 86400000) return `昨天 ${hm}`;
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

function previewOf(ch: ChannelView): string {
  const m = ch.lastMessage;
  if (!m) return "暂无消息";
  const body =
    m.type === "image" ? "[图片]" : m.type === "file" ? `[文件] ${m.payload?.name ?? m.content}` : m.content;
  return ch.type === "group" && m.senderName ? `${m.senderName}：${body}` : body;
}

function MessageAvatar({ name, isAi }: { name: string; isAi?: boolean }) {
  if (isAi) {
    return (
      <div className="im-avatar" style={{ background: "#3b2f63", color: "#c4b5fd" }}>
        <RobotOutlined />
      </div>
    );
  }
  return (
    <div className="im-avatar" style={{ background: avatarColor(name || "?") }}>
      {(name || "?").slice(0, 1).toUpperCase()}
    </div>
  );
}

function MessageBody({ m, mine }: { m: ImMessage; mine: boolean }) {
  if (m.type === "image" && m.payload?.fileId) {
    return (
      <div className="im-bubble-img">
        <img src={api.fileUrl(m.payload.fileId)} alt={m.payload.name ?? "图片"} />
        {m.content && m.content !== m.payload.name && <div className="im-bubble-img-cap">{m.content}</div>}
      </div>
    );
  }
  if (m.type === "file" && m.payload?.fileId) {
    return (
      <a
        className={`im-file-card ${mine ? "im-file-card-mine" : ""}`}
        href={api.fileUrl(m.payload.fileId)}
        target="_blank"
        rel="noreferrer"
      >
        <div className="im-file-icon">
          <FileOutlined />
        </div>
        <div className="im-file-meta">
          <div className="im-file-name">{m.payload.name ?? m.content}</div>
          <div className="im-file-size">{formatSize(m.payload.size)}</div>
        </div>
      </a>
    );
  }
  return <div className={`im-bubble ${mine ? "im-bubble-mine" : ""}`}>{m.content}</div>;
}

export default function ImPage() {
  const { user, feedToAgent } = useAppStore();
  const [channels, setChannels] = useState<ChannelView[]>([]);
  const [keyword, setKeyword] = useState("");
  const [active, setActive] = useState<ChannelView | null>(null);
  const [members, setMembers] = useState<ChannelMember[]>([]);
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
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<string | null>(null);
  const stickBottom = useRef(true);

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
          void api.markRead(ev.message.channelId);
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
    const el = listRef.current;
    if (el && stickBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, active?.id]);

  function onListScroll() {
    const el = listRef.current;
    if (!el) return;
    stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  async function openChannel(ch: ChannelView) {
    setActive(ch);
    activeRef.current = ch.id;
    setTypingUsers({});
    stickBottom.current = true;
    try {
      const [msgs, mem] = await Promise.all([
        api.listMessages(ch.id),
        api.channelMembers(ch.id).catch(() => [] as ChannelMember[]),
      ]);
      setMessages(msgs);
      setMembers(mem);
      setHasMore(msgs.length >= 50);
      await api.markRead(ch.id);
      refreshChannels();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
    }
  }

  async function loadEarlier() {
    if (!active || !messages.length || loadingMore) return;
    const el = listRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    setLoadingMore(true);
    try {
      const older = await api.listMessages(active.id, messages[0].createdAt);
      setMessages((prev) => [...older.filter((o) => !prev.some((m) => m.id === o.id)), ...prev]);
      setHasMore(older.length >= 50);
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - prevHeight;
      });
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
    stickBottom.current = true;
    try {
      const sent = await api.sendMessage(active.id, text);
      setMessages((prev) => (prev.some((m) => m.id === sent.id) ? prev : [...prev, sent]));
      refreshChannels();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "发送失败");
      setInput(text);
    }
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>, onlyImage = false) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !active) return;
    if (onlyImage && !file.type.startsWith("image/")) {
      message.warning("请选择图片文件");
      return;
    }
    const hide = message.loading(`正在上传 ${file.name}…`, 0);
    try {
      const info = await api.uploadFile(file);
      const type = info.mime.startsWith("image/") ? "image" : "file";
      stickBottom.current = true;
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

  const filteredChannels = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    if (!k) return channels;
    return channels.filter((c) => c.name.toLowerCase().includes(k));
  }, [channels, keyword]);

  const rows = useMemo(() => {
    const out: Array<
      | { kind: "divider"; key: string; ts: number }
      | { kind: "msg"; key: string; m: ImMessage; grouped: boolean }
    > = [];
    let prev: ImMessage | null = null;
    for (const m of messages) {
      if (!prev || m.createdAt - prev.createdAt > 5 * 60 * 1000) {
        out.push({ kind: "divider", key: `d-${m.id}`, ts: m.createdAt });
      }
      const grouped =
        !!prev &&
        m.createdAt - prev.createdAt <= 5 * 60 * 1000 &&
        m.senderUserId === prev.senderUserId &&
        m.senderRoleId === prev.senderRoleId;
      out.push({ kind: "msg", key: m.id, m, grouped });
      prev = m;
    }
    return out;
  }, [messages]);

  const typingNames = Object.keys(typingUsers)
    .map((uid) => users.find((u) => u.id === uid)?.name ?? "对方")
    .join("、");

  return (
    <div className="im-page">
      <div className="im-sidebar">
        <div className="im-sidebar-top">
          <Input
            className="im-search"
            prefix={<SearchOutlined style={{ color: "#6b6b72" }} />}
            placeholder="搜索会话"
            allowClear
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <Tooltip title="发起会话">
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)} />
          </Tooltip>
        </div>
        <div className="im-conv-list">
          {filteredChannels.length === 0 && (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={keyword ? "没有匹配的会话" : "暂无会话，点右上角 + 发起"}
              style={{ marginTop: 60 }}
            />
          )}
          {filteredChannels.map((ch) => (
            <div
              key={ch.id}
              className={`im-conv ${active?.id === ch.id ? "im-conv-active" : ""}`}
              onClick={() => void openChannel(ch)}
            >
              {ch.type === "group" ? (
                <div className="im-avatar im-avatar-lg" style={{ background: avatarColor(ch.name) }}>
                  <TeamOutlined />
                </div>
              ) : (
                <div className="im-avatar im-avatar-lg" style={{ background: avatarColor(ch.name) }}>
                  {ch.name.slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="im-conv-body">
                <div className="im-conv-row">
                  <span className="im-conv-name">{ch.name}</span>
                  {ch.lastMessage && <span className="im-conv-time">{fmtListTime(ch.lastMessage.createdAt)}</span>}
                </div>
                <div className="im-conv-row">
                  <span className="im-conv-preview">{previewOf(ch)}</span>
                  {ch.unread > 0 && <Badge count={ch.unread} size="small" />}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="im-main">
        {!active ? (
          <div className="im-placeholder">
            <Empty description="选择一个会话，或点击左上角 + 发起新会话" />
          </div>
        ) : (
          <>
            <div className="im-header">
              <div className="im-header-info">
                <span className="im-header-name">{active.name}</span>
                {active.type === "group" && <span className="im-header-count">{members.length} 名成员</span>}
              </div>
              <Space size={4}>
                {active.type === "group" && (
                  <Avatar.Group maxCount={5} size={28}>
                    {members.map((mb) => (
                      <Tooltip key={mb.id} title={mb.name}>
                        <Avatar style={{ background: avatarColor(mb.name), fontSize: 12 }}>
                          {mb.name.slice(0, 1).toUpperCase()}
                        </Avatar>
                      </Tooltip>
                    ))}
                  </Avatar.Group>
                )}
                {active.type === "group" && (
                  <Button size="small" icon={<RobotOutlined />} onClick={() => void openRoles()}>
                    AI 角色
                  </Button>
                )}
              </Space>
            </div>

            <div className="im-messages" ref={listRef} onScroll={onListScroll}>
              {hasMore && (
                <div className="im-load-more">
                  <Button size="small" type="link" loading={loadingMore} onClick={() => void loadEarlier()}>
                    加载更早消息
                  </Button>
                </div>
              )}
              {messages.length === 0 && (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="还没有消息，说点什么吧"
                  style={{ marginTop: 80 }}
                />
              )}
              {rows.map((row) => {
                if (row.kind === "divider") {
                  return (
                    <div key={row.key} className="im-divider">
                      <span>{fmtDivider(row.ts)}</span>
                    </div>
                  );
                }
                const m = row.m;
                const mine = m.senderUserId === user?.id;
                return (
                  <div
                    key={row.key}
                    className={`im-msg ${mine ? "im-msg-mine" : ""} ${row.grouped ? "im-msg-grouped" : ""}`}
                  >
                    {row.grouped ? (
                      <div className="im-avatar-spacer" />
                    ) : (
                      <MessageAvatar name={m.senderName} isAi={!!m.senderRoleId} />
                    )}
                    <div className="im-msg-main">
                      {!row.grouped && !mine && (
                        <div className="im-msg-sender">
                          {m.senderName}
                          {m.senderRoleId && <span className="im-ai-tag">AI</span>}
                        </div>
                      )}
                      <div className="im-msg-bubble-row">
                        <MessageBody m={m} mine={mine} />
                        <Tooltip title="喂给 AI 助手">
                          <Button
                            type="text"
                            size="small"
                            className="im-feed-btn"
                            icon={<RobotOutlined />}
                            onClick={() => feedToAgent(m.content)}
                          />
                        </Tooltip>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {typingNames && <div className="im-typing">{typingNames} 正在输入…</div>}

            <div className="im-input">
              <div className="im-input-toolbar">
                <Popover
                  trigger="click"
                  placement="topLeft"
                  content={
                    <div className="im-emoji-panel">
                      {EMOJIS.map((e) => (
                        <button key={e} className="im-emoji" onClick={() => onInputChange(input + e)}>
                          {e}
                        </button>
                      ))}
                    </div>
                  }
                >
                  <Button type="text" size="small" icon={<SmileOutlined />} />
                </Popover>
                <Tooltip title="发送图片">
                  <label className="im-tool">
                    <PictureOutlined />
                    <input
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={(e) => void onPickFile(e, true)}
                    />
                  </label>
                </Tooltip>
                <Tooltip title="发送文件">
                  <label className="im-tool">
                    <PaperClipOutlined />
                    <input type="file" hidden onChange={(e) => void onPickFile(e)} />
                  </label>
                </Tooltip>
              </div>
              <Input.TextArea
                className="im-textarea"
                value={input}
                onChange={(e) => onInputChange(e.target.value)}
                onPressEnter={(e) => {
                  if (!e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder={
                  active.type === "group" ? "Enter 发送，Shift+Enter 换行；@AI角色名 可触发 AI 回复" : "Enter 发送，Shift+Enter 换行"
                }
                autoSize={{ minRows: 2, maxRows: 6 }}
                variant="borderless"
              />
              <div className="im-input-footer">
                <span className="im-input-hint">Enter 发送 · Shift+Enter 换行</span>
                <Button type="primary" icon={<SendOutlined />} disabled={!input.trim()} onClick={() => void send()}>
                  发送
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      <Modal
        title="发起会话"
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
                <Button key="toggle" size="small" type="text" onClick={() => void onToggleRole(r)}>
                  {r.enabled ? "停用" : "启用"}
                </Button>,
                <Popconfirm
                  key="del"
                  title="移除该角色？"
                  onConfirm={() => api.deleteRole(r.id).then(() => void openRoles())}
                >
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
          style={{ marginTop: 16, borderTop: "1px solid #303035", paddingTop: 16 }}
        >
          <Space.Compact block>
            <Form.Item name="name" rules={[{ required: true, message: "角色名" }]} style={{ flex: 1 }}>
              <Input placeholder="角色名，如：小助手" />
            </Form.Item>
            <Form.Item name="model" rules={[{ required: true, message: "模型" }]} style={{ flex: 1 }}>
              <Select placeholder="模型" options={models.map((m) => ({ value: m.model, label: m.model }))} />
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
            <Input.TextArea
              placeholder="人设 prompt，如：你是资深前端工程师，回答简洁专业"
              autoSize={{ minRows: 2 }}
            />
          </Form.Item>
          <Button type="primary" htmlType="submit">
            添加角色
          </Button>
        </Form>
      </Modal>
    </div>
  );
}
