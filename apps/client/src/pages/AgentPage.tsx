import { Typography, Empty } from "antd";

export default function AgentPage() {
  return (
    <div className="page-card">
      <Typography.Title level={3}>Agent 工作台</Typography.Title>
      <Typography.Paragraph type="secondary">
        聊天式 Agent 界面：流式输出、工具调用卡片、任务中切换 CLI（Kimi / Claude / Codex /
        Gemini / Qwen），模型统一走服务端网关。
      </Typography.Paragraph>
      <Empty description="CLI 适配层接入中（ACP / headless stream-json）" />
    </div>
  );
}
