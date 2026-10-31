/* QuantWise 原型 · 听讲：本节路线图、讲解脚本、引用校验、来源标记、真实行情举例、因子检验、岔路 */
'use strict';

// 本节路线图（App 里由整理模型生成，校验块范围连续不重叠，不通过就按段落平均切）
const STEPS = { sample: { '3.1': [{ t: '动量的直觉和定义', b: [1, 2] }, { t: '为什么去掉最近 1 个月', b: [3] }, { t: '两种解释：反应不足和风险', b: [4] }, { t: 'A 股的情况', b: [5] }] } };
function stepsOf(id, sec) {
  if (STEPS[id] && STEPS[id][sec]) return STEPS[id][sec];
  const L = lsOf(id); if (L.steps[sec]) return L.steps[sec];
  const bk = bookOf(id).book, s = bk.sec(sec), n = s.blocks.length, k = Math.max(1, Math.min(4, Math.ceil(n / 2))), out = [];
  let from = 0;
  for (let i = 0; i < k && from < n; i++) {
    let to = i === k - 1 ? n : Math.round((i + 1) * n / k);
    while (to < n && bk.byId[s.blocks[to]].type === 'eq') to++; // 公式和它前面的说明不拆开
    if (to <= from) continue;
    const b = []; for (let j = from; j < to; j++) b.push(j + 1);
    out.push({ t: plainOf(bk.byId[s.blocks[from]].text).replace(/[：:，,。].*$/, '').slice(0, 14) || '第 ' + (i + 1) + ' 步', b });
    from = to;
  }
  return (L.steps[sec] = out);
}

