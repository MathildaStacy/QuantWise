/* QuantWise 原型 · 书：Markdown → 内容块、公式排版、书和学习记录的状态（App 里是 src/book/） */
'use strict';

// ---------- Markdown → 内容块 ----------
// 标题按「第 n 章」「3.1」「3.1.2」编号切成章 → 节 → 小节；段落、公式、列表项各是一个内容块，引用写成「3.1 ¶2」。
function parseBook(md, fallbackTitle) {
  const meta = {}, fm = md.match(/^---\n([\s\S]*?)\n---\n/);
  if (fm) fm[1].split('\n').forEach(l => { const m = l.match(/^(\w+):\s*(.+)$/); if (m) meta[m[1]] = m[2].trim(); });
  const body = fm ? md.slice(fm[0].length) : md;
  const secs = [], blocks = [], byId = {};
  let cur = null, chapNo = 0, para = 0, buf = [], math = null;
  const ensure = () => { if (!cur) { cur = { id: 'c0', no: '', title: meta.title || fallbackTitle || '正文', level: 1, blocks: [], parent: null }; secs.push(cur); } };
  const push = (type, text, extra) => { ensure(); const b = Object.assign({ id: 'b' + (blocks.length + 1), type, text, sec: cur.id, no: ++para }, extra); blocks.push(b); byId[b.id] = b; cur.blocks.push(b.id); };
  const flush = () => { if (buf.length) { push('p', buf.reduce((a, l) => a + (a && /[A-Za-z0-9,.;:]$/.test(a) ? ' ' : '') + l, '')); buf = []; } };
  for (const raw of body.split('\n')) {
    const ln = raw.trimEnd();
    if (math) { if (/\$\$\s*$/.test(ln)) { math.push(ln.replace(/\$\$\s*$/, '')); push('eq', math.join(' ').trim()); math = null; } else math.push(ln); continue; }
    const h = ln.match(/^(#{1,3})\s+(.+)$/);
    if (h) {
      flush();
      const title = h[2].trim();
      let m = title.match(/^第\s*(\d+)\s*章\s*(.*)$/), id, no, t, lv;
      if (m) { id = m[1]; no = '第 ' + m[1] + ' 章'; t = m[2]; lv = 1; }
      else if ((m = title.match(/^(\d+(?:\.\d+){1,2})\s+(.*)$/))) { id = m[1]; no = m[1]; t = m[2]; lv = id.split('.').length; }
      else { lv = h[1].length; id = 'c' + (++chapNo); no = ''; t = title; }
      const parent = lv === 1 ? null : ((secs.filter(s => s.level < lv).pop()) || {}).id || null;
      cur = { id, no, title: t, level: lv, blocks: [], parent };
      secs.push(cur); para = 0; continue;
    }
    if (/^\$\$/.test(ln)) { flush(); const rest = ln.slice(2); if (/\$\$\s*$/.test(rest) && rest.replace(/\$\$\s*$/, '').trim()) push('eq', rest.replace(/\$\$\s*$/, '').trim()); else math = [rest]; continue; }
    const li = ln.match(/^\s*([-*]|\d+\.)\s+(.+)$/);
    if (li) { flush(); push('li', li[2], { mark: /\d/.test(li[1]) ? li[1] : '•' }); continue; }
    if (!ln.trim()) { flush(); continue; }
    buf.push(ln.trim());
  }
  flush();
  secs.forEach(s => { s.chars = s.blocks.reduce((a, id) => a + byId[id].text.length, 0); s.kids = secs.filter(x => x.parent === s.id).map(x => x.id); });
  return { meta, secs, blocks, byId, sec: id => secs.find(s => s.id === id), leaves: secs.filter(s => !secs.some(x => x.parent === s.id) && s.blocks.length) };
}

// ---------- 公式排版（原型用的极简 LaTeX；App 里用离线 MathJax 渲染成 SVG） ----------
const GREEK = { Phi: 'Φ', alpha: 'α', beta: 'β', sigma: 'σ', ell: 'ℓ', varepsilon: 'ε', epsilon: 'ε', mu: 'μ', pi: 'π', rho: 'ρ', theta: 'θ', lambda: 'λ', Delta: 'Δ', Sigma: 'Σ' };
const TSYM = { times: ' × ', approx: ' ≈ ', le: ' ≤ ', ge: ' ≥ ', leq: ' ≤ ', geq: ' ≥ ', pm: ' ± ', cdot: '·', dots: '…', ldots: '…', infty: '∞', ln: 'ln', max: 'max', min: 'min', corr: 'corr', log: 'log' };
function tex(s) {
  let i = 0;
  const group = () => { while (s[i] === ' ') i++; if (s[i] === '{') { i++; const o = seq('}'); i++; return o; } return atom(); };
  function atom() {
    const c = s[i];
    if (c === '\\') {
      i++; let name = '';
      if (/[a-zA-Z]/.test(s[i])) while (i < s.length && /[a-zA-Z]/.test(s[i])) name += s[i++]; else name = s[i++];
      if (name === 'frac') { const a = group(), b = group(); return '<span class="fr"><span>' + a + '</span><span>' + b + '</span></span>'; }
      if (name === 'sqrt') return '√<span class="sq">' + group() + '</span>';
      if (name === 'bar') return '<span class="ov">' + group() + '</span>';
      if (name === 'mathrm' || name === 'text' || name === 'operatorname') return '<span class="rm">' + group() + '</span>';
      if (name === 'left' || name === 'right') return atom();
      if (name === 'sum' || name === 'prod') return '<span class="bigop">' + (name === 'sum' ? '∑' : '∏') + '</span>';
      if (',; '.includes(name) || name === 'quad') return ' ';
      if ('%{}'.includes(name)) return name;
      if (GREEK[name]) return '<i>' + GREEK[name] + '</i>';
      return TSYM[name] != null ? TSYM[name] : name;
    }
    i++;
    if (c === '^') return '<sup>' + group() + '</sup>';
    if (c === '_') return '<sub>' + group() + '</sub>';
    if (c === ' ') return '';
    if (/[a-zA-Z]/.test(c)) return '<i>' + c + '</i>';
    if (c === '-') return '−';
    if (c === '=' || c === '+') return ' ' + c + ' ';
    return esc(c);
  }
  function seq(end) { let o = ''; while (i < s.length && s[i] !== end) o += atom(); return o; }
  return seq(undefined);
}
/** 行内：$公式$、**加粗**。 */
const inl = s => String(s).split(/(\$[^$]+\$|\*\*[^*]+\*\*)/).map(x => x.length > 2 && x[0] === '$' && x.endsWith('$') ? '<span class="tex">' + tex(x.slice(1, -1)) + '</span>' : x.startsWith('**') && x.endsWith('**') && x.length > 4 ? '<b>' + inl(x.slice(2, -2)) + '</b>' : esc(x)).join('');
const plainOf = s => String(s).replace(/\$([^$]+)\$/g, (_, t) => t.replace(/\\[a-z]+|[{}_^\\]/g, '')).replace(/\*\*/g, '');

// ---------- 书架和学习记录 ----------
const SAMPLE = parseBook(SAMPLE_MD);
const BOOKS = [{ id: 'sample', title: SAMPLE.meta.title, author: SAMPLE.meta.author, fmt: 'Markdown', from: '内置', status: 'ready', book: SAMPLE, color: '#2D5BA8', mark: '因子' }];
const bookOf = id => BOOKS.find(b => b.id === id);
const LS = {};
function lsOf(id) { const bk = bookOf(id).book; return LS[id] || (LS[id] = { main: bk.leaves[0].id, step: 0, mode: 'lecture', status: {}, steps: {}, threads: {}, detour: null, notes: {}, pins: {}, hl: {}, away: null }); }
const label = (bk, b) => { const s = bk.sec(b.sec); return (s.no || s.title.slice(0, 4)) + ' ¶' + b.no; };
const secLabel = s => (s.no ? s.no + ' ' : '') + s.title;
const leafStatus = (id, sid) => { const L = lsOf(id); return L.status[sid] || 'new'; };
let CARDS = [], STUCK = [], REVIEW_LOG = [];
