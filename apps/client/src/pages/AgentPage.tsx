import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Form, Input, Modal, Select, Tag, message } from "antd";
import {
  ArrowUpOutlined,
  BugOutlined,
  CheckOutlined,
  CloudOutlined,
  CloudUploadOutlined,
  CodeOutlined,
  CopyOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  RocketOutlined,
  SaveOutlined,
  SearchOutlined,
  StopOutlined,
} from "@ant-design/icons";
import { api, type AgentChunk, type SessionView } from "../api";
import type { TextAreaRef } from "antd/es/input/TextArea";
import { useAppStore } from "../store/appStore";
import Markdown from "../components/Markdown";

interface ChatItem {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  thought?: string;
  tools?: string[];
}

interface CliInfoItem {
  kind: string;
  channel: string;
  command: string;
  installed: boolean;
  version: string | null;
}

function sessionGroup(ts: number): string {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ts >= startOfToday) return "今天";
  if (ts >= startOfToday - 86400000) return "昨天";
  if (ts >= startOfToday - 6 * 86400000) return "本周";
  return "更早";
}

const GROUP_ORDER = ["今天", "昨天", "本周", "更早"];

const QUICK_PROMPTS = [
  { icon: <CodeOutlined />, title: "解释代码", desc: "选中的代码或文件", prompt: "请解释当前项目里核心模块的代码逻辑，并给出调用关系说明" },
  { icon: <BugOutlined />, title: "排查问题", desc: "定位并修复报错", prompt: "帮我排查这个报错的原因，并给出修复方案：" },
  { icon: <RocketOutlined />, title: "实现功能", desc: "从需求到代码", prompt: "帮我实现一个功能：" },
  { icon: <CheckOutlined />, title: "代码审查", desc: "发现潜在问题", prompt: "请审查最近的代码改动，指出潜在的 bug、性能问题和可读性改进点" },
];

function MsgCopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="chat-copy-btn"
      title="复制内容"
      onClick={() => {
        void navigator.clipboard?.writeText(text).catch(() => undefined);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <CheckOutlined /> : <CopyOutlined />}
    </button>
  );
}