// ---------- 讲解脚本（只有 3.1 写了完整讲解；真实 App 由模型按讲解规则生成） ----------
const LECT = { '3.1': [
  { load: ['1.1', '2.1'], text: String.raw`先说直觉：**过去一段时间涨得多的股票，接下来是不是还会相对涨得多？**动量（momentum）把这个问题量化成一个数：过去 $n$ 天累计涨了多少 [[b:3.1#1]]。

$$MOM_{i,t}(n) = \frac{P_{i,t}}{P_{i,t-n}} - 1$$

$P_{i,t}$ 是股票 $i$ 在第 $t$ 天的收盘价 [[b:3.1#2]]，要用复权价：不复权的话，分红除权那一跳会被当成下跌 [[b:1.1#7]]。

动量是拿来做**横截面**比较的：同一天把一篮子股票按动量排队，看排在前面的之后是不是整体更好 [[b:2.1#2]]。一只股票自己的动量是正是负，本身说明不了什么。

检查一下：同一天，A 过去 20 天涨了 8%，B 跌了 3%，全市场平均跌了 5%。按 20 日动量排，谁在前面？全市场都在跌，这个排序还有意义吗？`,
    alt: String.raw`换个说法：把动量想成「最近谁跑得快」。每个调仓日给所有股票按过去 $n$ 天的涨幅排个名次 [[b:3.1#1]]，动量因子赌的是：名次靠前的，接下来一段时间还会相对跑得快一点。它不管大盘涨跌，只管名次 [[b:2.1#2]]。`,
    quiz: { q: '同一天，A 过去 20 天涨 8%，B 跌 3%，全市场平均跌 5%。按 20 日动量，谁的因子值更高？', o: ['A', 'B', '全市场都在跌，没法比'], a: 0, e: '动量是横截面排序：全市场都跌时 A 仍排在 B 前面。因子回答的是「相对谁更好」，不回答大盘涨不涨（2.1 ¶2）。' } },
  { load: ['3.2'], text: String.raw`学术上最常见的是「12-1 月动量」：看过去 12 个月的收益，但跳过最近 1 个月 [[b:3.1#3]]。

为什么跳过？最近 1 个月的收益往往会**反转**：最近涨多了的，接下来倾向于跌回来一点 [[b:3.2#1]]。把这一个月混进动量，两个方向相反的效应互相抵消，信号就弱了 [[b:3.1#3]]。

[[derive]]用日线写出来，一个月按 21 个交易日、一年按 252 个：

$$MOM^{12-1}_{i,t} = \frac{P_{i,t-21}}{P_{i,t-252}} - 1$$

分子用 21 天前的价格，就是把最近一个月剔掉了。[[/derive]]

检查一下：一只上个月暴涨 30% 的股票，在「12 个月动量」和「12-1 月动量」里的排名会有什么不同？`,
    quiz: { q: '12-1 月动量为什么去掉最近 1 个月？', o: ['最近一个月的数据还没公布', '最近一个月的收益往往反转，混进来会削弱信号', '为了降低换手'], a: 1, e: '短期反转和中期动量方向相反，混在一起互相抵消（3.1 ¶3、3.2 ¶1）。' } },
  { load: ['1.3'], text: String.raw`动量为什么能赚钱，书里给了两种解释 [[b:3.1#4]]：

- **反应不足**（underreaction）：好消息出来，价格不是一步到位，而是慢慢涨上去，先涨的会继续涨一段。这属于「行为偏差」一类的解释 [[b:2.1#3]]。
- **风险**：动量组合在市场急转弯时会出现很深的回撤 [[b:3.1#4]]。

[[example]]比如熊市末期突然反弹：过去跌得最惨的股票往往弹得最猛。动量组合恰好做空了它们，几周内就可能亏掉过去一两年攒下的收益。[[/example]]

所以看一个因子不能只看平均收益，还要看它最差的时候有多差，也就是最大回撤 [[b:1.3#3]]。

检查一下：如果动量的收益主要是对「急转弯」的补偿，它的收益分布更可能是左偏还是右偏？`,
    quiz: { q: '下面哪种行情最可能让动量组合大亏？', o: ['牛市里平稳上涨', '熊市末期突然大反弹', '长期横盘'], a: 1, e: '反弹时过去跌得最多的股票涨得最猛，动量组合做空的正是它们（3.1 ¶4）。' } },
  { load: [], text: String.raw`最后一点很关键：在美股，12-1 月动量是最稳健的因子之一；在 A 股，中长期动量的效果弱得多，短期更接近反转 [[b:3.1#5]]。书里给的一个可能原因是 A 股个人投资者交易占比高、换手快。

书里的建议是：**拿到一个因子的结论，先用自己的数据检验一遍** [[b:3.1#5]]。这正好能在 App 里做：点「这个因子在 A 股有效吗」，我用本地日线跑一次分组回测给你看。

这一节讲完了。懂了就点「懂了，下一节」，我整理摘要和闪卡草稿给你确认。`,
    quiz: { q: '书里对 A 股中长期动量的判断是？', o: ['和美股一样稳健', '弱得多，短期更接近反转', '已经被证明完全无效'], a: 1, e: '3.1 ¶5：A 股中长期动量弱得多，短期更接近反转；结论要用自己的数据检验。' } }
] };
function genericLecture(id, sec, k) {
  const bk = bookOf(id).book, s = bk.sec(sec), st = stepsOf(id, sec)[k];
  return '第 ' + (k + 1) + ' 步：' + st.t + '。\n\n' + st.b.map(n => { const b = bk.byId[s.blocks[n - 1]]; return b.type === 'eq' ? '$$' + b.text + '$$' : (b.type === 'li' ? '- ' : '') + b.text + ' [[b:' + sec + '#' + b.no + ']]'; }).join('\n\n') +
    '\n\n（原型：这一步直接摘了原文。真实 App 由模型按讲解规则讲：先直觉，再定义和公式，再举例，最后一个检查问题。写好完整讲解的是 3.1 动量因子。）';
}

