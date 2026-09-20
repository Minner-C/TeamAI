import React from "react";
import ReactDOM from "react-dom/client";
import { ConfigProvider, theme } from "antd";
import zhCN from "antd/locale/zh_CN";
import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: "#6366f1",
          colorInfo: "#6366f1",
          colorBgBase: "#171719",
          colorBgContainer: "#222224",
          colorBgElevated: "#2a2a2d",
          colorBorder: "#38383c",
          colorBorderSecondary: "#2e2e32",
          borderRadius: 8,
          fontSize: 13,
        },
        components: {
          Layout: { siderBg: "#141416", bodyBg: "#1b1b1d" },
          Menu: { darkItemBg: "transparent", itemBg: "transparent" },
        },
      }}
    >
      <App />
    </ConfigProvider>
  </React.StrictMode>,
);
