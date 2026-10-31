/* QuantWise 原型 · 因子实验室和全屏图表 */
'use strict';

const FL = { pool: 'sample', factor: 'mom20', hold: 20, groups: 5, costBp: 15 };
const POOLS = { sample: '示例池（' + QPOOL.length + ' 只）', watch: '自选 + 持仓', hs300: '沪深 300' };
function poolCodes() { if (FL.pool !== 'watch') return QPOOL; const held = S.lots.map(l => l.code); return QPOOL.filter(c => S.watch.includes(c) || held.includes(c)); }
SCREENS.factorLab = {
  title: '因子实验室',
  render() {
    const chip = (k, v, l) => '<button class="' + (FL[k] === v ? 'on' : '') + '" onclick="flSet(\'' + k + '\',' + (typeof v === 'number' ? v : '\'' + v + '\'') + ')">' + l + '</button>';
    const pool = poolCodes();
    let h = '<div class="sec flcfg"><div class="fr"><span>股票池</span><div class="seg2">' + Object.entries(POOLS).map(([k, l]) => chip('pool', k, l)).join('') + '</div></div>' +
      '<div class="frow"><span>因子</span><div class="seg2">' + Object.entries(FACTORS).map(([k, f]) => chip('factor', k, f.name)).join('') + '</div></div>' +
      '<div class="frow"><span>调仓</span><div class="seg2">' + [5, 10, 20].map(v => chip('hold', v, '每 ' + v + ' 日')).join('') + '</div></div>' +
      '<div class="frow"><span>分组</span><div class="seg2">' + [3, 5].map(v => chip('groups', v, v + ' 组')).join('') + '</div></div>' +
      '<div class="frow"><span>单边成本</span><div class="seg2">' + [0, 15, 30].map(v => chip('costBp', v, v ? '万 ' + v : '不扣')).join('') + '</div></div>' +
      '<div class="muted" style="font-size:11px;margin-top:6px">数据：本地前复权日线 ' + QDATES[0] + ' 到 ' + QDATES[QDATES.length - 1] + ' · ' + pool.length + ' 只 · 腾讯行情</div></div>';
    if (pool.length < FL.groups * 2) return h + '<div class="note warn" style="margin:10px">这个股票池只有 ' + pool.length + ' 只有日线的股票，分不出 ' + FL.groups + ' 组。换示例池，或者先在自选里多加几只。</div>';
    const test = { factor: FL.factor, hold: FL.hold, groups: FL.groups, costBp: FL.costBp, pool }, r = factorTest(test), f = FACTORS[FL.factor];
    ['flnav', 'flic', 'flgrp'].forEach((id, i) => { CHARTS[id] = { kind: ['factor', 'ic', 'groups'][i], test, res: r }; });
    const stat = (k, v, d, bad) => '<div class="fstat' + (bad ? ' weak' : '') + '"><span>' + k + '</span><b class="n">' + v + '</b><small>' + d + '</small></div>';
    h += '<div class="fstats">' + stat('Rank IC 均值', sgn(r.icMean, 3), Math.abs(r.icMean) >= 0.03 ? '过了 0.03' : '没到 0.03', Math.abs(r.icMean) < 0.03) + stat('t 值', fx(r.t, 2), r.periods + ' 期' + (Math.abs(r.t) < 2 ? '，不显著' : ''), Math.abs(r.t) < 2) + stat('ICIR', fx(r.icir, 2), '年化 ' + fx(r.icirAnn, 2)) + stat('IC 为正', fx(r.icPos * 100, 0) + '%', '') + stat('多空年化', sgn(r.lsAnn * 100, 1) + '%', FL.costBp ? '已扣费' : '未扣费') + stat('最高组换手', fx(r.turnover * 100, 0) + '%', '每期') + '</div>';
    h += '<div class="flcards">' + chartCard('flnav', '分组净值 · ' + f.name, groupLegend(FL.groups), pool.length + ' 只 · 每 ' + FL.hold + ' 日调仓 · ' + (FL.costBp ? '单边万 ' + FL.costBp : '不扣费')) + chartCard('flic', 'Rank IC · 每期', legendDot('#C7533A', 'IC > 0') + legendDot('#3E7C5A', 'IC < 0') + legendDot(QC.ink, '累计 IC', true), '均值 ' + sgn(r.icMean, 3) + ' · 标准差 ' + fx(r.icSd, 3)) + chartCard('flgrp', '各组每期平均收益', '', '单调性 ' + fx(r.mono, 2) + '（1 = 从低到高完全按顺序）') + '</div>';
    h += '<div class="note" style="margin:10px">股票池用的是今天的成分，有幸存者偏差；样本只有一年左右，结论只当练习。口径见《因子投资入门》4.1–4.5。</div>';
    return h + '<div style="display:flex;gap:8px;padding:4px 10px 16px"><button class="btn lt sm" style="flex:1" onclick="flAsk()">让 AI 解读这个结果</button><button class="btn sm" style="flex:1" onclick="openStudy(\'sample\',\'' + f.sec + '\',{mode:\'read\'})">书里怎么说（' + f.sec + '）</button></div>';
  },
  after() { paintCharts($('#view')); }
};
function flSet(k, v) {
  if (k === 'pool' && v === 'hs300') return modal({ title: '准备沪深 300 数据', ok: '下载', body: '<div class="ink2" style="font-size:13px">要下载 300 只成分股最近 3 年的前复权日线（约 22 万行、6 MB），用腾讯行情，大约 1 分钟。之后增量更新。<br><br>成分股名单是 App 内置的快照（带日期），不是历史成分：回测有幸存者偏差。</div>', onOk: () => { showToast('原型里没有沪深 300 的数据，继续用示例池'); } });
  FL[k] = v; refresh();
}
function flAsk() {
  const L = lsOf('sample'), f = FACTORS[FL.factor];
  L.main = f.sec; L.mode = 'lecture'; L.away = null;
  if (leafStatus('sample', f.sec) === 'new') L.status[f.sec] = 'learning';
  const th = threadOf('sample'); th.taught = Math.max(th.taught, 0);
  go('study', { id: 'sample' }); setTimeout(() => factorAsk('sample', '解读一下因子实验室里「' + f.name + '」的结果'), 200);
}

