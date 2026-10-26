# CIE Visual Design Specification

## 2026-10-26 owner-verified six-image redesign — current visual authority

The owner supplied six original full-resolution PNGs in the local, Git-ignored `prompts/m3-visual-redesign/references/`. This newer approval **supersedes the earlier blanket prohibitions in sections 1–3 and the previous M3 crosswalk in section 8 where their purely visual rules conflict**. Those sections remain below as historical records. The app retains the working name CIE: the references' Cinder Archive, HERMES and Codebase Intelligence wordmarks conflict and do not constitute a rename decision. The functional M2 graph and local security contracts override illustrative data in every screenshot. This M3 redesign is implemented **awaiting independent owner review**, not declared owner-approved.

| Original reference                           | Current role and treatment                                                                                                                                                                                                                                  |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01-archive-source-inspector.png` (1672×941) | Parchment `FileDetail` with dark path tree, large real filename, inset M2 evidence and real right-side relationships. No invented source text or AI notes; M6 source remains future. Repository metadata can open this view for files in an analyzed graph. |
| `02-archive-landing.png` (1672×941)          | Full-bleed locally bundled original archive-hall artwork behind real React navigation, editorial hero, three framed actions and truthful current-selection panel. No fabricated recent-project rows.                                                        |
| `03-assistant-workspace.png` (1672×941)      | Dark hairlines, framed file context and neighboring real relationships inform the atlas dock. AI chat, metrics, runtime call graph and risk cards remain absent/disabled until M5/M7.                                                                       |
| `04-functional-3d-prototype.png` (1500×900)  | Existing search, synchronized tree/scene/inspector, directed static-import evidence, camera actions and WebGL fallback remain the behavioral contract, not the final look.                                                                                  |
| `05-immersive-3d-atlas.png` (1536×1024)      | Primary M3 target: 214px rail, panoramic true-3D stage, faceted luminous ID-bound file prisms, real directory zones, floating tools/selected card, four-part lower investigation dock. No fictional towers or false minimap.                                |
| `06-functional-2d-prototype.png` (1500×900)  | Future M4 design target only. The 2D mode is visibly disabled and marked Available in M4; one-hop related-file list is not a 2D renderer.                                                                                                                   |

### Implemented material, scale and behavior

- `apps/web/src/tokens.css` keeps the baseline palette; `atlas.css` adds the current obsidian `#080706` / stage `#07080b`, brass `#bd985c`, selected gold `#f0c98b`, warm ivory `#efe5d2` and parchment `#f0e3ca`/ink `#2e241d`. Hairline frames, inset corner cuts, translucent glass, bevel shadows and serif headings distinguish Home, stage, dock and source-evidence surfaces. System Georgia/Noto Serif fallback is used for display, sans for controls, mono for paths; there is no runtime font request. Original decorative Home art is generated for this project (no baked UI), stored locally at `apps/web/public/art/archive-hall.webp`, not copied from the screenshots.
- `App.tsx` hosts the crest, navigation and true local API status. Home has an enabled path-based Open Local Repository action, a Resume action only while a current in-memory selection exists, and explicitly disabled snapshot import. The atlas mode switch offers real 3D and disabled 2D/M4; Findings/M5 and Assistant/M7 are disabled. No future feature pretends to return data.
- `GraphPage.tsx` owns one selected file ID for stage, searchable nested explorer, workbench, inspector, one-hop list and parchment detail. Project structure auto-opens the densest actual branch; all files remain reachable by real path. Selected/neighbor filename chips have priority over unrelated labels, with collision culling. Hover/focus and the explorer/inspector reveal complete paths. `graphModel.ts` groups only actual parent directories; familiar module-name palettes apply only when such directories exist, otherwise a deterministic palette is used.
- `GraphScene3D.tsx` remains React Three Fiber/Three.js perspective WebGL. Each prism is one real M2 file, with translucent faces, wire outlines and a lit top; heights are visual layout treatment from path/selection, **not** LOC or risk. Only `resolved_static` imports and re-exports connect files, importer → referenced file. Gold outgoing and blue incoming emphasis and evidence rows convey direction. Fit includes tower tops; Reset is closer on wide stages, full-bounds on narrow; native OrbitControls handles orbit, pan, zoom, with keyboard buttons for Fit/Rotate/Reset and module/file focus.
- At desktop ≥1440px the stage takes ~56vh above a four-pane dock: tree, file/evidence context, directional connections, related-file list. At 1024px the last panel drops below; at ≤900px the nav becomes horizontal and the dock stacks; at ≤700px Files/Inspector buttons expose either data pane, with compact on-stage control popover. Focus outlines, touch-size primary buttons, reduced-motion hover fallback and a real tree/inspector WebGL fallback remain essential. The selected metadata card/inspector use real language, parse status, path and exact counts; the parchment detail shows actual static declaration specifier/line/column while explicitly marking source bytes M6-only.
- No screenshot-as-UI, fictional repository data, fake minimap, CDN, source upload or new server endpoint. The Home art may depict decorative monumental architecture and a distant figure per reference 02; those motifs are **not** graph objects. At the real 31-file CIE graph the atlas is naturally less crowded than the illustrative multi-hundred-tower reference.

