/** AI reads a scan into data; only these native primitives are rendered, never model-authored SVG or code. */
export interface FigureBase { title: string; description: string; notes: string[] }
export interface FigureChart extends FigureBase {
  kind: 'chart'; chartType: 'line' | 'bar' | 'scatter';
  xLabel: string; yLabel: string; yMin: number; yMax: number; yScale: 'linear' | 'log';
  xTicks: { at: number; label: string }[];
  annotations: { x: number; y: number; text: string }[];
  series: { name: string; style: 'solid' | 'dashed' | 'dotted'; points: [number, number | null][] }[];
}
export interface FigureTable extends FigureBase { kind: 'table'; rows: string[][] }
export interface FigureDiagram extends FigureBase {
  kind: 'diagram';
  nodes: { id: string; label: string; x: number; y: number; width: number; height: number }[];
  edges: { from: string; to: string; label: string }[];
}
export type BookFigure = FigureChart | FigureTable | FigureDiagram | { kind: 'unsupported'; reason: string };

const invalid = () => new Error('识别结果缺少完整的坐标、数据或结构，请重试或查看原图');
const obj = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw invalid();
  return v as Record<string, unknown>;
};
const str = (v: unknown, empty = true, max = 600): string => {
  if (typeof v !== 'string' || v.length > max || (!empty && !v.trim())) throw invalid();
  return v.trim();
};
const num = (v: unknown, min = -1e15, max = 1e15): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw invalid();
  return v;
};
const list = (v: unknown, min: number, max: number): unknown[] => {
  if (!Array.isArray(v) || v.length < min || v.length > max) throw invalid();
  return v;
};
const one = <T extends string>(v: unknown, choices: readonly T[]): T => {
  if (!choices.includes(v as T)) throw invalid();
  return v as T;
};

export function parseFigure(text: string): BookFigure {
  if (text.length > 250000) throw invalid();
  let value: unknown;
  try { value = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
  catch { throw invalid(); }
  const v = obj(value);
  if (v.kind === 'unsupported') return { kind: 'unsupported', reason: str(v.reason, false) };
  const base = { title: str(v.title), description: str(v.description, false, 1200), notes: list(v.notes, 0, 8).map(n => str(n, false)) };
  if (v.kind === 'chart') {
    const yMin = num(v.yMin), yMax = num(v.yMax);
    const yScale = one(v.yScale, ['linear', 'log']);
    if (yMax <= yMin || (yScale === 'log' && yMin <= 0)) throw invalid();
    const xTicks = list(v.xTicks, 2, 16).map(t => { const x = obj(t); return { at: num(x.at, 0, 1), label: str(x.label, false, 100) }; });
    if (xTicks.some((t, i) => i > 0 && t.at <= xTicks[i - 1].at)) throw invalid();
    const series = list(v.series, 1, 6).map(s => {
      const x = obj(s);
      const points = list(x.points, 2, 400).map(p => {
        const pair = list(p, 2, 2);
        return [num(pair[0], 0, 1), pair[1] === null ? null : num(pair[1], yMin, yMax)] as [number, number | null];
      });
      if (points.filter(p => p[1] != null).length < 2 || points.some((p, i) => i > 0 && p[0] < points[i - 1][0])) throw invalid();
      return { name: str(x.name, false, 100), style: one(x.style, ['solid', 'dashed', 'dotted']), points };
    });
    const annotations = list(v.annotations ?? [], 0, 5).map(a => { const x = obj(a); return { x: num(x.x, 0, 1), y: num(x.y, yMin, yMax), text: str(x.text, false, 60) }; });
    return { ...base, kind: 'chart', chartType: one(v.chartType, ['line', 'bar', 'scatter']), xLabel: str(v.xLabel), yLabel: str(v.yLabel), yMin, yMax, yScale, xTicks, series, annotations };
  }
  if (v.kind === 'table') {
    const rows = list(v.rows, 2, 100).map(r => list(r, 1, 20).map(c => str(c)));
    if (rows.some(r => r.length !== rows[0].length)) throw invalid();
    return { ...base, kind: 'table', rows };
  }
  if (v.kind === 'diagram') {
    const nodes = list(v.nodes, 1, 30).map(n => {
      const x = obj(n);
      const node = { id: str(x.id, false, 60), label: str(x.label, false, 240), x: num(x.x, 0, 1), y: num(x.y, 0, 1), width: num(x.width, 0.08, 1), height: num(x.height, 0.05, 1) };
      if (node.x + node.width > 1.001 || node.y + node.height > 1.001) throw invalid();
      return node;
    });
    const ids = new Set(nodes.map(n => n.id));
    if (ids.size !== nodes.length) throw invalid();
    if (nodes.some((a, i) => nodes.slice(i + 1).some(b => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 0.005 &&
      Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 0.005))) throw invalid();
    const edges = list(v.edges, 0, 60).map(e => {
      const x = obj(e);
      const edge = { from: str(x.from, false, 60), to: str(x.to, false, 60), label: str(x.label, true, 100) };
      if (!ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to) throw invalid();
      return edge;
    });
    return { ...base, kind: 'diagram', nodes, edges };
  }
  throw invalid();
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
export const figureTableHtml = (f: FigureTable) => '<table>' + f.rows.map((r, i) => '<tr>' + r.map(c => '<' + (i ? 'td' : 'th') + '>' + escape(c) + '</' + (i ? 'td' : 'th') + '>').join('') + '</tr>').join('') + '</table>';

/** Null samples split paths; estimating a scan must never silently bridge missing observations. */
export function figureSegments(points: FigureChart['series'][number]['points']): [number, number][][] {
  const segments: [number, number][][] = [];
  let current: [number, number][] = [];
  for (const [x, y] of points) {
    if (y == null) { if (current.length) segments.push(current); current = []; }
    else current.push([x, y]);
  }
  if (current.length) segments.push(current);
  return segments;
}

export function figureYTicks(f: Pick<FigureChart, 'yMin' | 'yMax' | 'yScale'>): number[] {
  if (f.yScale === 'log') return Array.from({ length: 5 }, (_, i) => 10 ** (Math.log10(f.yMin) + (Math.log10(f.yMax) - Math.log10(f.yMin)) * i / 4));
  const raw = (f.yMax - f.yMin) / 5, unit = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find(n => n * unit >= raw) ?? 10) * unit;
  const ticks: number[] = [];
  for (let n = Math.ceil(f.yMin / step) * step; n <= f.yMax + step * 1e-8; n += step) ticks.push(Number(n.toPrecision(10)));
  return ticks;
}
