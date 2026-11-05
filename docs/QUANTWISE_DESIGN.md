# 因读 QuantWise 技术方案

> 版本 1.0 · 2026-11-01 · 配套：[可交互原型](design/prototype.html)（源文件 `design/prototype/`）
> QuantWise = AShareSim（底座，全部保留）+ Pagewise 的伴读（移植主要能力）+ 新增的行情图表与因子工具。

## 0. 范围（2026-11-01 确认）

| 问题 | 决定 |
| --- | --- |
| 仓库 | `MathildaStacy/QuantWise`，公开，GPL-3.0。带上 AShareSim 的全部提交历史（GitHub 不能把自己的仓库 fork 到同一账号，等价做法是克隆后推到新仓库）。不带 AShareSim 的 tag |
| 安装 | Android 包名 `com.quantwise`、应用显示名「因读」，英文名 QuantWise，版本从 0.1.0 开始；和 AShareSim 能同时装，数据库、Keystore 条目互不影响 |
| 书籍导入 | PDF（MinerU 精准解析）、EPUB（本机解析）、Markdown（本机解析）。阅读用**重排视图**，不做 PDF 原版页渲染和位置框高亮 |
| 因子深度 | 图表 + 轻量因子计算：AI 能画带标注的走势和指标图；用本地前复权日线对一个股票池（示例池 / 自选 + 持仓 / 沪深 300）算因子值、分组回测、Rank IC |
| 从 Pagewise 拿什么 | 伴读的产品逻辑（书的地图、本节路线图、听讲 ⇄ 读书、引用跳回原文、来源标记、岔路、本节小结、闪卡复习、续学回顾）和三块服务代码（MinerU 客户端、EPUB 解析、离线 MathJax）。不拿：五套皮肤、VM 分层、StudySession 编排、文本精修、语音、翻译、备份 |

## 1. 要解决的问题

读《因子投资》这类书，难点在于概念和真实市场之间隔着一层：书里说「A 股中长期动量偏弱」「低波动异象」「IC 均值 0.03 值得关注」，但手边没有数据去看一眼。QuantWise 让同一个 AI 既拿着书的原文讲，又能调用本地行情工具现画现算：

- 讲 3.1 动量时，点「用真实行情举例」：读宁德时代 250 根前复权日 K，画价格、MA20 和 20 日动量，标出极值，说出它今天在股票池里排第几。
- 问「这个因子在 A 股有效吗」：对股票池做一次分组回测和 Rank IC，结论按算出来的数写（t 值不到 2 就说样本不够），并引用书里 4.2、4.5 的原文。
- 所有数字来自工具结果；所有对书的说法带引用，点开看原文。

## 2. 总体结构

在 AShareSim 的目录里加 4 个目录，不改动原有的分层：

```
src/
├ book/        纯 TS：书的数据结构、Markdown / EPUB / MinerU 结果 → 内容块和章节、本节路线图、AI 标记解析、
│              复习调度、内置示例教材。不依赖 RN、数据库、网络
├ quant/       纯 TS：指标（MA、动量、波动、回撤、RSI）、因子定义、分组回测和 IC、图表数据
├ study/       伴读运行时：系统提示、上下文组装、读书工具 + 行情与因子工具、工具循环、导入流水线、MinerU 客户端
├ data/        （已有）加 bookRepo.ts、quantRepo.ts 和迁移 0008
├ native/      （已有）DocumentStore 加 pdfPageCount（系统 PdfRenderer 读页数）
└ ui/          （已有）加读书和因子页面、图表卡片、公式组件
```

依赖方向：`book`、`quant` 只依赖自己和 `engine/units`；`study` 依赖 `book`、`quant`、`data`、`ai`（复用协议层）、`market`；`ui` 依赖全部。和 AShareSim 一样不用 Redux、不用 UI 组件库。

## 3. 信息架构

底部 5 个 Tab 不变（自选 / 行情 / 交易 / 学习 / 我的），**启动后默认打开「学习」**（读书是 QuantWise 的主用途）。学习 Tab 顶部分两段：

| 段 | 内容 |
| --- | --- |
| 读书（默认） | 继续学习卡片（当前书 · 小节 · 第几步 · 上次卡点）→ 快捷入口（复习、因子实验室、笔记、导入）→ 书架 |
| 路线 | AShareSim 原来的学习 Tab：当前阶段、工具格、阶段卡片 |

新增页面（路由名 → 内容）：

