import { useEffect, useState } from "react";
import { Statistic, Table, Typography, message, Row, Col, Card } from "antd";
import { api } from "../api";

interface Summary {
  totalTokensIn: number;
  totalTokensOut: number;
  totalCost: number;
  byModel: Record<string, { tokensIn: number; tokensOut: number }>;
  byUser: Record<string, { tokensIn: number; tokensOut: number }>;
}

export default function UsagePage() {
  const [data, setData] = useState<Summary | null>(null);

  useEffect(() => {
    api
      .usageSummary()
      .then(setData)
      .catch((err) => message.error(`获取用量失败：${err.message}`));
  }, []);

  const modelRows = Object.entries(data?.byModel ?? {}).map(([model, v]) => ({
    key: model,
    model,
    tokensIn: v.tokensIn,
    tokensOut: v.tokensOut,
    total: v.tokensIn + v.tokensOut,
  }));

  return (
    <div className="page-card">
      <Typography.Title level={3}>用量统计</Typography.Title>
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={8}>
          <Card>
            <Statistic title="输入 Tokens" value={data?.totalTokensIn ?? 0} />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic title="输出 Tokens" value={data?.totalTokensOut ?? 0} />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic title="估算成本（¥）" value={data?.totalCost ?? 0} precision={4} />
          </Card>
        </Col>
      </Row>
      <Typography.Title level={5}>按模型</Typography.Title>
      <Table
        size="small"
        pagination={false}
        dataSource={modelRows}
        columns={[
          { title: "模型", dataIndex: "model" },
          { title: "输入 Tokens", dataIndex: "tokensIn" },
          { title: "输出 Tokens", dataIndex: "tokensOut" },
          { title: "合计", dataIndex: "total" },
        ]}
      />
    </div>
  );
}
