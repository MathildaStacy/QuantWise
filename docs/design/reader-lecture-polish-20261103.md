# 书页、中文对照与 AI 讲解：十项体验优化

2026-11-03，`codex/reader-polish`。承接用户「作为 PM 再看书页、翻译页和 AI 对话讲解，列出 10 点并优化」的要求，完成上一段聊天中断时的改动。沿用既有暖白书页、衬线原文和蓝色学习操作。

## 问题与结果

| # | 体验问题 | 完成的优化 |
| --- | --- | --- |
| 1 | 导读展开后把正在阅读的正文推走 | 导读使用独立的可滚动底部面板；关闭后继续读原位置。 |
| 2 | PDF 重排阅读不知道当前物理页码 | 工具栏显示「原页 N」，随当前原文块更新；点按打开对应本地原页，可在原页面板跳页。 |
| 3 | 节末只能返回目录再选下一节 | 增加上一节／下一节及标题，按原书叶子小节顺序导航；保存当前进度，沿用中文对照选择。 |
| 4 | 后面的单段翻译失败，定位却跳到更早的未译段 | 定位顺序为正在翻译的段、失败段、第一待译段；状态显示「翻译失败」和「定位失败」。 |
| 5 | 本地缓存读取失败被显示成「尚无译文」 | 顶部与段下显示「译文暂未读取」，保留错误和「重读译文」；重读只读本地缓存。 |
| 6 | 引用预览先显示前一段，长段落把目标挤出首屏 | 首先显示命中的原段，前后文按需展开；新引用重新收起邻段并回到顶部。未加载的引用不会误显示第一段。 |
| 7 | 讲解步骤列表常驻展开挤占对话空间 | 步骤使用独立可滚动面板，保留当前、已讲、已跳过状态与选步入口；首屏路线图只显示当前步骤。 |
| 8 | 上下文常驻显示内部小节 ID，内容难懂 | 顶部保留「上下文」入口；面板显示小节名称、当前进度和模型偏好，请求与用量明细按需展开。 |
| 9 | 成功工具记录逐条堆在讲解前 | 成功记录默认折叠，错误直接可见；图表、检查题、小结和答案继续独立显示。展开记录、来源或岔路时暂停自动跟随，保留当前视口。 |
| 10 | 多个快捷动作藏在横向滚动条 | 保留主操作和看原文，将其余可用动作放进「更多」面板；长标签完整显示，生成中保持禁用状态。 |

段落菜单中的已有译文可以直接查看；没有缓存时，配置 AI、重读缓存与新翻译分别进入对应操作。

顶栏收紧后的连带问题也已处理：钉住的小图按自身高度占位，隐藏的步骤栏不再参与布局；小图下方的讲解可以完整阅读。保留图表数据、触摸读数、全屏与收起行为。

## 验证

- **自动检查**：75 个套件、896 项测试通过，4 项既有 live 测试跳过。启用 `PAGEWISE_DOWNLOADS_FIXTURES` 与 `QUANTWISE_READING_BLOCKS`，保留六本真实 PDF 解析语料回归。TypeScript 通过，ESLint 无错误，保留两条已有测试警告。Android `:app:assembleDebug` 成功。
- **新增回归**：覆盖相邻小节与中文对照保存、缓存读取失败的准确状态、后段失败优先定位、PDF 页码更新、导读独立面板、引用默认原段与失效目标、上下文标题、工具成功折叠与错误／检查题可见。
- **真实书籍**：使用隔离的 `emulator-5586` 和已有 ISLP 解析内容。Notation and Simple Matrix Algebra（19–21 页）与 Organization of This Book（22–23 页）之间双向跳转，中文对照保持选中，返回恢复到原页 21；对应本地 PDF 原图可打开。缓存读取失败后重读恢复，没有清空译文。
- **失败定位**：在后段 `Then`（第 21 页）注入翻译网络失败。较早仍有未译段，点击「定位失败」后直接显示 `Then` 和「重试本段」。本轮仅一次被拦截的翻译请求，没有实际网络翻译。
- **展示与交互**：约 411dp／正常字号，以及 360dp／1.3 倍字号，检查导读、步骤、更多、上下文、引用与工具记录。系统返回可关闭面板；大字号下内容可滚动，底部操作可用。系统深色设置下仍使用项目既有浅色书页。
- **图文同屏**：上述两种手机设置中，钉图完整显示，讲解视口从图下方开始；收起后恢复步骤与上下文入口。此项使用明确标注的内存示意行情，保留原有图表组件。
- **讲解验收数据**：讲解文字和工具成功／失败记录使用标明「验收示例」的内存数据，引用指向真实 ISLP 原段；不作为 AI 实际回答或行情结果。检查后恢复真实会话，没有将示例消息写入数据库。展开工具记录前后，当前问题的原生坐标均为 `[240,701][1032,829]`。

采用原生 Assessment A，证据来自 Android 模拟器截图和交互结果。结论：上述 10 项优化可进入集成 review；证据覆盖这两种竖屏手机设置，未包含实体设备、平板或完整 TalkBack 遍历。

## 并行开发与清理

按共同祖先核对 Claude 的 `lecture-chart-readability` 与 `jolly-kalam-4c70bf`。前者当前在 `212d1ab`；后者新增改动限于通用助手 `AiScreen`、`ChatProcess` 和对应测试。本轮与这些新增改动没有文件交集，也没有写入其工作树。阅读器补丁在讲解工作树执行 `git apply --check`，只检查兼容性。

临时导航入口已从 `App.tsx` 移除；原生验收使用的模型传输和缓存读取替身已恢复；模拟器密度、系统字号与深色设置恢复到验收前的 420dpi、1.0、关闭。书文、译文、截图和临时脚本保存在 Git 忽略的 `log/reader-polish/`。

## 本地证据

- [界面预览](../../log/reader-polish/reader-lecture-polish-preview.jpg)
- [节末相邻小节导航](../../log/reader-polish/ux-section-end.png)
- [真实 PDF 原页](../../log/reader-polish/ux-pdf-original.png)
- [引用原段优先](../../log/reader-polish/ux-cite-end.png)
- [窄屏更多讲解方式](../../log/reader-polish/ux-more-narrow.png)
- [窄屏上下文面板](../../log/reader-polish/ux-context-narrow.png)
- [失败段定位](../../log/reader-polish/ux-located-failed-narrow.png)
- [缓存错误恢复](../../log/reader-polish/ux-cache-recovered.png)
- [钉图与回答不重叠](../../log/reader-polish/ux-pin-final.png)
- [窄屏大字号钉图](../../log/reader-polish/ux-pin-final-narrow.png)
- [原生坐标与请求次数](../../log/reader-polish/ux-native-results.json)
- [最终全量检查（含六本真实 PDF 语料）](../../log/reader-polish/ux-check-fixtures-final.log)
- [TypeScript](../../log/reader-polish/ux-typecheck-final.log)
- [ESLint](../../log/reader-polish/ux-lint-final.log)
- [最终 Android 构建](../../log/reader-polish/ux-android-build-final.log)
- [Claude 改动范围](../../log/reader-polish/ux-overlap.json)
- [讲解工作树补丁兼容](../../log/reader-polish/ux-compatibility.json)
- [最终会话与模拟器清理](../../log/reader-polish/ux-final-cleanup.json)

Questions skipped: 用户已要求完成既定 10 项优化，沿用现有设计与既定方向。