| 路由 | 参数 | 内容 |
| --- | --- | --- |
| `ImportBook` | `{ uri, name, size }` | 选好文件后的解析设置：PDF 显示页数、大小、分片计划、模型（vlm / pipeline）、上传确认；EPUB / Markdown 直接解析 |
| `ParseProgress` | `{ bookId }` | 各片状态和进度，失败可重试；完成后去地图 |
| `BookMap` | `{ bookId }` | 章 → 节 → 小节，每节状态（未学 / 在学 / 已学 / 有卡点）、字数、摘要开头；全文搜索 |
| `Study` | `{ bookId, sectionId?, mode?, blockId?, ask? }` | 一个页面两种模式：听讲（本节路线图、AI 对话、快捷动作）和读书（重排原文、段落菜单） |
| `SectionDone` | `{ bookId, sectionId }` | 本节小结：AI 起草的摘要、卡点、闪卡草稿，确认后保存、进度前移 |
| `Review` / `ReviewRun` | — | 今日待复习、盒子分布、卡点清单 / 翻卡复习 |
| `Notes` | `{ bookId }` | 每节的摘要、问答、卡点；导出 Markdown 和 Anki CSV |
| `FactorLab` | `{ factor?, universe? }` | 股票池、因子、调仓周期、分组、成本 → 统计、分组净值、IC、各组平均收益 |
| `ChartFull` | `{ chart }` | 全屏图表、十字线读数、「怎么算的」 |
| `MineruSettings` / `StudyPrefs` | — | MinerU Token（Keystore）、默认模型、今日额度 / 讲解偏好 |

浮层（不是路由）：导入方式选择、原文预览（点引用）、段落菜单（读书模式）、「AI 现在看到了什么」。

「我的」加一组「读书」：解析服务（MinerU）、讲解偏好、书架与存储。全局 AI 助手（右下角）不变，多了行情与因子工具（§8），个股页的快捷问题多一条「画出它的 20 日动量」。

## 4. 数据模型（迁移 0008）

```sql
book          (id TEXT PK, title, author, format 'pdf'|'epub'|'md', source 'sample'|'import', sha256 UNIQUE,
               pages, status 'parsing'|'ready'|'failed', error, body JSON（解析参数、片计划、警告）, created_at, updated_at)
book_section  (book_id, id, parent_id, ord, level, no, title, leaf 0|1, block_from, block_to,
               page_from, page_to, chars, PRIMARY KEY (book_id, id))
book_block    (book_id, seq, section_id, no（节内序号，引用「3.1 ¶2」）, type, text, page, image, html,
               PRIMARY KEY (book_id, seq))
book_part     (book_id, part_no, page_from, page_to, data_id, batch_id, state, error, updated_at)   -- PDF 分片
study_state   (book_id PK, main_section, step, mode 'lecture'|'read', away_at, body JSON（每节已讲到哪步、跳过的步）)
section_note  (book_id, section_id, summary, qa JSON, updated_at, PRIMARY KEY (book_id, section_id))
study_stuck   (id PK, book_id, section_id, text, resolved_at, created_at)
study_card    (id PK, book_id, section_id, front, back, box 1–5, due_date, created_at, reviewed_at)
book_mark     (book_id, block_seq, kind 'highlight'|'pin', text, created_at)
kline_qfq     (code, date, open, close, high, low, volume, PRIMARY KEY (code, date)) WITHOUT ROWID  -- 前复权，厘 / 股
kline_qfq_meta(code PK, name, fetched_at, last_date, bars, total_cap, float_cap, price)              -- 取到哪天、取数据时的市值和价格
quant_universe(id 'hs300'|…, codes JSON, meta JSON（名称、总市值、流通市值，按代码）, as_of, fetched_at)
ALTER TABLE ai_thread ADD kind TEXT NOT NULL DEFAULT 'assistant';   -- 'assistant' | 'study'
ALTER TABLE ai_thread ADD book_id TEXT; ALTER TABLE ai_thread ADD section_id TEXT;
ALTER TABLE ai_thread ADD context_snapshot TEXT;                    -- 伴读的固定上下文（§6.3）
```

- 伴读对话复用 `ai_thread` / `ai_message`（同一套协议层、存法和缓存约定），`kind = 'study'`，一个小节一个对话。AI 助手的对话列表、`openLatest`、对话检索只看 `kind = 'assistant'`。
- `kline_qfq` 和 AShareSim 的 `kline_day`（不复权，撮合和清算用）分开：前复权价会随每次分红整体变化，所以按代码整段重取、整段替换，不做增量。
- 内容块的 `no` 是节内序号，段落、公式、列表项、图、表各算一个。引用写成 `[[b:3.1#2]]`，界面显示「3.1 ¶2」；PDF 的块有页码时显示「p.86」。
- 内置示例教材在第一次启动时写入（`source = 'sample'`），和导入的书走同一套表。

## 5. 导入与解析

```
选文件（系统文件选择器，复制到 App 私有目录）
 → SHA-256（已有同哈希的书 → 直接打开）
 → 按扩展名：
   .md / .markdown / .txt  读文本 → parseMarkdown → assemble
   .epub                    解压 → container.xml → OPF（manifest、spine、nav / ncx）→ 每个 XHTML 转成「标题 / 段落 / 列表 / 公式 / 图 / 表」
                            → assemble（标题层级以 nav 目录为准，没有目录时用 h1–h3）
   .pdf                     DocumentStore.pdfPageCount 读页数 → 分片（每片 ≤ 200 页）→ 用户确认上传
                            → MinerU：POST /file-urls/batch（每片一项：同一文件 + page_ranges）→ PUT 上传
                            → 轮询 GET /extract-results/batch/{id}（2 s 起，指数退避到 30 s）
                            → 下载结果包、解压 → *_content_list.json → 内容块（页码加片偏移）→ assemble
 → 写库（一个事务），status = ready
```

