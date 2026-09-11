import { useState } from "react";
import { Layout, Menu } from "antd";
import {
  RobotOutlined,
  MessageOutlined,
  FolderOutlined,
  BarChartOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { useAppStore } from "./store/appStore";
import LoginPage from "./pages/LoginPage";
import AgentPage from "./pages/AgentPage";
import ImPage from "./pages/ImPage";
import ReposPage from "./pages/ReposPage";
import UsagePage from "./pages/UsagePage";
import SettingsPage from "./pages/SettingsPage";

const { Sider, Content } = Layout;

type PageKey = "agent" | "im" | "repos" | "usage" | "settings";

const PAGES: Record<PageKey, React.ReactNode> = {
  agent: <AgentPage />,
  im: <ImPage />,
  repos: <ReposPage />,
  usage: <UsagePage />,
  settings: <SettingsPage />,
};

export default function App() {
  const [page, setPage] = useState<PageKey>("agent");
  const token = useAppStore((s) => s.token);

  if (!token) return <LoginPage />;

  return (
    <Layout className="app-shell">
      <Sider width={200} theme="dark">
        <div className="app-logo">TeamAI</div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[page]}
          onClick={(e) => setPage(e.key as PageKey)}
          items={[
            { key: "agent", icon: <RobotOutlined />, label: "Agent 工作台" },
            { key: "im", icon: <MessageOutlined />, label: "团队消息" },
            { key: "repos", icon: <FolderOutlined />, label: "项目仓库" },
            { key: "usage", icon: <BarChartOutlined />, label: "用量统计" },
            { key: "settings", icon: <SettingOutlined />, label: "设置" },
          ]}
        />
      </Sider>
      <Content className="app-content">{PAGES[page]}</Content>
    </Layout>
  );
}