// ---------- AI 输出的标记：[[b:3.1#2]] 引用、[[derive]] 补充推导、[[example]] AI 举例、[[real]] 真实行情 ----------
const CALLOUT = { example: 'AI 举例', derive: '补充推导', real: '真实行情' };
function aiFmt(s, id, th) {
  const bk = bookOf(id).book;
  // 只能引用本轮读过的原文：所在小节不在已读列表里的引用标成「未核实」
  const cite = t => t.replace(/\[\[b:([\w.]+)#(\d+)\]\]/g, (_, sec, n) => {
    const sc = bk.sec(sec), bid = sc && sc.blocks.find(x => bk.byId[x].no === +n);
    if (!bid || (th && !th.loaded.includes(sec))) return '<span class="unv">未核实</span>';
    return '<button class="cite" onclick="openCite(\'' + id + '\',\'' + bid + '\')">' + label(bk, bk.byId[bid]) + '</button>';
  });
  const para = t => t.split(/\n{2,}/).map(p => {
    p = p.trim(); if (!p) return '';
    if (p.startsWith('$$')) return '<div class="eqd">' + tex(p.replace(/^\$\$|\$\$$/g, '')) + '</div>';
    if (/^- /.test(p)) return '<ul>' + p.split('\n').map(l => '<li>' + cite(inl(l.replace(/^- /, ''))) + '</li>').join('') + '</ul>';
    return '<p>' + cite(inl(p)) + '</p>';
  }).join('');
  return s.split(/(\[\[(?:example|derive|real)\]\][\s\S]*?\[\[\/(?:example|derive|real)\]\])/).map(part => {
    const m = part.match(/^\[\[(example|derive|real)\]\]([\s\S]*?)\[\[\/\1\]\]$/);
    return m ? '<div class="callout ' + m[1] + '"><span class="ctag">' + CALLOUT[m[1]] + '</span>' + para(m[2]) + '</div>' : para(part);
  }).join('');
}

// ---------- 对话运行时（原型：按脚本逐步出现工具调用和回答） ----------
let stBusy = false;
function threadOf(id) { const L = lsOf(id); return L.threads[L.main] || (L.threads[L.main] = { msgs: [], loaded: [L.main], taught: -1, skipped: [], factor: null, icDone: false }); }
function stRefresh() { if (cur().name === 'study') { refresh(); const v = $('#view'); v.scrollTop = v.scrollHeight; } }
function respond(id, o) {
  if (stBusy) return showToast('还在讲，稍等');
  stBusy = true;
  const L = lsOf(id), th = threadOf(id), bk = bookOf(id).book, det = !!L.detour;
  if (o.q) th.msgs.push({ r: 'u', text: o.q, det });
  const tools = (o.load || []).filter(s => !th.loaded.includes(s)).map(s => { th.loaded.push(s); const x = bk.sec(s); return 'load_section：' + secLabel(x) + '（' + x.blocks.length + ' 个内容块）'; }).concat(o.tools || []);
  const tm = tools.length ? { r: 'tool', items: [], det } : null;
  if (tm) th.msgs.push(tm);
  stRefresh();
  let i = 0;
  const next = () => {
    if (tm && i < tools.length) { tm.items.push(tools[i++]); stRefresh(); return setTimeout(next, 420); }
    const text = typeof o.text === 'function' ? o.text() : o.text;
    th.msgs.push({ r: 'a', html: aiFmt(text, id, th), plain: plainOf(text.replace(/\[\[[^\]]*\]\]/g, '')), chart: o.chart ? o.chart() : '', acts: o.acts, det });
    if (o.quiz) th.msgs.push(Object.assign({ r: 'quiz', picked: null, det }, o.quiz));
    if (o.done) o.done();
    stBusy = false; stRefresh();
  };
  setTimeout(next, 380);
}
function lecture(id, k, q, prefix) {
  const L = lsOf(id), th = threadOf(id), sc = LECT[L.main] && LECT[L.main][k];
  L.step = k; th.taught = Math.max(th.taught, k);
  respond(id, { q, load: sc ? sc.load : [], text: (prefix || '') + (sc ? sc.text : genericLecture(id, L.main, k)) });
}
