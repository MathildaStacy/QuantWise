/**
 * 行情与因子工具的定义（QUANTWISE_DESIGN.md §8），执行在 quant.ts。单独一个文件：defs.ts 要引用它，
 * 不能把行情客户端、数据库这些执行时的依赖带进来。
 */
import { SUB_NAME } from '../../quant/charts';
import { FACTOR_IDS, FACTORS } from '../../quant/factors';
import type { ToolDef } from '../protocol';

const CODE = {
  type: 'string',
  description: '证券代码（sh600036 / 600036）或名称（招商银行）',
};
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const FACTOR = {
  type: 'string',
  enum: FACTOR_IDS,
  description: FACTOR_IDS.map(f => f + ' ' + FACTORS[f].name).join('；'),
};
const UNIVERSE = {
  type: 'string',
  enum: ['sample', 'watch', 'hs300'],
  description: 'sample 示例池 25 只大盘股（随时可用）/ watch 自选 + 持仓 / hs300 沪深 300 当前成分（要用户先在因子实验室准备数据）',
};

/** 按名字排序；AI 助手和伴读都用这一份。 */
export const QUANT_TOOL_DEFS: ToolDef[] = [
  {
    name: 'factor_test',
    description:
      '因子分组回测和 Rank IC（本地前复权日线，口径见结果）：每 hold 个交易日按因子从低到高分组、等权持有，算 IC 均值、ICIR、t 值、各组收益、多空年化、换手，界面画分组净值和 IC 图。用户问某个因子在 A 股有没有效时用，结论按 t 值和期数说，样本不够就说不够。',
    schema: obj(
      {
        factor: FACTOR,
        universe: UNIVERSE,
        codes: { type: 'array', items: { type: 'string' }, description: '自定义股票池（代码，最多 300 只）；给了就不看 universe' },
        hold: { type: 'integer', enum: [5, 10, 20, 60], description: '调仓周期（交易日），默认 20' },
        groups: { type: 'integer', enum: [3, 5, 10], description: '分几组，默认 5' },
        cost_bp: { type: 'integer', description: '单边成本（万分之），0–50，默认 0' },
      },
      ['factor'],
    ),
  },
  {
    name: 'get_factor_values',
    description: '某天股票池里的因子值排名（默认最近一个交易日）：前后各 n 只；给了 code 时写明它排第几。',
    schema: obj(
      {
        factor: FACTOR,
        universe: UNIVERSE,
        code: CODE,
        date: { type: 'string', description: 'YYYY-MM-DD，不给 = 最近一个交易日' },
        n: { type: 'integer', description: '前后各几只，默认 5，最多 20' },
      },
      ['factor'],
    ),
  },
  {
    name: 'plot_chart',
    description:
      '在对话里画一张真实行情图（前复权日 K）：价格 + 可选均线、布林带、副图（mom20 / mom60 20、60 日动量，vol20 20 日年化波动，dd 回撤，rsi14，volume 成交量），可标出副图的最高最低点；compare 给 1–4 只代码时改成起点 = 100 的对比图。讲到某一段行情（「9 月」「这波上涨」）时用 focus 标出那段：图上高亮、自动缩放到区间附近，区间两端（前收那天和最后一天）的收盘和副图值自动标在图上，摘要给出区间涨跌、最高最低和副图起止值；区间里另外要讲的某一天用 points；takeaway 写一句看点。讲概念举例时用，回答里的数字以返回的摘要为准。',
    schema: obj(
      {
        code: CODE,
        bars: { type: 'integer', description: '画多少根，20–750；不给时默认 250，给了 focus 时按区间自动取（区间前后留出对比）' },
        end: { type: 'string', description: 'YYYY-MM-DD，图的最后一天（默认最新）；讲过去某段行情、又不想标区间时用' },
        ma: { type: 'integer', description: '均线天数，5–120' },
        band: { type: 'boolean', description: '画 20 日布林带' },
        sub: { type: 'string', enum: Object.keys(SUB_NAME) },
        marks: { type: 'boolean', description: '标出副图（没有副图时是价格）的最高、最低点' },
        focus: {
          type: 'array',
          maxItems: 2,
          items: obj(
            {
              from: { type: 'string', description: 'YYYY-MM-DD；整月写 YYYY-MM' },
              to: { type: 'string', description: 'YYYY-MM-DD；整月写 YYYY-MM（例如 9 月：from 和 to 都写 2026-09）' },
              label: { type: 'string', description: '区间名，6 字以内，例如「9 月」「急跌段」；不给按日期起名' },
            },
            ['from', 'to'],
          ),
          description: '要讲的时间段，最多 2 段（例如「8 月 vs 9 月」）：区间涨跌 = 区间最后一天收盘 ÷ 区间前一个交易日收盘 − 1',
        },
        points: {
          type: 'array',
          maxItems: 3,
          items: obj(
            {
              date: { type: 'string', description: 'YYYY-MM-DD' },
              label: { type: 'string', description: '8 字以内，写事件（「放量下跌」「政策发布」），不写数字；日期 App 会加' },
            },
            ['date', 'label'],
          ),
          description: '在收盘线上标出某几天，最多 3 个；摘要给出那天的收盘和当日涨跌',
        },
        takeaway: { type: 'string', description: '看点：一句话告诉读者这张图看哪里（24 字以内，不写价格和涨跌幅，这些图上会算好），显示在图的上方' },
        compare: { type: 'array', items: { type: 'string' }, description: '一起对比的代码或名称（最多 4 只）；对比图也能用 focus、takeaway' },
      },
      ['code'],
    ),
  },
];

export const QUANT_TOOLS = new Set(QUANT_TOOL_DEFS.map(t => t.name));
