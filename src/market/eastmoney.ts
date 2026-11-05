/**
 * 东方财富数据中心：分红送配（腾讯接口没有，2026-10-26 确认用这个）。
 *
 * `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_SHAREBONUS_DET&columns=...&filter=(SECURITY_CODE="600036")`
 *
 * 字段口径（2026-10-26 用招商银行核对）：
 * - PRETAX_BONUS_RMB：每 10 股派现（元，税前），例如 10.03 → 每股 1.003 元 = 1003 厘
 * - BONUS_IT_RATIO：每 10 股送转合计；没有时用 BONUS_RATIO（送股）+ IT_RATIO（转增）
 * - EQUITY_RECORD_DATE / EX_DIVIDEND_DATE：股权登记日、除权除息日
 * - 接口没有派息日字段，沪深 A 股的现金红利通常在除息日到账，按除息日处理（TRADING_RULES.md §5）
 * - 只取 ASSIGN_PROGRESS =「实施分配」的记录（预案、股东大会通过的还没有除权日）
 */
import type { CorporateAction } from '../engine/types';
import { toLi, type KBar } from './tencent';

export const BONUS_COLUMNS =
  'SECURITY_CODE,SECURITY_NAME_ABBR,PRETAX_BONUS_RMB,BONUS_IT_RATIO,BONUS_RATIO,IT_RATIO,EQUITY_RECORD_DATE,EX_DIVIDEND_DATE,ASSIGN_PROGRESS,IMPL_PLAN_PROFILE';

export function bonusUrl(code6: string, pageSize = 10): string {
  return (
    'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_SHAREBONUS_DET' +
    '&columns=' +
    BONUS_COLUMNS +
    '&filter=(SECURITY_CODE=%22' +
    code6 +
    '%22)&pageSize=' +
    pageSize +
    '&sortColumns=EX_DIVIDEND_DATE&sortTypes=-1'
  );
}

export interface CorporateActionRow extends CorporateAction {
  /** 方案原文，例如「10派10.03元(含税)」。 */
  plan: string;
}

const day = (s: unknown): string | null =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;

const n = (v: unknown): number => (typeof v === 'number' && v > 0 ? v : 0);

/** 解析分红送配。code 是带交易所前缀的代码（sh600036）。 */
export function parseBonus(json: unknown, code: string): CorporateActionRow[] {
  const rows = (json as any)?.result?.data;
  if (!Array.isArray(rows)) {
    return [];
  }
  const out: CorporateActionRow[] = [];
  for (const r of rows) {
    const exDate = day(r.EX_DIVIDEND_DATE);
    const recordDate = day(r.EQUITY_RECORD_DATE);
    if (r.ASSIGN_PROGRESS !== '实施分配' || !exDate || !recordDate) {
      continue;
    }
    const cash = n(r.PRETAX_BONUS_RMB);
    const bonus10 = n(r.BONUS_IT_RATIO) || n(r.BONUS_RATIO) + n(r.IT_RATIO);
    if (!cash && !bonus10) {
      continue;
    }
    out.push({
      code,
      recordDate,
      exDate,
      payDate: exDate,
      // 每 10 股 x 元 → 每股 x / 10 元 = x × 100 厘。方案最多 3 位小数（例如 10 派 0.865 元），
      // 每股就是 86.5 厘，保留 1 位小数，派息总额由引擎按持股数四舍五入到分
      cashPerShareLi: Math.round(cash * 1000) / 10,
      bonusPerShare: bonus10 / 10,
      plan: String(r.IMPL_PLAN_PROFILE ?? ''),
    });
  }
  return out;
}

// ---------- F10：公司简况、主要财务指标（AI 的 get_company_profile / get_financials，M4） ----------

/** 东方财富 F10 用「600036.SH」这种代码。 */
const secucode = (code: string) =>
  code.slice(2) + '.' + code.slice(0, 2).toUpperCase();

const F10_BASE =
  'https://datacenter.eastmoney.com/securities/api/data/v1/get?reportName=';

export function profileUrl(code: string): string {
  return (
    F10_BASE +
    'RPT_F10_BASIC_ORGINFO&columns=SECURITY_NAME_ABBR,ORG_NAME,INDUSTRYCSRC1,MAIN_BUSINESS,ORG_PROFILE,FOUND_DATE,LISTING_DATE,PROVINCE' +
    '&filter=(SECUCODE%3D%22' +
    secucode(code) +
    '%22)'
  );
}

