export interface DiffRow {
  type: "same" | "add" | "del";
  text: string;
}

export type DiffLine = DiffRow | { type: "fold"; count: number };

export function lineDiff(oldText: string, newText: string): DiffRow[] {
  const a = oldText ? oldText.split("\n") : [];
  const b = newText ? newText.split("\n") : [];
  if (a.length === 0 && b.length === 0) return [];
  if (a.length * b.length > 4_000_000) {
    return [...a.map((text) => ({ type: "del" as const, text })), ...b.map((text) => ({ type: "add" as const, text }))];
  }
  const m = a.length;
  const n = b.length;
  const dp: Uint32Array[] = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      rows.push({ type: "same", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ type: "del", text: a[i] });
      i++;
    } else {
      rows.push({ type: "add", text: b[j] });
      j++;
    }
  }
  while (i < m) rows.push({ type: "del", text: a[i++] });
  while (j < n) rows.push({ type: "add", text: b[j++] });
  return rows;
}

export function collapseSame(rows: DiffRow[], context = 3): DiffLine[] {
  const out: DiffLine[] = [];
  let i = 0;
  while (i < rows.length) {
    if (rows[i].type !== "same") {
      out.push(rows[i]);
      i++;
      continue;
    }
    let j = i;
    while (j < rows.length && rows[j].type === "same") j++;
    const run = j - i;
    const threshold = context * 2 + 2;
    if (run <= threshold) {
      for (let k = i; k < j; k++) out.push(rows[k]);
    } else {
      for (let k = i; k < i + context; k++) out.push(rows[k]);
      out.push({ type: "fold", count: run - context * 2 });
      for (let k = j - context; k < j; k++) out.push(rows[k]);
    }
    i = j;
  }
  return out;
}