- **assemble**（`book/assemble.ts`）：输入「标题（文本 + 层级）+ 正文块」的序列，按「第 n 章」「3.1」「3.1.2」编号定章节号；没编号的标题按层级挂到最近的上级。叶子小节是有正文的最低一级。和原型 `ui-book.js` 的 `parseBook` 同一套规则。
- MinerU 单文件限制 200 MB / 200 页，一次最多 50 项（官方文档 2026-11 核对）。超过 200 页的书用 `page_ranges` 分片，不在本机拆 PDF；代价是同一个文件上传多次。超过 200 MB 的文件 V1 不支持，提示原因。
- 每片的 `batch_id`、状态写进 `book_part`，App 被杀后回到解析页继续轮询，不重复上传。错误码映射沿用 Pagewise（Token 过期 A0211、额度、队列满、文件不支持）。
- MinerU Token 存 Keystore（`quantwise.mineru`），日志和导出里不出现。
- 图片：MinerU 结果包和 EPUB 里的图片复制到 `书目录/images/`，块里存相对路径；表格存 HTML，显示时转成 Markdown 表格。

## 6. 伴读

### 6.1 本节路线图

进入一个叶子小节，先在本机切出 1–5 步（`book/steps.ts`，不调用模型）：有小标题按小标题切；否则按块数平均切，公式、列表项不和它前面的说明段拆开，每步 1–3 个块。步骤标题取该步第一段的第一个短句。Pagewise 用整理模型生成路线图，QuantWise 先用确定的切法：可测、不花钱、和原型一致；以后可以换成模型生成，再按 Pagewise 的规则校验块范围。

### 6.2 讲解协议（系统提示，所有伴读对话共用一份缓存）

1. 中文讲，术语第一次出现时中英对照。顺序：直觉 → 定义和公式 → 例子 → 一个检查问题。只讲当前这一步，讲完停下等用户。
2. 每个依赖书中内容的说法后面写引用 `[[b:小节号#块号]]`，只能引用本对话里出现过原文的块（当前小节、`load_section` / `search_book` 读到的）。
3. 书里没有、自己补的推导写在 `[[derive]]…[[/derive]]`，自己编的例子写在 `[[example]]…[[/example]]`，用工具算出来的真实数据写在 `[[real]]…[[/real]]`。
4. **举例优先用真实 A 股数据**：概念能用价量数据说明时，调用 `get_kline` / `plot_chart` / `factor_test` / `get_factor_values` 现算，不凭记忆写行情数字。用户问「有没有效」「A 股是不是这样」时做一次 `factor_test`，结论按 t 值、IC 均值和样本期数写，样本不够就说不够；提醒幸存者偏差。
5. 用户问到别的小节，先 `load_section` 读原文再答；纯属另一个话题时传 `detour: true`。
6. 用户答错检查题，换个角度再讲一次，问要不要记成卡点（`mark_stuck`），不自动记。
7. 讲完最后一步，用户说懂了时调用 `propose_section_wrapup`（摘要 ≤ 120 字、卡点、3–5 张闪卡），用户确认后才保存。
8. 不给交易建议、不生成下单类操作；伴读里没有下单、转账这类工具。想交易去个股页问 AI 助手。

### 6.3 请求结构和缓存

| 顺序 | 内容 | 什么时候变 |
| --- | --- | --- |
| tools | 读书 6 个 + 行情与因子 3 个 + 只读行情 7 个（§8），按名字排序 | 不变 |
| 断点 1 · system | §6.2 的讲解协议 + 讲解偏好 | 改讲解偏好时 |
| 断点 2 · `context_snapshot` | 书的地图（全书目录 + 已学小节的摘要）+ 当前小节的全部原文（带块号） | 对话创建时拍快照，一个小节的对话里不变 |
| 历史 | 本小节的对话（只追加） | 每轮 |
| 最后一条 user | `<study_state>`（现在讲第几步、这一步的块范围、跳过的步、未解决的卡点、模式）+ `<action_results>`（检查题作答、草稿确认结果）+ 问题 | 每轮 |

快捷动作就是一句固定的问题加一条状态：「懂了，继续」把 `step + 1` 写进 `<study_state>` 再问「讲第 k 步」；「这步熟，跳过」把跳过的步写进状态；「看原文」只切模式，不请求。**只有用户点了或提问时才请求模型**；进入小节时显示本节路线图和「开始讲第 1 步」，续学回顾（距上次 ≥ 1 天）用本地的进度、摘要和卡点拼出来，不请求模型。

### 6.4 工具（读书）

| 工具 | 参数 | 结果 / 效果 |
| --- | --- | --- |
| `load_section` | `id`，`detour?` | 该小节全部内容块（带块号）；`detour: true` 时界面出现岔路条 |
| `search_book` | `query` | 本书命中的前 8 个块（块号、所在小节、片段），用 `LIKE` 查 `book_block.text` |
| `get_notes` | `section_id` | 该节摘要、问答、卡点 |
| `mark_stuck` | `text` | 写一条卡点（用户在对话里点了「记成卡点」才调用，见 6.2 第 6 条） |
| `ask_quiz` | `question`、`options[]`、`answer`、`explain` | 界面出一道选择题；作答结果在下一次提问的 `<action_results>` 里 |
| `propose_section_wrapup` | `summary`、`stuck[]`、`cards[{front, back}]` | 生成本节小结草稿，界面出「去确认」按钮 → `SectionDone` |

