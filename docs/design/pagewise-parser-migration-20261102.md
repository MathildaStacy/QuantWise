# Pagewise 书籍解析改进迁移与验收交接

2026-11-02。QuantWise 基线为 `bd886b9`（v1.1.0），迁移分支为 `codex/pagewise-parser-migration`。

结论：值得迁移的核心是 **OCR 默认配置、内容保留、章节纠错、缺少独立页内内容时保留原页，以及账号错误的可恢复暂停**。已完成这些改动。六本书的结构回归通过，但不能据此认定原始 OCR 里的所有公式正确；实际阅读与数学内容的验收交给下一会话。

## 来源及证据边界

主要来源是 Pagewise 已发布的 `908ca58` / v0.0.15，以及此前的 `92c8232` 结构识别规则：

- `src/services/mineru/adapter.ts`：保留脚注、边注和参考文献；无独立页内内容时保留原页。
- `src/core/layout/index.ts`、`src/core/map/index.ts`、`src/core/map/outline.ts`：目录页、图注、Part、附录、习题及章首识别。
- `src/app/usecases/parseQueue.ts`：账号与配额错误保留任务，允许恢复。
- `docs/dev/downloads-books-audit-20261102.md`、`__tests__/core/downloadsPrivate.test.ts`：六本书全量解析的验收证据。

迁移期间 Pagewise 工作区切换到 `codex/ocr-quality-audit`，在同一提交上出现尚未提交、尚未发布的 OCR 复核改动。本次只读参考了这些工作，不修改 Pagewise。新增证据见它的 `docs/dev/ocr-quality-audit-20261102.md`、`src/features/library/useLibraryVM.ts` 与 `src/ui/screens/ImportSettingsView.tsx`。

OCR 专项的原始单页结果也已核查：AFML p.62 在关闭 OCR 时有 5 个替换字符，开启后为 0；机器学习实战 p.256 开启后恢复约束里的 b；利率讲义 p.15 开启后包含负数 −0.002。这支持默认开启 OCR，但不能推广为全书准确性保证。本次没有重新上传整本书，也没有重新调用 AI 或消耗 OCR 配额。

## 已迁移

| 改动 | QuantWise 的行为及适配 |
| --- | --- |
| 默认开启 OCR | PDF 导入默认开启，包括已有文字层的书。用户可以关闭，切换模型不重置选择。移除“只有扫描版才需要”的误导提示。 |
| 保留书籍内容 | `page_footnote`、`aside_text`、`aside` 保留为正文段落；支持 `content`、`lines.spans` 嵌套文本。`ref_text` 原本已支持，继续保留。图片模型描述仍不冒充原文。 |
| 页内内容缺口 | 有检测区域、但没有独立内容的页面，用 Android 系统 `PdfRenderer` 从本地 PDF 生成原页 PNG。空白插页不生成假内容。提示明确为“未生成独立的可读内容”，不直接归因为 OCR 失败。 |
| 原页显示 | 兜底原页按实际长宽比显示，避免整页压进普通插图的固定高度框。渲染失败不会宣称已补齐；完成的云端分片保留，重试无需重新上传。 |
| PDF 章节校正 | 识别目录行与 SNIPPET 等图注，保留其文字但不新开章节；合并拆开的章号和标题；用目录/章首页眉证据恢复标题；至少 3 个锚点且 70% 支持相同页差时，补全图片形式的章首；保留 Part、章内书目、附录题解、书后注释的归属。 |
| 三层目录适配 | 深于三层的标题保留在正文；A.1、A.1.1 与中文 〇 可识别；普通示例教材的小节 ID 不变。新规则只在 PDF 导入流程应用，未重建已有书籍与学习记录。 |
| 可恢复暂停 | Token 失效、额度不足及网络问题保存暂停原因；书架和进度页显示暂停。继续时复用已接受的 batch 和已下载的分片。 |

主要实现：`src/study/import/pdfStructure.ts`、`src/study/import/mineruAdapter.ts`、`src/study/importer.ts`；原页渲染在 `DocumentStoreModule.kt`，显示在 `BookBlock.tsx`。

## 六本真实结果回放

复用 Pagewise 本地私有目录 `fixtures/private/downloads-20261102/raw/` 的 18 个真实 MinerU 分片，经过 QuantWise 的生产适配器、PDF 结构校正和 `assemble`。没有复制书籍到仓库；测试通过环境变量启用，CI 默认跳过。

