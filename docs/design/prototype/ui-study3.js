/* QuantWise 原型 · 学一个小节：读书 ⇄ 听讲 同一个页面，原文预览、上下文、本节小结 */
'use strict';

function openStudy(id, sec, o) {
  o = o || {}; const L = lsOf(id);
  if (sec && sec !== L.main) { L.main = sec; L.step = 0; if (leafStatus(id, sec) === 'new') L.status[sec] = 'learning'; L.away = null; }
  if (o.mode) L.mode = o.mode;
  L.focus = o.block || null; L.ask = o.ask || null;
  if (o.ask) L.away = null;
  if (cur().name === 'study') replace('study', { id }); else go('study', { id });
}
function setMode(id, m) {
  const L = lsOf(id), th = threadOf(id), st = stepsOf(id, L.main);
  if (m === 'read') L.focus = bookOf(id).book.sec(L.main).blocks[st[Math.max(0, L.step)].b[0] - 1];
  L.mode = m; refresh(); if (m === 'lecture') { const v = $('#view'); v.scrollTop = v.scrollHeight; }
  if (m === 'lecture' && th.taught < 0 && !L.away) lecture(id, L.step);
}
SCREENS.study = {
  fab: false,
  title: p => { const L = lsOf(p.id), s = bookOf(p.id).book.sec(L.main); return esc(secLabel(s)) + '<span class="sub">' + esc(bookOf(p.id).title) + '</span>'; },
  navRight: p => { const L = lsOf(p.id); return '<span class="modesw"><button class="' + (L.mode === 'read' ? 'on' : '') + '" onclick="setMode(\'' + p.id + '\',\'read\')">读书</button><button class="' + (L.mode === 'lecture' ? 'on' : '') + '" onclick="setMode(\'' + p.id + '\',\'lecture\')">听讲</button></span>'; },
  render(p) { return lsOf(p.id).mode === 'read' ? readerHTML(p.id) : lectureHTML(p.id); },
  after(p) {
    const L = lsOf(p.id), th = threadOf(p.id), v = $('#view');
    if (L.mode === 'read') { const el = L.focus && $('#blk-' + L.focus); if (el) { v.scrollTop = el.offsetTop - 80; el.classList.add('flash'); L.focus = null; } return; }
    paintCharts(v);
    $('#tabbar').insertAdjacentHTML('beforebegin', '<div id="aicomp" class="stcomp"><div class="chips">' + chips(p.id).map(([l, f]) => '<button onclick="' + f + '">' + esc(l) + '</button>').join('') + '</div><div class="composer"><input id="stin" placeholder="不懂就问，比如「用茅台举例」" onkeydown="if(event.key===\'Enter\'&&this.value.trim()){askFree(\'' + p.id + '\',this.value.trim());this.value=\'\'}"><button class="btn lt sm" onclick="const i=$(\'#stin\');if(i.value.trim()){askFree(\'' + p.id + '\',i.value.trim());i.value=\'\'}">发送</button></div></div>');
    if (L.ask) { const q = L.ask; L.ask = null; setTimeout(() => askFree(p.id, q), 200); return; }
    if (!th.msgs.length && th.taught < 0 && !L.away && !stBusy) { setTimeout(() => lecture(p.id, L.step), 250); }
  }
};
function lectureHTML(id) {
  const L = lsOf(id), th = threadOf(id), bk = bookOf(id).book, st = stepsOf(id, L.main);
  let h = '<div class="sthead"><div class="stepsbar">' + st.map((s, i) => '<button class="' + (i === L.step && th.taught >= 0 ? 'cur' : i <= th.taught ? 'done' : '') + (th.skipped.includes(i + 1) ? ' skip' : '') + '" onclick="if(!stBusy)lecture(\'' + id + '\',' + i + ',\'从第 ' + (i + 1) + ' 步讲\')"><i></i><span>' + (i + 1) + ' · ' + esc(s.t) + '</span></button>').join('') + '</div>';
  h += '<div class="seen" onclick="openCtx(\'' + id + '\')"><span>AI 现在看到</span><b>' + esc(L.main) + ' 原文</b>' + (th.loaded.length > 1 ? '<b>+' + (th.loaded.length - 1) + ' 节</b>' : '') + '<b>书的地图</b><b>学习记录</b><span style="flex:1"></span><span>›</span></div>';
  if (L.detour) h += '<div class="detour">岔路 · ' + esc(secLabel(bk.sec(L.detour.sec))) + '<span style="flex:1"></span><button onclick="leaveDetour(\'' + id + '\')">回到主线</button></div>';
  h += '</div><div class="thread">';
  if (L.away && !th.msgs.length) {
    const stuck = STUCK.find(x => !x.resolved);
    h += '<div class="recap"><div class="k">距上次 ' + L.away + ' 天</div><p>上次学完了第 2 章，2.3 节讲了常见的风格因子；现在从 3.1 动量因子开始。</p>' + (stuck ? '<p>你在 ' + stuck.sec + ' 卡过一个点：' + esc(stuck.text) + '。</p>' : '') + '<p>要先把卡点弄懂吗？</p><div class="racts"><button class="btn lt sm" onclick="lsOf(\'' + id + '\').away=null;lecture(\'' + id + '\',0)">直接继续</button>' + (stuck ? '<button class="btn sm" onclick="lsOf(\'' + id + '\').away=null;enterDetour(\'' + id + '\',\'' + stuck.sec + '\',\'先讲讲：' + esc(stuck.text) + '\')">先复习卡点</button>' : '') + '</div></div>';
  }
  th.msgs.forEach((m, i) => { h += msgOf(id, m, i); });
  if (stBusy) h += '<div class="typing"><i></i><i></i><i></i></div>';
  return h + '</div>';
}
function msgOf(id, m, i) {
  const d = m.det ? ' det' : '';
  if (m.r === 'u') return '<div class="su' + d + '"><span>' + esc(m.text) + '</span></div>';
  if (m.r === 'tool') return '<div class="stool' + d + '">' + m.items.map(t => '<div>' + esc(t) + '</div>').join('') + '</div>';
  if (m.r === 'sys') return '<div class="ssys">' + esc(m.text) + '</div>';
  if (m.r === 'fold') return '<div class="sfold" onclick="threadOf(\'' + id + '\').msgs[' + i + '].open=!threadOf(\'' + id + '\').msgs[' + i + '].open;refresh();paintCharts()"><b>已解决：' + esc(m.title) + '（' + m.msgs.filter(x => x.r === 'u' || x.r === 'a').length + ' 条）</b><span>岔路 · ' + esc(m.sec) + ' ' + (m.open ? '▴' : '▾') + '</span></div>' + (m.open ? '<div class="sfoldin">' + m.msgs.map((x, k) => msgOf(id, x, -1)).join('') + '</div>' : '');
  if (m.r === 'quiz') return '<div class="squiz' + d + '"><div class="q">' + esc(m.q) + '</div>' + m.o.map((o, k) => '<button class="' + (m.picked == null ? '' : k === m.a ? 'right' : k === m.picked ? 'wrong' : '') + '" onclick="pickQuiz(\'' + id + '\',' + i + ',' + k + ')">' + esc(o) + '</button>').join('') + (m.picked != null ? '<div class="e">' + (m.picked === m.a ? '答对了。' : '不对。') + esc(m.e) + '</div>' : '') + '</div>';
  return '<div class="sa' + d + '">' + m.html + (m.chart || '') + (m.acts ? '<div class="sacts">' + m.acts.map(([l, f]) => '<button onclick="' + f + '">' + esc(l) + '</button>').join('') + '</div>' : '') + '</div>';
}