### 6.5 引用校验、来源标记和岔路

- 引用校验（`book/markup.ts`）：`[[b:3.1#2]]` 的小节必须在本对话「读过的小节」里（当前小节 + 历史里 `load_section` 的结果 + `search_book` 命中的块）。通过的渲染成「3.1 ¶2」按钮，点开底部弹出原文（该块和前后各一块），可以「在读书模式打开」并闪一下这一块；不通过的去掉标记，换成灰色「未核实」。
- 来源标记渲染成带标签的底色块：补充推导（蓝）、AI 举例（橙）、真实行情（青）。
- 岔路：`load_section(detour: true)` 之后的消息标成岔路（左侧紫线），顶部出现「岔路 · 2.2 … 回到主线」。点「回到主线」不请求模型：本地插一条分隔「回到 3.1：刚才讲到第 k 步」，岔路里的问答折叠成一行「已解决：…（n 条）」，问题和最后一段回答写进被问小节的笔记（`section_note.qa`）。发给模型的历史不改（缓存）。

### 6.6 读书模式、小结、复习

- 读书：重排显示当前小节的块（原书文字用宋体），讲过的块左侧细线，当前这一步浅色底，有问答便签的块下面贴「已解决：…」。点段落出菜单：解释这一段（切到听讲，问「解释 3.1 ¶2」）、从这里开始讲（切到听讲，讲这一块所在的那一步）、用真实行情举例（讲横截面结论的段落换成「在 A 股复现」）、高亮。图、表、代码点「图表操作」，菜单按块类型给（PM 走查第 2 项）：表是「解释这张表」「在 A 股复现这张表」（把块号交给 factor_test 的 book_table）「全屏看表」，图是「解释这张图」「用 A 股数据画同类图」「AI 清晰重绘」，代码是「逐行讲解」「这段代码的输入输出」；菜单标题写图表编号（「表 3.19」「图 3.21 · Panel A」「Snippet 3.6」），没有编号写页码，表格预览是前 6 行的小表。宽表的行名列固定在左边、只横滑数据列；全屏看表时表头也固定，可以切横屏，关掉后交回系统方向设置（PM 走查第 1 项）。底部「读完这一节」→ 小结。
- 小结：模型调用 `propose_section_wrapup` 生成草稿（没有配置 AI 时用本节第一段做摘要）。摘要可改，闪卡默认全选。保存后写 `section_note`、`study_card`，小节标已学（有未解决卡点标「有卡点」），主线指针移到下一个叶子小节。
- 复习：Leitner 5 个盒子，间隔 1 / 3 / 7 / 15 / 30 天；记得升一盒、模糊不动、忘了回盒 1 并加卡点；每天最多 30 张。按北京时间的日期算到期。
- 笔记导出：每本书一个 Markdown（按章节：摘要、问答、卡点、高亮）+ 一个 Anki CSV（正面、背面、标签 = 小节号），走 AShareSim 已有的系统文件保存（`exportText`）。

## 7. 行情与因子

### 7.1 股票池和数据

| 股票池 | 成分 | 来源 |
| --- | --- | --- |
| 示例池 `sample` | AShareSim 数据练习的 25 只大盘股（`learn/datalab.ts` 的 `BIG_CAPS`） | 内置 |
| 自选 + 持仓 `watch` | 自选和当前持仓里的 A 股（不含 ETF、指数） | 本机 |
| 沪深 300 `hs300` | 当前成分 300 只 | 新浪 `Market_Center.getHQNodeData?node=hs300`（3 页 × 100），存 `quant_universe`，带取到的日期 （取不全时换东方财富） |
| 中证 500 `zz500` / 中证 1000 `zz1000` | 当前成分 500 / 1000 只 | 东方财富数据中心 `RPT_INDEX_TS_COMPONENT`（TYPE 3 / 7，每页 500；和沪深 300 的 TYPE 1 互不重叠，2026-11-05 核对），存 `quant_universe` |

- 准备数据（因子实验室或讲解里的「准备数据」，或者 `factor_test` 第一次用到示例池、自选时）：对池子里每只股票按日期段取约 5 年前复权日 K（腾讯 `fqkline/get?param=code,day,<1,900 天前>,,2000,qfq`，约 1,200 根、一只约 80 KB），并发 6，进度条可取消，连续 12 只取不到（限流、断网）就停下；再用腾讯快照（`client.quotes`）取总市值、流通市值。按代码整段写入 `kline_qfq`，`kline_qfq_meta(code, fetched_at, last_date, bars)` 记下取到哪天。最后一根不是最近一个交易日就算过期，以前只取了 750 根的也算，下次用到时重取。组面板时按 50 只一批只读收盘价和成交量，中证 1000 约 125 万行也不一次读进内存。
- 示例池 25 只在工具里第一次用到时自动准备（约 5 秒）；指数池要用户点「准备数据」（沪深 300 约 1 分钟、25 MB，中证 500 约 2 分钟、40 MB，中证 1000 约 4 分钟、80 MB）。工具遇到没准备的池子不算，返回提示，讲解里这条结果下面出「准备数据并重做这次检验」，准备好后自动让 AI 用这个池子重做；数据过期时照常用已有的算，同一个位置出「更新数据」。
- 双重排序（`factor_test` 的 `control = size`）：先按调仓日总市值分 2 / 3 / 5 组，条件排序在每个市值组里再按因子分组，独立排序两个变量各自分组再取交集（有空格的期跳过）；因子各组收益 = 各市值组同一因子组的平均，IC 在市值组内算再平均，另给每个市值组的多空和 t 值。`book_periods` 给了书里那张表的期数时，摘要写明本次少多少、t 值大约小多少倍。

