import { useEffect, useRef, useState } from "react";
import {
  Button,
  Drawer,
  Input,
  List,
  Modal,
  Radio,
  Select,
  Space,
  Tag,
  Typography,
  message,
} from "antd";
import { FolderOpenOutlined, StopOutlined } from "@ant-design/icons";
import { api, type AgentChunk, type SessionView } from "../api";
import { useAppStore } from "../store/appStore";

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

export default function AgentPage() {
  const [models, setModels] = useState<Array<{ model: string; providerType: string }>>([]);
  const [model, setModel] = useState<string>();
  const [mode, setMode] = useState<"gateway" | "cli">("gateway");
  const [clis, setClis] = useState<CliInfoItem[]>([]);
  const [cli, setCli] = useState<string>();
  const [workdir, setWorkdir] = useState("");
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [permission, setPermission] = useState<{
    taskId: string;
    requestId: string;
    toolName: string;
    description?: string;
  } | null>(null);
  const requestIdRef = useRef(0);
  const taskIdRef = useRef("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const { agentDraft, clearAgentDraft } = useAppStore();

  useEffect(() => {
    if (agentDraft) {
      setInput(agentDraft);
      clearAgentDraft();
      message.success("已把消息填入输入框，可直接发送给 AI");
    }
  }, [agentDraft, clearAgentDraft]);

  useEffect(() => {
    api
      .listModels()
      .then((list) => {
        setModels(list);
        if (list.length > 0) setModel(list[0].model);
      })
      .catch((err) => message.error(`获取模型列表失败：${err.message}`));
    if (api.isElectron) {
      api.detectClis().then((list) => {
        const installed = list.filter((c) => c.installed && (c.kind === "kimi" || c.kind === "claude"));
        setClis(installed);
        if (installed.length > 0) setCli(installed[0].kind);
      });
    }
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
          next[next.length - 1] = { ...last, tools: [...(last.tools ?? []), "工具调用"] };
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

  async function send() {
    const text = input.trim();
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
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存失败");
    }
  }

  async function openSessions() {
    try {
      setSessions(await api.listSessions());
      setSessionsOpen(true);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载失败");
    }
  }

  async function restoreSession(id: string) {
    try {
      const s = await api.getSession(id);
      setItems(
        s.messages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      );
      setSessionsOpen(false);
      message.success(`已恢复会话「${s.title}」`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "恢复失败");
    }
  }

  const cliReady = mode === "gateway" || (cli && workdir);

  return (
    <div className="page-card chat-page">
      <Space style={{ marginBottom: 12 }} wrap>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Agent 工作台
        </Typography.Title>
        {api.isElectron && (
          <Radio.Group
            value={mode}
            onChange={(e) => setMode(e.target.value as "gateway" | "cli")}
            optionType="button"
            buttonStyle="solid"
            size="small"
            options={[
              { value: "gateway", label: "网关模型" },
              { value: "cli", label: "本地 CLI" },
            ]}
          />
        )}
        {mode === "gateway" ? (
          <Select
            style={{ minWidth: 260 }}
            placeholder="选择模型（来自服务端网关）"
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
              style={{ minWidth: 180 }}
              placeholder="选择 CLI"
              value={cli}
              onChange={setCli}
              options={clis.map((c) => ({
                value: c.kind,
                label: `${c.kind}（${c.channel}）`,
              }))}
              notFoundContent="未检测到已安装的 CLI"
            />
            <Input
              style={{ width: 260 }}
              placeholder="工作目录"
              value={workdir}
              onChange={(e) => setWorkdir(e.target.value)}
              suffix={
                <FolderOpenOutlined
                  style={{ cursor: "pointer" }}
                  onClick={() => void api.pickDir().then((d) => d && setWorkdir(d))}
                />
              }
            />
          </>
        )}
        {sending && <Tag color="processing">生成中…</Tag>}
        {mode === "cli" && sending && (
          <Button size="small" danger icon={<StopOutlined />} onClick={() => void stopCli()}>
            停止
          </Button>
        )}
        <Button size="small" onClick={saveSession} disabled={items.length === 0 || sending}>
          保存会话
        </Button>
        <Button size="small" onClick={() => void openSessions()}>
          会话存档
        </Button>
      </Space>

      <div className="chat-history">
        {items.length === 0 && (
          <Typography.Paragraph type="secondary">
            {mode === "gateway"
              ? "选择模型后开始对话。请求经服务端网关转发并计入用量。"
              : "本地 CLI 模式：选择已安装的 CLI 与工作目录，任务在本机执行（Kimi 走 ACP 长连接，Claude 走 stream-json 双向协议）。"}
          </Typography.Paragraph>
        )}
        {items.map((it, i) => (
          <div key={i} className={`chat-item chat-${it.role}`}>
            <div className="chat-role">{it.role === "user" ? "我" : "AI"}</div>
            <div className="chat-bubble">
              {it.thought && (
                <div style={{ fontSize: 12, opacity: 0.55, fontStyle: "italic", marginBottom: 6 }}>
                  {it.thought}
                </div>
              )}
              {it.tools?.map((t, ti) => (
                <Tag key={ti} style={{ marginBottom: 4 }}>
                  {t}
                </Tag>
              ))}
              {it.content}
              {it.streaming && <span className="chat-cursor">▍</span>}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <Space.Compact style={{ width: "100%", marginTop: 12 }}>
        <Input.TextArea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPressEnter={(e) => {
            if (!e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="输入消息，Enter 发送 / Shift+Enter 换行"
          autoSize={{ minRows: 1, maxRows: 6 }}
        />
        <Button type="primary" onClick={send} disabled={!cliReady || sending}>
          发送
        </Button>
      </Space.Compact>

      <Drawer
        title="会话存档"
        open={sessionsOpen}
        onClose={() => setSessionsOpen(false)}
        width={420}
      >
        <List
          size="small"
          dataSource={sessions}
          locale={{ emptyText: "还没有存档，点上方「保存会话」试试" }}
          renderItem={(s) => (
            <List.Item
              actions={[
                <Button key="restore" size="small" type="link" onClick={() => void restoreSession(s.id)}>
                  恢复
                </Button>,
              ]}
            >
              <List.Item.Meta
                title={s.title}
                description={`${s.cli || "teamai-client"} · ${new Date(s.createdAt).toLocaleString("zh-CN")}`}
              />
            </List.Item>
          )}
        />
      </Drawer>

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
          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
            {permission.description}
          </Typography.Paragraph>
        )}
        <p style={{ fontSize: 12, color: "#8c8c8c" }}>拒绝后本轮任务中该工具调用将被阻止。</p>
      </Modal>
    </div>
  );
}
