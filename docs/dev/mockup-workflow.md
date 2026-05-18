# Visual mockup workflow

This card has a deliberately slow path from "what if we changed how this
looks" to "here's the implementation". For any non-trivial visual change,
we build standalone HTML mockups first, iterate them with screenshots,
and only start touching `src/` once the design is locked.

This document captures the convention so it survives the (gitignored)
`tmp/` directory being cleaned out between features.

## When to use this workflow

Use mockups when **all** of the following are true:

1. The change is visual — a new render path, a new layout option, a
   change to the level-ring shape, or anything affecting `pollenprognos-card.js`'s
   render output.
2. The change has multiple plausible shapes (different sizes, colors,
   thicknesses, etc.) and you need to compare them side-by-side before
   committing to one.
3. The change is large enough that you'd want a second opinion before
   writing card code — pixel-tweaks to existing code can skip this.

Bug fixes, refactors, adapter work, and locale changes do **not** need
mockups.

## Directory layout

All mockups live under `tmp/`, which is in `.gitignore`. One feature per
subdirectory:

```
tmp/
├── no-data-poc/          (#224 follow-up — already done)
├── icon-in-ring/         (#227)
└── <future-feature>/
```

Each mockup directory should contain:

- One or more standalone `.html` files (one per "view" — e.g. `minimal.html`,
  `normal.html`, `final.html`)
- An `index.html` landing page that links to the others and explains the
  goal of the mockup set
- A `_shared.js` helper module with the rendering primitives
- A `_shots/` directory for headless-Chrome screenshots (also gitignored)

Filenames starting with `_` (e.g. `_shared.js`, `_shots/`) are conventional
"infrastructure" — not designs to compare, but helpers consumed by the
design files.

## File-level conventions

### Standalone HTML

Each `.html` file must run when opened from `file://` with no build step
and no server. Concretely:

- No `<script type="module">` (CORS issues on `file://`)
- No `fetch()` calls
- A single `<script src="_shared.js"></script>` is fine — same-directory
  relative imports work via `<script src>` in all modern browsers, even
  under `file://`
- All other rendering logic lives in inline `<script>` blocks in the HTML

### Visual fidelity, not implementation re-use

Mockups recreate the **visual output** of the card's render functions,
but **do not** import card code. Rationale:

- The card is bundled by Vite; importing card modules from a `file://`
  HTML page requires either a build step or a dev server — both kill
  the "open file in browser" loop
- Mockups stay valid even when the card's internals are rewritten —
  they're a design artifact, not a regression test
- Mockup-vs-card divergence is a feature, not a bug: if the card changes
  shape, mockups should be rebuilt for the new feature, not retrofitted

For the level-ring: `_shared.js` uses plain SVG `<path>` arcs to draw
the doughnut, because Chart.js is overkill for a static visual. The
visual output matches `_renderLevelCircle()` (segments, gaps, rotation,
thickness) closely enough that decisions made on the mockup carry over.

### Comparison-grid layout

Every mockup section follows the same shape:

- **One question per section.** "What size should the icon be inside
  the ring?" gets one section. "Should the ring be thinner?" gets
  another. Mixing two questions in one section makes it impossible to
  read the answer.
- **Side-by-side cells.** Each section is a `.row` containing 3-6
  `.cell` divs. Each cell has the rendered output, a `.label` (the
  variant name), and a `.sub` (the concrete config values).
- **Dark theme by default; light theme alongside.** HA users run both
  themes — every visual decision needs both.
- **Real allergen variation.** Use 2-3 different allergens at different
  levels, not just birch-at-level-3. The icon shape (birch vs. grass
  vs. mugwort) interacts with the design.

### Realistic sizes

The card's default `icon_size` is **48 px**. Show mockups at that size
prominently. Larger mockups (96-120 px) are useful for inspecting
detail variation — e.g. when comparing five thicknesses — but should
never be the only size shown. A mockup that only works at 120 px and
looks like a smudge at 48 px has not finished iterating.

## Workflow steps

1. **Design questions.** What are we deciding? Write them down. One
   per section. If you can't enumerate 3-5 specific questions, the
   feature isn't ready for mockups yet.

2. **Build helpers in `_shared.js`.** Pure functions: `ringSvg(opts)`,
   `iconSvg(key, size, color)`, `levelCircle(opts)`. Export to
   `window.__<featureSlug>Mockup` so HTML files can use without
   modules.

3. **Build sections.** One section per design question. Each section
   has 3-6 candidates. Label everything — labels are the only
   documentation the future-you reading the mockup will have.

4. **Render to screenshots.** Use headless Chrome:

   ```bash
   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
     --headless --disable-gpu --no-sandbox --hide-scrollbars \
     --window-size=1400,2400 \
     --screenshot=_shots/minimal.png \
     "file://$(pwd)/minimal.html"
   ```

   Pick a window height tall enough to capture the longest page.
   Inspect screenshots before showing the user — sometimes a section
   renders blank because of a typo, or layouts wrap unexpectedly.

5. **Iterate with the user.** Show screenshots, ask focused questions
   ("which of these three looks right?"), update the mockup, re-render,
   re-ask. Don't write a wall of text — the user is looking at images.

6. **Final consolidated mockup.** Once the design choices are locked,
   build a `final.html` that applies all the chosen values consistently
   across sizes, allergens, themes, and edge states (no-data, stale).
   This is the design artifact that the implementation must match.

7. **Hard blocker: explicit go-ahead.** Don't start writing card code
   until the user has explicitly approved the final mockup.

## Workflow after go-ahead

Once the design is locked:

1. Mockups stay in `tmp/<feature>/` for the implementation work as a
   reference. They're not committed.
2. The implementation should be visually compared against the mockups
   periodically — Playwright screenshots from `hass-test` next to the
   `_shots/final.png` is a good sanity check.
3. After the feature ships, the mockup directory can be deleted. The
   design decisions are now encoded in the card itself and (if needed)
   in `docs/`. Don't preserve dead mockups in `tmp/`.

## Tooling references

- **Existing mockup sets** (as of 2026-05-18):
  - `tmp/no-data-poc/` — POC for the #224 no-data noise pattern
    (icon-vs-ring contrast, density variants, ring textures)
  - `tmp/icon-in-ring/` — POC for #227 (icon centered inside the ring)

- **Render helper**: see `tmp/icon-in-ring/_shared.js` for a reference
  implementation of `ringSvg()`, `iconSvg()`, `levelCircle()`, and
  `colorForLevel()` against the card's color and geometry conventions.
  Copy and adapt for new features.

- **Screenshot loop**: headless Chrome via the `--screenshot` flag.
  Other browsers work too; Chromium is just what was on the dev
  machine when this convention was codified.

## What goes in `docs/` vs. `tmp/`

| Where | What |
|-------|------|
| `tmp/<feature>/` | The mockups themselves. Ephemeral. Gitignored. Cleaned up after merge. |
| `docs/dev/` | The **process** (this file). Permanent. Should outlive every individual mockup set. |
| `docs/configuration.md` | The **result** — once a config key is shipped, document it here for end users. |
