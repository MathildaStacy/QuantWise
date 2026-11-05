/**
 * 书里的分组收益表（docs/design/pm-reader-lecture-20261105.md 第 11 项）：factor_test 带上要对照的表（块号 + Panel + 行）时，
 * App 从解析好的表格单元格里取这一行每组的数，画在各组收益图上；数不经模型抄写。
 * 认得的样子：表头一行组名（Low、2、…、High，或 1…10、小、大），可以有多空列（High−Low）；每组一格「1.19(1.60)」
 * （均值和括号里的 t 值），或者均值一行、t 值另起一行；一张表可以有几个 Panel（占满一行的那一格是 Panel 标题）。
 */
import { parseBookTable } from '../book/table';
import { shapeRho, type BookGroups } from '../quant/charts';

/** 书里一行分组收益（原书的组数和单位）。 */
export type BookRow = Omit<BookGroups, 'values' | 'merged'>;

const clean = (s: string) =>
  s
    .replace(/\*\*/g, '')
    .replace(/<\/?(sup|sub)>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/[−–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

/** 组名：Low / High / Loser / Winner / Small / Big / Q1 / P10 / 2 / 低 / 高 / 小 / 大 / 输家 / 赢家。 */
const GROUP = /^(?:low(?:est)?|high(?:est)?|loser|winner|small|big|large|[qpgd]?\d{1,2}|低|高|小|大|最低|最高|输家|赢家|低组|高组)(?:\s*[(（].*[)）])?$/i;
/** 多空列：High-Low、H-L、Winner-Loser、10-1、多空。 */
const SPREAD = /^(?:(?:high|h|winner|w|big|q?\d{1,2})\s*-\s*(?:low|l|loser|small|q?\d{1,2})|多空|高-低|赢家-输家|spread)(?:\s*[(（].*[)）])?$/i;
const VALUE = /^(-?\d+(?:\.\d+)?)\s*%?\s*\*{0,3}\s*(?:[(（]\s*(-?\d+(?:\.\d+)?)\s*[)）]\s*\*{0,3})?$/;
const T_ONLY = /^[(（]\s*-?\d+(?:\.\d+)?\s*[)）]\s*\*{0,3}$/;
/** 一格数：带小数点或括号（整数「2」是组名或行名）。 */
const isValue = (x: string | null) => !!x && VALUE.test(x) && /[.(（]/.test(x);
const tOf = (s: string) => Number(/-?\d+(?:\.\d+)?/.exec(s)?.[0]);

interface Row {
  label: string;
  /** 按列号：这一格的文字（被合并单元格占着的是 null）。 */
  cells: (string | null)[];
}
interface Segment {
  title: string;
  header: (string | null)[] | null;
  rows: Row[];
}

const tableNo = (s: string) => /(?:表|Table|TABLE)\s*\d+(?:[.\-－]\d+)*/.exec(s)?.[0]?.replace(/\s+/g, '') ?? '';

/** 按行切成几段：占满一行的那一格（或一行只有一格字）是 Panel 标题；表头一行组名；数据行至少 3 格数。 */
function segmentsOf(grid: (string | null)[][], wide: boolean[]): Segment[] {
  const out: Segment[] = [{ title: '', header: null, rows: [] }];
  let header: (string | null)[] | null = null;
  grid.forEach((cells, r) => {
    const filled = cells.filter((x): x is string => !!x);
    if (!filled.length) {
      return;
    }
    const values = filled.filter(isValue);
    if (!values.length && (filled.length === 1 || wide[r]) && !filled.every(x => GROUP.test(x) || SPREAD.test(x))) {
      out.push({ title: filled.join(' '), header, rows: [] });
      return;
    }
    const seg = out[out.length - 1];
    if (!values.length && filled.filter(x => GROUP.test(x) || SPREAD.test(x)).length >= 3) {
      header = cells;
      seg.header = cells;
      return;
    }
    seg.header = seg.header ?? header;
    // 行名：第一格数前面的最后一格字（双重排序表左边可能先有一格合并的「市值组」，再是「Small」）
    const at = cells.findIndex(x => x != null && (isValue(x) || T_ONLY.test(x)));
    const before = cells.slice(0, at < 0 ? cells.length : at).filter((x): x is string => !!x);
    const label = before.length ? before[before.length - 1] : '';
    const rest = cells.slice(at < 0 ? cells.length : at).filter((x): x is string => !!x);
    if (rest.length && rest.every(x => T_ONLY.test(x)) && seg.rows.length) {
      // t 值另起一行：接到上一行每一格的括号里
      const prev = seg.rows[seg.rows.length - 1];
      cells.forEach((x, k) => {
        const p = prev.cells[k];
        if (x && T_ONLY.test(x) && p && !/[(（]/.test(p)) {
          prev.cells[k] = p + '(' + tOf(x) + ')';
        }
      });
      return;
    }
    if (cells.filter(isValue).length >= 3) {
      seg.rows.push({ label, cells });
    }
  });
  return out.filter(s => s.rows.length && s.header);
}

/**
 * 从表格里取一行分组收益。panel 写「A」「Panel A」或 Panel 标题里的字（「等权」），row 写行名（「Small」「1」）；
 * 只有一个 Panel、一行时可以不写。认不出时返回原因（工具照常检验，原因写进结果，模型可以换个 Panel 或行再试）。
 */
export function bookRowOf(
  block: { text: string; html: string | null },
  ref: { cite: string; panel?: string; row?: string; caption?: string },
): BookRow | string {
  const table = parseBookTable(block.text, block.html);
  if (!table) {
    return '这一块不是能读出单元格的表格';
  }
  const grid: (string | null)[][] = Array.from({ length: table.rows }, () => Array<string | null>(table.columns).fill(null));
  const wide: boolean[] = Array<boolean>(table.rows).fill(false);
  for (const c of table.cells) {
    grid[c.row][c.col] = clean(c.text) || null;
    if (c.colSpan >= Math.max(2, table.columns - 1)) {
      wide[c.row] = true;
    }
  }
  const usable = segmentsOf(grid, wide);
  if (!usable.length) {
    return '这张表里没找到「Low、2、…、High」这样的分组表头和每组的数';
  }
  const titled = usable.filter(s => s.title);
  const want = (ref.panel ?? '').trim();
  const letter = /^(?:panel\s*)?([a-z])$/i.exec(want)?.[1]?.toLowerCase();
  const panels = want && titled.length
    ? titled.filter(s => {
        const t = s.title.toLowerCase();
        return letter ? new RegExp('panel\\s*' + letter + '\\b').test(t) : t.includes(want.toLowerCase());
      })
    : usable;
  if (!panels.length) {
    return '没有「' + want + '」这个 Panel；这张表有：' + titled.map(s => s.title).join('、');
  }
  if (panels.length > 1) {
    return '这张表有几个 Panel（' + titled.map(s => s.title).join('、') + '），用 book_panel 写要对照哪一个';
  }
  const seg = panels[0];
  const rowWant = (ref.row ?? '').trim().toLowerCase();
  const exact = seg.rows.filter(r => r.label.toLowerCase() === rowWant);
  const rows = seg.rows.length === 1 || !rowWant ? seg.rows : exact.length ? exact : seg.rows.filter(r => r.label.toLowerCase().startsWith(rowWant));
  if (rows.length !== 1) {
    return (rows.length ? '这个 Panel 有几行' : '没有「' + ref.row + '」这一行') + '（' + seg.rows.map(r => r.label || '（无行名）').join('、') + '），用 book_row 写要对照哪一行';
  }
  const row = rows[0];
  const head = seg.header!;
  const groupCols: number[] = [];
  let spreadCol = -1;
  // 表头和数据行按列号对齐；只认这一行这一列是数的组名（行名那一列的表头可能也像组名）
  head.forEach((h, k) => {
    if (!h || !isValue(row.cells[k])) {
      return;
    }
    if (SPREAD.test(h)) {
      spreadCol = k;
    } else if (GROUP.test(h)) {
      groupCols.push(k);
    }
  });
  const parsed = groupCols.map(k => VALUE.exec(row.cells[k] ?? ''));
  if (groupCols.length < 3 || parsed.some(m => !m)) {
    return '这一行的分组数读不全（每组要有一格数，例如「1.19(1.60)」）';
  }
  let raw = parsed.map(m => Number(m![1]));
  const first = head[groupCols[0]] ?? '';
  const last = head[groupCols[groupCols.length - 1]] ?? '';
  const reversed = /^(high|winner|big|large|高|大|赢家)/i.test(first) && /^(low|loser|small|低|小|输家)/i.test(last);
  if (reversed) {
    raw = raw.reverse();
  }
  const sm = spreadCol >= 0 ? VALUE.exec(row.cells[spreadCol] ?? '') : null;
  const words = [ref.caption ?? '', block.text.split('\n')[0] ?? '', seg.title].join(' ');
  const unit = /月|month/i.test(words) ? 'monthly' : /年化|年均|annual|per year/i.test(words) ? 'annual' : 'unknown';
  // 表注写了 % 就是百分数；没写、每个数都很小时当成小数
  const scale = /%|百分/.test(words) || raw.some(v => Math.abs(v) >= 0.2) ? 1 : 100;
  const sign = reversed ? -1 : 1;
  const label = [tableNo(ref.caption ?? '') || tableNo(block.text), seg.title, row.label].filter(Boolean).join(' ');
  return {
    label: label || '书中的表',
    cite: ref.cite,
    raw: raw.map(v => v * scale),
    ...(sm ? { spread: { mean: Number(sm[1]) * scale * sign, t: sm[2] != null ? Number(sm[2]) * sign : null } } : {}),
    unit,
    rho: shapeRho(raw),
  };
}

/**
 * 把书里的组数对到本次的组数：每组看成从低到高的一段分位，本次每组取和它重叠的书中各组的平均（按重叠长度加权）。
 * 10 → 5 就是每相邻 2 组取平均；5 → 10 是每组拆给本次 2 组。
 */
export function fitGroups(row: BookRow, groups: number): BookGroups {
  const n = row.raw.length;
  const values = Array.from({ length: groups }, (_, g) => {
    const a = g / groups;
    const b = (g + 1) / groups;
    let sw = 0;
    let sv = 0;
    row.raw.forEach((v, k) => {
      const w = Math.max(0, Math.min(b, (k + 1) / n) - Math.max(a, k / n));
      sw += w;
      sv += w * v;
    });
    return sw ? sv / sw : 0;
  });
  const merged =
    n === groups
      ? undefined
      : n % groups === 0
      ? '原书 ' + n + ' 组，每相邻 ' + n / groups + ' 组取平均'
      : groups % n === 0
      ? '原书 ' + n + ' 组，每组对应本次 ' + groups / n + ' 组'
      : '原书 ' + n + ' 组，按分位重叠加权合成 ' + groups + ' 组';
  return { ...row, values: values.map(v => Math.round(v * 10000) / 10000), ...(merged ? { merged } : {}) };
}
