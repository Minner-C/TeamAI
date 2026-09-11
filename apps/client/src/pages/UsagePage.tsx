import { Typography, Empty } from "antd";

export default function UsagePage() {
  return (
    <div className="page-card">
      <Typography.Title level={3}>用量统计</Typography.Title>
      <Typography.Paragraph type="secondary">
        按人 / 模型 / 项目聚合 token 用量与成本，数据来自服务端网关计量。
      </Typography.Paragraph>
      <Empty description="用量报表开发中" />
    </div>
  );
}
