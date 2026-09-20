import { Layout, Menu } from "antd";
import {
  RobotOutlined,
  MessageOutlined,
  FolderOutlined,
  CloudServerOutlined,
  FileZipOutlined,
  BarChartOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { useAppStore, type PageKey } from "./store/appStore";
import LoginPage from "./pages/LoginPage";
import AgentPage from "./pages/AgentPage";
import ImPage from "./pages/ImPage";
import ReposPage from "./pages/ReposPage";
import EnvsPage from "./pages/EnvsPage";
import FilesPage from "./pages/FilesPage";
import UsagePage from "./pages/UsagePage";
import SettingsPage from "./pages/SettingsPage";

const { Sider, Content } = Layout;

const PAGES: Record<PageKey, React.ReactNode> = {
  agent: <AgentPage />,
  im: <ImPage />,
  repos: <ReposPage />,
  envs: <EnvsPage />,
  files: <FilesPage />,
  usage: <UsagePage />,
  settings: <SettingsPage />,
};

export default function App() {
  const { page, setPage, token, offline } = useAppStore();

  if (!token && !offline) return <LoginPage />;

  const items = offline
    ? [
        { key: "agent", icon: <RobotOutlined />, label: "Agent 工作台（本地）" },
        { key: "settings", icon: <SettingOutlined />, label: "设置" },
      ]
    : [
        { key: "agent", icon: <RobotOutlined />, label: "Agent 工作台" },
        { key: "im", icon: <MessageOutlined />, label: "团队消息" },
        { key: "repos", icon: <FolderOutlined />, label: "项目仓库" },
        { key: "envs", icon: <CloudServerOutlined />, label: "在线环境" },
        { key: "files", icon: <FileZipOutlined />, label: "文件管理" },
        { key: "usage", icon: <BarChartOutlined />, label: "用量统计" },
        { key: "settings", icon: <SettingOutlined />, label: "设置" },
      ];

  const activePage: PageKey = offline && page !== "agent" && page !== "settings" ? "agent" : page;

  return (
    <Layout className="app-shell">
      <Sider width={200} theme="dark">
        <div className="app-logo">TeamAI{offline ? "（离线）" : ""}</div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[activePage]}
          onClick={(e) => setPage(e.key as PageKey)}
          items={items}
        />
      </Sider>
      <Content className="app-content">{PAGES[activePage]}</Content>
    </Layout>
  );
}
