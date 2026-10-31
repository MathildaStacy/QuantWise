/* QuantWise 原型 · 听讲（续）：真实行情举例、因子检验、岔路、检查题、快捷动作 */
'use strict';

const SEC_FACTOR = { '3.1': 'mom20', '3.2': 'rev20', '3.3': 'vol20', '3.4': 'vol20', '4.1': 'mom20', '4.2': 'mom20', '4.3': 'mom20', '4.4': 'rev20' };
const SEC_SUB = { '1.2': 'vol20', '1.3': 'dd', '1.4': 'dd', '3.3': 'vol20', '3.4': 'vol20' };
const stockIn = t => Object.keys(SEC).find(c => QPOOL.includes(c) && (t.includes(SEC[c].name) || t.includes(SEC[c].sym)));

/** 用真实行情举例：画价格 + 均线 + 副图（动量 / 波动 / 回撤），标出极值，文字里的数都从同一份数据算。 */
function realExample(id, code, q) {
  const L = lsOf(id), sub = SEC_SUB[L.main] || 'mom20', s = SEC[code], k = DATA.kline[code], full = k.map(r => r[2]), off = k.length - 250, dates = k.slice(off).map(r => r[0]), close = full.slice(off);
  const arr = sub === 'vol20' ? rollVol(full, 20).slice(off) : sub === 'dd' ? drawdown(close) : mom(full, 20).slice(off);
  const vs = arr.map(v => v == null ? NaN : v), hi = vs.indexOf(Math.max(...vs.filter(isFinite))), lo = vs.indexOf(Math.min(...vs.filter(isFinite)));
  let marks, text;
  if (sub === 'dd') {
    const pk = close.slice(0, lo + 1).indexOf(Math.max(...close.slice(0, lo + 1)));
    marks = [{ date: dates[pk], label: '高点 ' + fx(close[pk], 2) }, { date: dates[lo], label: '回撤 ' + fx(vs[lo] * 100, 1) + '%', below: true }];
    text = '[[real]]' + s.name + '最近 250 个交易日的最大回撤是 **' + fx(vs[lo] * 100, 1) + '%**：从 ' + dates[pk] + ' 的 ' + fx(close[pk], 2) + ' 元跌到 ' + dates[lo] + ' 的 ' + fx(close[lo], 2) + ' 元。要回到高点得再涨 ' + fx((close[pk] / close[lo] - 1) * 100, 1) + '%，这就是回撤的不对称 [[b:1.3#4]]。[[/real]]\n\n换一段时间看，最大回撤会不一样：它和路径有关，比较两个标的要用同一段时间 [[b:1.3#3]]。';
  } else if (sub === 'vol20') {
    marks = [{ date: dates[hi], label: '波动最高 ' + fx(vs[hi] * 100, 0) + '%' }, { date: dates[lo], label: '最低 ' + fx(vs[lo] * 100, 0) + '%', below: true }];
    text = '[[real]]' + s.name + '的 20 日年化波动率在 ' + dates[hi] + ' 最高，约 **' + fx(vs[hi] * 100, 0) + '%**；' + dates[lo] + ' 最低，约 ' + fx(vs[lo] * 100, 0) + '%。年化 = 20 天日收益的标准差 × √252 [[b:1.2#3]]。[[/real]]\n\n对照上面的价格：波动最高的那段，通常也是价格变化最剧烈的那段。波动率对涨跌一视同仁 [[b:1.3#1]]。';
  } else {
    const rk = factorRank('mom20', code);
    marks = [{ date: dates[hi], label: '动量最高 ' + sgn(vs[hi] * 100, 1) + '%' }, { date: dates[lo], label: '最低 ' + sgn(vs[lo] * 100, 1) + '%', below: true }];
    text = '[[real]]' + s.name + '最近 250 个交易日里，20 日动量最高是 ' + dates[hi] + ' 的 **' + sgn(vs[hi] * 100, 1) + '%**，最低是 ' + dates[lo] + ' 的 **' + sgn(vs[lo] * 100, 1) + '%**；今天（' + dates[dates.length - 1] + '）是 ' + sgn(vs[vs.length - 1] * 100, 1) + '%，在示例池 ' + rk.n + ' 只股票里排第 ' + rk.rank + '。[[/real]]\n\n下面的柱子就是 $MOM(20)$ 每天的值 [[b:3.1#2]]。单看一只股票，它在正负之间来回摆，说明不了什么；有意义的是同一天的排名，也就是上面那个「第 ' + rk.rank + '」[[b:2.1#2]]。想看整个池子按这个排名分组后表现如何，点「这个因子在 A 股有效吗」。';
  }
  const cid = chartSpec({ kind: 'price', code, n: 250, ma: 20, sub, marks });
  respond(id, { q: q || '用真实行情举个例子', load: sub === 'dd' ? ['1.3'] : sub === 'vol20' ? ['1.2', '1.3'] : ['2.1'], tools: ['get_kline：' + s.name + ' 日 K 前复权 · 250 根', 'plot_chart：价格 + MA20 + ' + { mom20: '20 日动量', vol20: '20 日波动', dd: '回撤' }[sub]].concat(sub === 'mom20' ? ['get_factor_values：mom20 · 示例池 ' + QPOOL.length + ' 只 · ' + dates[dates.length - 1]] : []), text, chart: () => chartCard(cid, s.name + ' · ' + { mom20: '20 日动量', vol20: '20 日年化波动', dd: '回撤' }[sub], legendDot(QC.main, '收盘（前复权）') + legendDot(QC.ma, 'MA20') + legendDot(sub === 'mom20' ? QC.up : '#9DB4D8', { mom20: '20 日动量（下）', vol20: '波动（下）', dd: '回撤（下）' }[sub])) });
}

