# 书页与中英对照：五项体验优化

2026-11-03，`codex/reader-polish`。本轮承接用户「作为 PM 查看当前书页和翻译页，列出 5 点并优化」的要求。开发途中将 `origin/main`（`f8f5b7e`，v1.6.0）快进合入本分支，并恢复阅读器改动；收尾再次同步了 main 的 `212d1ab`，该新增提交只修正 Jest 在 Claude 工作树中的运行配置。两次同步均无合并冲突。

## 从问题到修改

| 问题 | 读者现在能看到的行为 |
| --- | --- |
| 中文书只要夹英文术语，就出现整段中文翻译，重复且打断阅读 | 根据去除公式和括号术语后的正文判断待译语言。中文正文不再因为 `IC`、`IR`、`moving average crossover` 或 `covariance matrix` 等术语被整段翻译。保留外文正文与日文的翻译能力；不改写书文或删除已有缓存。 |
| 排版设置展开后挤占正文，小屏下难以调节 | 排版改为底部面板，提供实时中英文预览；字体、字号、行距和对照分组仍可调节并保存。支持「完成」、关闭按钮、系统返回和点遮罩关闭；面板内容可滚动。 |
| 按段／逐句切换藏在排版选项中 | 对照工具栏直接显示当前方式，点按可选择「按段阅读」或「逐句核对」，并有连续阅读／精读的简短说明。复用同一组句对，不发翻译请求。 |
| 部分译完后不清楚哪里待译，失败后只能回到顶部处理 | 进度区域可定位当前／下一待译段；段下展示尚无译文、等待中、翻译中或本段失败状态，并提供单段翻译／重试。缓存读取失败时「重读译文」重新读取本地内容；AI 失败时只重试原请求中缺少的段落。 |
| 切原文、切对照、改字号后容易跳到段落的其他位置 | 阅读锚点增加原文中的相对位置及原文／译文区域，跨按段、逐句和字号变化映射到对应内容。连续切换保留目标位置；新段落跳转优先于旧重排锚点。重排期间由阅读器保位，用户再次拖动后恢复 Android 对异步公式布局的原生保位。 |

视觉保持原有暖白书页、衬线正文、细分隔线和蓝色操作。没有改讲解页、消息顺序、行情图表、AI 提示词或共享样式。

## 真实书籍与原生验收

使用隔离的 `emulator-5586`，不操作 Claude Code 的 `emulator-5590`；复用既有真实书籍及 MinerU 解析结果。新一轮在已合入 v1.6.0 的代码上复核：

- **AFML 1.1**：读取既有 5 段真实译文，长段落中部在按段、逐句、原文与对照间连续切换，仍在对应原句附近；字号变化后继续阅读。整个缓存读取与模式切换过程没有 AI 请求。
- **ISLP，Notation and Simple Matrix Algebra**：保留 1/19 段已有译文，定位第一待译段；注入 AI 网络失败后显示错误与「重试本段」，缓存没有被清空。冷启动后再次读取同一本地缓存，字体和对照分组保留，AI 请求为 0。
- **《打开量化投资的黑箱》，基于价格相关数据的策略**：含 `moving average crossover` 的中文原段在中文对照页不再重复翻译，显示「本节无需翻译」，原文及已重绘图表继续显示。
- **约 411dp、系统字号 1.0**：检查长段落中部切换、源文／译文布局以及同节跳转到另一段。
- **360dp、系统字号 1.3、系统深色设置**：检查 22 号字预览、底部面板、系统返回关闭、分组选择、进度定位与单段失败入口；操作文字没有裁切。应用继续使用既有浅色书页。

采用原生 Assessment A，直接查看模拟器截图和操作结果。结论：上述 5 个问题已修复，可在本轮测试的 Android 手机尺寸上进入集成 review。此前记录的 OCR 内容问题仍以原内容审计为准；本轮未重新翻译或重新解析整书。

## 回归与并行开发

定向回归覆盖中文混排判断、源文／译文位置映射、单段失败重试、缓存读取重试、新跳转优先、连续切换时保留被短页面限制的目标位置。

合入 main 后的最终 `npm run check` 通过：TypeScript 通过，ESLint 无错误；**75 个测试套件、890 项测试通过，4 项既有 live 测试跳过**。启用了 `PAGEWISE_DOWNLOADS_FIXTURES` 和 `QUANTWISE_READING_BLOCKS`，保留真实解析语料回归。Android `:app:assembleDebug` 成功。

并行检查对象为「AI讲解股票数据图设计」的 `lecture-chart-readability` 工作树及其消息顺序子工作树 `jolly-kalam-4c70bf`。讲解图表改动已随 main 合入；消息顺序分支实际改动为 `AiScreen`、`ChatProcess` 及相应测试，与本轮阅读器改动无文件交集。没有写入它们的工作树。

最终检查时，讲解工作树已继续到 `212d1ab`，仍无文件交集；本轮完整补丁在该工作树执行 `git apply --check` 成功，未实际应用。检查结果仅对应记录中的提交和当时未提交改动。

临时导航调试入口不进入提交；真实书文、译文、数据库和截图均留在 Git 忽略的 `log/reader-polish/`。

## 本地证据

- [长段落切换对照](../../log/reader-polish/native-position-review.jpg)
- [小屏大字号和排版面板](../../log/reader-polish/narrow-review.jpg)
- [待译段落失败与重试](../../log/reader-polish/partial-narrow-failed.png)
- [中文混排不再重复翻译](../../log/reader-polish/chinese-bilingual-final.png)
- [冷启动缓存和偏好](../../log/reader-polish/coldstart-final.json)
- [定向回归](../../log/reader-polish/native-anchor-tests.log)
- [最终全量检查](../../log/reader-polish/check-final.log)
- [合入 main 后的 Android 构建](../../log/reader-polish/android-integrated-final.log)
- [main 合入记录](../../log/reader-polish/main-integration.json)
- [并行改动交集检查](../../log/reader-polish/overlap-after-main.json)
- [最终补丁兼容检查](../../log/reader-polish/compatibility-final.json)

Questions skipped: 用户已明确指定 5 点审查并直接优化，视觉与真实书籍材料充足，沿用既有阅读设计。
