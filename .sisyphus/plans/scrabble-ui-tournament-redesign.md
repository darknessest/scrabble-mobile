# Scrabble UI Tournament-Style Redesign

## TL;DR
> Redesign the full app UI to feel like a physical tournament Scrabble set (classic board palette + tactile tiles), while preserving all existing game logic and DOM-renderer contracts.

**Deliverables**:
- Tournament/classic “physical Scrabble” skin applied to the shipped app (`index.html` + `src/style.css`).
- Legacy concept UIs removed (`designs/v1`..`designs/v5` + `designs/index.html`).
- New Beads epic with dependency-linked tasks to enable parallel execution.

**Effort**: Medium
**Parallel Execution**: YES (3 waves)
**Critical Path**: Beads epic + foundation tokens → board/rack/tile skin → overlays/polish → remove legacy designs

---

## Context

### Original Request
- Remove the 5 different UI versions created previously and start design over.
- Replicate the physical Scrabble boardgame experience and colors.
- Use tournament/classic palette.
- Create a new `bd` epic to track progress; tasks must have explicit dependencies for safe parallelism.
- Do local deployment first.
- Use `frontend-ui-ux` skill during execution.
- When completed, prompt the user to review the final design.

### What Exists In This Repo (verified)
- Shipped app entrypoint: `index.html` → `<script type="module" src="/src/main.ts">`.
- Rendering is DOM-template based in `src/ui/uiRenderer.ts` (not React):
  - Board cells: premium classes `tw|dw|tl|dl|center` + state classes `pending|remote-draft|last-move|valid|invalid|checking`.
  - Rack tiles: `<button class="tile">` with state classes `selected|pending|blank`.
- All styling is in one global stylesheet: `src/style.css` (already has CSS vars like `--cell-tw`, `--tile-bg`).
- The “5 UIs” are static concept pages under `designs/v1`..`designs/v5`, selected manually via `designs/index.html` (no runtime flags).
- Local stack: Vite + TypeScript + Vitest (`package.json` scripts: `npm run dev|build|preview|test:run|lint`).
- CI deploy: `.github/workflows/deploy.yml` builds and deploys `dist` to GitHub Pages.

---

## Work Objectives

### Core Objective
Make the entire UI feel like a physical Scrabble board set (tournament/classic palette + tactile tiles + tabletop framing), without changing game logic.

### Must Have
- Tournament/classic premium colors for squares and a legible center “start” star.
- Physical/tactile tile look (bevel + shadow + readable letter/value).
- Preserve all existing DOM IDs and renderer-emitted class names used by `src/ui/uiRenderer.ts`.
- Beads epic + child tasks with explicit blocking dependencies so tasks can run in parallel safely.
- Local run verification (`npm run dev` and `npm run preview`) and build/test gates (`npm run build`, `npm run test:run`).

### Must NOT Have (Guardrails)
- No changes to game rules, networking, storage, or controller logic.
- No changes that break `src/ui/uiRenderer.ts` class contracts.
- No theme switcher / multiple themes (single tournament-style skin only).
- Do not delete `designs/` until the new skin is in place and verified.

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: YES (Vitest)
- **Automated tests added**: NO (default for CSS-heavy redesign)
- **Gates**: `npm run lint`, `npm run test:run`, `npm run build`

### QA Policy (Agent-Executed)
Each task includes QA scenarios. For UI verification, use the `playwright` skill to:
- Start `npm run dev` and assert key UI states exist.
- Capture screenshots for: board empty, board with placed tiles, rack states, overlays, and error/invalid placements.
Evidence saved to `.sisyphus/evidence/`.

---

## Execution Strategy

### Parallel Execution Waves

Wave 1 (Foundation + Beads wiring):
- T1: Create Beads epic + tasks + dependencies
- T2: Local baseline run + capture baseline screenshots (pre-change)
- T3: Tournament palette + material tokens (CSS vars)
- T4: Typography + layout framing decisions (minimal HTML touch)

Wave 2 (Core skin — parallel where safe):
- T5: Board grid + premium squares styling (board-only selectors)
- T6: Rack + tile styling (tile/rack-only selectors)
- T7: Controls/cards/status pills/forms styling (general components)
- T8: App background/tabletop framing + header branding polish

Wave 3 (Overlays + cleanup + local deploy verification):
- T9: Overlays/banners/toast/ready screens styling
- T10: Accessibility + focus/keyboard + reduced-motion pass
- T11: Remove legacy concept UIs (`designs/`)
- T12: Local deploy verification pack + final screenshots + user review prompt