export default function AgentPage() {
  const [models, setModels] = useState<Array<{ model: string; providerType: string }>>([]);
  const [model, setModel] = useState<string>();
  const [mode, setMode] = useState<"gateway" | "cli">(useAppStore.getState().offline ? "cli" : "gateway");
  const [clis, setClis] = useState<CliInfoItem[]>([]);
  const [cli, setCli] = useState<string>();
  const [workdir, setWorkdir] = useState("");
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [sessionFilter, setSessionFilter] = useState("");
  const [activeSessionId, setActiveSessionId] = useState<string>();
  const [openThoughts, setOpenThoughts] = useState<Record<number, boolean>>({});
  const [permission, setPermission] = useState<{
    taskId: string;
    requestId: string;
    toolName: string;
    description?: string;
  } | null>(null);
  const requestIdRef = useRef(0);
  const taskIdRef = useRef("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<TextAreaRef>(null);
  const { agentDraft, clearAgentDraft, offline, user, setPage } = useAppStore();
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ output: string; repo: string } | null>(null);
  const [syncForm] = Form.useForm();

  useEffect(() => {
    if (agentDraft) {
      setInput(agentDraft);
      clearAgentDraft();
      message.success("已把消息填入输入框，可直接发送给 AI");
    }
  }, [agentDraft, clearAgentDraft]);

  function refreshSessions() {
    if (offline) return;
    api.listSessions().then(setSessions).catch(() => undefined);
  }

  useEffect(() => {
    if (!offline) {
      api
        .listModels()
        .then((list) => {
          setModels(list);
          if (list.length > 0) setModel(list[0].model);
        })
        .catch((err) => message.error(`获取模型列表失败：${err.message}`));
      refreshSessions();
    }
    if (api.isElectron) {
      api.detectClis().then((list) => {
        const installed = list.filter((c) => c.installed && (c.kind === "kimi" || c.kind === "claude"));
        setClis(installed);
        if (installed.length > 0) setCli(installed[0].kind);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const off = api.onChatChunk((chunk) => {
      setItems((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (!last || last.role !== "assistant") return prev;
        if (chunk.delta) next[next.length - 1] = { ...last, content: last.content + chunk.delta };
        if (chunk.done) next[next.length - 1] = { ...next[next.length - 1], streaming: false };
        if (chunk.error) {
          next[next.length - 1] = {
            ...next[next.length - 1],
            content: `${next[next.length - 1].content}\n\n[错误] ${chunk.error}`,
            streaming: false,
          };
        }
        return next;
      });
      if (chunk.done || chunk.error) setSending(false);
    });
    return off;
  }, []);

  useEffect(() => {
    const off = api.onAgentChunk((chunk: AgentChunk) => {
      if (chunk.taskId !== taskIdRef.current) return;
      if (chunk.kind === "permission" && chunk.permission) {
        setPermission({
          taskId: chunk.taskId,
          requestId: chunk.permission.requestId,
          toolName: chunk.permission.toolName,
          description: chunk.permission.description,
        });
        return;
      }
      setItems((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (!last || last.role !== "assistant") return prev;
        if (chunk.kind === "message" && chunk.text) {
          next[next.length - 1] = { ...last, content: last.content + chunk.text };
        } else if (chunk.kind === "thought" && chunk.text) {
          next[next.length - 1] = { ...last, thought: (last.thought ?? "") + chunk.text };
        } else if (chunk.kind === "tool") {
          next[next.length - 1] = { ...last, tools: [...(last.tools ?? []), chunk.text || "工具调用"] };
        } else if (chunk.kind === "error" && chunk.text) {
          next[next.length - 1] = {
            ...last,
            content: `${last.content}\n\n[错误] ${chunk.text}`,
            streaming: false,
          };
        } else if (chunk.kind === "done") {
          next[next.length - 1] = { ...last, streaming: false };
        }
        return next;
      });
      if (chunk.kind === "done" || chunk.kind === "error") setSending(false);
    });
    return off;
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [items]);

  const groupedSessions = useMemo(() => {
    const kw = sessionFilter.trim().toLowerCase();
    const filtered = kw ? sessions.filter((s) => s.title.toLowerCase().includes(kw)) : sessions;
    const groups = new Map<string, SessionView[]>();
    for (const s of filtered) {
      const g = sessionGroup(s.createdAt);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(s);
    }
    return GROUP_ORDER.filter((g) => groups.has(g)).map((g) => ({ group: g, list: groups.get(g)! }));
  }, [sessions, sessionFilter]);

  function newChat() {
    if (sending) {
      message.warning("当前任务进行中，请先停止");
      return;
    }
    setItems([]);
    setActiveSessionId(undefined);
    setOpenThoughts({});
    taskIdRef.current = "";
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  async function send(override?: string) {
    const text = (override ?? input).trim();
    if (!text || sending) return;
    if (mode === "cli") {
      if (!cli || !workdir) {
        message.warning("请选择 CLI 与工作目录");
        return;
      }
      setInput("");
      setSending(true);
      const taskId = `task-${Date.now()}`;
      taskIdRef.current = taskId;
      setItems((prev) => [
        ...prev,
        { role: "user", content: text },
        { role: "assistant", content: "", streaming: true, thought: "", tools: [] },
      ]);
      try {
        await api.agentRun({ taskId, cli, cwd: workdir, prompt: text });
      } catch (err) {
        setSending(false);
        setItems((prev) => {
          const next = [...prev];
          next[next.length - 1] = {
            ...next[next.length - 1],
            content: `[错误] ${err instanceof Error ? err.message : "启动失败"}`,
            streaming: false,
          };
          return next;
        });
      }
      return;
    }
    if (!model) return;
    if (offline) {
      message.warning("网关模式需要连接服务端");
      return;
    }
    setInput("");
    setSending(true);
    const history: ChatItem[] = [
      ...items.map(({ role, content }) => ({ role, content })),
      { role: "user" as const, content: text },
    ];
    setItems([...history, { role: "assistant", content: "", streaming: true }]);
    requestIdRef.current += 1;
    await api.chatSend(`req-${requestIdRef.current}`, model, history);
  }

  async function stopCli() {
    if (taskIdRef.current) await api.agentStop(taskIdRef.current);
    setSending(false);
    setItems((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.streaming) next[next.length - 1] = { ...last, streaming: false };
      return next;
    });
  }

  async function saveSession() {
    if (items.length === 0) return;
    try {
      await api.saveSession({
        title: items[0]?.content.slice(0, 40) || "未命名会话",
        cli: mode === "cli" ? (cli ?? "") : "teamai-client",
        taskId: taskIdRef.current,
        messages: items.map(({ role, content }) => ({ role, content })),
      });
      message.success("会话已存档到服务端");
      refreshSessions();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存失败");
    }
  }

  async function restoreSession(id: string) {
    if (sending) {
      message.warning("当前任务进行中，请先停止");
      return;
    }
    try {
      const s = await api.getSession(id);
      setItems(
        s.messages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      );
      setActiveSessionId(id);
      setOpenThoughts({});
      message.success(`已恢复会话「${s.title}」`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "恢复失败");
    }
  }

  async function onSyncWorkspace(values: { group: string; name: string; message: string }) {
    if (!workdir.trim()) {
      message.warning("请先选择工作目录");
      return;
    }
    setSyncing(true);
    setSyncResult(null);
    try {
      const r = await api.pushWorkspace({
        cwd: workdir.trim(),
        group: values.group.trim() || "default",
        name: values.name.trim(),
        message: values.message.trim() || "sync from TeamAI client",
        authorName: user?.name ?? "teamai",
        authorEmail: user?.email ?? "teamai@local",
      });
      setSyncResult({ output: r.output, repo: r.repo });
      message.success(`已推送到服务端仓库 ${r.repo}`);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "推送失败");
    } finally {
      setSyncing(false);
    }
  }

  function openSyncModal() {
    if (!workdir.trim()) {
      message.warning("请先选择工作目录");
      return;
    }
    const dirName = workdir.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "project";
    syncForm.setFieldsValue({
      group: "default",
      name: dirName.replace(/[^\w.-]/g, "-").toLowerCase(),
      message: `sync: ${new Date().toLocaleString("zh-CN")}`,
    });
    setSyncResult(null);
    setSyncOpen(true);
  }

  function applyQuickPrompt(prompt: string) {
    setInput(prompt);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  const cliReady = mode === "gateway" || (cli && workdir);
  const workdirName = workdir ? (workdir.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? workdir) : "";

  return (
    <div className="agent-layout">
      <div className="agent-sessions">
        <div className="agent-sessions-top">
          <button className="agent-new-btn" onClick={newChat}>
            <PlusOutlined /> 新增对话
          </button>
          {!offline && (
            <Input
              size="small"
              allowClear
              prefix={<SearchOutlined style={{ color: "#6d6d73" }} />}
              placeholder="搜索会话…"
              value={sessionFilter}
              onChange={(e) => setSessionFilter(e.target.value)}
            />
          )}
        </div>
        <div className="agent-sessions-list">
          {offline ? (
            <div className="agent-session-group">离线模式 · 会话不存档</div>
          ) : groupedSessions.length === 0 ? (
            <div className="agent-session-group">暂无存档会话</div>
          ) : (
            groupedSessions.map(({ group, list }) => (
              <div key={group}>
                <div className="agent-session-group">{group}</div>
                {list.map((s) => (
                  <div
                    key={s.id}
                    className={`agent-session-item${activeSessionId === s.id ? " agent-session-item-active" : ""}`}
                    onClick={() => void restoreSession(s.id)}
                  >
                    <div className="agent-session-title">{s.title}</div>
                    <div className="agent-session-meta">
                      {s.cli || "teamai-client"} · {new Date(s.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="agent-main">
        <div className="agent-topbar">
          <span className="agent-topbar-title">AI 工作台</span>
          {sending && (
            <span className="agent-topbar-status">
              <span className="agent-status-dot agent-status-dot-busy" />
              正在生成…
            </span>
          )}
          <span style={{ flex: 1 }} />
          {mode === "cli" && !offline && (
            <Button
              size="small"
              icon={<CloudUploadOutlined />}
              disabled={!workdir.trim() || sending}
              onClick={openSyncModal}
            >
              同步到服务端
            </Button>
          )}
          {!offline && (
            <Button
              size="small"
              icon={<SaveOutlined />}
              onClick={saveSession}
              disabled={items.length === 0 || sending}
            >
              存档
            </Button>
          )}
        </div>

        <div className="chat-flow">
          {items.length === 0 ? (
            <div className="agent-welcome">
              <div className="agent-welcome-logo">T</div>
              <div className="agent-welcome-title">你好，{user?.name ?? "开发者"}</div>
              <div className="agent-welcome-sub">
                {mode === "gateway"
                  ? "选择下方模型开始对话，请求经服务端网关转发并计入团队用量"
                  : "本地 CLI 模式：任务在你本机的工作目录中执行，改动可一键同步到服务端"}
              </div>
              <div className="agent-quick-grid">
                {QUICK_PROMPTS.map((q) => (
                  <div key={q.title} className="agent-quick-card" onClick={() => applyQuickPrompt(q.prompt)}>
                    <div className="agent-quick-icon">{q.icon}</div>
                    <div>
                      <div className="agent-quick-title">{q.title}</div>
                      <div className="agent-quick-desc">{q.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            items.map((it, i) => (
              <div key={i} className={`chat-row${it.role === "user" ? " chat-row-user" : ""}`}>
                {it.role === "user" ? (
                  <div className="chat-bubble chat-bubble-user">{it.content}</div>
                ) : (
                  <div className="chat-ai">
                    <div className="chat-ai-head">
                      <span className="chat-ai-badge">T</span>
                      <span className="chat-ai-name">TeamAI</span>
                      {it.streaming && <span className="agent-status-dot agent-status-dot-busy" />}
                      {!it.streaming && it.content && <MsgCopyBtn text={it.content} />}
                    </div>
                    {it.thought && (
                      <div className="thought-block">
                        <div
                          className="thought-head"
                          onClick={() => setOpenThoughts((p) => ({ ...p, [i]: !p[i] }))}
                        >
                          <CloudOutlined />
                          思考过程 · {it.thought.length} 字符
                          <span style={{ marginLeft: "auto" }}>{openThoughts[i] ? "收起" : "展开"}</span>
                        </div>
                        {openThoughts[i] && <div className="thought-body">{it.thought}</div>}
                      </div>
                    )}
                    {it.tools && it.tools.length > 0 && (
                      <div style={{ marginBottom: 6 }}>
                        {it.tools.map((t, ti) => (
                          <div key={ti} className="tool-card">
                            <span className={`tool-card-icon ${it.streaming ? "tool-card-run" : "tool-card-ok"}`}>
                              {it.streaming ? "…" : <CheckOutlined />}
                            </span>
                            <span className="tool-card-name">{t}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="chat-ai-content">
                      <Markdown text={it.content} />
                      {it.streaming && <span className="chat-cursor">▍</span>}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        <div className="agent-inputbar">
          <div className="agent-inputbox">
            <Input.TextArea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPressEnter={(e) => {
                if (!e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={mode === "gateway" ? "向 AI 提问，Enter 发送 / Shift+Enter 换行" : "描述要完成的任务，AI 将在工作目录中执行"}
              autoSize={{ minRows: 2, maxRows: 8 }}
            />
            <div className="agent-inputrow">
              {api.isElectron && (
                <div className="agent-mode-seg">
                  <button
                    className={`agent-mode-seg-btn${mode === "gateway" ? " agent-mode-seg-on" : ""}`}
                    disabled={offline}
                    onClick={() => setMode("gateway")}
                  >
                    网关
                  </button>
                  <button
                    className={`agent-mode-seg-btn${mode === "cli" ? " agent-mode-seg-on" : ""}`}
                    onClick={() => setMode("cli")}
                  >
                    本地 CLI
                  </button>
                </div>
              )}
              {mode === "gateway" ? (
                <Select
                  size="small"
                  variant="borderless"
                  className="agent-pill-select"
                  style={{ minWidth: 170 }}
                  placeholder="选择模型"
                  value={model}
                  onChange={setModel}
                  options={models.map((m) => ({
                    value: m.model,
                    label: `${m.model}（${m.providerType}）`,
                  }))}
                  notFoundContent="服务端尚未配置 provider"
                />
              ) : (
                <>
                  <Select
                    size="small"
                    variant="borderless"
                    className="agent-pill-select"
                    style={{ minWidth: 110 }}
                    placeholder="选择 CLI"
                    value={cli}
                    onChange={setCli}
                    options={clis.map((c) => ({
                      value: c.kind,
                      label: `${c.kind}（${c.channel}）`,
                    }))}
                    notFoundContent="未检测到已安装的 CLI"
                  />
                  <button
                    className="agent-workdir-chip"
                    title={workdir || "选择工作目录"}
                    onClick={() => void api.pickDir().then((d) => d && setWorkdir(d))}
                  >
                    <FolderOpenOutlined />
                    <span className="agent-workdir-name">{workdirName || "选择目录"}</span>
                  </button>
                </>
              )}
              <span style={{ flex: 1 }} />
              {mode === "cli" && sending ? (
                <button
                  className="agent-send-btn agent-stop-btn"
                  onClick={() => void stopCli()}
                  title="停止"
                >
                  <StopOutlined />
                </button>
              ) : (
                <button
                  className="agent-send-btn"
                  onClick={() => void send()}
                  disabled={!cliReady || sending || !input.trim()}
                  title="发送"
                >
                  <ArrowUpOutlined />
                </button>
              )}
            </div>
          </div>
          <div className="agent-input-hint">
            {mode === "gateway"
              ? `网关模式 · ${model ?? "未选模型"} · 用量计入团队统计`
              : `本地 CLI · ${cli ?? "未选 CLI"}${workdir ? ` · ${workdir}` : " · 未选工作目录"}`}
          </div>
        </div>
      </div>

      <Modal
        title="同步工作区到服务端"
        open={syncOpen}
        onCancel={() => setSyncOpen(false)}
        onOk={() => syncForm.submit()}
        okText={syncing ? "推送中…" : "推送"}
        okButtonProps={{ loading: syncing }}
        width={520}
      >
        <Form form={syncForm} layout="vertical" onFinish={onSyncWorkspace}>
          <Form.Item label="工作目录">
            <Input value={workdir} disabled />
          </Form.Item>
          <Form.Item name="group" label="仓库分组" rules={[{ required: true, message: "请输入分组" }]}>
            <Input placeholder="default" />
          </Form.Item>
          <Form.Item
            name="name"
            label="仓库名（不存在则自动创建）"
            rules={[
              { required: true, message: "请输入仓库名" },
              { pattern: /^[a-zA-Z0-9._-]{1,64}$/, message: "仅限字母、数字、点、横线、下划线" },
            ]}
          >
            <Input placeholder="my-project" />
          </Form.Item>
          <Form.Item name="message" label="提交信息" rules={[{ required: true, message: "请输入提交信息" }]}>
            <Input placeholder="本次改动的简要说明" />
          </Form.Item>
        </Form>
        {syncResult && (
          <>
            <pre className="sync-result">{syncResult.output}</pre>
            <Button type="link" onClick={() => { setSyncOpen(false); setPage("envs"); }}>
              前往「在线环境」部署运行 →
            </Button>
          </>
        )}
      </Modal>

      <Modal
        title="CLI 请求工具权限"
        open={permission !== null}
        okText="允许"
        cancelText="拒绝"
        onOk={() => {
          if (permission) api.agentPermission(permission.taskId, permission.requestId, true);
          setPermission(null);
        }}
        onCancel={() => {
          if (permission) api.agentPermission(permission.taskId, permission.requestId, false);
          setPermission(null);
        }}
      >
        <p>
          Claude 想要使用工具 <Tag color="orange">{permission?.toolName}</Tag>
        </p>
        {permission?.description && (
          <p style={{ fontSize: 12, color: "#9a9aa0" }}>{permission.description}</p>
        )}
        <p style={{ fontSize: 12, color: "#6d6d73" }}>拒绝后本轮任务中该工具调用将被阻止。</p>
      </Modal>
    </div>
  );
}
