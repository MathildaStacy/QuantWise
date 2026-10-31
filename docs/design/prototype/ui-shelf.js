/* QuantWise 原型 · 学习 Tab 的「读书」：书架、导入与解析、书的地图、复习、笔记、读书设置 */
'use strict';

// ---------- 示例学习记录：学完了第 1、2 章，正在学 3.1，距上次 3 天 ----------
function seedBooks() {
  const L = lsOf('sample');
  ['c1', '1.1', '1.2', '1.3', '1.4', '2.1', '2.2', '2.3'].forEach(s => { L.status[s] = 'done'; });
  L.status['2.2'] = 'stuck'; L.status['3.1'] = 'learning'; L.main = '3.1'; L.step = 0; L.away = 3;
  const N = (sum, qa) => ({ sum, qa: qa || [] });
  L.notes = {
    '1.1': N('简单收益连乘、对数收益相加；组合用简单收益，时间序列统计用对数收益。算收益要用复权价。', [['为什么组合收益不能用对数收益加权？', '组合收益等于各股简单收益按权重加权；对数收益没有这个性质，只能在时间上相加。']]),
    '1.2': N('波动率是收益的标准差；日波动 × √252 得年化，前提是每天收益独立同分布。'),
    '1.3': N('回撤是相对历史高点的跌幅，和路径有关；跌 50% 要涨 100% 才回本。'),
    '1.4': N('夏普 = 超额收益 / 波动；估计误差很大，一年数据的标准误约为 1。', [['夏普 1.5 只有一年数据靠谱吗？', '不靠谱：标准误约 1，真实夏普可能接近 0（1.4 ¶4）。']]),
    '2.1': N('因子研究是横截面比较：同一天里哪些股票相对更好。有效的解释：风险补偿或行为偏差。'),
    '2.2': N('原始因子值先去极值（MAD）再标准化（z-score 或排序）。'),
    '2.3': N('价量、基本面、规模三类；后面用价量因子举例，只需要日线。')
  };
  STUCK = [{ book: 'sample', sec: '2.2', text: 'MAD 去极值里的 1.4826 是怎么来的', resolved: false }];
  const C = (sec, front, back, box, due) => ({ id: CARDS.length + 1, book: 'sample', sec, front, back, box, due });
  CARDS = [];
  [['1.1', '多日的简单收益怎么累加？对数收益呢？', '简单收益连乘：$R = \\prod_t (1 + r_t) - 1$；对数收益直接相加。', 2, 0],
   ['1.1', '为什么计算收益要用复权价格？', '分红送股时价格除权下跳，不复权会把这一跳当成亏损。', 3, 0],
   ['1.2', '日波动率怎么换算成年化？前提是什么？', '乘以 $\\sqrt{252}$；前提是每天的收益独立、分布相同。', 1, 0],
   ['1.3', '跌 50% 之后要涨多少才能回本？', '100%。回撤是不对称的。', 2, 0],
   ['1.4', '只有一年数据时，年化夏普的标准误大约是多少？', '约 1：一年夏普 1.5 的策略，真实夏普可能接近 0。', 1, 0],
   ['2.1', '因子研究回答的是什么问题？', '横截面：同一天这些股票里哪些相对更好；不回答大盘涨不涨。', 2, 0],
   ['2.2', '排序标准化比 z-score 好在哪？', '结果落在 0 到 1 之间，对极端值不敏感。', 3, 3],
   ['2.3', '为什么后面的例子用价量因子？', '只需要日线，在手机上就能算。', 2, 2]].forEach(a => CARDS.push(C(...a)));
}
seedBooks();

