# 个人量化研习验证记录

本页依据已完成的实现、验证日志、原生操作记录与评审记录，说明研习扩展的验证范围与证据边界。首轮独立收尾评审提出两项修复；随后 **verdict pass** 的 disposition 为 **ship**，仅确认这两项已 **resolved**。

## 范围与入口

- 入口：**学习 → 研习**，与原有「读书 / 路线」并列。覆盖个人计划、今日任务、知识地图、基础诊断、错题再练、研究手记、实验质量自查、AI 陪练、学习周报与 Markdown 导出九项需求。
- 实现位于 [`src/ui/learning/`](../../src/ui/learning/)，通过 [`LearnScreens.tsx`](../../src/ui/screens/LearnScreens.tsx) 与根路由接入；领域逻辑、SQLite 仓储和迁移为本地学习记录提供支持。
- 需求与验收口径见 [PRD / 技术方案](personal-quant-learning.md)；本页不扩展需求，也不改动图表或 AI 讲解。

## 自动化验证

核对了 [`verification.json`](../../build/learning/verification.json)、[`check.log`](../../build/learning/check.log)、[`bundle.log`](../../build/learning/bundle.log) 及两份研习测试文件。

| 检查 | 已记录结果 |
| --- | --- |
| `npm run check` | 65 个套件、812 个测试通过；2 个套件、10 个测试跳过；本轮新增 26 个测试 |
| TypeScript / ESLint | 类型检查通过，lint 无错误；保留 2 条既有警告 |
| Android production JS bundle | 成功写入 bundle 并复制资源 |
| SQLite 与组件集成 | 覆盖升级保留旧数据、防重复作答、错题订正与历史保留、计划切换、周报日期与分母、手记及来源快照、草稿保护、加载重试、导出及 AI 发送边界 |

关键测试见 [`learning.test.ts`](../../__tests__/learning/learning.test.ts) 与 [`learningHub.test.tsx`](../../__tests__/ui/learningHub.test.tsx)。检查结果沿用本次完整验证运行；本次文档交接未重复执行测试。

## Android 证据与人工路径

使用独立 `emulator-5592`，复用既有 debug APK 原生壳并加载当前 worktree 的 JS。验证包含约 **411dp / 字体 1.0** 与 **360dp / 字体 1.3 / 系统夜间模式** 两组手机配置。应用保持既有浅色主题。

| 人工路径 | 当前原生截图 |
| --- | --- |
| 研习首页、计划、知识地图及空状态、概念详情 | [首页](../../.impeccable/review/learning-hub-phone.png)、[计划](../../.impeccable/review/learning-plan-phone.png)、[知识地图](../../.impeccable/review/learning-knowledge-phone.png)、[空状态](../../.impeccable/review/learning-knowledge-empty-phone.png)、[概念](../../.impeccable/review/learning-concept-phone.png) |
| 诊断选择与提交、错误反馈、答对后解除待练；概念 → 两题练习 → 结果 → 原概念 | [题目](../../.impeccable/review/learning-quiz-phone.png)、[反馈](../../.impeccable/review/learning-feedback-phone.png)、[结果](../../.impeccable/review/learning-result-phone.png)、[返回概念](../../.impeccable/review/learning-return-concept-phone.png) |
| 手记输入、键盘避让、四项自查、真实书籍 / 小节选择、保存后重开；已存来源打开实际 3.1 小节 | [研究编辑](../../.impeccable/review/learning-research-small-large-dark.png)、[键盘](../../.impeccable/review/learning-keyboard-small-large-dark.png)、[自查](../../.impeccable/review/learning-checklist-phone.png)、[来源](../../.impeccable/review/learning-source-phone.png)、[来源选择](../../.impeccable/review/learning-source-picker-phone.png) |
| 陪练问题与材料预览、未配置模型时的恢复入口、学习周报 | [陪练](../../.impeccable/review/learning-coach-small-large-dark.png)、[材料](../../.impeccable/review/learning-coach-material-small-large-dark.png)、[缺少模型](../../.impeccable/review/learning-coach-error-small-large-dark.png)、[周报](../../.impeccable/review/learning-report-phone.png) |

