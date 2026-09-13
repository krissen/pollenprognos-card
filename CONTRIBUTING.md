# Contributing to Pollenprognos Card

First of all, **thank you for considering contributing to this project!**
Everyone is welcome to participate, regardless of experience level, background, or where you are from.

We appreciate all kinds of contributions, including code, documentation, translations, bug reports, feature requests, and ideas for improvements.

---

## How to Contribute

- **Fork** the repository and create your own feature branch from the latest `master`.
- **Do _not_ create pull requests (PRs) directly against `master`.**
  - Instead, open your PR against a development or feature branch (e.g., `dev`, or your own feature branch).
  - Pull requests targeting `master` will be closed.
- **Describe your changes clearly** in your pull request. Include motivation and context where helpful.
- **Follow the existing code style** and try to keep your changes focused (one thing per PR).
- If you’re unsure about your change or want feedback before implementing, feel free to [open an issue](../../issues/new) for discussion.

---

## Code of Conduct

We are committed to providing a welcoming, friendly, and harassment-free environment for all. Please treat everyone with respect and be constructive in discussions.

---

## Reporting Issues

- If you find a bug or have an idea for an enhancement, please [open an issue](../../issues/new) and describe it as clearly as possible.
- Include steps to reproduce, screenshots, logs, or any context that may help us understand and address the issue.

---

## Development

### Getting Started

1. **Clone the repository** and install dependencies:

   ```bash
   npm install
   ```

2. **Build commands:**
   - `npm run dev` - Start development server with hot reload
   - `npm run build` - Build production bundle
   - `npm run preview` - Preview production build

3. **Project architecture:**
   - Main card: `src/pollenprognos-card.ts`
   - Visual editor: `src/pollenprognos-editor.ts`
   - Adapters: `src/adapters/` (one per integration)
   - Translations: `src/locales/*.json` (only edit `en.json`)
   - Constants: `src/constants.ts`

4. **Testing and quality gates:**
   - `npm run check` runs the same gates CI does (lint, format, typecheck,
     test, build, bundle size); run it before opening a PR. It expects
     `prek` and `gitleaks` on your `PATH` and tells you to run `npm run
setup` if they're missing.
   - `npm run test` runs the vitest suite on its own; `npm run lint` /
     `npm run typecheck` run ESLint / `tsc --noEmit` on their own.
   - Manual testing in Home Assistant is still expected for anything that
     touches rendering or an adapter's live behaviour.
   - **Local pre-commit/pre-push hooks** run most of the same checks
     automatically from `.pre-commit-config.yaml`, but the setup differs
     depending on how your machine runs Git hooks:
     - **Ordinary clone (most contributors):** run `npm run setup` once. It
       resolves `prek` on demand via `pipx run --spec`/`uv tool run --from`
       (pinned to the exact version this repo's CI uses, regardless of any
       other `prek` on your machine) and checks for `gitleaks`, then runs
       `prek install` / `prek install --hook-type pre-push` to wire the hooks
       into this clone's own `.git/hooks` -- the generated hook scripts point
       straight at the resolved, version-pinned binary, so `pipx`/`uv` aren't
       invoked again on every commit. Re-run it any time; it's idempotent.
     - **A machine that routes all repos through a global
       `core.hooksPath` dispatcher** (a maintainer convention, not the
       norm): `prek install` refuses to write local hooks there on
       purpose, since Git would never read them. Use
       `git config prek.enabled true` instead — the dispatcher runs prek
       for any repo that opts in that way. `npm run setup` detects this
       case automatically and tells you which command to run.

   Escape hatches, one per path above: on an ordinary clone,
   `git commit --no-verify` skips every hook `npm run setup` installed for
   one commit; to skip only specific hooks instead, prek itself reads
   `SKIP=<hook-id>[,<hook-id>...]` or `PREK_SKIP=<hook-id>[,...]`
   (comma-delimited — e.g. `SKIP=eslint git commit`). `SKIP_PREK=1 git
commit` only does something on the global-dispatcher machine (the
   `git config prek.enabled true` case above) — that dispatcher, not
   `prek` or Git itself, is what reads `SKIP_PREK`. Either way, the
   separate AI-attribution guard is unaffected by any of these.

For detailed architecture documentation and development patterns, see the code comments and structure in `src/`.

---

## Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/) with a
mandatory scope: `type(scope): subject`.

- **type**: one of `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`,
  `build`, `ci`, `chore`, `revert`.
- **scope**: required, lowercase, short — a filename without its extension or
  a module/feature name (e.g. `adapters`, `editor`, `i18n`).
- **subject**: imperative mood, lowercase first letter, no trailing period.
- **Breaking change**: `type(scope)!: subject` with a `BREAKING CHANGE:`
  footer.
- Commit messages (and PR titles, which normally become the squash-merge
  commit subject) are written in English. A PR that must keep a mechanical
  commit reachable for `.git-blame-ignore-revs` to work (see below) is
  merged with a real merge commit instead of squashed -- squashing would
  drop that commit from `dev`'s history, and `git blame` would then fail
  to resolve the ignored SHA for anyone who configures the ignore-revs
  file.
- One logical change per commit; don't bundle an unrelated fix into a feature
  commit.

Mechanical, no-op commits (e.g. a repo-wide `prettier --write`) are listed in
`.git-blame-ignore-revs` so `git blame` skips them. Configure it locally with:

```bash
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

```
feat(adapters): add support for the Foo integration
fix(editor): keep the color picker in sync with custom mode
docs(readme): describe the new hourly_sixth interval
```

PRs must carry at least one label (e.g. `bug`, `enhancement`) before merge.

---

## Getting Help

- If you have questions, suggestions, or need guidance, don't hesitate to [open an issue](../../issues/new) or reach out in the project discussions.
- For project documentation, see the [docs/](docs/) folder
- We're happy to help new contributors get started!

---

## Thank you

Your feedback and contributions help make this project better for everyone.