// ---------- 学习 Tab：读书 | 路线 ----------
let learnSeg = 'read';
const _routeRender = SCREENS.learn.render;
SCREENS.learn.render = function () {
  return '<div class="lseg"><button class="' + (learnSeg === 'read' ? 'on' : '') + '" onclick="learnSeg=\'read\';refresh()">读书</button><button class="' + (learnSeg === 'route' ? 'on' : '') + '" onclick="learnSeg=\'route\';refresh()">路线</button></div>' + (learnSeg === 'read' ? shelfHTML() : _routeRender.call(this));
};
const dueCards = () => CARDS.filter(c => c.due <= 0);
const doneOf = id => { const bk = bookOf(id).book; return bk.leaves.filter(s => ['done', 'stuck'].includes(leafStatus(id, s.id))).length; };
function shelfHTML() {
  const L = lsOf('sample'), s = SAMPLE.sec(L.main), st = stepsOf('sample', L.main), stuck = STUCK.find(x => !x.resolved);
  let h = '<div class="cont" onclick="openStudy(\'sample\')"><div class="k">继续学习' + (L.away ? ' · 距上次 ' + L.away + ' 天' : '') + '</div><div class="t">' + esc(secLabel(s)) + '</div><div class="s">《' + esc(SAMPLE.meta.title) + '》· 第 ' + (L.step + 1) + ' / ' + st.length + ' 步' + (stuck ? ' · 上次卡在：' + esc(stuck.text) : '') + '</div><div class="pbar"><i style="width:' + (doneOf('sample') / SAMPLE.leaves.length * 100) + '%"></i></div><div class="go">继续 ›</div></div>';
  h += '<div class="qtools">' + [['review', '复', '复习', '今日 ' + dueCards().length + ' 张'], ['factorLab', 'IC', '因子实验', '4 个因子'], ['notes', '记', '笔记', Object.keys(L.notes).length + ' 节'], ['importBook()', '+', '导入', 'PDF/EPUB/MD']].map(([k, i, l, d]) => '<button onclick="' + (k.endsWith(')') ? k : "go('" + k + "')") + '"><i>' + i + '</i><b>' + l + '</b><small>' + d + '</small></button>').join('') + '</div>';
  h += '<div class="sec"><div class="sec-h">书架 <small>' + BOOKS.length + ' 本</small></div>' + BOOKS.map(bookRow).join('') + '</div>';
  return h + '<div class="muted" style="font-size:11px;padding:4px 14px 16px">只学你自己拥有的书。PDF 在你确认后上传到 MinerU 解析；讲解时当前小节的原文会发给你配置的 AI 服务。</div>';
}
function bookRow(b) {
  const right = b.status === 'ready' ? (b.book ? doneOf(b.id) + ' / ' + b.book.leaves.length + ' 节' : '已解析') : b.status === 'parsing' ? '解析中 ' + Math.round(b.prog) + '%' : '';
  return '<div class="row tap" onclick="' + (b.status === 'parsing' ? "go('parse',{id:'" + b.id + "'})" : "go('bookMap',{id:'" + b.id + "'})") + '"><div class="cover" style="background:' + b.color + '">' + esc(b.mark) + '</div><div class="grow"><div style="font-weight:600">' + esc(b.title) + '</div><div class="muted" style="font-size:12px">' + esc(b.author) + ' · ' + b.fmt + ' · ' + b.from + '</div></div><span class="muted" style="font-size:12px">' + right + '</span><span class="chev"></span></div>';
}

