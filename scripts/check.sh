#!/bin/sh
# npm run check — one local gate that mirrors CI.
#
# Quiet on success (a couple of tail lines); full output always lands in
# .check.log (gitignored) so a failure can be grepped without ever
# scrolling past a context window.
#
# Runs prek AND a standalone eslint/prettier check-mode pass on purpose:
# `prek run --all-files` resolves its file list from git (tracked files),
# so a newly written, still-untracked module is invisible to it. Worse,
# prek's eslint/prettier hooks autofix and report "Passed" once the fix is
# applied — a bare `prek run` can silently launder a lint error into a
# green run. The explicit `eslint .` (no --fix) and `prettier --check .`
# below scan the whole working tree in report-only mode and catch both
# gaps; `gitleaks dir .` closes the same hole for the gitleaks hook (its
# `--staged` default sees zero files when nothing is staged).
set -eu
cd "$(dirname "$0")/.."

log=.check.log
: >"$log"

fail() {
	echo "FAILED: $1 (see $log)"
	tail -n 40 "$log"
	exit 1
}

step() { printf '\n== %s ==\n' "$1" >>"$log"; }

step "prek --all-files"
prek run --all-files --show-diff-on-failure >>"$log" 2>&1 || fail "prek"

step "gitleaks dir . (full tree, not just staged)"
gitleaks dir . --no-banner >>"$log" 2>&1 || fail "gitleaks (full tree)"

step "eslint (no --fix, whole tree)"
npx eslint . >>"$log" 2>&1 || fail "eslint"

step "prettier --check (whole tree)"
npx prettier --check . >>"$log" 2>&1 || fail "prettier --check"

step "typecheck"
npm run typecheck >>"$log" 2>&1 || fail "typecheck"

step "test"
npx vitest run --reporter=dot >>"$log" 2>&1 || fail "test"

step "build + check-dist-size"
npm run build >>"$log" 2>&1 || fail "build"
npm run check-dist-size >>"$log" 2>&1 || fail "check-dist-size"

echo "OK: all quality gates passed"
tail -n 2 "$log"
