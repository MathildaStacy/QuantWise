/* QuantWise 原型 · 因子引擎和图表卡片：用快照里的真实日线（前复权）现算，和 App 的 src/quant/ 同一套口径 */
'use strict';

// ---------- 数据面板 ----------
const QDATES = DATA.kline.sh000300.map(r => r[0]).filter(d => d >= DATA.kline.sh600519[0][0]);
// 样本池：快照里有日线的个股（不含 ETF、指数），App 里对应「示例池」
const QPOOL = Object.keys(DATA.kline).filter(c => SEC[c] && !['etf', 'index'].includes(SEC[c].board) && DATA.kline[c].length >= 240);
function closeMap(code) { const m = {}; for (const r of DATA.kline[code]) m[r[0]] = r[2]; return m; }
const QCLOSE = {}; for (const c of QPOOL.concat(['sh000300', 'sh510300'])) QCLOSE[c] = closeMap(c);
const closeSeries = (code, dates) => dates.map(d => QCLOSE[code][d] ?? null);

// ---------- 指标 ----------
function ma(v, n) { return v.map((_, i) => { if (i < n - 1) return null; let s = 0; for (let k = i - n + 1; k <= i; k++) s += v[k]; return s / n; }); }
function mom(v, n) { return v.map((x, i) => i >= n && v[i - n] ? x / v[i - n] - 1 : null); }
function dret(v) { return v.map((x, i) => i ? x / v[i - 1] - 1 : null); }
function rollVol(v, n) { const r = dret(v); return r.map((_, i) => { if (i < n) return null; const w = r.slice(i - n + 1, i + 1), m = w.reduce((a, b) => a + b, 0) / n; return Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)) * Math.sqrt(252); }); }
function drawdown(v) { let pk = -Infinity; return v.map(x => { pk = Math.max(pk, x); return x / pk - 1; }); }
function rankOf(xs) { const idx = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]); const r = new Array(xs.length); let i = 0; while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1; i = j + 1; } return r; }
function corr(a, b) { const n = a.length, ma_ = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n; let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < n; i++) { sab += (a[i] - ma_) * (b[i] - mb); saa += (a[i] - ma_) ** 2; sbb += (b[i] - mb) ** 2; } return saa && sbb ? sab / Math.sqrt(saa * sbb) : 0; }
const meanOf = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const sdOf = xs => { const m = meanOf(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1)); };

// ---------- 因子 ----------
const FACTORS = {
  mom20: { name: '20 日动量', sec: '3.1', calc: (v, i) => i >= 20 ? v[i] / v[i - 20] - 1 : null },
  mom60: { name: '60 日动量', sec: '3.1', calc: (v, i) => i >= 60 ? v[i] / v[i - 60] - 1 : null },
  rev20: { name: '20 日反转', sec: '3.2', calc: (v, i) => i >= 20 ? -(v[i] / v[i - 20] - 1) : null },
  vol20: { name: '20 日低波动', sec: '3.3', calc: (v, i) => { if (i < 20) return null; const r = []; for (let k = i - 19; k <= i; k++) r.push(v[k] / v[k - 1] - 1); return -sdOf(r); } }
};

