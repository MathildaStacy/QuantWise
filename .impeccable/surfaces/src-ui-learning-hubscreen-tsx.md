---
version: 1
slug: "src-ui-learning-hubscreen-tsx"
primary_target: "src/ui/learning/HubScreen.tsx"
related_targets: ["src/ui/learning/KnowledgeScreens.tsx", "src/ui/learning/QuizScreen.tsx", "src/ui/learning/ResearchScreens.tsx", "src/ui/learning/CoachReportScreens.tsx", "src/ui/learning/shared.tsx"]
---

# Personal quant learning

Mode: Operate / Read. An extension of the established learning workflow. User wants books, foundations and research covered together. Scope and acceptance live in `docs/design/personal-quant-learning.md`.

THESIS: Reading becomes useful when the learner can answer a question and record a testable hypothesis.

OWN-WORLD: Inherit the existing warm paper, native Chinese type, ink-blue learning actions, shared native controls and simple separated rows. No new visual identity, raster assets or chart changes.

STORY: Open 研习, choose a bounded task, practice without seeing the answer, review evidence, then retain a source-linked research note. Preview the material before explicitly starting AI practice.

FIRST VIEWPORT: Existing 学习 header and three segments, purpose line, current plan and the first actionable tasks. The question screen prioritizes the question and choices. Research editing begins with title and hypothesis. Long labels wrap at narrow width and 1.3× font scale.

FORM: Local learning extension, code-led using existing lists and reading typography; no concept roll for the settled surface. No decorative data or synthetic progress. Named interaction: a wrong answer becomes a targeted retry and a later correct answer resolves it while history remains.

FINISH: Native Android evidence, independent finish review, and documentation comparison against the incumbent system. Existing DESIGN.md and its sidecar stay unchanged; no generated shipping assets.
