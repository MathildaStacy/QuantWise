# 因读 QuantWise

<!-- impeccable:product-schema 1 -->

## Platform

android

## Stack

现有 React Native / TypeScript App，SQLite 本地存储；先交付 Android，iOS 后补。

## Users

个人使用；阅读量化与因子投资书籍，借助 AI 逐节理解概念，并结合真实 A 股行情、因子实验和模拟交易学习个人量化。

## Product Purpose

把书中概念与真实行情连起来：AI 带着原文讲解、引用可回到书中，图表和因子结果来自实际数据；通过小结、闪卡和笔记巩固理解。保留 AShareSim 的模拟交易、费用规则和 AI 助手。

## Capabilities and Constraints

- 入金和交易为模拟，不连接真实券商。AI 的写操作仍需用户确认。
- 支持 Markdown、EPUB 和 PDF 导入；PDF 在用户确认后上传 MinerU，书籍采用重排阅读。
- 伴读和全局 AI 助手分开；伴读使用读书与行情工具，小结和闪卡经用户确认后保存。
- AI 直连用户配置的供应商，Key 保存在设备安全存储，不写入页面上下文、日志和记忆。
- 供应商与模型分开管理；模型、思考和搜索随会话保存，新会话沿用最近选择。
- 能力和引用必须来自明确标注或实际接口结果；原型中的模型列表、回答和耗时都是演示数据。
- 历史记录与已有服务配置必须平滑迁移。
- 首次进入提供无需 Key、无需网络的内置动量体验；教学例子、原文和真实行情明确区分。
- 阅读位置、问题草稿和待重试请求按书与小节保存在本机；只有完整成功的讲解推进已讲步骤。
- 因子实验先呈现结论与证据；参数确认后才重算，AI 解读使用屏幕上同一次结果快照。
- 小结可以保存后结束或继续下一节；复习区分没有闪卡、尚未到期与实际完成。

## Brand Commitments

中文名「因读」，英文名与工程名 QuantWise，标语「读懂因子，看懂市场」。Android / iOS 的桌面显示名为「因读」，包标识为 `com.quantwise`。启动页和「我的」展示「因读 · QuantWise」。

读书和听讲使用暖白纸色，原书用宋体，讲解用黑体；行情和交易保留原有中文术语与浅色界面。整体交互见 docs/design/prototype.html，技术方案见 docs/QUANTWISE_DESIGN.md；AI 对话排版约束见 docs/design/ai-chat-layout.md。

## Evidence on Hand

- docs/PRODUCT_DESIGN.md、docs/AI_ASSISTANT.md：现有产品与协议约束。
- docs/QUANTWISE_DESIGN.md、docs/design/prototype.html：读书伴学、导入、图表和因子工具的设计与实现约定。
- docs/design/ai-redesign.html：用户选定的交互原型及说明。
- src/ui/、src/ai/：现有原生实现。

## Product Principles

- 建议先给判断与依据，数据可追溯。
- 模型能力明确呈现，未知能力允许标注。
- 搜索由用户按会话控制，不自动改变请求或费用。
- 流式阅读、键盘避让和已收到的正文不能因改版而退化。
- 一级入口为「学习 / 自选 / 行情 / 模拟交易 / 我的」；设置优先展示讲解偏好、AI 服务与书籍解析。

- 页面只常驻展示数据、操作和当前状态；删除泛泛免责声明、重复提醒与实现细节。成本、收益等补充公式按需展开，操作校验、资金冻结和确认信息保留。