### 7.2 因子（`quant/factors.ts`）

| id | 名称 | 定义（t 是调仓日，P 是前复权收盘价） | 书里对应 |
| --- | --- | --- | --- |
| `mom20` / `mom60` | 20 / 60 日动量 | $P_t / P_{t-n} - 1$ | 3.1 |
| `mom12_1` | 12-1 月动量 | $P_{t-21} / P_{t-252} - 1$ | 3.1 |
| `rev20` | 20 日反转 | $-(P_t / P_{t-20} - 1)$ | 3.2 |
| `vol20` | 20 日低波动 | $-\sigma(r_{t-19..t})$ | 3.3 |
| `turn20` | 20 日低换手（近似） | $-\overline{V_{t-19..t}} / 流通股本$，流通股本 = 今天的流通市值 / 今天的价格 | 3.4 |
| `size` | 小市值（近似） | $-\ln(总市值_{今天} \times P_t / P_{今天})$ | 2.3 |

`turn20` 和 `size` 用今天的股本往回推，界面和工具结果里都注明「近似」（书 3.4 ¶3 讲的就是这个误差）。

### 7.3 分组回测和 IC（`quant/backtest.ts`，和原型 `quant.js` 同一套口径）

1. 交易日历取池子里至少一半股票有数据的日期。起点 = 最长回看窗口之后。
2. 从起点开始每 `hold` 个交易日调仓一次。调仓日 t：池子里在 t 和 t+hold 都有收盘价、因子值有效的股票，按因子值从低到高排序，平均分成 G 组（第 g 组取排序后的 `[round(g·n/G), round((g+1)·n/G))`）。
3. 下一期收益 $r = P_{t+hold}/P_t - 1$；组收益 = 组内等权平均。Rank IC = 因子值排名和收益排名的相关系数，即斯皮尔曼相关（并列取平均名次）。
4. 换手 = 本期最高组（最低组）里不在上期同一组的股票占比。成本：每换掉一只算一次卖出 + 一次买入，`cost_bp` 是单边成本（万分之），多空收益 = 最高组 − 最低组 − 两组换手 × 2 × 单边成本。各组净值只扣自己那组的成本。
5. 统计：IC 均值、标准差、ICIR、年化 ICIR（× √(252/hold)）、IC 为正的比例、t = 均值 / (标准差 / √期数)、各组平均收益、单调性（组号和组平均收益的秩相关）、多空年化收益、最高组平均换手、期数和起止日期、每期平均股票数。
6. 少于 3 期或者每组不到 2 只时不出结果，写明样本不够。

### 7.4 图表数据（`quant/charts.ts`）

图表存成数据而不是图片：工具执行时算好，存在这次工具调用的 `ToolUi.chart` 里（一张图十几 KB），历史对话重新打开时图和当时一样，不受之后行情更新影响。

```ts
type ChartData =
  | { kind: 'price'; code; name; dates; close; ma?: {n; values}; band?: {upper; lower};
      sub?: {kind: 'mom20'|'mom60'|'vol20'|'dd'|'rsi14'|'volume'; values}; marks?: {date; label; below?; kind?: 'point'}[];
      focus?: {from; to; label}[]; takeaway? }
  | { kind: 'compare'; dates; series: {code; name; values /* base 那天 = 100 */}[]; base? /* 不写 = 第一天 */; focus?; takeaway? }
  | { kind: 'factor'; factor; universe; dates; groups: number[][]; bench: number[]; longShort: number[]; stats? }
  | { kind: 'ic'; factor; dates; ic: number[]; noise? /* 2/√(每期只数 − 1) */; stats? }
  | { kind: 'groups'; factor; means: number[]; stats?; book? };
```

`stats` 是这次检验的口径和关键统计（股票池、加权、组数、调仓周期、成本、市值控制、期数、每期平均只数、多空和 IC 的均值与 t 值、IC 为正的期数），三张图带同一份，旧图没有。标题写加权方式（「分组净值 · 20 日动量 · 等权」），页脚写口径（「示例池 · 等权 · 5 组 · 每 20 日调仓 · 24 期 · 当前成分」）。

