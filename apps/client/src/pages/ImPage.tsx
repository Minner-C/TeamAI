import { Typography, Empty } from "antd";

export default function ImPage() {
  return (
    <div className="page-card">
      <Typography.Title level={3}>团队消息</Typography.Title>
      <Typography.Paragraph type="secondary">
        单聊 / 群组，消息一键喂给 AI，群组内可添加 AI 角色参与讨论。
      </Typography.Paragraph>
      <Empty description="IM 模块开发中" />
    </div>
  );
}