Final browser captures live in `docs/screenshots/ui-redesign-*.png`; the six original reference PNGs remain only in ignored `prompts/`, not bundled into the running application. See root `ARCHITECTURE.md` ADR-022 for supersession and risk tradeoffs.

- **Status:** Approved _direction_ distilled from the design discussion; the CSS tokens below are proposed implementation values, **not claimed pixel samples of reference screenshots**.
- **Reference conversation:** https://chatgpt.com/share/6addfe15-6604-83ee-865a-89701c1623fd
- **Applies to:** M0 shell and subsequent M1–M9 experiences.
- **Priority:** Latest **explicit user corrections** > early assistant concepts/mockups > this file's suggested token values.

## 1. Design lineage and final intent

- **Previous direction:** Elden Ring-themed black and gold fantasy aesthetics. **Superseded.**
- **New direction:** An **original** interactive code intelligence application aesthetically inspired by _Clair Obscur: Expedition 33_: painterly subtlety, art-directed mood, precise cinematic spacing, an editorial sense of hierarchy, quiet ornamental flourishes and dramatic use of darkness.
- **Not a direct replica:** No game asset extraction, reproduced interface elements, trademarks, soundtrack, intellectual-property mimicry, or copy-pasted scenery.
- **Hybrid choice:** Favor sophisticated menus/panels plus spatial visualization; decorative ambition must never obscure utility.
- **Visualization concept discussed:** Astral Constellation / a technical dependency observatory. These are **metaphors for the visualization**, not a replacement project/product name.
- **One-line principle:** _Make the codebase itself the world, with visible, traversable file connectivity._

## 2. Crucial accepted/rejected elements

### Must communicate

- A **genuine 3D space** in M3, not a static 2D infographic with perspective. At least camera rotation/orbit, zoom/pan and spatially separated file clusters when M3 exists.
- Every meaningful node corresponds to a **real file or folder**; visible filename labels, paths and highlighted relationships as interaction allows.
- Edges mean real, explainable relationships such as import/export/module reference, with a documented origin, confidence and direction where applicable.
- Structural groupings like `frontend/`, `backend/`, `config/`, `shared/`, etc. derived from actual repository structure, not artificially themed regions.
- A visible **3D ↔ 2D** affordance; later the same graph data powers both.
- A mostly black/ink-dark canvas; warm off-white text and **measured** antique-metal accent rather than full-frame yellow/gold.
- Clean, legible developer tooling embedded in a painterly, restrained, dramatic shell.

### Must avoid

