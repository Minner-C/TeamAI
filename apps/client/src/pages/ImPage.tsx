import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Avatar,
  Badge,
  Button,
  Drawer,
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
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import {
  ApartmentOutlined,
  DownloadOutlined,
  FileOutlined,
  FileImageOutlined,
  MessageOutlined,
  PaperClipOutlined,
  PictureOutlined,
  PlusOutlined,
  RightOutlined,
  RobotOutlined,
  SearchOutlined,
  SendOutlined,
  SettingOutlined,
  SmileOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import {
  api,
  type AiRoleView,
  type ChannelFile,
  type ChannelMember,
  type ChannelView,
  type Department,
  type ImMessage,
  type OrgUser,
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

function UserAvatar({ name, size = 32, isAi }: { name: string; size?: number; isAi?: boolean }) {
  if (isAi) {
    return (
      <div
        className="im-avatar"
        style={{ background: "#3b2f63", color: "#c4b5fd", width: size, height: size, flexBasis: size }}
      >
        <RobotOutlined />
      </div>
    );
  }
  return (
    <div
      className="im-avatar"
      style={{ background: avatarColor(name || "?"), width: size, height: size, flexBasis: size }}
    >
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

interface OrgNode {
  dept: Department | null;
  children: OrgNode[];
  users: OrgUser[];
}

function buildOrgTree(departments: Department[], users: OrgUser[]): OrgNode[] {
  const byId = new Map<string, OrgNode>();
  const roots: OrgNode[] = [];
  for (const d of departments) byId.set(d.id, { dept: d, children: [], users: [] });
  for (const d of departments) {
    const node = byId.get(d.id)!;
    if (d.parent_id && byId.has(d.parent_id)) byId.get(d.parent_id)!.children.push(node);
    else roots.push(node);
  }
  const unassigned: OrgUser[] = [];
  for (const u of users) {
    if (u.department_id && byId.has(u.department_id)) byId.get(u.department_id)!.users.push(u);
    else unassigned.push(u);
  }
  if (unassigned.length) roots.push({ dept: null, children: [], users: unassigned });
  return roots;
}

export default function ImPage() {
  const { user, feedToAgent } = useAppStore();
  const [sideTab, setSideTab] = useState<"chat" | "contacts">("chat");
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
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([]);
  const [orgDepts, setOrgDepts] = useState<Department[]>([]);
  const [collapsedDepts, setCollapsedDepts] = useState<Record<string, boolean>>({});
  const [models, setModels] = useState<Array<{ model: string }>>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [rolesOpen, setRolesOpen] = useState(false);
  const [roles, setRoles] = useState<AiRoleView[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState("members");
  const [channelFiles, setChannelFiles] = useState<ChannelFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [addMemberIds, setAddMemberIds] = useState<string[]>([]);
  const [form] = Form.useForm();
  const [roleForm] = Form.useForm();
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<string | null>(null);
  const stickBottom = useRef(true);

  const refreshChannels = useCallback(async (): Promise<ChannelView[]> => {
    try {
      const list = await api.listChannels();
      setChannels(list);
      return list;
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
      return [];
    }
  }, []);

  useEffect(() => {
    void refreshChannels();
    api.orgTree().then((o) => { setOrgDepts(o.departments); setOrgUsers(o.users); }).catch(() => {});
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
        void refreshChannels();
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
      void refreshChannels();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
    }
  }

  async function openDmWith(target: OrgUser) {
    if (target.id === user?.id) return;
    try {
      const ch = await api.createChannel({ type: "dm", memberIds: [target.id] });
      const list = await refreshChannels();
      const view = list.find((c) => c.id === ch.id);
      setSideTab("chat");
      if (view) await openChannel(view);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "发起会话失败");
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
      void refreshChannels();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "发送失败");
      setInput(text);
    }
  }

  async function uploadToChannel(file: File) {
    if (!active) return;
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
      void refreshChannels();
      if (drawerOpen && drawerTab === "files") void loadChannelFiles();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "上传失败");
    } finally {
      hide();
    }
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>, onlyImage = false) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (onlyImage && !file.type.startsWith("image/")) {
      message.warning("请选择图片文件");
      return;
    }
    await uploadToChannel(file);
  }

  async function onCreateChannel(values: { type: "dm" | "group"; name?: string; topic?: string; memberIds: string[] }) {
    try {
      await api.createChannel(values);
      setCreateOpen(false);
      form.resetFields();
      void refreshChannels();
      message.success(values.type === "group" ? "项目讨论组已创建" : "会话已创建");
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

  async function loadChannelFiles() {
    if (!active) return;
    setFilesLoading(true);
    try {
      setChannelFiles(await api.channelFiles(active.id));
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setFilesLoading(false);
    }
  }

  function openDrawer(tab: string) {
    setDrawerTab(tab);
    setDrawerOpen(true);
    if (tab === "files") void loadChannelFiles();
  }

  async function onSaveChannelInfo(values: { name: string; topic: string }) {
    if (!active) return;
    try {
      await api.updateChannel(active.id, values);
      setActive({ ...active, name: values.name, topic: values.topic });
      void refreshChannels();
      message.success("已保存");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    }
  }

  async function onAddMembers() {
    if (!active || !addMemberIds.length) return;
    try {
      await api.addChannelMembers(active.id, addMemberIds);
      setAddMemberIds([]);
      setMembers(await api.channelMembers(active.id));
      message.success("成员已添加");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "添加失败");
    }
  }

  async function onRemoveMember(uid: string) {
    if (!active) return;
    try {
      await api.removeChannelMember(active.id, uid);
      setMembers(await api.channelMembers(active.id));
      message.success("已移除");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "移除失败");
    }
  }

  const filteredChannels = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    if (!k) return channels;
    return channels.filter((c) => c.name.toLowerCase().includes(k));
  }, [channels, keyword]);

  const orgTree = useMemo(() => buildOrgTree(orgDepts, orgUsers), [orgDepts, orgUsers]);

  const memberIdSet = useMemo(() => new Set(members.map((m) => m.id)), [members]);

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
    .map((uid) => orgUsers.find((u) => u.id === uid)?.name ?? "对方")
    .join("、");

  const canManageGroup =
    active?.type === "group" && (active.ownerId === user?.id || user?.role === "admin");

  function renderOrgNode(node: OrgNode, depth: number): React.ReactNode {
    const key = node.dept?.id ?? "__unassigned";
    const name = node.dept?.name ?? "未分配部门";
    const collapsed = collapsedDepts[key];
    return (
      <div key={key}>
        <div
          className="im-org-dept"
          style={{ paddingLeft: 10 + depth * 16 }}
          onClick={() => setCollapsedDepts((prev) => ({ ...prev, [key]: !prev[key] }))}
        >
          <RightOutlined
            className="im-org-arrow"
            style={{ transform: collapsed ? "none" : "rotate(90deg)" }}
          />
          <ApartmentOutlined style={{ color: "#8b8b92" }} />
          <span className="im-org-dept-name">{name}</span>
          <span className="im-org-count">{node.users.length + node.children.reduce((s, c) => s + c.users.length, 0)}</span>
        </div>
        {!collapsed && (
          <>
            {node.children.map((c) => renderOrgNode(c, depth + 1))}
            {node.users.map((u) => (
              <div
                key={u.id}
                className="im-org-user"
                style={{ paddingLeft: 10 + (depth + 1) * 16 }}
                onClick={() => void openDmWith(u)}
              >
                <UserAvatar name={u.name} size={28} />
                <div className="im-org-user-info">
                  <div className="im-org-user-name">
                    {u.name}
                    {u.id === user?.id && <span className="im-org-me">我</span>}
                  </div>
                  {u.title && <div className="im-org-user-title">{u.title}</div>}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="im-page">
      <div className="im-sidebar">
        <div className="im-side-tabs">
          <button
            className={`im-side-tab ${sideTab === "chat" ? "im-side-tab-on" : ""}`}
            onClick={() => setSideTab("chat")}
          >
            <MessageOutlined /> 消息
          </button>
          <button
            className={`im-side-tab ${sideTab === "contacts" ? "im-side-tab-on" : ""}`}
            onClick={() => setSideTab("contacts")}
          >
            <TeamOutlined /> 通讯录
          </button>
        </div>

        {sideTab === "chat" ? (
          <>
            <div className="im-sidebar-top">
              <Input
                className="im-search"
                prefix={<SearchOutlined style={{ color: "#6b6b72" }} />}
                placeholder="搜索会话"
                allowClear
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
              <Tooltip title="发起会话 / 创建项目讨论组">
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
          </>
        ) : (
          <div className="im-conv-list">
            {orgTree.length === 0 && (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="暂无成员，请管理员在后台配置组织架构"
                style={{ marginTop: 60 }}
              />
            )}
            {orgTree.map((n) => renderOrgNode(n, 0))}
            <div className="im-org-hint">点击成员即可发起单聊</div>
          </div>
        )}
      </div>

      <div className="im-main">
        {!active ? (
          <div className="im-placeholder">
            <Empty description="选择一个会话，或从通讯录发起单聊" />
          </div>
        ) : (
          <>
            <div className="im-header">
              <div className="im-header-info">
                <span className="im-header-name">{active.name}</span>
                {active.type === "group" && (
                  <>
                    <span className="im-header-count">{members.length} 名成员</span>
                    {active.topic && (
                      <Tooltip title={active.topic}>
                        <span className="im-header-topic">{active.topic}</span>
                      </Tooltip>
                    )}
                  </>
                )}
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
                <Tooltip title="会话设置">
                  <Button size="small" type="text" icon={<SettingOutlined />} onClick={() => openDrawer("members")} />
                </Tooltip>
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
                      <UserAvatar name={m.senderName} isAi={!!m.senderRoleId} />
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
                  active.type === "group"
                    ? "Enter 发送，Shift+Enter 换行；@AI角色名 可触发 AI 回复"
                    : "Enter 发送，Shift+Enter 换行"
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

      <Drawer
        title={active ? `${active.name} · 会话信息` : "会话信息"}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={380}
      >
        {active && (
          <Tabs
            activeKey={drawerTab}
            onChange={(k) => {
              setDrawerTab(k);
              if (k === "files") void loadChannelFiles();
            }}
            items={[
              {
                key: "members",
                label: `成员（${members.length}）`,
                children: (
                  <div>
                    <div className="im-member-add">
                      <Select
                        mode="multiple"
                        style={{ flex: 1 }}
                        placeholder="选择要添加的成员"
                        value={addMemberIds}
                        onChange={setAddMemberIds}
                        options={orgUsers
                          .filter((u) => !memberIdSet.has(u.id))
                          .map((u) => ({ value: u.id, label: u.name }))}
                      />
                      <Button type="primary" disabled={!addMemberIds.length} onClick={() => void onAddMembers()}>
                        添加
                      </Button>
                    </div>
                    {members.map((mb) => (
                      <div key={mb.id} className="im-member-row">
                        <UserAvatar name={mb.name} size={30} />
                        <div className="im-member-info">
                          <div className="im-member-name">
                            {mb.name}
                            {mb.id === active.ownerId && <Tag color="gold" style={{ marginLeft: 6 }}>群主</Tag>}
                            {mb.id === user?.id && <span className="im-org-me">我</span>}
                          </div>
                          <div className="im-member-email">{mb.email}</div>
                        </div>
                        {active.type === "group" && mb.id !== active.ownerId && (canManageGroup || mb.id === user?.id) && (
                          <Popconfirm title="移出该成员？" onConfirm={() => void onRemoveMember(mb.id)}>
                            <Button size="small" type="text" danger>
                              移除
                            </Button>
                          </Popconfirm>
                        )}
                      </div>
                    ))}
                  </div>
                ),
              },
              {
                key: "files",
                label: `群文件（${channelFiles.length}）`,
                children: (
                  <div>
                    <div className="im-member-add">
                      <label className="ant-btn ant-btn-default" style={{ cursor: "pointer" }}>
                        <PaperClipOutlined /> 上传文件到本群
                        <input type="file" hidden onChange={(e) => void onPickFile(e)} />
                      </label>
                    </div>
                    {filesLoading ? (
                      <div style={{ textAlign: "center", padding: 24, color: "#7a7a80" }}>加载中…</div>
                    ) : channelFiles.length === 0 ? (
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有群文件，聊天中发送的文件会自动归集到这里" />
                    ) : (
                      channelFiles.map((f) => (
                        <a
                          key={f.id}
                          className="im-file-card"
                          style={{ marginBottom: 8, width: "100%" }}
                          href={api.fileUrl(f.fileId)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <div className="im-file-icon">
                            {f.type === "image" ? <FileImageOutlined /> : <FileOutlined />}
                          </div>
                          <div className="im-file-meta">
                            <div className="im-file-name">{f.name}</div>
                            <div className="im-file-size">
                              {formatSize(f.size)} · {f.senderName} · {fmtListTime(f.createdAt)}
                            </div>
                          </div>
                          <DownloadOutlined style={{ color: "#6b6b72" }} />
                        </a>
                      ))
                    )}
                  </div>
                ),
              },
              {
                key: "settings",
                label: "设置",
                children: (
                  <Form
                    layout="vertical"
                    initialValues={{ name: active.name, topic: active.topic }}
                    onFinish={onSaveChannelInfo}
                    key={active.id}
                  >
                    {active.type === "group" && (
                      <Form.Item name="name" label="讨论组名称" rules={[{ required: true, message: "请输入名称" }]}>
                        <Input disabled={!canManageGroup && active.ownerId !== user?.id} />
                      </Form.Item>
                    )}
                    {active.type === "group" && (
                      <Form.Item name="topic" label="项目描述 / 群公告">
                        <Input.TextArea
                          rows={4}
                          placeholder="这个项目讨论组的目标、范围、相关仓库链接等"
                        />
                      </Form.Item>
                    )}
                    {active.type === "group" ? (
                      <Button type="primary" htmlType="submit" block>
                        保存
                      </Button>
                    ) : (
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="单聊无可配置项" />
                    )}
                  </Form>
                ),
              },
            ]}
          />
        )}
      </Drawer>

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
                { value: "group", label: "项目讨论组" },
              ]}
              optionType="button"
            />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(a, b) => a.type !== b.type}>
            {({ getFieldValue }) =>
              getFieldValue("type") === "group" ? (
                <>
                  <Form.Item name="name" label="讨论组名称" rules={[{ required: true, message: "请输入名称" }]}>
                    <Input placeholder="如：支付系统重构项目组" />
                  </Form.Item>
                  <Form.Item name="topic" label="项目描述（可选）">
                    <Input.TextArea
                      rows={3}
                      placeholder="项目目标、范围、里程碑等，会展示在群顶部"
                    />
                  </Form.Item>
                </>
              ) : null
            }
          </Form.Item>
          <Form.Item name="memberIds" label="成员" rules={[{ required: true, message: "请选择成员" }]}>
            <Select
              mode="multiple"
              options={orgUsers
                .filter((u) => u.id !== user?.id)
                .map((u) => ({
                  value: u.id,
                  label: `${u.name}${u.title ? `（${u.title}）` : ""}`,
                }))}
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
