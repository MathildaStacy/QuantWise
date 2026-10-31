/* QuantWise 原型 · 书的地图、全文搜索、复习、笔记、读书设置 */
'use strict';

const ST_ICON = { done: ['●', 'done', '已学'], learning: ['◐', 'learning', '在学'], stuck: ['!', 'stuck', '有卡点'], new: ['○', 'new', '未学'] };
// 导入的 PDF 只有地图没有正文（原型里只有示例教材有正文）
const PDF_MAP = [['1', '量化投资概览', ['1.1 收益、风险与基准', '1.2 回测框架']], ['2', '因子构建', ['2.1 数据清洗与对齐', '2.2 去极值、标准化与中性化', '2.3 因子合成']], ['3', '单因子检验', ['3.1 分组与 IC', '3.2 因子衰减', '3.3 换手与容量']], ['4', '风险模型', ['4.1 协方差估计', '4.2 风格与行业因子']], ['5', '组合优化', ['5.1 均值方差', '5.2 约束与交易成本']]];
SCREENS.bookMap = {
  title: p => '书的地图<span class="sub">' + esc(bookOf(p.id).title) + '</span>',
  render(p) {
    const b = bookOf(p.id);
    if (!b.book) return '<div class="note warn" style="margin:10px">2 处和 PDF 书签不一致，标黄的请确认：可能漏识别了小节，或层级不对。</div>' + PDF_MAP.map(([no, t, kids], ci) => '<div class="sec"><div class="chap">第 ' + no + ' 章 ' + t + '</div>' + kids.map((k, i) => '<div class="row tap leaf' + ((ci === 1 && i === 2) || (ci === 3 && i === 1) ? ' flag' : '') + '" onclick="showToast(\'原型里只有示例教材有正文；真实 App 打开这一节就能读、能听讲\')"><span class="sti new">○</span><span class="grow">' + k + ((ci === 1 && i === 2) || (ci === 3 && i === 1) ? '<small class="flagt">书签有「' + (ci === 1 ? '2.4 因子正交化' : '4.3 特异风险') + '」，解析没识别到 · 补上</small>' : '') + '</span><span class="muted n" style="font-size:12px">p.' + (12 + ci * 80 + i * 24) + '</span></div>').join('') + '</div>').join('') + '<div class="muted" style="font-size:12px;padding:4px 14px 16px">还有 4 章 · 共 9 章 47 节 · 可以重命名、合并、拆分、调整层级</div>';
    const bk = b.book, L = lsOf(p.id), done = doneOf(p.id), main = bk.sec(L.main);
    let h = '<div class="sec" style="padding:14px"><div style="font-weight:600;font-size:16px">' + esc(b.title) + '</div><div class="muted" style="font-size:12px">' + esc(b.author) + ' · ' + bk.leaves.length + ' 节 · 已学 ' + done + '</div><div class="pbar" style="margin:10px 0"><i style="width:' + done / bk.leaves.length * 100 + '%"></i></div><button class="btn lt block" onclick="openStudy(\'' + p.id + '\')">继续 ' + esc(secLabel(main)) + '</button></div>';
    bk.secs.filter(s => s.level === 1).forEach(ch => {
      const leaves = bk.leaves.filter(s => s.parent === ch.id || s.id === ch.id);
      if (!leaves.length) return;
      h += '<div class="sec"><div class="chap">' + esc(secLabel(ch)) + '</div>' + leaves.map(s => { const st = ST_ICON[leafStatus(p.id, s.id)]; return '<div class="row tap leaf" onclick="openStudy(\'' + p.id + '\',\'' + s.id + '\')"><span class="sti ' + st[1] + '">' + st[0] + '</span><span class="grow">' + esc(secLabel(s)) + (L.notes[s.id] ? '<small class="muted" style="display:block;font-size:11px">' + esc(L.notes[s.id].sum.slice(0, 30)) + '…</small>' : '') + '</span><span class="muted" style="font-size:11px">' + st[2] + ' · ' + s.chars + ' 字</span></div>'; }).join('') + '</div>';
    });
    return h + '<div style="display:flex;gap:8px;padding:6px 10px 16px"><button class="btn sm" style="flex:1" onclick="go(\'notes\')">笔记</button><button class="btn sm" style="flex:1" onclick="bookSearch(\'' + p.id + '\')">全文搜索</button></div>';
  }
};
function bookSearch(id) {
  sheet('全文搜索', '<div class="fld" style="margin:0 14px 8px;height:36px"><input id="bsq" placeholder="例如：换手、IC、复权" oninput="bookSearchRun(\'' + id + '\',this.value)"></div><div id="bsr" style="max-height:360px;overflow:auto"></div>');
  setTimeout(() => $('#bsq').focus(), 30);
}
function bookSearchRun(id, q) {
  const bk = bookOf(id).book; q = q.trim();
  const hits = q ? bk.blocks.filter(b => plainOf(b.text).includes(q)).slice(0, 8) : [];
  $('#bsr').innerHTML = hits.map(b => '<div class="row tap" onclick="closeOverlay();openStudy(\'' + id + '\',\'' + b.sec + '\',{mode:\'read\',block:\'' + b.id + '\'})"><span class="cite">' + label(bk, b) + '</span><span class="grow" style="font-size:13px">' + esc(plainOf(b.text).slice(0, 60)) + '…</span></div>').join('') || (q ? '<div class="empty">没有找到「' + esc(q) + '」</div>' : '');
}

