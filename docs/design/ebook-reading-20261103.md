# 真实书籍电子书排版验收

2026-11-03，`codex/ebook-reading`，基于 `465671d`。本轮按 PM 的实际阅读路径检查原文、中文对照、图表公式与阅读设置，并直接修复。承接 [六本 PDF 验收](reading-acceptance-20261102.md)，复用已入库的真实 MinerU 结果。

结论：在本轮测试的 Android 手机尺寸上，原文和译文已有一致的书籍排版，支持连续按段阅读与逐句核对，准备好进入集成 review。这里的通过指显示与交互；旧解析中的数学符号、页码归属和内容污染问题仍以此前的内容审计为准。

## 从问题到实际行为

| 实际问题 | 本轮修改 |
| --- | --- |
| 中英逐句交替过于碎片化，中文像界面说明 | 默认完整原段后跟完整中文段；两种语言均用系统衬线字体，中文用稍浅的墨色和细分隔线。仍可切换逐句核对，复用原有句对缓存。 |
| 字号、行距固定，正文、图注和标题层次弱 | 新增宋体/黑体、16/18/20/22 号、标准/宽松行距。默认正文 18、行高 31，标题 +6，图注/表格 −3；24dp 页边距、20dp 段间距。设置持久保存。 |
| 段号和导读占用正文注意力 | 移除逐段可见的 ¶ 标签；引用、解释、高亮保留在段落操作内。导读收进工具栏，PDF 原页与排版随时可用。 |
| HTML 表格转 Markdown 丢失跨行跨列表头 | 使用原始 HTML 的单元格跨度建立原生网格，保留表题、表注。长表横向滚动，字体变化后重新测量行高。 |
| 插图被统一高度压缩，代码折行打乱结构 | 插图按真实宽高比展示，引用预览保留紧凑尺寸；代码使用等宽字体和独立横向滚动。 |
| 旧解析正文露出 `\-`、`\_` | 仅展示层恢复列表和转义字符，普通负数、代码与 TeX 不经过同样处理；源文、块 ID 和引用位置不改写。 |
| 排版变化容易丢失位置 | 重排保留可见块及块内相对位置；冷启动恢复阅读位置、对照模式和阅读偏好。 |

实现以 `StudyReader`、`BookBlock`、`TranslatedBlock` 为主；新增阅读器局部字体角色与偏好、原生表格和行内文本组件。`MathView` 新增可选字号，其他调用的默认字号不变。没有数据库迁移、依赖升级或重新解析全书。

## 真实样本与原生验证

使用隔离的 `QuantWise_Ebook_20261103` / `emulator-5586`，克隆此前验收数据。共六本书、2,879 页、19,702 块。未操作 Claude 的 `emulator-5590`。下表为实际打开并查看的首部、中部、末部小节，页码为 PDF 物理页码。

| 书籍 | 首部 | 中部 | 末部 |
| --- | --- | --- | --- |
| ISLP | Overview，p.12 | 第 7 章，p.297 | 第 13 章，p.563 |
| 机器学习实战，第 2 版 | 第 1 章，p.30 | 第 10 章，p.400 | 第 19 章，p.893 |
| 因子投资：方法与实践 | 第 1 章，p.8 | 第 4 章，p.200 | 第 7 章，p.372 |
| 打开量化投资的黑箱 | 第 1 章，p.19 | 第 7 章，p.124 | 第 13 章，p.240 |
| Advances in Financial Machine Learning | 1.1，p.30 | 12.1，p.188 | 第 22 章，p.356 |
| 利率模型讲义 | 第 1 主题，p.4 | 6.1，p.13 | 第 10 主题，p.22 |

另外检查 ISLP 合并表头/跨行标签、图像、数学段落及列表，机器学习代码，利率讲义公式；全量回放六本书的 **193 个 HTML 表格，其中 60 个含合并单元格**，检查单元格数量与网格重叠。全量结构检查不是 193 张表的逐格视觉校对。

真实翻译使用克隆设备已配置的 `gpt-6.1-sol`，通过生产 App 翻译入口完成：AFML 1.1 的 5 段/29 个句对，ISLP 矩阵记号的 1 段/4 个句对，合计 **6 段、33 个真实句对**。检查了按段/逐句切换、原文保持、公式显示和缓存复用；不是整书翻译质量认证。

