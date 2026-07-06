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
      // The TS migration (#259) is complete: src/ and test/ are TypeScript and
      // the rules the tooling PR temporarily downgraded to `warn` are promoted
      // back to `error` below.

      // Left off deliberately: `hass` state is an open, HA-idiomatic attributes
      // bag typed `Record<string, any>` (types/home-assistant.ts, types/sensor.ts).
      // The handful of remaining explicit `any` sites are enumerated with inline
      // justifications; there is no untracked `any` creep to guard against here.
      "@typescript-eslint/no-explicit-any": "off",
      // Enforced now the migration is complete. A leading underscore still
      // marks an intentionally unused binding (args, vars, caught errors).
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // `no-undef` is redundant/incorrect for browser+bundler ESM and is
      // covered by the typecheck step; typescript-eslint recommends off.
      "no-undef": "off",

      // The rules below caught pre-existing legacy-JS patterns. The offending
      // sites were cleaned up during the close-out, so each is now `error`.

      // Dead empty `else` branches were removed; the only empty blocks left are
      // intentional `catch {}` swallowing optional JSON.parse lookups.
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Direct `obj.hasOwnProperty(k)` calls were migrated to `Object.hasOwn`
      // (plain-config sites) or `Object.prototype.hasOwnProperty.call`.
      "no-prototype-builtins": "error",
      // Over-escaped characters inside regex character classes were cleaned up.
      "no-useless-escape": "error",
      // Dead initializers before an unconditional reassignment were removed.
      "no-useless-assignment": "error",
      "no-dupe-keys": "error",
      "no-setter-return": "error",
      // The ternary-as-statement side effects were rewritten to if/else.
      "@typescript-eslint/no-unused-expressions": "error",
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