export interface CompanyProfile {
  name: string;
  fullName: string;
  /** 证监会行业，例如「金融业-货币金融服务」。 */
  industry: string;
  mainBusiness: string;
  profile: string;
  foundDate: string | null;
  listingDate: string | null;
  province: string;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** 解析公司简况；ETF、指数没有，返回 null（接口返回「返回数据为空」）。 */
export function parseProfile(json: unknown): CompanyProfile | null {
  const r = (json as any)?.result?.data?.[0];
  if (!r) {
    return null;
  }
  return {
    name: str(r.SECURITY_NAME_ABBR),
    fullName: str(r.ORG_NAME),
    industry: str(r.INDUSTRYCSRC1),
    mainBusiness: str(r.MAIN_BUSINESS),
    profile: str(r.ORG_PROFILE),
    foundDate: day(r.FOUND_DATE),
    listingDate: day(r.LISTING_DATE),
    province: str(r.PROVINCE),
  };
}

export function financeUrl(code: string, periods: number): string {
  return (
    F10_BASE +
    'RPT_F10_FINANCE_MAINFINADATA&columns=REPORT_DATE_NAME,EPSJB,TOTALOPERATEREVE,PARENTNETPROFIT,ROEJQ,XSMLL,TOTALOPERATEREVETZ,PARENTNETPROFITTZ' +
    '&filter=(SECUCODE%3D%22' +
    secucode(code) +
    '%22)&pageNumber=1&pageSize=' +
    periods +
    '&sortColumns=REPORT_DATE&sortTypes=-1'
  );
}

/**
 * 一期主要财务指标。金额是元（接口原样，可能有小数，这里只做展示和给 AI 读，不参与记账）；
 * 银行等金融企业没有毛利率（null）。
 */
export interface FinancePeriod {
  /** 「2026中报」「2025年报」。注意报告期是累计值：中报 = 1–6 月。 */
  period: string;
  /** 基本每股收益（元）。 */
  eps: number | null;
  revenue: number | null;
  /** 归属于母公司股东的净利润。 */
  netProfit: number | null;
  /** 营收、归母净利润同比增长（%）。 */
  revenueYoy: number | null;
  netProfitYoy: number | null;
  /** 加权净资产收益率（%）、销售毛利率（%）。 */
  roe: number | null;
  grossMargin: number | null;
}

const numOrNull = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

export function parseFinance(json: unknown): FinancePeriod[] {
  const rows = (json as any)?.result?.data;
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows.map(r => ({
    period: str(r.REPORT_DATE_NAME),
    eps: numOrNull(r.EPSJB),
    revenue: numOrNull(r.TOTALOPERATEREVE),
    netProfit: numOrNull(r.PARENTNETPROFIT),
    revenueYoy: numOrNull(r.TOTALOPERATEREVETZ),
    netProfitYoy: numOrNull(r.PARENTNETPROFITTZ),
    roe: numOrNull(r.ROEJQ),
    grossMargin: numOrNull(r.XSMLL),
  }));
}

/**
 * 中证指数当前成分（因子的中证 500 / 中证 1000 股票池）：数据中心 RPT_INDEX_TS_COMPONENT，按 TYPE 分指数，
 * 2026-11-05 核对：1 = 沪深 300（300 只）、3 = 中证 500（500 只）、7 = 中证 1000（1000 只，pageSize 500 时 2 页），三者不重叠。
 * SECUCODE 是「000012.SZ」，只有沪深两市。
 */
export const INDEX_MEMBER_TYPE = { hs300: '1', zz500: '3', zz1000: '7' } as const;

export function indexMembersUrl(type: string, page: number): string {
  return (
    F10_BASE +
    'RPT_INDEX_TS_COMPONENT&columns=SECUCODE,SECURITY_CODE,SECURITY_NAME_ABBR,TYPE' +
    '&filter=(TYPE%3D%22' +
    type +
    '%22)&pageNumber=' +
    page +
    '&pageSize=500&sortColumns=SECURITY_CODE&sortTypes=1'
  );
}

/** 一页成分和总页数；代码换成 sh600036 这种。 */
export function parseIndexMembers(json: unknown): { rows: { code: string; name: string }[]; pages: number } {
  const r = (json as any)?.result;
  const data = Array.isArray(r?.data) ? r.data : [];
  const rows = data
    .map((x: any) => {
      const m = /^(\d{6})\.(SH|SZ)$/.exec(str(x?.SECUCODE));
      return m ? { code: m[2].toLowerCase() + m[1], name: str(x?.SECURITY_NAME_ABBR).replace(/\s+/g, '') } : null;
    })
    .filter((x: { code: string; name: string } | null): x is { code: string; name: string } => !!x);
  return { rows, pages: typeof r?.pages === 'number' && r.pages > 0 ? r.pages : 1 };
}

// ---------- 前复权日 K（因子股票池准备数据用） ----------

/**
 * 东方财富历史 K 线 `push2his.eastmoney.com/api/qt/stock/kline/get`，fqt=1 前复权，一次能回约 5 年（1,270 根左右）；
 * 腾讯前复权日 K 个股一次只回约 640 根，要取两段。2026-11-05 核对（中国神华、宁德时代、贵州茅台、平安银行、中微公司）：
 * 两家前复权收盘在重叠的 640 天里一致（东方财富只到分，差 0.01 元以内）；成交量东方财富是「手」，
 * 科创板也是手，腾讯科创板是股（见 volumeUnit）。secid：沪市 1.、深市 0.。
 */
export function emDailyUrl(code: string, start: string): string {
  return (
    'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=' +
    (code.startsWith('sh') ? '1.' : '0.') +
    code.slice(2) +
    '&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56&klt=101&fqt=1&beg=' +
    start.replace(/-/g, '') +
    '&end=20500101&lmt=2000'
  );
}

/** 解析成 KBar（价格换成厘，成交量换成股）。回的不是这只股票、或者没有数据时返回空。 */
export function parseEmDaily(json: unknown, code: string): KBar[] {
  const d = (json as any)?.data;
  if (!d || d.code !== code.slice(2) || !Array.isArray(d.klines)) {
    return [];
  }
  const out: KBar[] = [];
  for (const k of d.klines) {
    const [date, o, c, h, l, v] = typeof k === 'string' ? k.split(',') : [];
    const open = toLi(o);
    const close = toLi(c);
    const high = toLi(h);
    const low = toLi(l);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || open == null || close == null || high == null || low == null) {
      continue;
    }
    out.push({ date, open, close, high, low, volume: Math.round((Number(v) || 0) * 100) });
  }
  return out;
}