Dependency highlights:
- T5/T6/T7/T8 depend on T3/T4.
- T9 depends on T7/T8.
- T11 depends on T12 (so we don’t delete references before verification artifacts exist).

---

## TODOs

---

- [x] 1. Create Beads Epic + Dependency-Linked Task Tree

  **What to do**:
  - Create epic:
    - `bd create "UI Redesign: Tournament Scrabble Skin" -t epic -p 1`
  - Create child issues (titles may be adjusted, but keep the same grouping as this plan):
    - `bd create "Baseline local run + screenshot pack" -t task --parent <EPIC_ID> -p 1`
    - `bd create "Tournament palette + material tokens (CSS vars)" -t task --parent <EPIC_ID> -p 1`
    - `bd create "Typography + layout framing (minimal HTML touch)" -t task --parent <EPIC_ID> -p 2`
    - `bd create "Board premium squares styling" -t task --parent <EPIC_ID> -p 1`
    - `bd create "Rack + tile tactile styling" -t task --parent <EPIC_ID> -p 1`
    - `bd create "Controls/cards/pills/forms skin" -t task --parent <EPIC_ID> -p 2`
    - `bd create "Overlays/toast/banners skin" -t task --parent <EPIC_ID> -p 2`
    - `bd create "Remove legacy designs/ concepts" -t task --parent <EPIC_ID> -p 3`
    - `bd create "Local deploy verification + final screenshots + prompt review" -t task --parent <EPIC_ID> -p 1`
  - Add explicit *blocking* dependencies to enable parallel work safely (syntax per Beads docs):
    - `bd dep add <BoardStylingTaskId> <TokensTaskId>`
    - `bd dep add <RackTileTaskId> <TokensTaskId>`
    - `bd dep add <ControlsSkinTaskId> <TokensTaskId>`
    - `bd dep add <OverlaysSkinTaskId> <ControlsSkinTaskId>`
    - `bd dep add <RemoveDesignsTaskId> <FinalVerificationTaskId>`
  - Verify graph:
    - `bd dep tree <EPIC_ID>`
    - `bd ready` shows only tasks without blockers.

  **Must NOT do**:
  - Do not run `bd` commands concurrently (repo guidance: `bd` can crash if run in parallel).

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`beads`]

  **Parallelization**:
  - **Can Run In Parallel**: NO (wiring step)
  - **Blocks**: All other tasks (tracking + parallel execution)
  - **Blocked By**: None

  **References**:
  - `AGENTS.md` (Beads usage + concurrency warning)
  - `.beads/README.md` (Beads basics)
  - External: https://github.com/steveyegge/beads/blob/main/website/docs/cli-reference/dependencies.md (dep add/remove/tree/ready)

  **Acceptance Criteria**:
  - [ ] `bd list` shows the new epic and all child tasks
  - [ ] `bd dep tree <EPIC_ID>` shows the intended blocker relationships

  **QA Scenarios**:
  ```
  Scenario: Beads graph created and viewable
    Tool: Bash
    Steps:
      1. Run: bd dep tree <EPIC_ID>
      2. Run: bd ready
    Expected Result: Tree renders; blocked tasks do not appear in ready list
    Evidence: .sisyphus/evidence/task-1-bd-dep-tree.txt
  ```

- [ ] 2. Local Baseline Run + Pre-Change Screenshot Pack

  **What to do**:
  - Install deps and start locally (`npm ci`, then `npm run dev`).
  - Capture baseline screenshots for comparison (Playwright skill preferred):
    - Empty board state (pre-game)
    - In-game board + rack visible
    - “Invalid move” UI state (so we don’t lose feedback styling)
    - Game over overlay + banner

  **Must NOT do**:
  - Do not change app logic; this is baseline only.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`playwright`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: None
  - **Blocked By**: Task 1 (tracking only; can still be executed anytime, but prefer after epic exists)

  **References**:
  - `package.json` (scripts)
  - `vite.config.ts` (dev server behavior)
  - `index.html` (IDs to assert)

  **Acceptance Criteria**:
  - [ ] `npm run dev` starts and serves the app
  - [ ] Baseline screenshots exist in `.sisyphus/evidence/baseline/`

  **QA Scenarios**:
  ```
  Scenario: Baseline app loads
    Tool: Playwright
    Steps:
      1. Start dev server: npm run dev
      2. Navigate to http://localhost:5173/
      3. Assert #board exists and is visible
      4. Assert #rack exists and is visible
      5. Screenshot
    Expected Result: App loads and core containers render
    Evidence: .sisyphus/evidence/baseline/app-load.png
  ```

