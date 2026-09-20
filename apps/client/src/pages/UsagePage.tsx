import { useEffect, useMemo, useState } from "react";
import { Segmented, Select, Tooltip, message } from "antd";
import { api, type UsageDimRow, type UsageStats } from "../api";
import { useAppStore } from "../store/appStore";

type RangeKey = "today" | "week" | "month" | "all";

const DONUT_COLORS = ["#22c55e", "#6366f1", "#f59e0b", "#ec4899", "#06b6d4", "#a855f7", "#ef4444", "#84cc16"];

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function rangeFrom(key: RangeKey): number | undefined {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (key === "today") return startOfToday;
  if (key === "week") return startOfToday - 6 * 86400000;
  if (key === "month") return startOfToday - 29 * 86400000;
  return undefined;
}

function Donut({ rows }: { rows: UsageDimRow[] }) {
  const data = rows.map((r) => ({ name: r.name, value: r.tokensIn + r.tokensOut }));
  const total = data.reduce((s, d) => s + d.value, 0);
  const R = 52;
  const C = 2 * Math.PI * R;
  let acc = 0;
  const segs = data.slice(0, 8).map((d, i) => {
    const frac = total > 0 ? d.value / total : 0;
    const seg = { ...d, color: DONUT_COLORS[i % DONUT_COLORS.length], offset: acc, frac };
    acc += frac;
    return seg;
  });
  return (
    <div className="usage-donut-wrap">
      <svg width="140" height="140" viewBox="0 0 140 140">
        <circle cx="70" cy="70" r={R} fill="none" stroke="#333338" strokeWidth="18" />
        {segs.map((s) => (
          <circle
            key={s.name}
            cx="70"
            cy="70"
            r={R}
            fill="none"
            stroke={s.color}
            strokeWidth="18"
            strokeDasharray={`${Math.max(s.frac * C - 2, 0)} ${C}`}
            strokeDashoffset={-s.offset * C + C / 4}
          />
        ))}
        <text x="70" y="66" textAnchor="middle" fill="#e8e8ea" fontSize="17" fontWeight="600">
          {fmtTokens(total)}
        </text>
        <text x="70" y="84" textAnchor="middle" fill="#7a7a80" fontSize="10">
          tokens
        </text>
      </svg>
      <div className="usage-legend">
        {segs.map((s) => (
          <div key={s.name} className="usage-legend-row">
            <span className="usage-dot" style={{ background: s.color }} />
            <span className="usage-legend-name" title={s.name}>
              {s.name}
            </span>
            <span className="usage-legend-val">{fmtTokens(s.value)}</span>
            <span className="usage-legend-pct">{Math.round(s.frac * 100)}%</span>
          </div>
        ))}
        {data.length > 8 && (
          <div className="usage-legend-row">
            <span className="usage-dot" style={{ background: "#555" }} />
            <span className="usage-legend-name">其他 {data.length - 8} 项</span>
            <span className="usage-legend-val">
              {fmtTokens(data.slice(8).reduce((s, d) => s + d.value, 0))}
            </span>
            <span className="usage-legend-pct" />
          </div>
        )}
        {data.length === 0 && <div className="usage-empty">暂无数据</div>}
      </div>
    </div>
  );
}

function Heatmap({ byDay }: { byDay: Array<{ day: string; tokens: number }> }) {
  const weeks = useMemo(() => {
    const map = new Map(byDay.map((d) => [d.day, d.tokens]));
    const max = Math.max(1, ...byDay.map((d) => d.tokens));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today.getTime() - (16 * 7 + today.getDay()) * 86400000);
    const cols: Array<Array<{ day: string; tokens: number; level: number } | null>> = [];
    for (let w = 0; w < 17; w++) {
      const col: Array<{ day: string; tokens: number; level: number } | null> = [];
      for (let d = 0; d < 7; d++) {
        const date = new Date(start.getTime() + (w * 7 + d) * 86400000);
        if (date > today) {
          col.push(null);
          continue;
        }
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        const tokens = map.get(key) ?? 0;
        const ratio = tokens / max;
        const level = tokens === 0 ? 0 : ratio < 0.25 ? 1 : ratio < 0.5 ? 2 : ratio < 0.75 ? 3 : 4;
        col.push({ day: key, tokens, level });
      }
      cols.push(col);
    }
    return cols;
  }, [byDay]);

  return (
    <div className="usage-heat">
      <div className="usage-heat-grid">
        {weeks.map((col, i) => (
          <div key={i} className="usage-heat-col">
            {col.map((cell, j) =>
              cell ? (
                <Tooltip key={j} title={`${cell.day} · ${fmtTokens(cell.tokens)} tokens`}>
                  <div className={`usage-heat-cell lv${cell.level}`} />
                </Tooltip>
              ) : (
                <div key={j} className="usage-heat-cell lv0" style={{ visibility: "hidden" }} />
              ),
            )}
          </div>
        ))}
      </div>
      <div className="usage-heat-scale">
        <span>少</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <div key={l} className={`usage-heat-cell lv${l}`} />
        ))}
        <span>多</span>
      </div>
    </div>
  );
}