- Human characters, humanoid silhouettes, warriors, people or mascots.
- Castles, kingdoms, palaces, ruins, city panoramas, fantasy architecture, or ornamental world maps.
- A large 3D kingdom or mountainous landscape standing in for a codebase graph.
- Random bright stars masquerading as file nodes; fake sample dependencies shown as if real.
- The name **“Cinder Archive”** or any unapproved invented product identity.
- A generic black/gold Elden Ring RPG inventory copy or a generic SaaS sidebar with no art direction.
- Background motion, lens flare, film grain or glow strong enough to compromise reading/code inspection.

## 3. Proposed visual language / adaptable tokens

| Role                | Candidate value | Use                                   |
| ------------------- | --------------- | ------------------------------------- |
| Deep background     | `#09090A`       | app background                        |
| Visualization stage | `#050506`       | graph canvas area                     |
| Elevated panel      | `#141316`       | bars, inspectors                      |
| Soft border         | `#353137`       | restrained separators                 |
| Primary type        | `#EDE8DF`       | high contrast headings, body          |
| Muted type          | `#AAA39A`       | secondary UI                          |
| Antique accent      | `#BAA07A`       | precise highlights, focus, selection  |
| Accent brighter     | `#D6BD94`       | highlighted hover/active details only |
| Error               | `#D18E86`       | clear offline/error state             |
| Success             | `#97B19C`       | online/ready states                   |

**These are deliberate starting suggestions, not an exact color match to approved generated images.** Verify visually during design review; change by editing shared tokens, not scattered literals.

**Typography:** editorial serif for the primary headline/brand treatment (system fallback e.g. Georgia), neutral highly legible sans for controls/text, monospaced type for paths and code. Use only legally redistributable fonts or system stacks. Over-styled serif labels on every UI element are forbidden.

**Material:** very low-frequency watercolor/paper/ink suggestion in non-interactive background; ultra-subtle ambient flecks only if they aren't mistaken for graph nodes; light bevels/soft shadows, thin hairline accents. Avoid literal paintings of landscapes.

**Motion:** slow and intentional transitions for panels, hover states, and loading only. Honor `prefers-reduced-motion`; never use perpetual unnecessary motion in M0.

## 4. M0 application shell wireframe (STRUCTURE, not pixel-perfect)