- **IC 图**：柱子后面一条灰色噪声带 ±2/√(n − S)（n 是每期平均只数，S 是控制市值时的市值组数，不控制时 1）：没有预测力时约 95% 的单期 Rank IC 落在里面。累计 IC 和柱子共用 0 线，刻度单独写在右侧，线尾一个点写「累计 +4.08」。页脚「24 期 · 均值 -0.006（t -0.08）· 为正 14/24」。「怎么看」按 t 值和累计 IC 的走势写一路向上、一路向下、大体向上（向下）或来回摆动；七成以上的柱子在噪声带里时提醒看均值和 t 值。
- **各组收益图和书里的表**：讲解里 `factor_test` 可以带 `book_table`（书中分组收益表的块号）和 `book_panel`、`book_row`。App 从表格单元格读出每组的数（`study/bookTable.ts`：找「Low、2、…、High」或「1…10」这样的表头，Panel 标题行、行名、单独一行的 t 值都认），存在 `groups.book`：`{label, cite, raw, spread?, values, merged?, unit, rho}`。组数不同时按分位重叠加权合并到本次组数（10 组到 5 组就是每相邻 2 组取平均），`merged` 写明怎么合并的；`rho` 是组序和原书各组收益的秩相关，用原书的组数算。书里是月均（或年化）时，本次的每期收益按 × 21 / hold（或 × 252 / hold）单利折算后画在同一个刻度上，书中的数画成空心点和虚线，图下写「分组收益的形状（秩相关）：书中 -0.333（10 组）· 本次 -0.300（5 组）」和一张小表；书里看不出单位时只写不画。工具摘要里写书中的数、合并方式和两边的秩相关，不让模型自己抄书里的数。读不出来时摘要写原因（不是表格、没有分组表头、要指定 Panel 或行），这次照常检验、不叠画。
- **摘要的月度行**：`testSummary` 多一行「折成月度（每期 × 21 / hold，单利近似，t 值不变）」，和书里的「月均收益」对照时用这一行。

讲解和助手里，一次 `factor_test` 排成一张结果卡（`ui/charts/FactorResult.tsx`），不再连排三张图卡：标题「因子检验 · 名字」和「历史回测」标签、口径一行，统计一行（多空每期和 t 值，持有期不是 20 日时加「月均约」；Rank IC 均值、t 值、为正的期数），下面一张图用「净值 / IC / 各组」切换，默认净值，净值图默认只画最高、最低两组（「看全部分组」展开）。同一问里同一因子、同一股票池和口径、只换加权方式的几次检验合成一张卡，加「等权 / 市值加权」切换（`chartItems`）；IC 不随加权变，IC 页写一句「IC 只看排名，等权和市值加权两次一样」。操作提示「点一下或按住拖动」一问只写一次。因子实验室仍是一张张的图卡。

同一个 `QuantChart` 组件（react-native-svg）画对话里的卡片和全屏图：卡片里点一下、按住或左右拖动出十字线，跟着手指走、页面不滚（和个股页 `ChartInspector` 同一套手势），全屏一按下就跟手。讲解页读到图卡滚出屏幕时，小图钉在页顶对照讲解（图文同屏）；因子检验的结果卡滚出去时钉的是一条结果条（[ai-lecture-charts.md](design/ai-lecture-charts.md) §2.9）。讲解里的行情图怎么标重点区间、坐标轴和读数怎么画，见同一篇。

### 7.5 三重屏障和元标签（`quant/labels.ts`，AFML 第 3 章）

讲 AFML 3.6 元标签时，原来只能画一段 ETF 回撤再「假设初级模型给出做多信号」（[pm-reader-lecture-20261105.md](design/pm-reader-lecture-20261105.md) 第 10 项）。`meta_label_test` 在一只股票或指数约 5 年的前复权日线（按日期段取，和准备数据一样往回 1,900 个自然日）上跑一遍：

1. **主信号**：MA fast 上穿 MA slow（金叉）做多；`side = both` 时下穿（死叉）也做空。信号当天收盘进场。
2. **三重屏障**：目标波动 = 信号前 60 日日收益的标准差 × √hold；止盈 = 进场价 × (1 + pt × 目标波动)，止损 = 进场价 × (1 − sl × 目标波动)（做空反过来），最长持有 hold 个交易日。每天按收盘价看先碰到哪一道；hold 天里都没碰到就在第 hold 天收盘出场；数据到头还没出结果的不打标签。
3. **元标签**：顺着信号方向的收益 > 0 记 1，否则 0。
4. **次级模型**：逻辑回归（特征按训练样本标准化，L2 λ = 1，牛顿法），特征是信号当天能看到的 20 日波动、20 日动量、离 60 日最高收盘、log(5 日均量 / 60 日均量)，`side = both` 时加方向。每次信号只用出场在它之前的信号训练，至少 20 次、赚和没赚各 5 次以上，不够时这次不出概率（预热）。概率 ≥ 0.5 放行。
5. **对比**：只比预热之后的信号：全部跟主信号、只做放行的、没放行的，各自的次数、命中率、平均每次收益。标准误按「从比较期随机挑同样多次」算（不放回抽样）；结论分几种：一次没放行、全部放行、样本太少（比较期不到 20 次或放行不到 5 次）、不到 2 个标准误（说明不了）、2 个以上（同时提醒持有期重叠、结果不独立，这个标准误偏小）。
6. 不扣成本、不管涨跌停和 T+1；今天盘中那根不用。

走查时在随机游走上试过：MA5/20 只做多，约 5 年 35 次信号、预热 20 次，比较期只剩 14—17 次，结论都是「样本太少」，摘要提示把 fast、slow 调小（3 / 10 时约 60 次）；随机游走上也出过一次 z = 3.2（13 次放行 12 次赚），所以 2 个标准误以上的结论也要写重叠的提醒。

