import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { api } from "../api";

export default function EnvTerminal({ envId }: { envId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [exited, setExited] = useState<number | null>(null);

  useEffect(() => {
    const term = new Terminal({
      fontSize: 13,
      fontFamily: "'Cascadia Code', Consolas, 'JetBrains Mono', monospace",
      cursorBlink: true,
      scrollback: 2000,
      theme: {
        background: "#141416",
        foreground: "#e8e8ea",
        cursor: "#6366f1",
        selectionBackground: "#6366f155",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current!);
    fit.fit();

    const conn = api.connectEnvTerminal(envId, {
      onReady: (info) => {
        if (info.message) term.writeln(`\u001b[33m${info.message}\u001b[0m`);
        conn.resize(term.cols, term.rows);
        term.focus();
      },
      onOutput: (data) => term.write(data),
      onExit: (code) => {
        setExited(code);
        term.writeln(`\r\n\u001b[90m[会话已退出，退出码 ${code}]\u001b[0m`);
      },
      onError: (msg) => term.writeln(`\r\n\u001b[31m[错误] ${msg}\u001b[0m`),
    });

    const dataSub = term.onData((d) => conn.send(d));
    const observer = new ResizeObserver(() => {
      fit.fit();
      conn.resize(term.cols, term.rows);
    });
    observer.observe(containerRef.current!);

    return () => {
      observer.disconnect();
      dataSub.dispose();
      conn.close();
      term.dispose();
    };
  }, [envId]);

  return (
    <div style={{ position: "relative" }}>
      <div
        ref={containerRef}
        style={{ height: 440, background: "#141416", borderRadius: 8, padding: "6px 4px 4px 8px" }}
      />
      {exited !== null && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            paddingBottom: 16,
            pointerEvents: "none",
          }}
        >
          <span style={{ background: "#242426", color: "#9a9aa0", fontSize: 12, padding: "4px 12px", borderRadius: 12 }}>
            会话已结束，关闭弹窗后可重新打开
          </span>
        </div>
      )}
    </div>
  );
}