/** 分组回测 + Rank IC（4.1–4.4）。每 hold 个交易日调仓，按因子值从低到高分 groups 组，等权持有到下一个调仓日。 */
function factorTest(o) {
  const f = FACTORS[o.factor], dates = QDATES, pool = o.pool || QPOOL, hold = o.hold, G = o.groups, cost = (o.costBp || 0) / 1e4;
  const px = {}; for (const c of pool) px[c] = closeSeries(c, dates);
  const nav = Array.from({ length: G }, () => [1]), ls = [1], bench = [1], ics = [], navDates = [], grpRet = Array.from({ length: G }, () => []);
  let prevTop = null; const turns = [];
  const start = 61; // 让 60 日因子也有数据
  for (let t = start; t + hold < dates.length; t += hold) {
    const rows = [];
    for (const c of pool) { const v = px[c]; if (v[t] == null || v[t + hold] == null) continue; const x = f.calc(v, t); if (x == null || !isFinite(x)) continue; rows.push({ c, x, r: v[t + hold] / v[t] - 1 }); }
    if (rows.length < G * 2) continue;
    rows.sort((a, b) => a.x - b.x);
    const ic = corr(rankOf(rows.map(r => r.x)), rankOf(rows.map(r => r.r)));
    ics.push({ date: dates[t], ic });
    const per = rows.length / G, gr = [];
    for (let g = 0; g < G; g++) { const part = rows.slice(Math.round(g * per), Math.round((g + 1) * per)); gr.push(meanOf(part.map(r => r.r))); }
    const top = rows.slice(Math.round((G - 1) * per)).map(r => r.c);
    const turn = prevTop ? top.filter(c => !prevTop.includes(c)).length / top.length : 1; prevTop = top; turns.push(turn);
    gr.forEach((r, g) => { grpRet[g].push(r); nav[g].push(nav[g][nav[g].length - 1] * (1 + r - (g === G - 1 || g === 0 ? turn * cost * 2 : 0))); });
    const lsr = gr[G - 1] - gr[0] - turn * cost * 4; ls.push(ls[ls.length - 1] * (1 + lsr));
    bench.push(bench[bench.length - 1] * (1 + meanOf(rows.map(r => r.r))));
    navDates.push(dates[t + hold]);
  }
  navDates.unshift(dates[start]);
  const icv = ics.map(x => x.ic), m = meanOf(icv), sd = sdOf(icv), perYear = 252 / hold;
  const lsAnn = Math.pow(ls[ls.length - 1], perYear / Math.max(1, ls.length - 1)) - 1;
  const means = grpRet.map(meanOf), mono = corr(means.map((_, i) => i), rankOf(means).map(Number));
  return { o, f, n: pool.length, periods: icv.length, nav, ls, bench, navDates, ics, icMean: m, icSd: sd, icir: sd ? m / sd : 0, icirAnn: sd ? m / sd * Math.sqrt(perYear) : 0, icPos: icv.filter(x => x > 0).length / icv.length, t: sd ? m / (sd / Math.sqrt(icv.length)) : 0, lsAnn, turnover: meanOf(turns.slice(1)), means, mono, from: navDates[0], to: navDates[navDates.length - 1] };
}

/** 某一天的因子排名（get_factor_values）。 */
function factorRank(factor, code, di) {
  const f = FACTORS[factor], d = di == null ? QDATES.length - 1 : di;
  const rows = QPOOL.map(c => { const v = closeSeries(c, QDATES); return { c, x: f.calc(v, d) }; }).filter(r => r.x != null).sort((a, b) => b.x - a.x);
  return { rank: rows.findIndex(r => r.c === code) + 1, n: rows.length, rows };
}

// ---------- 图表卡片 ----------
// 图表是一份规格（chart spec），App 里由模型调用 plot_chart 生成、App 现算；这里同样只存规格，画的时候现算。
const CHARTS = {};
let chartSeq = 0;
function chartSpec(spec) { const id = 'c' + (++chartSeq); CHARTS[id] = spec; return id; }
const QC = { up: '#E5322D', dn: '#0E9F5B', grid: '#ECEAE4', txt: '#8B877F', ink: '#292825', ma: '#E08A1E', main: '#2D5BA8', bench: '#9A968D', ls: '#A65035' };
const GROUP_COL = ['#C9D6EA', '#9DB4D8', '#6F90C4', '#456CAD', '#1F4A8F', '#0F3170', '#082356', '#041640', '#020E2D', '#01081C'];