**图**（`kind: 'labels'`）：最近 250 根的收盘、MA fast（紫）、MA slow（橙色虚线），每次信号一个三角（做多朝上画在线下，做空朝下画在线上）：红赚、绿亏、灰色还没结果；实心放行、空心没放行，预热的淡一些。没点图时框出最近一次信号的三道屏障：浅灰底从进场到到期，止盈（红）、止损（绿）两条虚线上写离进场价多远，碰到的那条加粗，到期一条竖虚线，进场到出场的收盘线用结果的颜色加粗；点图时框离手指最近的那次。卡片下面是「全部跟主信号 / 只做放行的」两行对比和结论，没点图时再写一行框出的那次；全屏的数据表每次信号一行。

讲解里，当前这一步或这一段讲到三重屏障、元标签、事件采样、次级模型（`labeling()`）时，「用真实行情举例」改成 `meta_label_test`，不假设一个信号。

## 8. AI：两个入口共用一套行情与因子工具

| 工具 | 参数 | 返回给模型 |
| --- | --- | --- |
| `plot_chart` | `code`、`bars?`（20–750；不给时无区间画 250 根、有区间按区间自动缩放）、`end?`（图的最后一天）、`ma?`（5–120）、`band?`（布林带）、`sub?`（mom20 / mom60 / vol20 / dd / rsi14 / volume）、`compare?: code[]`（最多 4 只，= 100 对比）、`marks?: 'extremes'`、`focus?: {from, to, label?}[]`（重点区间，最多 2 段，可写整月 `2026-09`）、`points?: {date, label}[]`（标注某天，最多 3 个）、`takeaway?`（一句看点） | 起止日期、首末价格、区间涨跌、副图的最高 / 最低 / 最新值和日期、极值标注；有区间时加区间读数（前收 → 末日收盘、区间涨跌、区间最高最低、副图起止值），标注日的收盘、当日涨跌和副图值；画不出来的区间和标注写明原因 |
| `factor_test` | `factor`、`universe`（sample / watch / hs300 / 代码列表 ≤ 300）、`hold`（5 / 10 / 20 / 60）、`groups`（3 / 5 / 10）、`cost_bp`（0–50） | §7.3 的全部统计（带口径说明和样本是否足够），三张图 |
| `get_factor_values` | `factor`、`universe`、`date?`、`code?`、`n?` | 某天的因子值排名（前后各 n 只）；给了 `code` 时写明它排第几 |
| `meta_label_test` | `code`、`fast?`（2–60，默认 5）、`slow?`（5–250，默认 20）、`side?`（long / both）、`pt?` / `sl?`（目标波动的几倍，0–5，默认 1）、`hold?`（5–120，默认 20）、`bars?`（图上画几根，60–750） | 口径、三道屏障各碰到几次、元标签、次级模型的对比（全部跟 / 放行的 / 没放行的：次数、命中率、平均收益）和结论（差几个标准误）、最近一次信号；一张元标签图（§7.5） |

- AI 助手（全局）：工具从 36 个变成 40 个，仍然按名字排序、任何设置下不增减。个股页快捷问题加「画出它的 20 日动量」。
- 伴读：读书 6 个 + 上面 4 个 + 只读行情 7 个（`get_quote`、`get_kline`、`get_company_profile`、`get_financials`、`get_benchmark`、`query_local_db`、`screen`），共 17 个。伴读里不带下单、转账、改设置、记忆这类工具。
- 伴读运行时（`study/session.ts`）是一个精简的工具循环：拼请求 → `callModel`（流式）→ 执行工具 → 再请求，最多 6 轮；复用 AShareSim 的协议层（`buildRequest`、`callModel`、`parseResponse`）、服务配置和 Key、`ai_message` 存法、兼容服务的缓存参数回退。模型、思考强度和联网搜索按小节对话保存（`study/config.ts`），和 AI 助手的对话配置分开；长对话按词元预算自动整理（`study/compact.ts`）。不做 MCP、操作卡。见 [AI 讲解选项与自动整理](design/ai-study-options.md)。
- 数字溯源：伴读回答也用 AShareSim 的 `traceNumbers` 对一遍，找不到来源的数字加虚线。

## 9. 公式

- 独立公式（`$$…$$`、MinerU 的 equation 块）：离线 MathJax 3 在一个隐藏的 WebView 里转成 SVG，`SvgXml` 显示（移植 Pagewise `services/math`）。内存缓存 300 条；3 秒没渲染出来或报错就显示原始 TeX（等宽字体）。
- 行内公式（`$…$`）：本机把简单 TeX 转成带 Unicode 上下标的文字（$r_t$ → rₜ，$\sqrt{252}$ → √252，希腊字母、×、≈、≤）；转不了的保留原文、等宽显示。行内用 SVG 在 RN 的 Text 里对不齐基线，所以不用。
- v0.1.1 起忽略数学模式中的源空白（包括 MinerU 插入的逐字符空格），按运算符补空格；`\text{…}` 等文本命令保留词间空格。OCR 本身识错或漏掉的内容不会自动补写。
- MathJax 资源在 `postinstall` 时从 `node_modules/mathjax` 复制到 `android/app/src/main/assets/math/`（不进 git，CI 和本机都会生成）。

