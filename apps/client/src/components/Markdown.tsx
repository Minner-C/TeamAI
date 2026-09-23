import { useMemo, useState, type ReactNode } from "react";
import { CheckOutlined, CopyOutlined } from "@ant-design/icons";

interface Block {
  type: "code" | "text";
  lang?: string;
  content: string;
}

function splitBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const re = /```([\w#+.-]*)\n?([\s\S]*?)(?:```|$)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) blocks.push({ type: "text", content: text.slice(last, m.index) });
    blocks.push({ type: "code", lang: m[1] || "", content: m[2].replace(/\n$/, "") });
    last = m.index + m[0].length;
  }
  if (last < text.length) blocks.push({ type: "text", content: text.slice(last) });
  return blocks;
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g);
  return parts.map((p, i) => {
    const key = `${keyPrefix}-${i}`;
    if (p.startsWith("`") && p.endsWith("`") && p.length > 2) {
      return (
        <code key={key} className="md-inline-code">
          {p.slice(1, -1)}
        </code>
      );
    }
    if (p.startsWith("**") && p.endsWith("**") && p.length > 4) {
      return <strong key={key}>{p.slice(2, -2)}</strong>;
    }
    if (p.startsWith("*") && p.endsWith("*") && p.length > 2) {
      return <em key={key}>{p.slice(1, -1)}</em>;
    }
    return <span key={key}>{p}</span>;
  });
}

function renderTextBlock(content: string, keyPrefix: string): ReactNode {
  const lines = content.split("\n");
  const out: ReactNode[] = [];
  let list: string[] = [];
  let ordered = false;

  const flushList = (idx: number) => {
    if (list.length === 0) return;
    const items = list.map((li, i) => <li key={i}>{renderInline(li, `${keyPrefix}-li${idx}-${i}`)}</li>);
    out.push(
      ordered ? (
        <ol key={`ol-${idx}`} className="md-list">
          {items}
        </ol>
      ) : (
        <ul key={`ul-${idx}`} className="md-list">
          {items}
        </ul>
      ),
    );
    list = [];
  };

  lines.forEach((line, idx) => {
    const ul = /^\s*[-•]\s+(.+)$/.exec(line);
    const ol = /^\s*\d+[.、]\s+(.+)$/.exec(line);
    if (ul) {
      if (ordered) flushList(idx);
      ordered = false;
      list.push(ul[1]);
      return;
    }
    if (ol) {
      if (!ordered && list.length > 0) flushList(idx);
      ordered = true;
      list.push(ol[1]);
      return;
    }
    flushList(idx);
    const h = /^(#{1,4})\s+(.+)$/.exec(line);
    if (h) {
      const level = h[1].length;
      out.push(
        <div key={`h-${idx}`} className={`md-h md-h${level}`}>
          {renderInline(h[2], `${keyPrefix}-h${idx}`)}
        </div>,
      );
      return;
    }
    if (line.trim() === "") {
      out.push(<div key={`br-${idx}`} className="md-gap" />);
      return;
    }
    out.push(
      <div key={`p-${idx}`} className="md-p">
        {renderInline(line, `${keyPrefix}-p${idx}`)}
      </div>,
    );
  });
  flushList(lines.length);
  return <>{out}</>;
}

function CodeBlock({ lang, content }: { lang?: string; content: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="md-code">
      <div className="md-code-head">
        <span className="md-code-lang">{lang || "text"}</span>
        <button
          className="md-code-copy"
          onClick={() => {
            void navigator.clipboard?.writeText(content).catch(() => undefined);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <CheckOutlined /> : <CopyOutlined />} {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre className="md-code-body">{content}</pre>
    </div>
  );
}

export default function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => splitBlocks(text), [text]);
  return (
    <div className="md-root">
      {blocks.map((b, i) =>
        b.type === "code" ? (
          <CodeBlock key={i} lang={b.lang} content={b.content} />
        ) : (
          <div key={i}>{renderTextBlock(b.content, `b${i}`)}</div>
        ),
      )}
    </div>
  );
}
