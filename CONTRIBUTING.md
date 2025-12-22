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
   - Main card: `src/pollenprognos-card.js`
   - Visual editor: `src/pollenprognos-editor.js`
   - Adapters: `src/adapters/` (one per integration)
   - Translations: `src/locales/*.json` (only edit `en.json`)
   - Constants: `src/constants.js`

4. **Testing:**
   - Manual testing in Home Assistant
   - Always run `npm run build` to verify changes compile

For detailed architecture documentation and development patterns, see the code comments and structure in `src/`.

---

## Getting Help

- If you have questions, suggestions, or need guidance, don't hesitate to [open an issue](../../issues/new) or reach out in the project discussions.
- For project documentation, see the [docs/](docs/) folder
- We're happy to help new contributors get started!

---

## Thank you

Your feedback and contributions help make this project better for everyone.