/** 这个因子在 A 股有效吗：分组回测 + Rank IC，结论按算出来的数写，不预设。 */
function factorAsk(id, q) {
  const L = lsOf(id), th = threadOf(id), fk = SEC_FACTOR[L.main] || 'mom20', f = FACTORS[fk];
  const test = { factor: fk, hold: 20, groups: 5, costBp: 0 }, r = factorTest(test), nav = chartSpec({ kind: 'factor', test }), ic = chartSpec({ kind: 'ic', test });
  CHARTS[nav].res = CHARTS[ic].res = r; th.factor = test; th.factorRes = r;
  const strong = Math.abs(r.icMean) >= 0.03, sig = Math.abs(r.t) >= 2;
  const bookLine = { mom20: '书里说 A 股中长期动量偏弱 [[b:3.1#5]]，这个小样本既证实不了，也推翻不了它。', rev20: '书里说 A 股短期更接近反转 [[b:3.1#5]]；反转因子的方向正好和动量相反 [[b:3.2#1]]。', vol20: '这对应书里说的低波动异象 [[b:3.3#1]]。' }[fk];
  const text = '用示例池 ' + r.n + ' 只股票（前复权日线 ' + r.from + ' 到 ' + r.to + '）做了一次分组回测：每 20 个交易日按「' + f.name + '」分 5 组，等权持有到下一次调仓 [[b:4.1#2]]。\n\n' +
    '[[real]]Rank IC 均值 **' + sgn(r.icMean, 3) + '**，IC 为正的比例 ' + fx(r.icPos * 100, 0) + '%，ICIR ' + fx(r.icir, 2) + '，t 值 **' + fx(r.t, 2) + '**（' + r.periods + ' 期）。最高组和最低组的多空年化收益 ' + sgn(r.lsAnn * 100, 1) + '%，最高组每期平均换掉 ' + fx(r.turnover * 100, 0) + '% 的持仓。[[/real]]\n\n' +
    '怎么读：' + (strong ? 'IC 均值的绝对值过了 0.03 这条经验线 [[b:4.2#6]]，' : 'IC 均值的绝对值没到 0.03 这条经验线 [[b:4.2#6]]，') + (sig ? 't 值超过 2，在这个样本里算显著。' : '但 t 值' + (Math.abs(r.t) < 1 ? '不到 1' : '不到 2') + '：只有 ' + r.periods + ' 期、每组 5 只左右，这么大的多空收益很可能是噪声。单期 IC 噪声很大，要看整条序列 [[b:4.2#4]]。') + bookLine + '\n\n' +
    '还要提防幸存者偏差：示例池是今天的大盘股，等于提前剔除了这一年里出过问题的股票 [[b:4.5#2]]。要更可靠的结论，去因子实验室把股票池换成沪深 300、拉长样本，再看扣费后的多空收益 [[b:4.4#3]]。';
  respond(id, { q: q || '这个因子在 A 股有效吗？', load: ['4.1', '4.2', '4.4', '4.5'].concat(fk === 'rev20' ? ['3.2'] : fk === 'vol20' ? ['3.3'] : []), tools: ['get_kline：示例池 ' + r.n + ' 只 · 日 K 前复权', 'factor_test：' + f.name + ' · 5 组 · 每 20 日调仓 · ' + r.periods + ' 期'], text,
    chart: () => chartCard(nav, '分组净值 · ' + f.name, groupLegend(5), '示例池 ' + r.n + ' 只 · 不扣费 · 前复权日线') + chartCard(ic, 'Rank IC · 每期', legendDot('#C7533A', 'IC > 0') + legendDot('#3E7C5A', 'IC < 0') + legendDot(QC.ink, '累计 IC', true), r.periods + ' 期 · 均值 ' + sgn(r.icMean, 3) + ' · t ' + fx(r.t, 2)),
    acts: [['在因子实验室打开', "FL=Object.assign(FL,{factor:'" + fk + "'});go('factorLab')"], ['IC 是什么？', "askFree('sample','IC 是什么？')"]] });
}

