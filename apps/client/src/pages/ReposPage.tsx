import { Typography, Empty } from "antd";

export default function ReposPage() {
  return (
    <div className="page-card">
      <Typography.Title level={3}>项目仓库</Typography.Title>
      <Typography.Paragraph type="secondary">
        服务端内置 Git 托管：仓库列表、clone 到本地、分支与提交历史、任务与分支绑定。
      </Typography.Paragraph>
      <Empty description="Git 托管对接中" />
    </div>
  );
}