| 书籍 | PDF 页数 | 迁移后正文章数 | 迁移前缺失的脚注/边注文本 → 迁移后 | 需要原页兜底的物理页 |
| --- | ---: | ---: | ---: | --- |
| ISLP | 613 | 13 | 673 → 0 | 无 |
| 机器学习实战，第 2 版 | 1,052 | 19，位于两个 Part 下 | 50 → 0 | 181、326、520、594、663、784 |
| 因子投资：方法与实践 | 546 | 7 | 17 → 0 | 164 |
| 打开量化投资的黑箱 | 252 | 13 | 3 → 0 | 无 |
| Advances in Financial Machine Learning | 393 | 22，第 2–22 章位于五个 Part 下 | 33 → 0 | 114 |
| Lecture07 利率模型讲义 | 23 | 10 个主题 | 0 → 0 | 无 |

总计 **2,879 页**。777 条脚注/边注记录中，迁移前有 776 条文本无法在正文中找到；迁移后全部保留。原本已在其他位置出现的同文记录不算文本缺失。所有非空 `ref_text` 也逐项保留；参考文献与附录中的数字章号没有被计入上表正文章数。每个正文块恰好属于一个可阅读单元，引用序号连续；ISLP 的 Exercises / Conceptual 分开。

这些检查不包含原书逐字校对。QuantWise 与 Pagewise 的单元划分不同，未用“小节数相等”冒充质量标准。

## 未复制的能力与后续重点

- **原生 PDF 书签、版面几何和多页来源**：Pagewise 有 PDFBox 与版面信息基础；QuantWise 当前只有系统 PDF 渲染。本次用现有可验证证据适配章节，没有引入整套新 PDF 引擎。
- **跨页定位问题仍存在**：专项确认上述 8 页中，7 页已被 MinerU 合并到前页，1 页（机器学习实战 p.663）脚注续行被当成页眉。原页图像让内容可见，但没有把图像变成可检索的独立文字，也没有修正合并块的引用页码。
- **已有数学内容不会自动修复**：默认 OCR 只影响新导入。旧结果中的负号、希腊字母、矩阵变量和公式编号错误仍需针对性重解析及原页核对。没有修改用户已有学习记录或引用。
- **AI 重整结构、人工校正 UI、默认学习范围筛选**：依赖 Pagewise 自己的结构版本、块引用迁移与学习范围体系，需要另做产品设计，不宜直接搬入 QuantWise。
- **全书显示与原页渲染实测**：本会话完成代码回归和 Android 编译。六本实际书架、阅读、图表公式、兜底页显示及 AI 内容质量由下一会话验收。

## 验证与复现

```sh
PAGEWISE_DOWNLOADS_FIXTURES=/Users/boren.fang/Desktop/Personal/Pagewise/fixtures/private/downloads-20261102 npm run check
```

最终 `npm run check`：**61 个套件、747 项测试通过**（包含六本私有夹具），4 项需凭据的 AI live 测试未运行。TypeScript 通过；ESLint 无错误，只有 2 条原有测试文件警告。

生产代码的合成回归覆盖脚注、嵌套文本、相对/绝对分片页码、空白页、缺页插入顺序、目录/图注误判、页眉章首、Part/附录归属、页码偏移条件、暂停恢复和原页渲染失败重试。UI 回归验证 OCR 默认开启与手动关闭后的模型切换。

Android 编译命令（在 `android/` 目录）：

```sh
JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home' ./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a --no-daemon --max-workers=2
```

Android Debug 构建成功。本次没有发布 APK、推送分支或合并 main。

## 下一会话的验收目标

先在独立 QuantWise 测试设备上复用真实结果，验证生产导入后的阅读体验；按需要对关键页以 OCR 开启的配置作增量对照。所有检查注明是缓存回放、新云端解析、原页视觉抽查还是 AI 实测。

优先核对：

1. AFML p.62 的 ω、σ、Λ 指数，以及 p.114 续表与 p.370 多页来源。
2. 机器学习实战 p.256 的 `Ap ≤ b`、p.681 的变量和 p.663 的脚注续行。
3. 利率讲义 p.15 的 −0.002、p.17 的两个负数与下标。
4. 因子投资 p.58 公式编号，ISLP p.610 双栏索引，黑箱封面英文人名。
5. 所有书的首章、中间章、末章、附录/参考文献入口；Part 层级、公式/表格/图片、8 张兜底原页、长标题和大字号下的可用性。
6. AI 引用既要验证块存在，也要核对来源数学符号；不能把引用能跳转当作 OCR 正确。

测试设备不要操作现有 `emulator-5554` 或 `emulator-5590`；仅使用/创建 QuantWise 专用设备。书籍和完整解析包保持本地私有，截图中非书籍的 recovery-code 文本不属于测试范围。