// ---------- 岔路：问到别的小节时读那一节的原文来答，主线不动；回到主线时折叠成一行 ----------
const DETOUR_KEYS = [[/MAD|1\.4826|去极值/, '2.2'], [/ICIR/, '4.3'], [/IC|信息系数/, '4.2'], [/复权|对数收益/, '1.1'], [/年化|√252|波动率/, '1.2'], [/回撤/, '1.3'], [/夏普/, '1.4'], [/横截面/, '2.1'], [/标准化|z-score|排序/, '2.2'], [/反转/, '3.2'], [/低波动/, '3.3'], [/换手/, '3.4'], [/分组/, '4.1'], [/幸存者|前视/, '4.5'], [/合成|多因子/, '5.1'], [/[Bb]eta|贝塔|α|alpha/, '5.2']];
const DETOUR_TEXT = {
  '2.2': String.raw`1.4826 是把 MAD 换算成标准差的系数。数据服从正态分布 $N(\mu, \sigma^2)$ 时，$|x - \mu|$ 的中位数满足 $\Phi(MAD / \sigma) = 0.75$，查表得 $MAD \approx 0.6745\sigma$，所以

$$\sigma \approx \frac{MAD}{0.6745} = 1.4826 \times MAD$$

[[derive]]于是 $m \pm 5 \times 1.4826 \times MAD$ 就相当于「中位数 ± 5 个标准差」，只是用中位数和 MAD 代替均值和标准差，不会被极端值本身带偏。[[/derive]]

这就是 2.2 节去极值那一段的意思 [[b:2.2#5]]。`,
  '4.2': String.raw`IC 是每个调仓日，因子值和下一期收益的横截面相关系数 [[b:4.2#1]]：

$$IC_t = \mathrm{corr}(f_{i,t},\ r_{i,t+1})$$

一般用 Rank IC：先把因子值和收益都换成排名再算相关，不怕极端值 [[b:4.2#3]]。刚才那张 IC 图里每根柱子就是一期的 Rank IC，单看一根噪声很大，要看整条序列的均值、为正的比例和 t 值 [[b:4.2#4]]。`
};
function enterDetour(id, sec, q) {
  const L = lsOf(id), th = threadOf(id), bk = bookOf(id).book, s = bk.sec(sec);
  L.detour = { sec, from: th.msgs.length };
  const text = DETOUR_TEXT[sec] || (secLabel(s) + ' 里是这么说的：\n\n' + s.blocks.slice(0, 2).map(b => (bk.byId[b].type === 'eq' ? '$$' + bk.byId[b].text + '$$' : bk.byId[b].text + ' [[b:' + sec + '#' + bk.byId[b].no + ']]')).join('\n\n') + '\n\n（原型：岔路直接摘了那一节的原文；真实 App 由模型读完原文再答。）');
  const stuck = STUCK.find(x => x.sec === sec && !x.resolved && /1\.4826/.test(x.text) && sec === '2.2');
  respond(id, { q, load: [sec], text, acts: stuck ? [['讲懂了，划掉这个卡点', "resolveStuck('" + sec + "')"]] : null });
}
function resolveStuck(sec) { STUCK.filter(x => x.sec === sec).forEach(x => { x.resolved = true; }); const L = lsOf('sample'); L.status[sec] = 'done'; showToast('卡点已划掉：' + secLabel(SAMPLE.sec(sec))); refresh(); }
function leaveDetour(id) {
  const L = lsOf(id), th = threadOf(id), d = L.detour; if (!d) return;
  const part = th.msgs.splice(d.from), first = part.find(m => m.r === 'u'), ans = part.filter(m => m.r === 'a').pop();
  th.msgs.push({ r: 'fold', sec: d.sec, title: first ? first.text : secLabel(bookOf(id).book.sec(d.sec)), msgs: part, open: false });
  const n = L.notes[d.sec] || (L.notes[d.sec] = { sum: '', qa: [] });
  if (first && ans) n.qa.push([first.text, ans.plain.slice(0, 120) + '（来自 ' + L.main + ' 的岔路）']);
  L.detour = null;
  const st = stepsOf(id, L.main);
  th.msgs.push({ r: 'sys', text: '回到 ' + secLabel(bookOf(id).book.sec(L.main)) + '：刚才讲到第 ' + (L.step + 1) + ' 步「' + st[L.step].t + '」' });
  if (th.taught < 0) lecture(id, 0); else stRefresh();
}