// ---------- 读书：原文重排，讲过的段落左侧细线，当前这一步浅色底，问过的段落贴便签 ----------
function readerHTML(id) {
  const L = lsOf(id), bk = bookOf(id).book, s = bk.sec(L.main), th = threadOf(id), st = stepsOf(id, L.main);
  const taught = new Set(), curB = new Set();
  st.forEach((x, i) => x.b.forEach(n => { if (i <= th.taught) taught.add(n); if (i === L.step && th.taught >= 0) curB.add(n); }));
  let h = '<div class="reader"><div class="rh">' + esc(secLabel(s)) + '</div><div class="guide" onclick="this.classList.toggle(\'open\')"><b>本节讲什么 · 前置：' + (L.main === '3.1' ? '1.1、2.1' : '无') + ' ▾</b><div>' + st.map((x, i) => (i + 1) + '. ' + esc(x.t)).join('<br>') + '</div></div>';
  s.blocks.forEach(bid => {
    const b = bk.byId[bid], cls = (taught.has(b.no) ? ' taught' : '') + (curB.has(b.no) ? ' cur' : '') + (L.hl[bid] ? ' hl' : '');
    h += '<div class="blk ' + b.type + cls + '" id="blk-' + bid + '" onclick="blockMenu(\'' + id + '\',\'' + bid + '\')">' + (b.type === 'eq' ? '<div class="eqd">' + tex(b.text) + '</div>' : b.type === 'li' ? '<span class="lim">' + esc(b.mark) + '</span>' + inl(b.text) : inl(b.text)) + '<span class="bno">¶' + b.no + '</span></div>';
    (L.pins[bid] || []).forEach(p => { h += '<div class="pin">已解决：' + esc(p) + '</div>'; });
  });
  return h + '<button class="btn lt block" style="margin:18px 0 24px" onclick="finishSection(\'' + id + '\')">读完这一节</button></div>';
}
function blockMenu(id, bid) {
  const L = lsOf(id), bk = bookOf(id).book, b = bk.byId[bid], st = stepsOf(id, L.main), k = st.findIndex(x => x.b.includes(b.no));
  const it = (l, d, f) => '<div class="row tap" onclick="closeOverlay();' + f + '"><div class="grow">' + l + '<div class="muted" style="font-size:11px">' + d + '</div></div></div>';
  sheet(label(bk, b), '<div class="quote">' + inl(b.text.slice(0, 90)) + (b.text.length > 90 ? '…' : '') + '</div>' +
    it('解释这一段', '200 字以内', "explainBlock('" + id + "','" + bid + "')") +
    it('从这里开始讲', '切到听讲，从第 ' + (k + 1) + ' 步「' + esc(st[k].t) + '」讲起', "lsOf('" + id + "').mode='lecture';lecture('" + id + "'," + k + ",'从 " + label(bk, b) + " 开始讲')") +
    it('用真实行情举例', '画图、算因子，数字都从本地日线现算', "lsOf('" + id + "').mode='lecture';realExample('" + id + "','sz300750','用真实行情解释 " + label(bk, b) + "')") +
    it(L.hl[bid] ? '取消高亮' : '高亮', '高亮会出现在笔记里', "lsOf('" + id + "').hl['" + bid + "']=!lsOf('" + id + "').hl['" + bid + "'];refresh()"));
}
function explainBlock(id, bid) {
  const L = lsOf(id), bk = bookOf(id).book, b = bk.byId[bid];
  L.mode = 'lecture'; refresh();
  respond(id, { q: '解释一下 ' + label(bk, b), text: '这一段说的是：' + plainOf(b.text).slice(0, 90) + (b.text.length > 90 ? '…' : '') + ' [[b:' + b.sec + '#' + b.no + ']]\n\n（原型：真实 App 在 200 字以内用自己的话解释这一段，要多问几轮就留在听讲里继续问。）' });
}
function openCite(id, bid) {
  const bk = bookOf(id).book, b = bk.byId[bid], s = bk.sec(b.sec), i = s.blocks.indexOf(bid);
  const near = s.blocks.slice(Math.max(0, i - 1), i + 2).map(x => { const y = bk.byId[x]; return '<div class="cq' + (x === bid ? ' on' : '') + '">' + (y.type === 'eq' ? tex(y.text) : inl(y.text)) + '</div>'; }).join('');
  sheet('原文 · ' + esc(secLabel(s)) + ' ¶' + b.no, '<div class="citebody">' + near + '</div><div style="padding:8px 14px 14px"><button class="btn block" onclick="closeOverlay();openStudy(\'' + id + '\',\'' + s.id + '\',{mode:\'read\',block:\'' + bid + '\'})">在读书模式打开</button></div>');
}
function openCtx(id) {
  const L = lsOf(id), th = threadOf(id), bk = bookOf(id).book, tok = s => fx(Math.max(0.1, s / 1000), 1) + 'k';
  const rows = [['1 讲解规则', '讲解顺序、引用和来源标记、只引用读过的原文、举例优先用真实行情', 1200, true], ['2 书的地图', bk.leaves.length + ' 个小节的目录 + 已学 ' + Object.keys(L.notes).length + ' 节的摘要', 1800, true], ['3 当前原文', secLabel(bk.sec(L.main)) + ' 全部 ' + bk.sec(L.main).blocks.length + ' 个内容块，现在讲第 ' + (L.step + 1) + ' 步', bk.sec(L.main).chars * 1.2, false], ['4 学习记录', '进度、卡点 ' + STUCK.filter(x => !x.resolved).length + ' 个、最近的问题', 300, false], ['5 按需加载', th.loaded.filter(x => x !== L.main).map(x => x).join('、') || '还没有', th.loaded.slice(1).reduce((a, x) => a + bk.sec(x).chars * 1.2, 0), false], ['6 最近对话', th.msgs.length + ' 条', th.msgs.reduce((a, m) => a + (m.plain || m.text || '').length, 0) * 0.8, false]];
  sheet('AI 现在看到了什么', rows.map(([t, d, n, c]) => '<div class="row"><div class="grow"><b>' + t + '</b>' + (c ? '<span class="ostat done" style="margin-left:6px">缓存</span>' : '') + '<div class="muted" style="font-size:12px">' + esc(d) + '</div></div><span class="n">' + tok(n) + '</span></div>').join('') +
    '<div class="row"><div class="grow"><b>工具</b><div class="muted" style="font-size:12px">读书 5 个（load_section、search_book、get_notes、propose_section_wrapup、mark_stuck）· 行情与因子 10 个（get_kline、get_quote、plot_chart、factor_test、get_factor_values…）· 听讲里不带下单、转账这类操作工具</div></div></div><div class="muted" style="font-size:11px;padding:8px 14px 14px">只有第 3、5 层里的原文能被引用，引用到别处的标「未核实」。缓存断点在第 2 层之后，同一本书反复对话很省。</div>');
}

