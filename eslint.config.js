import js from "@eslint/js";
import tseslint from "typescript-eslint";
import lit from "eslint-plugin-lit";
import wc from "eslint-plugin-wc";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    // `.venv` holds a Python virtualenv (Playwright's bundled JS) under the
    // screenshots tooling; it is third-party and must never be linted.
    ignores: ["dist", "node_modules", "coverage", "**/.venv/**", "tmp"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  lit.configs["flat/recommended"],
  wc.configs["flat/recommended"],
  {
    languageOptions: {
      globals: {
        // Browser + build-time globals present across the card runtime.
        window: "readonly",
        document: "readonly",
        console: "readonly",
        customElements: "readonly",
        HTMLElement: "readonly",
        CustomEvent: "readonly",
        Event: "readonly",
        __VERSION__: "readonly",
      },
    },
    rules: {
      // The legacy JS codebase uses `require`-free ESM already, but leans on
      // patterns typescript-eslint flags aggressively. These are downgraded
      // (not disabled) so real regressions still surface as warnings while we
      // migrate file-by-file to TypeScript. Revisit as strict typing lands.

      // Heavily used across adapters/editor where HA state is untyped `any`.
      "@typescript-eslint/no-explicit-any": "off",
      // Legacy code has many intentional unused catch bindings / args; keep as
      // warnings and honour a leading underscore as "intentionally unused".
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // `no-undef` is redundant/incorrect for browser+bundler ESM and is
      // covered by the typecheck step; typescript-eslint recommends off.
      "no-undef": "off",

      // The rules below fire only on pre-existing legacy-JS patterns. They are
      // downgraded to `warn` (still surfaced in lint output, don't fail CI) so
      // the tooling PR stays green without drive-by source rewrites. As files
      // convert to TypeScript they should be cleaned up and the rules promoted
      // back to `error`.

      // Intentional empty blocks (e.g. empty catch swallowing optional lookups).
      "no-empty": "warn",
      // Legacy `obj.hasOwnProperty(k)` calls; safe on plain config objects here.
      "no-prototype-builtins": "warn",
      // Over-escaped but harmless characters inside regex character classes.
      "no-useless-escape": "warn",
      // Newer stylistic rule; hits dead assignments before early returns.
      "no-useless-assignment": "warn",
      // Deliberate default-then-override-after-spread object literals in the
      // badge config builders (the later key intentionally wins).
      "no-dupe-keys": "warn",
      // A setter returns a promise value (ignored by JS at runtime, harmless).
      "no-setter-return": "warn",
      // Short-circuit expression statements used for their side effects.
      "@typescript-eslint/no-unused-expressions": "warn",
    },
  },
  {
    // Node-context scripts and build config: allow process/console/require-free
    // Node globals.
    files: ["scripts/**/*.js", "vite.config.js", "vitest.config.js"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        __dirname: "readonly",
      },
    },
  },
  prettier,
);
