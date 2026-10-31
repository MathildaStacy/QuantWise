/* 模拟器走查用的本地「模型」：Anthropic Messages 协议（流式 SSE），按提问返回固定的讲解和工具调用。
 * 只用于开发验证，不进 App。用法：node scripts/mock-ai.cjs，App 里服务地址填 http://10.0.2.2:8787 */
const http = require('node:http');

const sse = (res, events) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const e of events) {
    res.write('event: ' + e.type + '\ndata: ' + JSON.stringify(e) + '\n\n');
  }
  res.end();
};
const usage = { input_tokens: 1200, cache_read_input_tokens: 3000, cache_creation_input_tokens: 0, output_tokens: 180 };
const start = { type: 'message_start', message: { model: 'mock-sonnet', content: [], usage } };
const stop = r => [{ type: 'message_delta', delta: { stop_reason: r }, usage: { output_tokens: 180 } }, { type: 'message_stop' }];
const text = t => [
  start,
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  ...t.match(/[\s\S]{1,24}/g).map(x => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: x } })),
  { type: 'content_block_stop', index: 0 },
  ...stop('end_turn'),
];
let n = 0;
const tool = (name, input) => [
  start,
  { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_' + ++n, name, input: {} } },
  { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } },
  { type: 'content_block_stop', index: 0 },
  ...stop('tool_use'),
];

const LECTURE = '先说直觉：**过去一段时间涨得多的股票，接下来是不是还会相对涨得多？**动量（momentum）把这个问题量化成过去 $n$ 天的累计收益 [[b:3.1#1]]：\n\n$$MOM_{i,t}(n) = \\frac{P_{i,t}}{P_{i,t-n}} - 1$$\n\n$P_{i,t}$ 要用复权价 [[b:3.1#2]]。动量是拿来做横截面比较的：同一天把一篮子股票按动量排队 [[b:2.1#2]]。\n\n[[example]]A 过去 20 天涨 8%，B 跌 3%：同一天 A 的动量排在 B 前面。[[/example]]\n\n检查一下：全市场都在跌时，这个排序还有意义吗？';

http
  .createServer((req, res) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      if (req.url.includes('/models')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ data: [{ id: 'mock-sonnet', display_name: 'Mock Sonnet', type: 'model' }] }));
      }
      const j = JSON.parse(body || '{}');
      const last = (j.messages ?? [])[j.messages?.length - 1] ?? {};
      const parts = Array.isArray(last.content) ? last.content : [{ type: 'text', text: String(last.content ?? '') }];
      const q = parts.map(p => p.text ?? '').join('\n');
      const results = parts.filter(p => p.type === 'tool_result').map(p => JSON.stringify(p.content));
      console.log(new Date().toISOString(), 'tools=' + (j.tools ?? []).length, results.length ? 'tool_result' : q.split('\n').pop().slice(0, 60));
      if (results.length) {
        const r = results.join('\n');
        if (/Rank IC/.test(r)) {
          const ic = /Rank IC 均值 ([+-]?[\d.]+)/.exec(r)?.[1];
          const t = /t 值 ([+-]?[\d.]+)/.exec(r)?.[1];
          return sse(res, text('[[real]]示例池上 20 日动量的 Rank IC 均值 ' + ic + '，t 值 ' + t + '。[[/real]]\n\n' + (Math.abs(Number(t)) < 2 ? 't 值不到 2：样本太少，不能下结论 [[b:3.1#5]]。' : 't 值超过 2，在这个样本里显著。') + '股票池是当前成分，有幸存者偏差。'));
        }
        return sse(res, text('[[real]]' + (/20 日动量：最高 ([^（]+)（([\d-]+)）/.exec(r)?.slice(1).join('，') ?? '图已画好') + '。[[/real]]\n\n单看一只股票的动量说明不了什么，要看同一天的排名 [[b:2.1#2]]。'));
      }
      if (/真实/.test(q)) {
        return sse(res, tool('plot_chart', { code: 'sz300750', bars: 250, ma: 20, sub: 'mom20', marks: true }));
      }
      if (/有效/.test(q)) {
        return sse(res, tool('factor_test', { factor: 'mom20', universe: 'sample', hold: 20, groups: 5 }));
      }
      if (/小结/.test(q)) {
        return sse(res, tool('propose_section_wrapup', { summary: '动量 = 过去 n 天的累计收益，做横截面排序用；A 股中长期动量偏弱。', stuck: [], cards: [{ front: '动量因子怎么算？', back: 'P(t) / P(t−n) − 1，用复权价' }] }));
      }
      return sse(res, text(LECTURE));
    });
  })
  .listen(8787, () => console.log('mock AI on http://localhost:8787'));