export default function UsagePage() {
  const { user } = useAppStore();
  const [range, setRange] = useState<RangeKey>("all");
  const [userId, setUserId] = useState<string>();
  const [members, setMembers] = useState<Array<{ id: string; name: string; email: string }>>([]);
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(false);
  const isAdmin = user?.role === "admin";

  useEffect(() => {
    if (isAdmin) {
      api
        .listUsers()
        .then((list) => setMembers(list.map((u) => ({ id: u.id, name: u.name, email: u.email }))))
        .catch(() => undefined);
    }
  }, [isAdmin]);

  useEffect(() => {
    setLoading(true);
    api
      .usageStats({ from: rangeFrom(range), userId })
      .then(setStats)
      .catch((err) => message.error(err instanceof Error ? err.message : "获取用量统计失败"))
      .finally(() => setLoading(false));
  }, [range, userId]);

  const cards = [
    { title: "总 Tokens（所选范围）", value: fmtTokens((stats?.range.tokensIn ?? 0) + (stats?.range.tokensOut ?? 0)) },
    { title: "今日", value: fmtTokens((stats?.today.tokensIn ?? 0) + (stats?.today.tokensOut ?? 0)) },
    { title: "本周", value: fmtTokens((stats?.week.tokensIn ?? 0) + (stats?.week.tokensOut ?? 0)) },
    {
      title: "输入 / 输出",
      value: `${fmtTokens(stats?.range.tokensIn ?? 0)} / ${fmtTokens(stats?.range.tokensOut ?? 0)}`,
    },
  ];

  return (
    <div className="page-card usage-page">
      <div className="usage-header">
        <div>
          <div className="usage-title">用量统计</div>
          <div className="usage-sub">
            口径说明：网关对话按上游返回的真实 token 计数；本地 CLI 经网关注入时同样落库。
            {isAdmin ? "管理员可查看全员或按成员过滤。" : "成员仅可查看自己的用量。"}
          </div>
        </div>
        <div className="usage-filters">
          {isAdmin && (
            <Select
              allowClear
              placeholder="全部成员"
              style={{ width: 180 }}
              value={userId}
              onChange={(v) => setUserId(v)}
              options={members.map((m) => ({ value: m.id, label: `${m.name}（${m.email}）` }))}
            />
          )}
          <Segmented
            value={range}
            onChange={(v) => setRange(v as RangeKey)}
            options={[
              { value: "today", label: "今天" },
              { value: "week", label: "近7天" },
              { value: "month", label: "近30天" },
              { value: "all", label: "全部" },
            ]}
          />
        </div>
      </div>

      <div className="usage-cards" style={{ opacity: loading ? 0.5 : 1 }}>
        {cards.map((c) => (
          <div key={c.title} className="usage-card">
            <div className="usage-card-value">{c.value}</div>
            <div className="usage-card-title">{c.title}</div>
          </div>
        ))}
      </div>

      <div className="usage-section-title">近期用量（按天）</div>
      <Heatmap byDay={stats?.byDay ?? []} />

      <div className="usage-donuts">
        <div>
          <div className="usage-section-title">按模型</div>
          <Donut rows={stats?.byModel ?? []} />
        </div>
        <div>
          <div className="usage-section-title">按成员</div>
          <Donut rows={stats?.byUser ?? []} />
        </div>
        <div>
          <div className="usage-section-title">按 CLI / 渠道</div>
          <Donut rows={stats?.byCli ?? []} />
        </div>
      </div>
    </div>
  );
}