// ---------- 全屏图表：十字线读数、怎么算的 ----------
SCREENS.chartFull = {
  title: '图表',
  fab: false,
  render(p) {
    const sp = CHARTS[p.id];
    const how = sp.kind === 'price' ? ['收盘价：前复权日 K 的收盘', sp.ma ? 'MA' + sp.ma + '：最近 ' + sp.ma + ' 个收盘价的平均' : '', { mom20: '20 日动量：P(t) / P(t−20) − 1（3.1 ¶2）', mom60: '60 日动量：P(t) / P(t−60) − 1', vol20: '20 日年化波动：20 天日收益的标准差 × √252（1.2 ¶3）', dd: '回撤：收盘价 / 此前最高收盘价 − 1（1.3 ¶2）' }[sp.sub] || ''] : ['每 ' + sp.test.hold + ' 个交易日按 ' + FACTORS[sp.test.factor].name + ' 从低到高分 ' + sp.test.groups + ' 组（4.1 ¶1）', '每组等权持有到下一个调仓日；成本按最高组和最低组的换手扣', 'Rank IC：因子值排名和下一期收益排名的相关系数（4.2 ¶3）'];
    return '<div class="sec" style="padding:10px 6px 4px"><canvas id="bigc" data-big="1"></canvas><div id="readout" class="readout">在图上按住或拖动查看每天的数</div></div>' +
      '<div class="sec"><div class="sec-h">怎么算的</div><ul style="padding:0 14px 12px 30px;font-size:13px;line-height:1.8" class="ink2">' + how.filter(Boolean).map(x => '<li>' + esc(x) + '</li>').join('') + '</ul></div>' +
      (sp.code ? '<div style="padding:4px 10px 16px"><button class="btn block" onclick="go(\'stock\',{code:\'' + sp.code + '\'})">打开' + esc(SEC[sp.code].name) + '个股页</button></div>' : '');
  },
  after(p) {
    const cv = $('#bigc'); drawChart(cv, p.id);
    const mv = e => { const rc = cv.getBoundingClientRect(), x = (e.touches ? e.touches[0].clientX : e.clientX) - rc.left, f = Math.max(0, Math.min(1, (x - 4) / (rc.width - 8))); drawChart(cv, p.id, f); $('#readout').textContent = chartReadout(p.id, f); };
    cv.addEventListener('mousemove', mv); cv.addEventListener('touchmove', e => { e.preventDefault(); mv(e); }, { passive: false }); cv.addEventListener('touchstart', mv);
  }
};

// ---------- 新页面的 AI 页面上下文（全局 AI 按钮用） ----------
Object.assign(PAGE_AI, {
  learn: () => learnSeg === 'read' ? { name: '学习 · 读书', lines: BOOKS.map(b => '《' + b.title + '》' + (b.book ? doneOf(b.id) + ' / ' + b.book.leaves.length + ' 节' : b.status)).concat(['今日待复习 ' + dueCards().length + ' 张，卡点 ' + STUCK.filter(x => !x.resolved).length + ' 个']), tip: '书架上的书点进去是书的地图；「继续学习」直接进上次的小节。' } : { name: '学习 · 路线', lines: [], tip: '' },
  factorLab: () => { const r = CHARTS.flnav && CHARTS.flnav.res; return { name: '因子实验室', lines: r ? [FACTORS[FL.factor].name + '，' + poolCodes().length + ' 只，每 ' + FL.hold + ' 日调仓，' + FL.groups + ' 组', 'Rank IC 均值 ' + sgn(r.icMean, 3) + '，t ' + fx(r.t, 2) + '，ICIR ' + fx(r.icir, 2) + '，多空年化 ' + sgn(r.lsAnn * 100, 1) + '%'] : [], tip: '股票池是今天的成分，有幸存者偏差；样本短，结论只当练习。' }; },
  bookMap: p => ({ name: '书的地图 · ' + bookOf(p.id).title, lines: [], tip: '' }),
  study: p => { const L = lsOf(p.id), s = bookOf(p.id).book.sec(L.main); return { name: (L.mode === 'read' ? '读书 · ' : '听讲 · ') + secLabel(s), lines: ['第 ' + (L.step + 1) + ' / ' + stepsOf(p.id, L.main).length + ' 步'], tip: '' }; }
});