// ---------- 自由提问和快捷动作 ----------
function askFree(id, v) {
  const L = lsOf(id), th = threadOf(id);
  const code = stockIn(v);
  if (code) return realExample(id, code, v);
  if (/有效|管用|回测|检验|能赚钱/.test(v)) return factorAsk(id, v);
  if (/举例|例子|行情|画/.test(v)) return realExample(id, 'sz300750', v);
  const hit = DETOUR_KEYS.find(([re, s]) => re.test(v) && s !== L.main);
  if (hit && !L.detour) return enterDetour(id, hit[1], v);
  const st = stepsOf(id, L.main)[Math.max(0, L.step)], bk = bookOf(id).book, b = bk.byId[bk.sec(L.main).blocks[st.b[0] - 1]];
  respond(id, { q: v, text: '（原型示例回答）这一步书里的说法是：' + b.text + ' [[b:' + L.main + '#' + b.no + ']]\n\n原型只对几类问题写了回答：这个因子在 A 股有效吗、用某只股票举例（如「用茅台举例」）、IC 是什么、MAD 的 1.4826 怎么来的。真实 App 里这里是模型的回答，引用照样能跳回原文。' });
}
function chips(id) {
  const L = lsOf(id), th = threadOf(id), st = stepsOf(id, L.main), last = th.taught >= st.length - 1, out = [];
  if (L.detour) return [['回到主线', "leaveDetour('" + id + "')"], ['再举个例子', "askFree('" + id + "','举个例子')"]];
  if (th.taught < 0) out.push(['开始讲第 1 步', "lecture('" + id + "',0)"]);
  else if (last) out.push(['懂了，下一节', "finishSection('" + id + "')"]);
  else out.push(['懂了，继续', "lecture('" + id + "'," + (L.step + 1) + ",'懂了，继续')"]);
  if (th.taught >= 0) {
    out.push(['用真实行情举例', "realExample('" + id + "','sz300750')"]);
    if (SEC_FACTOR[L.main] && !th.factor) out.push(['这个因子在 A 股有效吗？', "factorAsk('" + id + "')"]);
    out.push(['考考我', "quizMe('" + id + "')"], ['换个说法', "rephrase('" + id + "')"]);
    if (L.step + 2 < st.length) out.push(['下一步熟，跳过', "skipStep('" + id + "')"]);
  }
  return out.concat([['看原文', "setMode('" + id + "','read')"]]);
}
function rephrase(id) { const L = lsOf(id), sc = LECT[L.main] && LECT[L.main][L.step]; respond(id, { q: '换个说法', text: sc && sc.alt ? sc.alt : '换个角度：' + plainOf(stepsOf(id, L.main)[L.step].t) + '这一步，抓住一句话就够了。' + '（原型：只有 3.1 第 1 步写了换个说法。）' }); }
/** 「这步熟，跳过」：跳过下一步，用一句话交代它讲什么，接着讲再下一步；小结里标出跳过的步骤。 */
function skipStep(id) {
  const L = lsOf(id), th = threadOf(id), st = stepsOf(id, L.main), k = L.step + 1, bk = bookOf(id).book, b = bk.byId[bk.sec(L.main).blocks[st[k].b[0] - 1]];
  th.skipped.push(k + 1);
  lecture(id, k + 1, '这步熟，跳过', '好，跳过第 ' + (k + 1) + ' 步「' + st[k].t + '」，一句话：' + plainOf(b.text).slice(0, 50) + '… [[b:' + L.main + '#' + b.no + ']]\n\n');
}
function quizMe(id) {
  const L = lsOf(id), sc = LECT[L.main] && LECT[L.main][L.step];
  const qz = sc && sc.quiz ? sc.quiz : (() => { const c = CARDS.find(x => x.sec === L.main) || CARDS[0]; return { q: plainOf(c.front), o: [plainOf(c.back), '和书里说的相反', '书里没讲'], a: 0, e: '出处见 ' + c.sec + '。（原型：只有 3.1 写了检查题，这里拿闪卡凑了一道。）' }; })();
  respond(id, { q: '考考我', text: '好，一道题：', quiz: qz });
}
function pickQuiz(id, mi, k) {
  const th = threadOf(id), m = th.msgs[mi]; if (m.picked != null) return;
  m.picked = k; stRefresh();
  if (k !== m.a) setTimeout(() => respond(id, { text: '换个角度再讲一次：' + m.e + '\n\n要把这一点记成卡点吗？', acts: [['记成卡点', "STUCK.push({book:'" + id + "',sec:lsOf('" + id + "').main,text:'" + m.q.replace(/'/g, '') + "',resolved:false});showToast('已记成卡点，复习页能看到')"]] }), 200);
}