## 10. 新增依赖

| 包 | 版本 | 用途 |
| --- | --- | --- |
| `@react-native-documents/picker` | 12.0.3 | 选书（复制到 App 私有目录） |
| `react-native-blob-util` | 0.25.1 | SHA-256、读文件、MinerU 大文件 PUT 上传、结果包下载 |
| `react-native-zip-archive` | 9.5.3 | 解压 EPUB 和 MinerU 结果包 |
| `react-native-webview` | 14.0.1 | 只用于离线 MathJax |
| `htmlparser2` | 10.0.0 | EPUB 的 XHTML / OPF / nav（纯 JS） |
| `mathjax`（dev） | 3.2.2 | 复制 `tex-svg.js` 进 APK |
| 原生 `DocumentStore.pdfPageCount`（Kotlin） | — | 加在 AShareSim 已有的 DocumentStore 模块里：用系统 `PdfRenderer` 读 PDF 页数，只读 App 私有目录里的文件 |

版本和 Pagewise 在 RN 0.87.1 上验证过的一致。不加：PDF 渲染库、FTS5（全文搜索 V1 用 `LIKE`，一本书几万个块够快）。

## 11. 测试

| 范围 | 怎么测 |
| --- | --- |
| `book/` | 示例教材：24 个标题、19 个叶子小节、3.1 有 5 个块；步骤切分规则；引用校验（通过 / 小节没读过 / 块不存在）、来源标记、流式半截标记；行内公式转换；Leitner 盒子和到期日 |
| EPUB / MinerU | 用内存文件系统喂构造的 EPUB（container、OPF、nav、XHTML）和 MinerU 结果包；MinerU 客户端用假的 fetch 走申请上传地址 → 上传 → 轮询 → 下载，覆盖错误码映射和续传 |
| `quant/` | 指标对手算值；**分组回测和原型对账**：用原型的快照日线跑 20 日动量 / 每 20 日 / 5 组，期数、IC 均值、t 值和 `quant.js` 一致（9 期、+0.094、0.92） |
| 数据层 | 迁移 0008 在内存库上跑通；书、小节、块、笔记、卡片、复习的仓库读写；`ai_thread.kind` 过滤 |
| 伴读运行时 | 内存库 + 脚本化的 SSE 回复：讲解 → `load_section`（岔路）→ 引用校验 → `plot_chart` 存图 → `factor_test` → `ask_quiz` 作答进 `<action_results>` → `propose_section_wrapup` → 保存后进度前移；请求结构（工具排序、两个缓存断点、`<study_state>`） |
| AI 助手 | 工具数 40、排序；`plot_chart` / `factor_test` / `meta_label_test` 在助手里能用 |
| 界面 | 书架、地图、听讲（含图表卡片）、读书、小结、复习、因子实验室的渲染测试 |
| 真机 / 模拟器 | 独立 QuantWise_Test 模拟器已用真实模型走通听讲、行情举例、因子检验、检查题、小结和闪卡保存，并通过 MinerU 导入 5 页 PDF；公式和图表标签修复已在 release APK 上走查。见 [v0.1.1 发布说明](releases/v0.1.1.md) |

## 12. 实施顺序

| 步 | 内容 | 验收 |
| --- | --- | --- |
| Q1 | `book/`：类型、assemble、Markdown、步骤、标记、行内公式、复习、示例教材 | 单测 |
| Q2 | 迁移 0008、`bookRepo`、`quantRepo`；第一次启动写入示例教材 | 单测 |
| Q3 | `quant/`：指标、因子、回测、图表数据；股票池和数据准备 | 和原型对账 |
| Q4 | `study/`：提示、上下文、工具、运行时；助手接入行情与因子工具 | 脚本化对话测试 |
| Q5 | 导入：文件选择、哈希、Markdown、EPUB、MinerU、PDF 页数、解析进度 | 单测 + 模拟器导入 Markdown |
| Q6 | 公式：MathJax 资源、WebView 桥、`MathView` | 模拟器显示示例教材的公式 |
| Q7 | 界面：学习 Tab 两段、书架、地图、听讲、读书、小结、复习、笔记、因子实验室、全屏图、设置 | 渲染测试 + 模拟器走查 |
| Q8 | `npm run check`、release APK、模拟器走查、发布 v0.1.0 | 全绿；APK 能装能用 |

v1.0.0 为首个以「因读」命名的正式 Android 版本。名称、原生工程和升级兼容情况见 [v1.0.0 发布说明](releases/v1.0.0.md)。

## 13. 已知限制

- PDF 只有重排阅读，没有原版页和位置框；引用显示页码，但不能跳到原版页。
- 沪深 300、中证 500、中证 1000 用当前成分回测，有幸存者偏差；`size`、`turn20` 用今天的股本近似。界面和工具结果里都写明。
- 前复权日线约 5 年（约 1,200 根），期数仍远少于书里的学术样本；分钟级因子不做。
- 全文搜索是 `LIKE`，不分词。
- 只做 Android；iOS 工程保留但没有验证。