// ---------- 导入 ----------
function importBook() {
  sheet('导入一本书', '<div class="pick" onclick="closeOverlay();go(\'importSettings\')"><b>PDF</b><span>MinerU 精准解析：公式转 LaTeX、表格、扫描版 OCR，每个内容块带页码。需要 MinerU Token，书会上传到 MinerU。</span></div>' +
    '<div class="pick" onclick="closeOverlay();modal({title:\'EPUB\',cancel:false,ok:\'知道了\',body:\'<div class=ink2 style=font-size:13px>App 在本机解压 EPUB，按 OPF / nav 目录切章节，不上传。原型读不了 EPUB，可以用 Markdown 体验本地导入。</div>\'})"><b>EPUB</b><span>本机解析目录和章节，不上传。</span></div>' +
    '<label class="pick"><b>Markdown</b><span>本机解析，按「第 n 章」「3.1」这样的编号切章节，公式写成 $…$ / $$…$$。原型可以选一个真的 .md 文件试试。</span><input type="file" accept=".md,.markdown,.txt" style="display:none" onchange="importMd(this.files[0])"></label>');
}
function importMd(f) {
  if (!f) return; closeOverlay();
  f.text().then(t => {
    const bk = parseBook(t, f.name.replace(/\.\w+$/, ''));
    if (!bk.leaves.length) return showToast('没有切出小节：标题要用 # / ## 开头');
    const id = 'md' + BOOKS.length; BOOKS.push({ id, title: bk.meta.title || f.name.replace(/\.\w+$/, ''), author: bk.meta.author || '本地文件', fmt: 'Markdown', from: '导入', status: 'ready', book: bk, color: '#6B5B95', mark: 'MD' });
    showToast('已导入：' + bk.secs.length + ' 个标题，' + bk.leaves.length + ' 个小节'); go('bookMap', { id });
  });
}
const IMP = { model: 'vlm', from: 1, confirm: true };
SCREENS.importSettings = {
  title: '解析设置',
  render() {
    const opt = (k, v, l, d) => '<div class="row tap" onclick="IMP.' + k + '=\'' + v + '\';refresh()"><span class="radio' + (IMP[k] === v ? ' on' : '') + '"></span><div class="grow">' + l + '<div class="muted" style="font-size:11px">' + d + '</div></div></div>';
    return '<div class="sec" style="padding:14px;display:flex;gap:12px"><div class="cover" style="background:#7A4E2D;width:44px;height:58px">PDF</div><div class="grow"><div style="font-weight:600">因子投资讲义.pdf</div><div class="muted" style="font-size:12px;line-height:1.7">418 页 · 36.2 MB · 有文字层（不需要 OCR）<br>PDF 书签 52 条 · SHA-256 3f9a…c21e（没有导入过）</div></div></div>' +
      '<div class="sec"><div class="sec-h">解析模型</div>' + opt('model', 'vlm', 'vlm（默认）', '公式、表格和复杂排版更准') + opt('model', 'pipeline', 'pipeline', '更快，适合文字为主的书') + '</div>' +
      '<div class="sec"><div class="row"><div class="grow">优先解析<div class="muted" style="font-size:11px">先解析你要读的部分，就绪的章节马上能学</div></div>从第 <div class="fld" style="width:64px;height:30px;margin:0 6px"><input value="' + IMP.from + '" oninput="IMP.from=this.value"></div> 页</div><div class="row"><span class="grow">单片限制</span><span class="muted" style="font-size:12px">≤ 600 页 / 200 MB，这本不用拆</span></div><div class="row"><span class="grow">今日额度（高优先级）</span><span class="n">0 / 2000 页</span></div><div class="row tap" onclick="go(\'mineru\')"><span class="grow">MinerU Token</span><span class="muted" style="font-size:12px">已保存 · 2026-12-31 到期</span><span class="chev"></span></div></div>' +
      '<div class="note warn" style="margin:10px">确认后，这本书会上传到 MinerU 服务器解析。结果（Markdown、内容块、图片）存在本机，之后阅读、讲解、搜索都不再联网解析。</div>' +
      '<div style="padding:4px 10px 16px"><button class="btn lt block" onclick="startParse()">上传并解析</button></div>';
  }
};
const PARSE_STAGES = ['计算 SHA-256', '申请上传地址', '上传 36.2 MB', 'MinerU 解析（vlm）', '下载结果包', '切章节、建全文索引', '和 PDF 书签核对'];
function startParse() { const id = 'pdf1'; if (!bookOf(id)) BOOKS.push({ id, title: '因子投资讲义', author: '你的 PDF', fmt: 'PDF', from: 'MinerU', status: 'parsing', prog: 0, book: null, color: '#7A4E2D', mark: 'PDF' }); replace('parse', { id }); }
SCREENS.parse = {
  title: '解析进度',
  tick(p) { const b = bookOf(p.id); if (b.status !== 'parsing') return; b.prog = Math.min(100, b.prog + 3.2); if (b.prog >= 100) { b.status = 'ready'; showToast('解析完成：9 章 47 节，2 处和书签不一致'); } refresh(); },
  render(p) {
    const b = bookOf(p.id), k = Math.min(PARSE_STAGES.length, Math.floor(b.prog / 100 * PARSE_STAGES.length));
    return '<div class="sec" style="padding:14px"><div style="font-weight:600">' + esc(b.title) + '</div><div class="pbar" style="margin:10px 0 6px"><i style="width:' + b.prog + '%"></i></div><div class="muted" style="font-size:12px">' + (b.status === 'ready' ? '完成 · 418 页 · 用了 418 页额度' : Math.round(b.prog) + '% · 可以离开这个页面，回来接着看') + '</div></div>' +
      '<div class="sec">' + PARSE_STAGES.map((t, i) => '<div class="row"><span class="stx ' + (i < k ? 'ok' : i === k && b.status === 'parsing' ? 'run' : '') + '">' + (i < k ? '✓' : i === k && b.status === 'parsing' ? '…' : '') + '</span><span class="grow">' + t + '</span></div>').join('') + '</div>' +
      (b.status === 'ready' ? '<div style="padding:10px"><button class="btn lt block" onclick="replace(\'bookMap\',{id:\'' + b.id + '\'})">看书的地图</button></div>' : '<div class="muted" style="font-size:12px;padding:6px 14px">失败的片可以单独重试；Token 过期、额度不足、文件超限都会写明原因和处理办法。</div>');
  }
};
