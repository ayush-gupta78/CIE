# CIE Visual Design Specification

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