窄屏与放大字体还复查了 [首页](../../.impeccable/review/learning-hub-small-large-dark.png)、[题目](../../.impeccable/review/learning-quiz-small-large-dark.png)、[反馈](../../.impeccable/review/learning-feedback-small-large-dark.png)、[结果](../../.impeccable/review/learning-result-small-large-dark.png) 和 [返回概念](../../.impeccable/review/learning-return-concept-small-large-dark.png)。本表只引用本次确认的当前截图；截图由实现阶段与独立收尾评审验证，本次文档交接核对其索引与对应实现。

## 与既有设计系统的对照

核对 [`PRODUCT.md`](../../PRODUCT.md)、[`DESIGN.md`](../../DESIGN.md)、[设计 sidecar](../../.impeccable/design.json)、[研习方向约定](../../.impeccable/surfaces/src-ui-learning-hubscreen-tsx.md)，并抽查 [`readTheme.ts`](../../src/ui/readTheme.ts)、[`shared.tsx`](../../src/ui/learning/shared.tsx) 与首页、测验、研究表单实现。

- **配色**：直接复用暖纸色 `rc.page`、深色正文和墨蓝 `rc.main`（`#2D5BA8`）；选中态使用既有浅蓝底。AI 对话的局部规则和行情红绿语义保持原作用域。
- **文字**：沿用原生中文字体与系统字号缩放。研习正文为 16 / 27，标题 18 / 28，首页主句 24 / 34；辅助文字 14 / 23。长内容通过换行和纵向滚动容纳。
- **结构**：首页按「当前计划 → 今日任务 → 工具 → 本周进展」组织；知识与任务采用带分隔线的入口行。共享内容区左右留白 20dp，区块间距 12dp，原生返回和既有按钮保持一致。
- **交互**：入口行至少 64dp，选择项与输入框至少 48dp；表单复用键盘避让、安全区、未保存保护，错误保留为可见文本与重试动作。未引入新的视觉身份、装饰性图片或图表风格。
- **既有漂移**：`DESIGN.md` 包含 2026-11-01 的学习流程扩展，sidecar 的 `generatedAt` 仍为 2026-10-27；上下文检查已标记前者较新。本次仅报告，保持两者及 `PRODUCT.md` 原样，不把局部实现提升为新的全局规则。

## 收尾评审与修复

依据 [独立界面审阅记录](../../.impeccable/review/finish-review.md) 与 `verification.json` 的 `review` 字段：首轮对设计材料、既有设计一致性及手机范围内的完成度进行检查，提出两项 P2 交互问题，disposition 为 **fix**。后续 **verdict pass** 的 disposition 为 **ship**、remaining 为 **clear within fix scope**，仅确认以下两项修复已 **resolved**：

1. 测验结果按钮改为「返回上一页」，与实际历史返回一致。组件集成测试通过，正常与窄屏均实际走通返回原概念路径。
2. 来源小节加载失败时增加「重新加载小节」，可重试同一本书并保留草稿。单书瞬时失败的组件 / SQLite 集成测试验证重试与保存；未在原生模拟器注入该失败。

## 隔离与验证边界

- 基线 `f79a605`，分支 `codex/feature-personal-quant-learning`。与 Claude 的 `feat/lecture-chart-readability` 实际变更文件交集为 **0**；主分支未被本轮改动。`node_modules` 为本地未跟踪依赖软链接，不纳入提交。
- 已验证 production JS 打包；未执行全新 Gradle release 构建。现有 debug 壳的原生运行证据不延伸为发布 APK 验证。
- 未调用真实 AI；成功响应与发送边界由 mock 测试覆盖，缺少模型的实际 UI 已验证。原生系统分享落盘、全量读屏遍历及硬件性能不在本次证据范围。
- 未验证 iOS、平板或真机；系统夜间模式证据仅覆盖现有浅色应用的可读性。
- 一次性模拟器已恢复设置并停止，原 `emulator-5590` 未动；Metro `8088` 已停止。