// ---------- 本节小结：摘要、卡点、闪卡草稿，你确认后才入库，进度指针前移 ----------
const WRAP = { '3.1': { sum: '动量 = 过去 n 天的累计收益，做横截面排序用。12-1 月动量去掉最近 1 个月，因为短期会反转。两种解释：反应不足和急转弯风险。A 股中长期动量偏弱。', cards: [['动量因子 $MOM(n)$ 怎么算？用什么价格？', '$P_t / P_{t-n} - 1$，用复权价。'], ['12-1 月动量为什么去掉最近 1 个月？', '最近一个月的收益往往反转，混进来会削弱信号。'], ['动量组合什么时候最容易大亏？', '市场急转弯，比如熊市末期反弹：过去跌得最多的弹得最猛。']] } };
let WD_DRAFT = null;
function finishSection(id) {
  const L = lsOf(id), th = threadOf(id), bk = bookOf(id).book, s = bk.sec(L.main), w = WRAP[L.main];
  const sum = w ? w.sum + (th.factorRes ? '示例池里 ' + FACTORS[th.factor.factor].name + ' 的 Rank IC 均值 ' + sgn(th.factorRes.icMean, 3) + '、t 值 ' + fx(th.factorRes.t, 2) + '，样本太小，不下结论。' : '') : plainOf(bk.byId[s.blocks[0]].text).slice(0, 80);
  const cards = (w ? w.cards : [[s.title + ' 讲的核心是什么？', plainOf(bk.byId[s.blocks[0]].text).slice(0, 60)]]).map(([f, b]) => ({ f, b, on: true }));
  WD_DRAFT = { id, sec: L.main, sum, cards, skipped: th.skipped.slice() };
  go('sectionDone', { id });
}
SCREENS.sectionDone = {
  title: '本节小结',
  render(p) {
    const d = WD_DRAFT, bk = bookOf(p.id).book, s = bk.sec(d.sec), nx = bk.leaves[bk.leaves.indexOf(s) + 1];
    return '<div class="sec" style="padding:14px"><div class="muted" style="font-size:12px">' + esc(secLabel(s)) + ' · AI 起草，确认后保存</div><div class="sec-h" style="padding:10px 0 6px">摘要</div><textarea class="ta" oninput="WD_DRAFT.sum=this.value">' + esc(d.sum) + '</textarea>' + (d.skipped.length ? '<div class="muted" style="font-size:12px;margin-top:6px">跳过了第 ' + d.skipped.join('、') + ' 步</div>' : '') + '</div>' +
      '<div class="sec"><div class="sec-h">卡点</div>' + (STUCK.filter(x => x.sec === d.sec).map(x => '<div class="row"><span class="sti stuck">!</span><span class="grow">' + esc(x.text) + '</span></div>').join('') || '<div class="row muted">这一节没有卡点</div>') + '</div>' +
      '<div class="sec"><div class="sec-h">闪卡草稿 <small>默认全选，不要的取消</small></div>' + d.cards.map((c, i) => '<div class="row tap" onclick="WD_DRAFT.cards[' + i + '].on=!WD_DRAFT.cards[' + i + '].on;refresh()"><span class="bx' + (c.on ? ' on' : '') + '">' + (c.on ? '✓' : '') + '</span><div class="grow"><div>' + inl(c.f) + '</div><div class="muted" style="font-size:12px">' + inl(c.b) + '</div></div></div>').join('') + '</div>' +
      '<div style="padding:6px 10px 16px"><button class="btn lt block" onclick="saveSection()">保存' + (nx ? '，学下一节：' + esc(secLabel(nx)) : '') + '</button></div>';
  }
};
function saveSection() {
  const d = WD_DRAFT, L = lsOf(d.id), bk = bookOf(d.id).book, s = bk.sec(d.sec), nx = bk.leaves[bk.leaves.indexOf(s) + 1];
  const n = L.notes[d.sec] || (L.notes[d.sec] = { sum: '', qa: [] }); n.sum = d.sum;
  L.status[d.sec] = STUCK.some(x => x.sec === d.sec && !x.resolved) ? 'stuck' : 'done';
  const add = d.cards.filter(c => c.on); add.forEach(c => CARDS.push({ id: CARDS.length + 1, book: d.id, sec: d.sec, front: c.f, back: c.b, box: 1, due: 1 }));
  showToast('已保存：摘要 + ' + add.length + ' 张闪卡' + (nx ? '，进度移到 ' + nx.id : ''));
  if (nx) { L.main = nx.id; L.step = 0; L.status[nx.id] = 'learning'; replace('study', { id: d.id }); } else back();
}
