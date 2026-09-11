import { useEffect, useRef, useState } from "react";
import { Button, Input, Select, Space, Tag, Typography, message } from "antd";
import { api } from "../api";
import { useAppStore } from "../store/appStore";

interface ChatItem {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

export default function AgentPage() {
  const [models, setModels] = useState<Array<{ model: string; providerType: string }>>([]);
  const [model, setModel] = useState<string>();
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const requestIdRef = useRef(0);
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
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [items]);

  async function send() {
    const text = input.trim();
    if (!text || !model || sending) return;
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

  async function saveSession() {
    if (items.length === 0) return;
    try {
      await api.saveSession({
        title: items[0]?.content.slice(0, 40) || "未命名会话",
        cli: "teamai-client",
        messages: items.map(({ role, content }) => ({ role, content })),
      });
      message.success("会话已存档到服务端");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存失败");
    }
  }

  return (
    <div className="page-card chat-page">
      <Space style={{ marginBottom: 12 }} wrap>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Agent 工作台
        </Typography.Title>
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
        {sending && <Tag color="processing">生成中…</Tag>}
        <Button size="small" onClick={saveSession} disabled={items.length === 0 || sending}>
          保存会话
        </Button>
      </Space>

      <div className="chat-history">
        {items.length === 0 && (
          <Typography.Paragraph type="secondary">
            选择模型后开始对话。请求经服务端网关转发并计入用量。
          </Typography.Paragraph>
        )}
        {items.map((it, i) => (
          <div key={i} className={`chat-item chat-${it.role}`}>
            <div className="chat-role">{it.role === "user" ? "我" : "AI"}</div>
            <div className="chat-bubble">
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
        <Button type="primary" onClick={send} disabled={!model || sending}>
          发送
        </Button>
      </Space.Compact>
    </div>
  );
}