// ---------- 复习（Leitner 5 个盒子：1 / 3 / 7 / 15 / 30 天） ----------
const BOX_DAYS = [0, 1, 3, 7, 15, 30];
SCREENS.review = {
  title: '复习',
  render() {
    const due = dueCards(), box = [1, 2, 3, 4, 5].map(n => CARDS.filter(c => c.box === n).length), mx = Math.max(1, ...box);
    return '<div class="sec" style="padding:16px 14px"><div style="display:flex;align-items:flex-end;gap:14px"><div><div class="muted" style="font-size:12px">今日待复习</div><div class="n" style="font-size:34px;font-weight:600;line-height:1.1">' + due.length + '</div><div class="muted" style="font-size:12px">共 ' + CARDS.length + ' 张 · 每天上限 30</div></div><div class="boxes">' + box.map((v, i) => '<div><i style="height:' + (6 + v / mx * 44) + 'px"></i><span>' + (i + 1) + '</span></div>').join('') + '</div></div><button class="btn lt block" style="margin-top:12px"' + (due.length ? ' onclick="startReview()"' : ' disabled') + '>' + (due.length ? '开始复习' : '今天复习完了') + '</button></div>' +
      '<div class="sec"><div class="sec-h">卡点清单 <small>没完全掌握的点</small></div>' + (STUCK.length ? STUCK.map((s, i) => '<div class="row"><span class="sti stuck">!</span><div class="grow"><div' + (s.resolved ? ' style="text-decoration:line-through;color:var(--ink3)"' : '') + '>' + esc(s.text) + '</div><div class="muted" style="font-size:11px">' + esc(secLabel(bookOf(s.book).book.sec(s.sec))) + '</div></div>' + (s.resolved ? '' : '<button class="btn sm" onclick="openStudy(\'' + s.book + '\',\'' + s.sec + '\',{ask:\'' + esc(s.text).replace(/'/g, '') + '\'})">让 AI 重讲</button><button class="ib" style="width:30px;height:30px" onclick="STUCK[' + i + '].resolved=true;refresh()" aria-label="划掉">✓</button>') + '</div>').join('') : '<div class="empty">还没有卡点</div>') + '</div>' +
      '<div class="sec"><div class="sec-h">卡片 <small>按小节</small></div>' + CARDS.map(c => '<div class="row"><span class="cite">' + c.sec + '</span><span class="grow" style="font-size:13px">' + inl(c.front) + '</span><span class="muted" style="font-size:11px">盒 ' + c.box + (c.due > 0 ? ' · ' + c.due + ' 天后' : ' · 今天') + '</span></div>').join('') + '</div>';
  }
};
let RV = null;
function startReview() { RV = { q: dueCards().map(c => c.id), i: 0, flip: false, stat: { again: 0, hard: 0, good: 0 } }; go('reviewRun'); }
SCREENS.reviewRun = {
  title: () => '复习<span class="sub">' + (RV && RV.i < RV.q.length ? (RV.i + 1) + ' / ' + RV.q.length : '完成') + '</span>',
  render() {
    if (RV.i >= RV.q.length) return '<div class="sec" style="padding:24px 16px;text-align:center"><div style="font-size:18px;font-weight:600">今天复习完了</div><p class="ink2" style="margin-top:8px">记得 ' + RV.stat.good + ' · 模糊 ' + RV.stat.hard + ' · 忘了 ' + RV.stat.again + '</p>' + (RV.stat.again ? '<p class="muted" style="font-size:12px;margin-top:6px">忘了的卡回到盒子 1，对应的点加进了卡点清单。</p>' : '') + '<button class="btn lt" style="margin-top:14px" onclick="back()">返回</button></div>';
    const c = CARDS.find(x => x.id === RV.q[RV.i]), s = SAMPLE.sec(c.sec);
    return '<div class="fcard" onclick="RV.flip=true;refresh()"><div class="muted" style="font-size:11px">' + esc(secLabel(s)) + ' · 盒 ' + c.box + '</div><div class="ff">' + inl(c.front) + '</div>' + (RV.flip ? '<div class="fb">' + inl(c.back) + '</div>' : '<div class="muted" style="font-size:12px;margin-top:auto">点一下看答案</div>') + '</div>' +
      (RV.flip ? '<div class="rate"><button onclick="rate(\'again\')">忘了<small>回盒 1 · 明天</small></button><button onclick="rate(\'hard\')">模糊<small>留在盒 ' + c.box + ' · ' + BOX_DAYS[c.box] + ' 天</small></button><button class="pri" onclick="rate(\'good\')">记得<small>盒 ' + Math.min(5, c.box + 1) + ' · ' + BOX_DAYS[Math.min(5, c.box + 1)] + ' 天</small></button></div>' : '') +
      '<div style="display:flex;gap:8px;padding:8px 12px"><button class="btn sm" style="flex:1" onclick="openStudy(\'sample\',\'' + c.sec + '\',{mode:\'read\'})">回到原文</button><button class="btn sm" style="flex:1" onclick="openStudy(\'sample\',\'' + c.sec + '\',{ask:\'' + esc(plainOf(c.front)).replace(/'/g, '') + '\'})">问 AI</button></div>';
  }
};
function rate(k) {
  const c = CARDS.find(x => x.id === RV.q[RV.i]);
  if (k === 'good') c.box = Math.min(5, c.box + 1); if (k === 'again') { c.box = 1; if (!STUCK.some(s => s.text === plainOf(c.front))) STUCK.push({ book: c.book, sec: c.sec, text: plainOf(c.front), resolved: false }); }
  c.due = BOX_DAYS[c.box]; RV.stat[k]++; RV.i++; RV.flip = false; refresh();
}

// ---------- 笔记 ----------
SCREENS.notes = {
  title: '笔记',
  render() {
    const L = lsOf('sample');
    let h = '<div class="sec" style="padding:12px 14px;display:flex;align-items:center;gap:10px"><div class="grow"><div style="font-weight:600">' + esc(SAMPLE.meta.title) + '</div><div class="muted" style="font-size:12px">' + Object.keys(L.notes).length + ' 节摘要 · ' + Object.values(L.notes).reduce((a, n) => a + n.qa.length, 0) + ' 条问答 · ' + CARDS.length + ' 张闪卡</div></div><button class="btn sm" onclick="exportNotes()">导出</button></div>';
    SAMPLE.leaves.filter(s => L.notes[s.id]).forEach(s => { const n = L.notes[s.id]; h += '<div class="sec"><div class="sec-h">' + esc(secLabel(s)) + '</div><div class="nsum">' + inl(n.sum) + '</div>' + n.qa.map(([q, a]) => '<div class="nqa"><b>问：' + esc(q) + '</b><div>' + inl(a) + '</div></div>').join('') + (STUCK.filter(x => x.sec === s.id).map(x => '<div class="nqa"><span class="sti stuck">!</span> 卡点：' + esc(x.text) + (x.resolved ? '（已解决）' : '') + '</div>').join('')) + '</div>'; });
    return h;
  }
};
function exportNotes() {
  const L = lsOf('sample'), md = SAMPLE.leaves.filter(s => L.notes[s.id]).map(s => '## ' + secLabel(s) + '\n\n' + L.notes[s.id].sum + '\n' + L.notes[s.id].qa.map(([q, a]) => '\n**问：' + q + '**\n\n' + a + '\n').join('')).join('\n');
  modal({ title: '导出 Markdown', ok: '分享', cancel: '关闭', onOk: () => showToast('真实 App 用系统分享面板发出 .md 和 Anki CSV'), body: '<div class="muted" style="font-size:12px;margin-bottom:6px">每节一个文件；默认去掉大段原文引用，只留出处。另有 Anki CSV（闪卡）。</div><pre class="mdpre">' + esc(md.slice(0, 900)) + '…</pre>' });
}

// ---------- 读书设置（我的 → 读书） ----------
SCREENS.mineru = {
  title: '解析服务（MinerU）',
  render() {
    return '<div class="sec"><div class="row"><span class="grow">MinerU Token</span><span class="muted" style="font-size:12px">已保存，末 4 位 8c1d</span></div><div class="row"><span class="grow">有效期</span><span class="n">2026-12-31</span></div><div class="row"><span class="grow">默认解析模型</span><span>vlm</span></div><div class="row"><span class="grow">今日额度（高优先级）</span><span class="n">418 / 2000 页</span></div><div class="row"><span class="grow">上传前确认</span><span class="ostat done">开</span></div></div><div class="note" style="margin:10px">Token 存在 Android Keystore，不写进日志和导出文件。额度用完不会拦截，只是排队变慢。自建 MinerU 服务（书不出家门）以后再做。</div>';
  }
};
const PREF = { order: '直觉 → 公式 → 例子 → 检查题', example: 'real', quiz: 'step', term: true };
SCREENS.studyPrefs = {
  title: '讲解偏好',
  render() {
    const opt = (k, v, l, d) => '<div class="row tap" onclick="PREF.' + k + '=\'' + v + '\';refresh()"><span class="radio' + (PREF[k] === v ? ' on' : '') + '"></span><div class="grow">' + l + (d ? '<div class="muted" style="font-size:11px">' + d + '</div>' : '') + '</div></div>';
    return '<div class="sec"><div class="sec-h">讲解顺序</div><div class="row">' + PREF.order + '</div></div>' +
      '<div class="sec"><div class="sec-h">举例</div>' + opt('example', 'real', '优先用真实 A 股行情', '讲到能用价量数据说明的概念时，AI 调用画图和因子工具现算') + opt('example', 'book', '优先用书里的例子', '') + opt('example', 'ai', '可以自己编例子', '编的例子标「AI 举例」') + '</div>' +
      '<div class="sec"><div class="sec-h">检查题</div>' + opt('quiz', 'step', '每一步讲完问一个', '') + opt('quiz', 'end', '一节讲完再问', '') + opt('quiz', 'off', '不出题', '') + '</div>' +
      '<div class="sec"><div class="row tap" onclick="PREF.term=!PREF.term;refresh()"><span class="grow">术语第一次出现时中英对照</span><span class="ostat ' + (PREF.term ? 'done' : '') + '">' + (PREF.term ? '开' : '关') + '</span></div><div class="row"><span class="grow">讲解模型</span><span class="muted" style="font-size:12px">' + esc(aiSvc().model) + '</span></div><div class="row"><span class="grow">整理模型（摘要、闪卡草稿）</span><span class="muted" style="font-size:12px">同讲解模型</span></div></div>';
  }
};
