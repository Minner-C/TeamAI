import { useEffect, useRef, useState } from "react";
import { message, Modal, Tooltip } from "antd";
import {
  CloseOutlined,
  FileOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  ReloadOutlined,
  RobotOutlined,
  SaveOutlined,
} from "@ant-design/icons";
import { api, type IdeNode } from "../api";
import { useAppStore } from "../store/appStore";
import monaco from "../monacoSetup";

const LANG_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  htm: "html",
  vue: "html",
  md: "markdown",
  py: "python",
  go: "go",
  rs: "rust",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  cs: "csharp",
  rb: "ruby",
  php: "php",
  sh: "shell",
  bash: "shell",
  yml: "yaml",
  yaml: "yaml",
  sql: "sql",
  xml: "xml",
  toml: "ini",
  ini: "ini",
  swift: "swift",
  kt: "kotlin",
};

function langOf(rel: string): string {
  const ext = rel.split(".").pop()?.toLowerCase() ?? "";
  return LANG_MAP[ext] ?? "plaintext";
}

function baseName(p: string): string {
  return p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? p;
}

interface IdeTab {
  rel: string;
  dirty: boolean;
}

export default function IdePage() {
  const { feedToAgent } = useAppStore();
  const [root, setRoot] = useState(() => localStorage.getItem("teamai_ide_root") ?? "");
  const [dirs, setDirs] = useState<Record<string, IdeNode[]>>({});
  const [openDirs, setOpenDirs] = useState<Set<string>>(new Set());
  const [tabs, setTabs] = useState<IdeTab[]>([]);
  const [activeRel, setActiveRel] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelsRef = useRef<Map<string, monaco.editor.ITextModel>>(new Map());
  const stateRef = useRef({ root, tabs, activeRel });
  stateRef.current = { root, tabs, activeRel };

  const isElectron = typeof window !== "undefined" && !!window.teamai;

  const loadDir = async (r: string, rel: string) => {
    const nodes = await api.ideListDir(r, rel);
    setDirs((prev) => ({ ...prev, [rel]: nodes }));
  };

  const closeAllTabs = () => {
    for (const model of modelsRef.current.values()) model.dispose();
    modelsRef.current.clear();
    setTabs([]);
    setActiveRel(null);
    editorRef.current?.setModel(null);
  };

  const openRoot = async (dir: string) => {
    const r = dir.replace(/[\\/]+$/, "");
    closeAllTabs();
    setDirs({});
    setOpenDirs(new Set());
    setRoot(r);
    localStorage.setItem("teamai_ide_root", r);
    setLoading(true);
    try {
      await loadDir(r, "");
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const refresh = async () => {
    const r = stateRef.current.root;
    if (!r) return;
    setLoading(true);
    try {
      const expanded = [...openDirs];
      setDirs({});
      await loadDir(r, "");
      for (const rel of expanded) {
        try {
          await loadDir(r, rel);
        } catch {
          setOpenDirs((prev) => {
            const n = new Set(prev);
            n.delete(rel);
            return n;
          });
        }
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const activate = (rel: string) => {
    setActiveRel(rel);
    const model = modelsRef.current.get(rel);
    if (model) editorRef.current?.setModel(model);
  };

  const markDirty = (rel: string) => {
    setTabs((prev) => prev.map((t) => (t.rel === rel && !t.dirty ? { ...t, dirty: true } : t)));
  };

  const openFile = async (rel: string) => {
    const r = stateRef.current.root;
    if (!r) return;
    if (modelsRef.current.has(rel)) {
      activate(rel);
      return;
    }
    try {
      const f = await api.ideReadFile(r, rel);
      if (f.binary) {
        message.warning("二进制文件暂不支持在编辑器中打开");
        return;
      }
      const uri = monaco.Uri.file(`${r}/${rel}`);
      const model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(f.content, langOf(rel), uri);
      model.onDidChangeContent(() => markDirty(rel));
      modelsRef.current.set(rel, model);
      setTabs((prev) => (prev.some((t) => t.rel === rel) ? prev : [...prev, { rel, dirty: false }]));
      activate(rel);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  };

  const saveFile = async (rel: string) => {
    const r = stateRef.current.root;
    const model = modelsRef.current.get(rel);
    if (!r || !model) return;
    try {
      await api.ideWriteFile(r, rel, model.getValue());
      setTabs((prev) => prev.map((t) => (t.rel === rel ? { ...t, dirty: false } : t)));
      message.success(`已保存 ${rel}`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  };

  const saveActiveRef = useRef<() => Promise<void>>(async () => {});
  saveActiveRef.current = async () => {
    const rel = stateRef.current.activeRel;
    if (rel) await saveFile(rel);
  };

  const closeTab = (rel: string) => {
    const tab = stateRef.current.tabs.find((t) => t.rel === rel);
    const doClose = () => {
      modelsRef.current.get(rel)?.dispose();
      modelsRef.current.delete(rel);
      setTabs((prev) => prev.filter((t) => t.rel !== rel));
      if (stateRef.current.activeRel === rel) {
        const rest = stateRef.current.tabs.filter((t) => t.rel !== rel);
        if (rest.length) activate(rest[rest.length - 1].rel);
        else {
          setActiveRel(null);
          editorRef.current?.setModel(null);
        }
      }
    };
    if (tab?.dirty) {
      Modal.confirm({
        title: "文件未保存",
        content: `「${baseName(rel)}」有未保存的修改，关闭前要保存吗？`,
        okText: "保存并关闭",
        cancelText: "直接关闭",
        onOk: async () => {
          await saveFile(rel);
          doClose();
        },
        onCancel: doClose,
      });
    } else doClose();
  };

  const toggleDir = async (rel: string) => {
    if (openDirs.has(rel)) {
      setOpenDirs((prev) => {
        const n = new Set(prev);
        n.delete(rel);
        return n;
      });
      return;
    }
    if (!dirs[rel]) {
      try {
        await loadDir(stateRef.current.root, rel);
      } catch (err) {
        message.error(err instanceof Error ? err.message : String(err));
        return;
      }
    }
    setOpenDirs((prev) => new Set(prev).add(rel));
  };

  const sendToAgent = () => {
    const rel = stateRef.current.activeRel;
    const model = rel ? modelsRef.current.get(rel) : null;
    if (!rel || !model) return;
    const ext = rel.split(".").pop() ?? "";
    feedToAgent(
      `请帮我分析并优化以下代码（文件：${rel}）：\n\n\`\`\`${ext}\n${model.getValue()}\n\`\`\`\n\n`,
    );
    message.success("已发送到 Agent 工作台");
  };

  useEffect(() => {
    const editor = monaco.editor.create(hostRef.current!, {
      theme: "teamai-dark",
      fontSize: 13,
      automaticLayout: true,
      minimap: { enabled: true, scale: 1, size: "proportional" },
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      cursorBlinking: "smooth",
      renderLineHighlight: "all",
      padding: { top: 10, bottom: 10 },
      tabSize: 2,
    });
    editorRef.current = editor;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      void saveActiveRef.current();
    });
    return () => {
      editor.dispose();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveActiveRef.current();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (isElectron && root) void openRoot(root);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isElectron) {
    return (
      <div className="ide-shell">
        <div className="ide-welcome">
          <div className="ide-welcome-icon">
            <FileOutlined />
          </div>
          <div className="ide-welcome-title">代码编辑器</div>
          <div className="ide-welcome-desc">IDE 功能需要在 TeamAI 桌面客户端中使用（浏览器模式无法访问本地文件）</div>
        </div>
      </div>
    );
  }

  const dirtyCount = tabs.filter((t) => t.dirty).length;
  const activeModel = activeRel ? modelsRef.current.get(activeRel) : null;

  const renderNodes = (nodes: IdeNode[], depth: number): React.ReactNode =>
    nodes.map((node) => (
      <div key={node.path}>
        <div
          className={`ide-tree-row${!node.dir && activeRel === node.path ? " ide-tree-row-active" : ""}`}
          style={{ paddingLeft: 10 + depth * 14 }}
          onClick={() => void (node.dir ? toggleDir(node.path) : openFile(node.path))}
        >
          {node.dir ? (
            openDirs.has(node.path) ? (
              <FolderOpenOutlined className="ide-tree-icon" />
            ) : (
              <FolderOutlined className="ide-tree-icon" />
            )
          ) : (
            <FileOutlined className="ide-tree-icon" />
          )}
          <span className="ide-tree-name" title={node.path}>
            {node.name}
          </span>
        </div>
        {node.dir &&
          openDirs.has(node.path) &&
          renderNodes(dirs[node.path] ?? [], depth + 1)}
      </div>
    ));

  return (
    <div className="ide-shell">
      <div className="ide-topbar">
        <Tooltip title="选择工作目录">
          <button className="ide-btn" onClick={() => void api.pickDir().then((d) => d && void openRoot(d))}>
            <FolderOpenOutlined />
            <span>{root ? baseName(root) : "打开目录"}</span>
          </button>
        </Tooltip>
        <Tooltip title="刷新文件树">
          <button className="ide-btn ide-btn-icon" disabled={!root || loading} onClick={() => void refresh()}>
            <ReloadOutlined spin={loading} />
          </button>
        </Tooltip>
        <div className="ide-topbar-spacer" />
        <Tooltip title="把当前文件发给 AI 分析">
          <button className="ide-btn" disabled={!activeModel} onClick={sendToAgent}>
            <RobotOutlined />
            <span>发送到 AI 工作台</span>
          </button>
        </Tooltip>
        <button
          className="ide-btn ide-btn-primary"
          disabled={dirtyCount === 0}
          onClick={() => void saveActiveRef.current()}
        >
          <SaveOutlined />
          <span>保存{dirtyCount > 0 ? ` (${dirtyCount})` : ""}</span>
        </button>
      </div>
      <div className="ide-main">
        <div className="ide-tree">
          {root ? (
            renderNodes(dirs[""] ?? [], 0)
          ) : (
            <div className="ide-tree-empty">先选择一个工作目录</div>
          )}
        </div>
        <div className="ide-editor-col">
          {tabs.length > 0 && (
            <div className="ide-tabs">
              {tabs.map((t) => (
                <div
                  key={t.rel}
                  className={`ide-tab${activeRel === t.rel ? " ide-tab-active" : ""}`}
                  onClick={() => activate(t.rel)}
                >
                  <span className="ide-tab-name" title={t.rel}>
                    {baseName(t.rel)}
                  </span>
                  {t.dirty && <span className="ide-tab-dirty" />}
                  <CloseOutlined
                    className="ide-tab-close"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(t.rel);
                    }}
                  />
                </div>
              ))}
            </div>
          )}
          <div ref={hostRef} className="ide-editor-host" />
          <div className="ide-status">
            {activeRel ? (
              <>
                <span className="ide-status-path">{activeRel}</span>
                <span>{langOf(activeRel)}</span>
                <span className={tabs.find((t) => t.rel === activeRel)?.dirty ? "ide-status-dirty" : ""}>
                  {tabs.find((t) => t.rel === activeRel)?.dirty ? "未保存（Ctrl+S）" : "已保存"}
                </span>
              </>
            ) : (
              <span>
                {root
                  ? "从左侧文件树选择文件开始编辑 · Ctrl+S 保存 · 编辑后可在 Agent 工作台一键同步到服务端"
                  : "选择工作目录后即可浏览和编辑本地代码"}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
