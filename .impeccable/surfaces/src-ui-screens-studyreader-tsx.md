---
version: 1
slug: "src-ui-screens-studyreader-tsx"
primary_target: "src/ui/screens/StudyReader.tsx"
related_targets: ["src/ui/screens/StudyScreen.tsx","src/ui/components/TranslatedBlock.tsx"]
---

# Ebook reading and translation

Mode: Read. Extend the existing Android reader; use `docs/design/ai-translation.md` and the real-book acceptance record in `docs/design/ebook-reading-20261103.md`. Simplified Chinese translation only. Preserve the warm paper identity and existing learning actions.

## Direction contract

THESIS: Read a complete source paragraph and its Chinese translation in a continuous book page; switch to sentence pairs when checking meaning closely.

OWN-WORLD: Warm paper, native serif for both languages by default, quieter translation ink and blue actions. A fine neutral rule identifies Chinese text without a card. Native sans is an optional reading preference; interface controls retain their native sans role.

STORY: Open a real book, adjust font/size/leading if needed, choose 中文对照, explicitly translate the section or one paragraph, read completed paragraphs or sentence pairs, stop or retry remaining work. Settings and cached translations survive reopening. Type changes preserve the visible source block and relative position.

FIRST VIEWPORT: Existing book header and 原文 / 中文对照 / AI 讲解 row, quiet PDF 原页 / 导读 / 排版 tools, optional translation progress, section heading and continuous prose. Appearance controls open in a bottom sheet with a live type preview and 完成 action. The translation toolbar exposes paragraph/sentence grouping and pending-paragraph location; untranslated paragraphs offer their own translation/retry action. Chinese prose containing foreign terms does not get a duplicate translation. Source-text anchors survive mode and type changes. No repeated paragraph numbers. A 24dp gutter, 18sp default body, 31sp line height and 20dp paragraph gap establish the book rhythm. Tables retain merged cells, figures retain their aspect ratio, and captions use a smaller role.

FORM: Established reader extension, fixed by the current implementation and confirmed brief; code-led. No concept roll because the surface identity is already settled. No comp or shipping raster.

FINISH: Native Assessment A completed against six real books, paragraph and sentence translation, tables, figures, code and formulas. Verdict: ready for integration review on the tested Android phone sizes; see `docs/design/ebook-reading-20261103.md`. The five-issue PM follow-up is recorded in `docs/design/reader-polish-20261103.md`, including small-screen settings, partial translation recovery and source-position checks after merging main v1.6.0. No web detector applies and no generated raster ships. Existing OCR content defects remain separately recorded.

SCANNED FIGURES: For the two Chinese scan books, AI 清晰重绘 reads one figure into validated chart/table/diagram data. The reader renders native vector geometry and selectable text; reuse the local result on reopen. Always distinguish estimated chart samples from exact source data, retain original comparison and recognition notes, and show an unsupported reason when needed. Fit width first, expose enlargement on request. Long table cells grow and monetary decimals stay together. Separate 图表操作 from the scrollable figure to avoid gesture conflicts. Five real samples were verified at normal type, with chart/diagram/table checks at 360dp and 1.3× type; see `docs/design/scanned-figures-20261103.md`.
