import type { NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { OrderKind } from '../../engine/types';
import type { ChartData } from '../../quant/charts';
import type { ConceptId, ResearchDraft } from '../../learning/types';
import type { QuizMode } from '../../learning/progress';

export type TabParamList = {
  Watch: undefined;
  Market: undefined;
  Trade: undefined;
  Learn: undefined;
  Me: undefined;
};

/** 下单页的 4 个分段：买入 / 卖出 / 撤单 / 持仓。 */
export type OrderSide = 'B' | 'S' | 'C' | 'P';

export type OrdersTab = 'today' | 'fills' | 'hist' | 'ledger';

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList> | undefined;
  /** name / type 是从列表带过来的，行情到之前先显示。 */
  Stock: { code: string; name?: string; type?: string };
  /** pick：从下单页进来选证券，选中后带着代码回到下单页。 */
  Search: { pick?: { side: 'B' | 'S'; kind?: OrderKind } } | undefined;
  WatchEdit: undefined;
  Debug: undefined;
  /**
   * price 是点五档带过来的价格（厘）；kind 默认限价，「盘后交易」入口传 after。
   * qty：AI 的 navigate 把表单填好时带的数量（只填好，不提交）。
   */
  Order: {
    side: OrderSide;
    code?: string;
    name?: string;
    price?: number;
    kind?: OrderKind;
    qty?: number;
  };
  Positions: undefined;
  Position: { code: string };
  Orders: { tab?: OrdersTab } | undefined;
  OrderDetail: { id: number };
  FillDetail: { id: number };
  /** 银证转账：in 银行转证券（默认），out 证券转银行；amount（分）是 AI 填好的金额。 */
  Transfer: { dir?: 'in' | 'out'; amount?: number } | undefined;
  Flows: undefined;
  Fees: undefined;
  Calibrate: undefined;
  Settings: undefined;
  PowerGuide: undefined;
  Accounts: undefined;
  ArchivedAccount: { id: number };
  // M3 学习
  Stage: { no: number };
  Lessons: undefined;
  Lesson: { id: string };
  /** code：从个股页、费率设置带过来的证券；price（厘）、qty 是 AI 填好的。 */
  FeeCalc: { code?: string; price?: number; qty?: number } | undefined;
  Auction: undefined;
  Analysis: undefined;
  DataLab: undefined;
  /** M5 才做的功能，先放说明页。 */
  Coming: { key: 'datacenter' | 'exec' };
  Portfolio: undefined;
  Strategy: { id?: number } | undefined;
  Rebalance: { id?: number } | undefined;
  DataCenter: undefined;
  // M4 AI
  Ai: undefined;
  AiThreads: undefined;
  AiMemory: undefined;
  AiServices: { returnToStudy?: { bookId: string; sectionId: string } } | undefined;
  /** 没有 id 是添加服务。 */
  AiService: { id?: string; returnToStudy?: { bookId: string; sectionId: string } } | undefined;
  AiMcp: undefined;
  /** 没有 id 是添加外部工具。 */
  AiMcpServer: { id?: string } | undefined;
  AiContext: undefined;
  // M5.5
  AiFlows: undefined;
  Proposals: undefined;
  // M6 回放
  Replay: undefined;
  /** blind：从「盲测回放」进来，日期已经随机选好、默认隐藏。 */
  ReplayNew: { date: string; blind?: boolean };
  ReplayRun: { id: number };
  ReplayVerify: { date: string };
  // QuantWise 读书伴学（QUANTWISE_DESIGN.md §3）
  /** 选好 PDF 之后的解析设置；uri 是复制到 App 私有目录后的路径。 */
  ImportBook: { path: string; name: string; size: number };
  ParseProgress: { bookId: string };
  BookMap: { bookId: string };
  /** mode：进来时的模式；blockSeq：读书模式定位到这一块；ask：进来就问这个问题（复习页「让 AI 重讲」）。 */
  Study: { bookId: string; sectionId?: string; mode?: 'lecture' | 'read'; blockSeq?: number; ask?: string; askLabel?: string; askSnapshot?: boolean; wrapup?: boolean };
  SectionDone: { bookId: string };
  /** 讲解记录：给了 bookId 只看这本书。 */
  StudyHistory: { bookId?: string } | undefined;
  /** 归档的一轮讲解（只读）。 */
  StudyRound: { threadId: number; bookId: string; sectionId: string };
  Review: undefined;
  ReviewRun: undefined;
  Notes: { bookId: string };
  FactorLab: { factor?: string; universe?: string } | undefined;
  ChartFull: { chart: ChartData };
  MineruSettings: undefined;
  StudyPrefs: undefined;
  StudyIntro: undefined;
  LearningPlan: undefined;
  Knowledge: undefined;
  Concept: { id: ConceptId };
  QuantQuiz: { mode: QuizMode; conceptId?: ConceptId };
  ResearchNotes: undefined;
  /** draft：从讲解里的因子检验带过来的草稿（还没保存）。 */
  ResearchEdit: { id?: string; conceptId?: ConceptId; draft?: ResearchDraft };
  LearningCoach: { conceptId?: ConceptId; noteId?: string };
  LearningReport: undefined;
};

export type RootScreenProps<K extends keyof RootStackParamList> =
  NativeStackScreenProps<RootStackParamList, K>;
