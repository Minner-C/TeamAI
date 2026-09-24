import { Layout, Tooltip } from "antd";
import {
  RobotOutlined,
  MessageOutlined,
  FolderOutlined,
  CloudServerOutlined,
  FileZipOutlined,
  BarChartOutlined,
  SettingOutlined,
  CodeOutlined,
} from "@ant-design/icons";
import { useAppStore, type PageKey } from "./store/appStore";
import LoginPage from "./pages/LoginPage";
import AgentPage from "./pages/AgentPage";
import IdePage from "./pages/IdePage";
import ImPage from "./pages/ImPage";
import ReposPage from "./pages/ReposPage";
import EnvsPage from "./pages/EnvsPage";
import FilesPage from "./pages/FilesPage";
import UsagePage from "./pages/UsagePage";
import SettingsPage from "./pages/SettingsPage";

const { Content } = Layout;

const PAGES: Record<PageKey, React.ReactNode> = {
  agent: <AgentPage />,
  ide: <IdePage />,
  im: <ImPage />,
  repos: <ReposPage />,
  envs: <EnvsPage />,
  files: <FilesPage />,
  usage: <UsagePage />,
  settings: <SettingsPage />,
};

interface RailItem {
  key: PageKey;
  icon: React.ReactNode;
  label: string;
}

export default function App() {
  const { page, setPage, token, offline, user } = useAppStore();

  if (!token && !offline) return <LoginPage />;

  const items: RailItem[] = offline
    ? [
        { key: "agent", icon: <RobotOutlined />, label: "Agent 工作台（本地）" },
        { key: "ide", icon: <CodeOutlined />, label: "代码编辑器" },
        { key: "settings", icon: <SettingOutlined />, label: "设置" },
      ]
    : [
        { key: "agent", icon: <RobotOutlined />, label: "Agent 工作台" },
        { key: "ide", icon: <CodeOutlined />, label: "代码编辑器" },
        { key: "im", icon: <MessageOutlined />, label: "团队消息" },
        { key: "repos", icon: <FolderOutlined />, label: "项目仓库" },
        { key: "envs", icon: <CloudServerOutlined />, label: "在线环境" },
        { key: "files", icon: <FileZipOutlined />, label: "文件管理" },
        { key: "usage", icon: <BarChartOutlined />, label: "用量统计" },
        { key: "settings", icon: <SettingOutlined />, label: "设置" },
      ];

  const activePage: PageKey = offline && page !== "agent" && page !== "settings" && page !== "ide" ? "agent" : page;
  const navItems = items.filter((i) => i.key !== "settings");
  const settingsItem = items.find((i) => i.key === "settings");
  const fullHeight = activePage === "agent" || activePage === "im" || activePage === "ide";

  return (
    <Layout className="app-shell" style={{ flexDirection: "row" }}>
      <div className="app-rail">
        <Tooltip title={offline ? "TeamAI（离线模式）" : "TeamAI"} placement="right">
          <div className="app-rail-logo">T</div>
        </Tooltip>
        {navItems.map((item) => (
          <Tooltip key={item.key} title={item.label} placement="right">
            <div
              className={`app-rail-item${activePage === item.key ? " app-rail-item-active" : ""}`}
              onClick={() => setPage(item.key)}
            >
              {item.icon}
            </div>
          </Tooltip>
        ))}
        <div className="app-rail-spacer" />
        {settingsItem && (
          <Tooltip title={settingsItem.label} placement="right">
            <div
              className={`app-rail-item${activePage === "settings" ? " app-rail-item-active" : ""}`}
              onClick={() => setPage("settings")}
            >
              {settingsItem.icon}
            </div>
          </Tooltip>
        )}
        {user && (
          <Tooltip title={user.name || user.email} placement="right">
            <div className="app-rail-avatar" style={{ marginTop: 6 }}>
              {(user.name || user.email).slice(0, 1).toUpperCase()}
            </div>
          </Tooltip>
        )}
      </div>
      <Content className="app-content">
        {fullHeight ? PAGES[activePage] : <div className="page-scroll">{PAGES[activePage]}</div>}
      </Content>
    </Layout>
  );
}
