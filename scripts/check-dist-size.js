#!/usr/bin/env node
// Guards the shipped bundle size. Gzips dist/pollenprognos-card.js and fails
// if the compressed size exceeds the budget in size-budget.json. Run in CI
// after `npm run build` so bundle-size regressions surface on every PR.
//
// The budget is deliberately generous (current size + headroom); it is a
// ratchet against accidental blow-ups, not a tight target. Bump it in
// size-budget.json when an intentional size increase lands.

import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const bundlePath = resolve(root, "dist/pollenprognos-card.js");
const budgetPath = resolve(root, "size-budget.json");

let bundle;
try {
  bundle = readFileSync(bundlePath);
} catch {
  console.error(
    `check-dist-size: bundle not found at ${bundlePath}. Run \`npm run build\` first.`,
  );
  process.exit(1);
}

const { gzipBudgetBytes } = JSON.parse(readFileSync(budgetPath, "utf8"));
const gzipBytes = gzipSync(bundle, { level: 9 }).length;

const kb = (n) => (n / 1024).toFixed(2);
console.log(
  `check-dist-size: gzip ${gzipBytes} bytes (${kb(gzipBytes)} kB), budget ${gzipBudgetBytes} bytes (${kb(gzipBudgetBytes)} kB)`,
);

if (gzipBytes > gzipBudgetBytes) {
  console.error(
    `check-dist-size: FAIL — bundle is ${gzipBytes - gzipBudgetBytes} bytes over budget. ` +
      `Reduce the bundle or raise gzipBudgetBytes in size-budget.json if the growth is intentional.`,
  );
  process.exit(1);
}

console.log("check-dist-size: OK");