function priceData(spec) {
  const k = DATA.kline[spec.code], n = Math.min(spec.n || 250, k.length), rows = k.slice(-n);
  const dates = rows.map(r => r[0]), close = rows.map(r => r[2]);
  const full = k.map(r => r[2]), off = k.length - n;
  const sub = spec.sub === 'mom20' ? mom(full, 20).slice(off) : spec.sub === 'mom60' ? mom(full, 60).slice(off) : spec.sub === 'vol20' ? rollVol(full, 20).slice(off) : spec.sub === 'dd' ? drawdown(close) : null;
  return { dates, close, ma20: spec.ma ? ma(full, spec.ma).slice(off) : null, sub };
}
const minMax = arr => { let lo = Infinity, hi = -Infinity; for (const v of arr) if (v != null && isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } return [lo, hi]; };
function line(ctx, xs, ys, col, w, dash) { ctx.strokeStyle = col; ctx.lineWidth = w || 1.4; ctx.setLineDash(dash || []); ctx.beginPath(); let on = false; ys.forEach((y, i) => { if (y == null || !isFinite(y)) { on = false; return; } on ? ctx.lineTo(xs[i], y) : ctx.moveTo(xs[i], y); on = true; }); ctx.stroke(); ctx.setLineDash([]); }

/** 画一张图：price（价格 + 均线 + 副图）、factor（分组净值）、ic（IC 柱 + 累计）、groups（分组平均收益柱）。 */
function drawChart(cv, id, hover) {
  const spec = CHARTS[id]; if (!spec) return;
  const big = cv.dataset.big === '1', H = big ? 320 : spec.kind === 'price' && spec.sub ? 210 : 168;
  const { ctx, w, h } = setupCanvas(cv, H);
  ctx.font = '10px ' + getComputedStyle(document.body).getPropertyValue('--num');
  if (spec.kind === 'price') return drawPrice(ctx, w, h, spec, hover);
  const r = spec.res || (spec.res = factorTest(spec.test));
  if (spec.kind === 'factor') {
    const series = r.nav.map((v, g) => ({ v, col: GROUP_COL[Math.round(g * 9 / Math.max(1, r.nav.length - 1))], w: g === 0 || g === r.nav.length - 1 ? 1.8 : 1.1 })).concat([{ v: r.bench, col: QC.bench, w: 1, dash: [3, 3] }]);
    const [lo, hi] = minMax(series.flatMap(s => s.v)), padB = 16, X = i => 4 + (w - 8) * i / (r.navDates.length - 1), Y = v => 10 + (h - padB - 16) * (hi - v) / (hi - lo || 1);
    ctx.strokeStyle = QC.grid; ctx.beginPath(); ctx.moveTo(0, Y(1)); ctx.lineTo(w, Y(1)); ctx.stroke();
    series.forEach(s => line(ctx, s.v.map((_, i) => X(i)), s.v.map(Y), s.col, s.w, s.dash));
    ctx.fillStyle = QC.txt; ctx.fillText(fx(hi, 2), 4, 9); ctx.fillText(fx(lo, 2), 4, h - padB - 2);
    ctx.fillText(r.navDates[0], 4, h - 3); ctx.textAlign = 'right'; ctx.fillText(r.navDates[r.navDates.length - 1], w - 4, h - 3); ctx.textAlign = 'left';
    if (hover != null) hoverLine(ctx, X(Math.round(hover * (r.navDates.length - 1))), h - padB);
    return;
  }
  if (spec.kind === 'ic') {
    const v = r.ics.map(x => x.ic), cum = []; v.reduce((a, b, i) => (cum[i] = a + b), 0);
    const lim = Math.max(0.2, ...v.map(Math.abs)), padB = 16, bw = (w - 8) / v.length, Y = x => 8 + (h - padB - 16) * (lim - x) / (2 * lim);
    ctx.strokeStyle = QC.grid; ctx.beginPath(); ctx.moveTo(0, Y(0)); ctx.lineTo(w, Y(0)); ctx.stroke();
    v.forEach((x, i) => { ctx.fillStyle = x >= 0 ? '#C7533A' : '#3E7C5A'; const y0 = Y(0), y1 = Y(x); ctx.fillRect(4 + i * bw + 1, Math.min(y0, y1), Math.max(1, bw - 2), Math.abs(y1 - y0)); });
    const [clo, chi] = minMax(cum), CY = x => 8 + (h - padB - 16) * (chi - x) / (chi - clo || 1);
    line(ctx, cum.map((_, i) => 4 + i * bw + bw / 2), cum.map(CY), QC.ink, 1.2, [4, 2]);
    ctx.fillStyle = QC.txt; ctx.fillText('+' + fx(lim, 2), 4, 9); ctx.fillText('−' + fx(lim, 2), 4, h - padB - 2);
    ctx.fillText(r.ics[0].date, 4, h - 3); ctx.textAlign = 'right'; ctx.fillText('虚线：累计 IC', w - 4, 9); ctx.fillText(r.ics[r.ics.length - 1].date, w - 4, h - 3); ctx.textAlign = 'left';
    return;
  }
  if (spec.kind === 'groups') {
    const v = r.means.map(x => x * 100), lim = Math.max(...v.map(Math.abs)) * 1.15 || 1, bw = (w - 8) / v.length, Y = x => 8 + (h - 32) * (lim - x) / (2 * lim);
    ctx.strokeStyle = QC.grid; ctx.beginPath(); ctx.moveTo(0, Y(0)); ctx.lineTo(w, Y(0)); ctx.stroke();
    v.forEach((x, i) => { ctx.fillStyle = GROUP_COL[Math.round(i * 9 / Math.max(1, v.length - 1))]; const y0 = Y(0), y1 = Y(x); ctx.fillRect(4 + i * bw + bw * 0.2, Math.min(y0, y1), bw * 0.6, Math.abs(y1 - y0)); ctx.fillStyle = QC.ink; ctx.textAlign = 'center'; ctx.fillText(sgn(x, 2) + '%', 4 + i * bw + bw / 2, x >= 0 ? y1 - 3 : y1 + 11); ctx.fillStyle = QC.txt; ctx.fillText('Q' + (i + 1), 4 + i * bw + bw / 2, h - 4); ctx.textAlign = 'left'; });
  }
}
function hoverLine(ctx, x, bottom) { ctx.strokeStyle = 'rgba(41,40,37,.5)'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, bottom); ctx.stroke(); ctx.setLineDash([]); }
function drawPrice(ctx, w, h, spec, hover) {
  const d = priceData(spec), subH = d.sub ? (h - 16) * 0.32 : 0, mainB = h - 16 - subH - (d.sub ? 8 : 0);
  const [lo, hi] = minMax(d.close.concat(d.ma20 || [])), X = i => 4 + (w - 8) * i / (d.dates.length - 1), Y = v => 8 + (mainB - 14) * (hi - v) / (hi - lo || 1);
  ctx.strokeStyle = QC.grid; for (const f of [0.25, 0.5, 0.75]) { ctx.beginPath(); ctx.moveTo(0, 8 + (mainB - 14) * f); ctx.lineTo(w, 8 + (mainB - 14) * f); ctx.stroke(); }
  line(ctx, d.close.map((_, i) => X(i)), d.close.map(Y), QC.main, 1.5);
  if (d.ma20) line(ctx, d.ma20.map((_, i) => X(i)), d.ma20.map(v => v == null ? null : Y(v)), QC.ma, 1.1);
  ctx.fillStyle = QC.txt; ctx.fillText(fx(hi, 2), 4, 16); ctx.fillText(fx(lo, 2), 4, mainB - 6);
  (spec.marks || []).forEach(mk => { const i = d.dates.indexOf(mk.date); if (i < 0) return; const x = X(i), y = Y(d.close[i]); ctx.fillStyle = mk.col || QC.ls; ctx.beginPath(); ctx.arc(x, y, 3.2, 0, Math.PI * 2); ctx.fill(); ctx.font = '11px ' + getComputedStyle(document.body).getPropertyValue('--zh'); ctx.textAlign = x > w * 0.7 ? 'right' : 'left'; ctx.fillText(mk.label, x + (x > w * 0.7 ? -6 : 6), y + (mk.below ? 14 : -6)); ctx.textAlign = 'left'; ctx.font = '10px ' + getComputedStyle(document.body).getPropertyValue('--num'); });
  if (d.sub) {
    const top = mainB + 8, [slo, shi] = minMax(d.sub), lo2 = Math.min(0, slo), hi2 = Math.max(0, shi), SY = v => top + (subH - 2) * (hi2 - v) / (hi2 - lo2 || 1);
    ctx.strokeStyle = QC.grid; ctx.beginPath(); ctx.moveTo(0, SY(0)); ctx.lineTo(w, SY(0)); ctx.stroke();
    const bw = Math.max(1, (w - 8) / d.dates.length - 0.4);
    d.sub.forEach((v, i) => { if (v == null) return; ctx.fillStyle = spec.sub === 'dd' || spec.sub === 'vol20' ? '#9DB4D8' : v >= 0 ? 'rgba(229,50,45,.55)' : 'rgba(14,159,91,.55)'; const y0 = SY(0), y1 = SY(v); ctx.fillRect(X(i) - bw / 2, Math.min(y0, y1), bw, Math.max(0.6, Math.abs(y1 - y0))); });
    ctx.fillStyle = QC.txt; ctx.fillText({ mom20: '20 日动量', mom60: '60 日动量', vol20: '20 日年化波动', dd: '回撤' }[spec.sub] + ' ' + (spec.sub === 'vol20' ? fx(shi * 100, 0) + '% 高' : sgn(shi * 100, 0) + '% / ' + sgn(slo * 100, 0) + '%'), 4, top + 9);
  }
  ctx.fillStyle = QC.txt; ctx.fillText(d.dates[0], 4, h - 3); ctx.textAlign = 'right'; ctx.fillText(d.dates[d.dates.length - 1], w - 4, h - 3); ctx.textAlign = 'left';
  if (hover != null) { const i = Math.round(hover * (d.dates.length - 1)); hoverLine(ctx, X(i), h - 16); }
}
/** 读数：十字线所在那天的数字（全屏图用）。 */
function chartReadout(id, frac) {
  const spec = CHARTS[id];
  if (spec.kind === 'price') { const d = priceData(spec), i = Math.round(frac * (d.dates.length - 1)); return d.dates[i] + ' 收盘 ' + fx(d.close[i], 2) + (d.ma20 && d.ma20[i] ? ' · MA' + spec.ma + ' ' + fx(d.ma20[i], 2) : '') + (d.sub && d.sub[i] != null ? ' · ' + ({ mom20: '动量', mom60: '动量', vol20: '波动', dd: '回撤' }[spec.sub]) + ' ' + sgn(d.sub[i] * 100, 1) + '%' : ''); }
  const r = spec.res || (spec.res = factorTest(spec.test)); const i = Math.round(frac * (r.navDates.length - 1));
  return r.navDates[i] + ' · ' + r.nav.map((v, g) => 'Q' + (g + 1) + ' ' + fx(v[i], 3)).join(' ');
}
function paintCharts(root) { (root || document).querySelectorAll('canvas[data-chart]').forEach(cv => drawChart(cv, cv.dataset.chart)); }
/** 对话里的图表卡：标题、来源标签、图、图例、「全屏」。 */
function chartCard(id, title, legend, foot) {
  return '<div class="ccard"><div class="cch"><b>' + title + '</b><span class="srctag real">真实行情</span></div><canvas data-chart="' + id + '"></canvas>' +
    (legend ? '<div class="clegend">' + legend + '</div>' : '') + '<div class="ccf"><span>' + (foot || '前复权日线 · 腾讯行情') + '</span><button onclick="go(\'chartFull\',{id:\'' + id + '\'})">全屏查看 ›</button></div></div>';
}
const legendDot = (col, l, dash) => '<span><i style="background:' + col + (dash ? ';height:0;border-top:2px dashed ' + col + ';background:none' : '') + '"></i>' + l + '</span>';
function groupLegend(G) { return Array.from({ length: G }, (_, g) => legendDot(GROUP_COL[Math.round(g * 9 / Math.max(1, G - 1))], 'Q' + (g + 1) + (g === 0 ? ' 因子最低' : g === G - 1 ? ' 因子最高' : ''))).join('') + legendDot(QC.bench, '等权基准', true); }