```text
┌──────────────────────────────────────────────────────────────────────────────────┐
│  CIE  ·  AI Codebase Intelligence Engine     No repository selected    LOCAL ●    │
├───────────────────┬───────────────────────────────────────────┬──────────────────┤
│                   │  Explore the structure behind the code   │  FILE DETAILS    │
│  Workspace        │                                           │                  │
│  Repository (M1)  │  [3D (M3)] [2D (M4)]  (clearly deferred)  │  No file selected│
│  Graph (M3)       │ ┌───────────────────────────────────────┐ │                  │
│  Insights (M5)    │ │                                       │ │  Select a real   │
│  AI (M7)          │ │         EMPTY VISUAL STAGE            │ │  file after      │
│                   │ │                                       │ │  importing a repo│
│  Settings         │ │     No repository loaded             │ │                  │
│                   │ │     (no fake nodes or edges)          │ │                  │
│                   │ │                                       │ │                  │
│                   │ └───────────────────────────────────────┘ │                  │
├───────────────────┴───────────────────────────────────────────┴──────────────────┤
│  Local API: connected / disconnected     Index: not started                     │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### Screen-level guidance

- **Top/header:** slender, typographic, sophisticated; working name `CIE` only. Local status clearly visible and truthful.
- **Sidebar:** spatially economical, vertical rhythm and fine separators. Future nav states must clearly show their later milestone.
- **Main hero:** a clear statement of purpose, not fantasy lore. Example placeholder: “Understand how your code connects.”
- **Main stage:** prioritize negative space and legibility. A later 3D graph should be the primary visual; the M0 empty state reserves its region.
- **Right inspector:** an honest unselected/empty detail state and future extension point.
- **Bottom strip:** operations-style status for localhost and indexing; `Not started` is the M0 truth.
- **Mobile/narrow:** show accessible stacked layout or drawer; don't force a broken three-column grid.

## 5. Interaction contracts by milestone

| Control / behavior                | M0                                  | Future                 |
| --------------------------------- | ----------------------------------- | ---------------------- |
| Workspace & Settings navigation   | Functional                          | Expandable             |
| Local API status and retry        | Functional                          | Continues              |
| Repository selection              | Disabled with explicit M1 label     | M1 functional          |
| Repository tree/data              | Not implemented                     | M1                     |
| Graph mode navigation             | Disabled with explicit M3 label     | M3                     |
| Actual file-node edges and camera | Not implemented                     | M2 data / M3 rendering |
| 2D/3D mode switching              | Visually present, disabled/deferred | M3–M4                  |
| File inspector with real metadata | Empty-state shell only              | M6                     |
| AI assistance                     | Disabled with explicit M7 label     | M7, opt-in             |

No deceptive interactions, fake activity, disabled control without explanation, or placeholder graph passed off as functionality.

## 6. Accessibility and responsiveness

- WCAG-informed color contrast, keyboard tab order, visible focus rings, semantic landmarks, aria/HTML labels, >=44px tap targets when practical.
- `prefers-reduced-motion` implementation, not just a mention in README.
- Desktop: inspector visible; mobile: inspector lower in flow/collapsible. Support 320px and above without horizontal page scroll.
- Icons never replace the only readable label for critical controls.

## 7. How to resolve differences from shared chat screenshots

This document records the **explicit corrections that can be confirmed from the conversation**. It does **not** claim that every shared generated image has been reproduced or that sample color codes are exact. The coding agent should compare the final relevant approved visuals if it has access; **do not prioritize an older, rejected image over newer user feedback**. If images are inaccessible, keep the approved _principles_ above and note missing pixel-level reference in the final agent report. Do not stop the M0 implementation over missing images.

## 8. M3 owner-approved reference crosswalk (2026-10-26)

Historical M3 note: the first M3 handoff had only a text crosswalk. The owner subsequently supplied all seven original PNGs and `FILE_GRAPH_3D_PROTOTYPE.html` in the ignored `prompts/m3/correction/assets/`. The correction uses those exact references, not screenshot backgrounds. No reference asset is committed.

| Screenshot                                             | M3 use                                                                            | Deferred scope                                                    |
| ------------------------------------------------------ | --------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1 — dark 2D dependency view                            | Accurate tree, file names, path labels, dependency direction and selection detail | Functional 2D mode (M4)                                           |
| 2 — luminous 3D clusters                               | Spatial depth, connected file nodes, restrained gold lighting                     | Prototype name and source editor (M6)                             |
| 3 — directory regions                                  | Real module grouping, search, camera and label controls                           | Unproven metrics or a fake minimap (M5)                           |
| 4 — spatial file relationships                         | True perspective orbit, file-to-file import direction, inspector clarity          | Functional 2D mode (M4)                                           |
| 5–7 — source workspace, landing and inspector concepts | Restrained typography/framing only                                                | Code/AI/advanced intelligence (M5–M7), unrelated landing redesign |

M3 keeps CIE identity. Screens 02–03 are the primary targets for the dark, spatial, grouped file composition; 01 and 04 guide paths, tree, toolbar, legend and inspector. Screens 05–07 set the long-term editorial mood, not permission for source/AI/landing features. The HTML prototype informs panel hierarchy and controls only; its 2D Canvas and fictional graph data are not production components. The corrected implementation uses genuine perspective WebGL, directory-derived 3D grouping, evidence-backed directed lines, collision-capped filename chips, selected/neighbor priority and full paths outside the scene. The near-black stage and slender gold accents are approximate design interpretations, not a pixel-perfect recreation of concept art. M4 2D, M5 metrics, M6 source view and M7 AI remain deferred. M3 is implemented, awaiting independent owner review.
