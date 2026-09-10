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
     test, build, bundle size); run it before opening a PR.
   - `npm run test` runs the vitest suite on its own; `npm run lint` /
     `npm run typecheck` run ESLint / `tsc --noEmit` on their own.
   - Manual testing in Home Assistant is still expected for anything that
     touches rendering or an adapter's live behaviour.
   - Optional but recommended: `git config prek.enabled true` turns on local
     pre-commit/pre-push hooks (`.pre-commit-config.yaml`) that run most of
     the same checks automatically.

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
- Commit messages (and PR titles, which become the squash-merge commit
  subject) are written in English.
- One logical change per commit; don't bundle an unrelated fix into a feature
  commit.

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