设备检查覆盖约 411dp / 系统字号 1.0，以及 360dp / 系统字号 1.3 / 系统深色设置。后者仍显示应用现有的浅色书页。设置选项可操作、文字正常换行，公式与表格可横向滚动。原生冷启动前后，ISLP 锚点均为块 65、相对位置 `0.5966641036760089`，译文边界只差 1 个物理像素；字体和对照偏好一致。

## Finish review

采用 Impeccable 的完整原生方法：本上下文完成 Assessment A，查看实际模拟器截图和交互；web detector/overlay 不适用于 React Native。本轮没有生成图像资产或引入网页样式。

- 层次：标题、正文、中文、图注和工具分工明确；中文正文不再使用小号界面说明样式。
- 阅读连续性：默认按段对照；可选逐句模式支持核对；更改排版和重新打开都保持阅读位置。
- 复杂内容：合并表格、图片比例、代码缩进、公式及旧版列表恢复均有真实样本证据。
- 裁决：**ready for integration review**，适用于上述 Android 手机验证范围。iOS、平板、实体机和完整 TalkBack 遍历尚未验证。
- 仍存在的具体内容问题见前次审计；例如利率讲义旧 OCR 的负号、AFML 损坏符号。本轮没有把美观显示当作这些内容已正确。
- 共享导航栏中的含 TeX 章名仍是普通文本；阅读页内的大标题已按行内数学排版。后续修改共享导航时需与讲解/图表分支协调。

Questions skipped: 用户已明确要求继续审查并改进，已有真实书和既定视觉方向足够执行。

## 回归与并行工作

`npm run check`：TypeScript 通过，ESLint 0 错误、2 条原有测试警告；**68 个套件、825 项测试通过，4 项既有 live 测试跳过**。测试启用了 `PAGEWISE_DOWNLOADS_FIXTURES` 和 `QUANTWISE_READING_BLOCKS`，覆盖真实解析语料。上述 33 个设备真实句对独立于 Jest 数量。Android `assembleDebug` 成功，离线 MathJax 资产已打包；临时导航调试入口已恢复为原文件。

Claude Code 会话为 `AI讲解股票数据图设计`，工作树 `.claude/worktrees/lecture-chart-readability`，分支 `feat/lecture-chart-readability`。本轮独立工作树为 `QuantWise-ebook-reading`；没有修改它正在编辑的 `StudyScreen`、`StudyThread`、`readTheme`、图表、提示词和既有 study UI 测试。新增阅读器字体角色单独放在 `readerTypography.ts`。检查时双方改动文件交集为空，本轮完整补丁在 Claude 工作树执行 `git apply --check` 成功，主工作树保持干净；没有实际应用到 Claude 工作树。结果保存在下述本地证据目录；这只证明检查当时的文本兼容性，后续双方继续编辑仍应重新检查。

本轮保留本地独立分支，未合并、推送、打 tag 或发布。真实书文、完整译文、原页和截图均留在 Git 忽略目录，不进入提交。

## 本地证据

工作树内 `log/ebook-reading/`：

- [排版效果](../../log/ebook-reading/ebook-preview.jpg)、[中文正文](../../log/ebook-reading/factor-recheck.png)、[按段对照](../../log/ebook-reading/islp-paragraph-final.png)、[逐句对照](../../log/ebook-reading/islp-bilingual-final.png)。
- [大字号设置](../../log/ebook-reading/settings-large-dark.png)、[表题与合并表格](../../log/ebook-reading/islp-table-caption.png)、[表格横向滚动](../../log/ebook-reading/islp-merged-table-pan.png)、[列表](../../log/ebook-reading/list-rendering-final.png)。
- [中部/末部走查 1](../../log/ebook-reading/later-review-0.jpg)、[走查 2](../../log/ebook-reading/later-review-1.jpg)、[冷启动恢复](../../log/ebook-reading/reopened-state.json)。
- [最终检查](../../log/ebook-reading/check-final.log)、[Android 构建](../../log/ebook-reading/android-final.log)、[并行分支检查](../../log/ebook-reading/conflict-check.json)。