- [ ] 3. Tournament Palette + Physical Materials Tokens (CSS Vars)

  **What to do**:
  - Update `src/style.css` to define a tournament/classic Scrabble token set, centered on:
    - Premium squares: TW red, DW pink (incl. center star), TL dark blue, DL light blue
    - Board frame/background: “tabletop” + “board face” (subtle texture via gradients, not image dumps)
    - Tile face: warm ivory + subtle speckle/highlight; tile edge/shadow tokens
  - Keep existing variable names where possible (`--cell-tw`, `--cell-dw`, `--cell-tl`, `--cell-dl`, `--tile-*`).
  - Default hex targets (override if you later decide to match a different reference):
    - `--cell-tw: #b31c2a; --cell-dw: #f1a3c2; --cell-tl: #0c3d76; --cell-dl: #7fbfe1;`

  **Must NOT do**:
  - Do not rename/remove variables that are already used elsewhere; add new ones if needed.

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: [`frontend-ui-ux`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 5-10
  - **Blocked By**: None

  **References**:
  - `src/style.css` (existing vars + selectors)
  - `src/ui/uiRenderer.ts` (premium class names to preserve)
  - `src/core/boardLayout.ts` (standard premium layout; no UI change needed)
  - External: https://en.wikipedia.org/wiki/Scrabble#Equipment (premium counts + classic scheme)

  **Acceptance Criteria**:
  - [ ] `src/style.css` defines tournament premium colors for `--cell-tw/dw/tl/dl`
  - [ ] `npm run build` succeeds

  **QA Scenarios**:
  ```
  Scenario: Tokens apply without breaking build
    Tool: Bash
    Steps:
      1. Run: npm run build
    Expected Result: Build passes
    Evidence: .sisyphus/evidence/task-3-build.txt
  ```

- [ ] 4. Typography + Layout Framing (Minimal HTML Touch)

  **What to do**:
  - Adjust typography away from the current modern Inter look toward a “boardgame set” feel:
    - UI text: readable, slightly classic (avoid neon/tech)
    - Tile letters: bold, high legibility, strong baseline (Scrabble-like)
  - Prefer: update font imports in `index.html` and `src/style.css` font vars.
  - Keep changes minimal and reversible (no new libraries).

  **Must NOT do**:
  - Do not change DOM IDs or structure in `index.html`.

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: [`frontend-ui-ux`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 5-10
  - **Blocked By**: None

  **References**:
  - `index.html` (font link + base layout)
  - `src/style.css` (`--font-sans`)

  **Acceptance Criteria**:
  - [ ] App still loads locally and typography is consistent across cards, board, rack
  - [ ] `npm run build` succeeds

  **QA Scenarios**:
  ```
  Scenario: Fonts load and layout still renders
    Tool: Playwright
    Steps:
      1. Start dev server
      2. Load home screen
      3. Screenshot header + board area
    Expected Result: No layout breakage; text remains legible
    Evidence: .sisyphus/evidence/task-4-typography.png
  ```

- [ ] 5. Board Grid + Premium Squares (Tournament Look)

  **What to do**:
  - Re-skin the board to look like a physical board:
    - Board frame + inner bevel
    - Grid lines that feel printed/inked (not neon)
    - Premium squares use tournament palette + subtle texture/pattern so color isn’t the only cue
    - Center square has a star/mark while keeping class `center` (don’t change renderer)
  - Ensure all state classes remain visually distinct: `pending`, `remote-draft`, `last-move`, `valid`, `invalid`, `checking`.

  **Must NOT do**:
  - Do not change `src/ui/uiRenderer.ts` markup or class names.

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: [`frontend-ui-ux`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 6-8)
  - **Blocks**: Task 12 (final screenshots)
  - **Blocked By**: Tasks 3-4

  **References**:
  - `src/ui/uiRenderer.ts` (board cell classes + data-x/y)
  - `index.html` (`#board`)
  - `src/style.css` (current `.board`, `.cell`, `.row` selectors)

  **Acceptance Criteria**:
  - [ ] Premium squares `tw|dw|tl|dl|center` are visually distinct without relying only on color
  - [ ] `pending/remote-draft/last-move/valid/invalid/checking` states are visible
  - [ ] `npm run build` succeeds

  **QA Scenarios**:
  ```
  Scenario: Board premium squares and states render
    Tool: Playwright
    Steps:
      1. Start dev server
      2. Load app and start a solo game
      3. Screenshot board
    Expected Result: Board grid uses tournament palette; center is marked; visuals are legible
    Evidence: .sisyphus/evidence/task-5-board.png
  ```

- [ ] 6. Rack + Tile Physical Styling (Buttons)

  **What to do**:
  - Re-skin `.rack`, `.rack-row`, and `.tile` to feel like real tiles:
    - Tile face (ivory), tile edge (slightly darker), embossed letter feel, crisp value placement
    - Clear states: `.tile.selected`, `.tile.pending`, `.tile.blank`
  - Ensure touch targets remain comfortable on mobile.

  **Must NOT do**:
  - Do not change the fact that tiles are `<button>` elements (`renderTile`).

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: [`frontend-ui-ux`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 5,7,8)
  - **Blocks**: Task 12
  - **Blocked By**: Tasks 3-4

  **References**:
  - `src/ui/uiRenderer.ts` (`renderTile`, `renderRack`)
  - `index.html` (`#rack`)
  - `src/style.css` (current `.tile`, `.rack` styles)

  **Acceptance Criteria**:
  - [ ] Tiles read clearly (letter/value), including blank `?`
  - [ ] Selected/pending/blank states are obvious
  - [ ] `npm run build` succeeds

  **QA Scenarios**:
  ```
  Scenario: Tile states are visible
    Tool: Playwright
    Steps:
      1. Start solo game
      2. Tap a rack tile to select it
      3. Place a tile on the board (pending)
      4. Screenshot rack + board
    Expected Result: selected and pending styles are clearly differentiated
    Evidence: .sisyphus/evidence/task-6-tiles.png
  ```

- [ ] 7. Controls + Cards + Status Pills + Forms Skin

  **What to do**:
  - Re-skin shared UI components to match tabletop/tournament vibe:
    - `.card`, `.card-head`, `.pill`, `.segmented`, `.primary`, `.ghost`, inputs/selects/textarea
    - Avoid “modern SaaS” look; use warmer surfaces and subtle paper/wood textures.
  - Preserve readability and hierarchy (status row, session controls, actions).

  **Must NOT do**:
  - Do not hide or remove controls; only change styling.

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: [`frontend-ui-ux`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Tasks 9-10
  - **Blocked By**: Tasks 3-4

  **References**:
  - `index.html` (setup + cards + buttons)
  - `src/style.css` (component selectors)

  **Acceptance Criteria**:
  - [ ] Forms and buttons remain usable and legible on mobile
  - [ ] Status pills remain readable in both online/offline states
  - [ ] `npm run build` succeeds

  **QA Scenarios**:
  ```
  Scenario: Setup UI remains usable
    Tool: Playwright
    Steps:
      1. Load app
      2. Toggle setup visibility
      3. Switch mode tabs (solo/host/join)
      4. Screenshot setup section
    Expected Result: Controls remain accessible; styling matches new theme
    Evidence: .sisyphus/evidence/task-7-setup.png
  ```

- [ ] 8. Tabletop Background + Header Branding Polish

  **What to do**:
  - Replace the current dark navy gradient atmosphere with a tabletop/boardgame setting:
    - Warm wood/paper vibe; subtle texture; no flat background
  - Keep the app mobile-first and ensure board remains the visual hero.

  **Must NOT do**:
  - Do not introduce heavy raster textures; prefer CSS gradients/patterns.

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: [`frontend-ui-ux`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 12
  - **Blocked By**: Tasks 3-4

  **References**:
  - `src/style.css` (`body`, `#app`, `.shell`, header styles)
  - `index.html` (header markup)

  **Acceptance Criteria**:
  - [ ] Background supports readability and doesn’t reduce board contrast
  - [ ] `npm run build` succeeds

  **QA Scenarios**:
  ```
  Scenario: Layout works on mobile and desktop widths
    Tool: Playwright
    Steps:
      1. Set viewport 390x844, screenshot top + board
      2. Set viewport 1280x800, screenshot full layout
    Expected Result: No overflow; board and rack remain usable
    Evidence: .sisyphus/evidence/task-8-responsive.png
  ```

- [ ] 9. Overlays + Toast + Banners (Themed, Legible)

  **What to do**:
  - Re-skin overlays and transient UI so it matches the boardgame vibe:
    - `#ready-overlay`, `#gameover-overlay`, `#disconnect-overlay`, `#toast`, `#gameover-banner`
  - Ensure overlay readability over the board and keep buttons discoverable.

  **Must NOT do**:
  - Do not change overlay show/hide logic; only styling.

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: [`frontend-ui-ux`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 10-12)
  - **Blocks**: Task 12
  - **Blocked By**: Tasks 7-8

  **References**:
  - `index.html` (overlay markup)
  - `src/style.css` (overlay selectors)

  **Acceptance Criteria**:
  - [ ] Overlays remain readable (text + buttons) on both mobile and desktop
  - [ ] `npm run build` succeeds

  **QA Scenarios**:
  ```
  Scenario: Overlays render without layout breakage
    Tool: Playwright
    Steps:
      1. Load app
      2. Trigger an error toast (e.g., confirm move with no placements)
      3. Screenshot toast
    Expected Result: Toast is visible, themed, and readable
    Evidence: .sisyphus/evidence/task-9-toast.png
  ```

- [ ] 10. Accessibility + Focus + Reduced Motion Pass

  **What to do**:
  - Ensure focus rings are visible on `.tile` and `.cell` (keyboard play).
  - Ensure premium-square differentiation works for colorblind users (labels/patterns).
  - Respect `prefers-reduced-motion` for any animations introduced.

  **Must NOT do**:
  - Do not remove existing ARIA labels generated by `src/ui/uiRenderer.ts`.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`frontend-ui-ux`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 12
  - **Blocked By**: Tasks 5-9

  **References**:
  - `src/ui/uiRenderer.ts` (ARIA labels + tabindex grid)
  - `src/style.css` (focus styles)

  **Acceptance Criteria**:
  - [ ] Keyboard focus is visible on interactive elements
  - [ ] `npm run build` succeeds

  **QA Scenarios**:
  ```
  Scenario: Keyboard navigation on board and tiles
    Tool: Playwright
    Steps:
      1. Load app
      2. Use Tab/Arrow keys to move focus on board cells
      3. Tab to rack tiles and focus a tile
      4. Screenshot focus ring
    Expected Result: Focus is clearly visible; no trapped focus
    Evidence: .sisyphus/evidence/task-10-focus.png
  ```

- [ ] 11. Remove Legacy Concept UIs (`designs/`)

  **What to do**:
  - Delete the legacy concept UIs:
    - `designs/index.html`
    - `designs/v1/`, `designs/v2/`, `designs/v3/`, `designs/v4/`, `designs/v5/`
  - Ensure nothing references these paths anymore.

  **Must NOT do**:
  - Do not delete `index.html` or anything under `src/` as part of this cleanup.

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`git-master`]

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential (after verification artifacts exist)
  - **Blocks**: Final deliverable
  - **Blocked By**: Task 12

  **References**:
  - `designs/index.html`
  - `designs/v1/index.html`
  - `designs/v2/index.html`
  - `designs/v3/index.html`
  - `designs/v4/index.html`
  - `designs/v5/index.html`

  **Acceptance Criteria**:
  - [ ] `designs/` no longer contains v1-v5 concept pages
  - [ ] `npm run build` succeeds

  **QA Scenarios**:
  ```
  Scenario: Build still succeeds after deleting designs
    Tool: Bash
    Steps:
      1. Run: npm run build
    Expected Result: Build passes
    Evidence: .sisyphus/evidence/task-11-build.txt
  ```

- [ ] 12. Local Deploy Verification Pack + Final Screenshots + Prompt Review

  **What to do**:
  - Verify both dev and “local deploy” preview:
    - `npm run dev` (interactive)
    - `npm run build && npm run preview` (serves `dist`)
  - Capture final screenshot pack (at least):
    - Home/setup section
    - Board with premium squares visible
    - Rack with selected + pending tile states
    - Toast + overlay
    - Desktop + mobile viewports
  - After artifacts exist, explicitly prompt the user to review the new design (provide the preview URL and the screenshot paths).

  **Must NOT do**:
  - Do not require user interaction to mark the task complete; review prompt is a final handoff.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`playwright`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 11
  - **Blocked By**: Tasks 5-10

  **References**:
  - `package.json` (`dev`, `build`, `preview`)
  - `.github/workflows/deploy.yml` (build parity)

  **Acceptance Criteria**:
  - [ ] `npm run build` passes
  - [ ] `npm run preview` serves the built app locally
  - [ ] Screenshot pack exists under `.sisyphus/evidence/final/`

  **QA Scenarios**:
  ```
  Scenario: Preview build works
    Tool: Bash
    Steps:
      1. Run: npm run build
      2. Run: npm run preview
    Expected Result: Preview server starts and serves dist
    Evidence: .sisyphus/evidence/task-12-preview.txt
  ```

## Final Verification Wave

- Run `npm run lint && npm run test:run && npm run build`.
- Run `npm run preview` and validate key flows with Playwright.
- Produce screenshot pack + short review checklist, then prompt user to review.

---

## Commit Strategy
- Prefer small commits aligned to Beads tasks (CSS foundation, board, tiles, overlays, cleanup).

## Success Criteria
- Tournament/classic physical-board aesthetic is applied across the full app.
- All existing tests/build/lint pass.
- `designs/v1..v5` and `designs/index.html` are removed.
- User is prompted to review the final design with a local preview link + screenshots.
