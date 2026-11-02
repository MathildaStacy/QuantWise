---
version: 1
slug: "src-ui-screens-studyreader-tsx"
primary_target: "src/ui/screens/StudyReader.tsx"
related_targets: ["src/ui/screens/StudyScreen.tsx","src/ui/components/TranslatedBlock.tsx"]
---

# Study reader translation

Mode: Read. Extend the existing Android reader; use the product plan in `docs/design/ai-translation.md`. User confirmed simplified Chinese only. No new visual world or generated artwork.

## Direction contract

THESIS: Keep an original sentence and its Chinese translation together so the reader can check meaning without moving between screens.

OWN-WORLD: Inherit warm paper, serif source text, native sans translation, muted ink and blue actions from the existing reader. A fine neutral rule identifies translations; paragraphs remain continuous.

STORY: Choose 中文对照, explicitly translate the section or one paragraph, read completed pairs, stop or retry remaining work. Cached text survives reopening.

FIRST VIEWPORT: Existing book header, one 原文 / 中文对照 / AI 讲解 row, compact progress with translate/stop action, section heading and first source/translation pairs. No second mode row. Text wraps at narrow phone widths and enlarged system type.

FORM: Established reader extension, fixed by the current implementation and confirmed brief; code-led. No concept roll because the surface identity is already settled. No comp or shipping raster.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
