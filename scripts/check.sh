#!/bin/sh
# npm run check — one local gate that mirrors CI.
#
# Quiet on success (a couple of tail lines); full output always lands in
# .check.log (gitignored) so a failure can be grepped without ever
# scrolling past a context window.
#
# Runs prek AND a standalone eslint/prettier check-mode pass on purpose:
# `prek run --all-files` resolves its file list from git (tracked files),
# so a newly written, still-untracked file is invisible to it -- a lint
# or format issue in it goes entirely unseen by prek, not autofixed and
# not reported either way. (For a file prek DOES see, its own
# before/after diff check catches an autofix: changing a tracked file
# marks that hook Failed, so a fix prek just applied is never silently
# reported "Passed".) The explicit `eslint .` (no --fix) and
# `prettier --check .` below scan the whole working tree in report-only
# mode and close that untracked-file gap; `gitleaks dir .` closes the
# same hole for the gitleaks hook (its `--staged` default sees zero files
# when nothing is staged).
#
# prek runs through the persistent, version-pinned binary `npm run setup`
# installs (see scripts/setup-dev.sh) when that exists -- no pipx/uv
# overhead per invocation. Only when that hasn't been set up yet does
# this fall back to `pipx run --spec`/`uv tool run --from` (same as CI),
# rather than a `prek` on PATH -- see setup-dev.sh for why: it removes
# the "wrong prek version" class of bug regardless of what else happens
# to be installed or where.
set -eu
cd "$(dirname "$0")/.."

prek_version=$(grep -o 'prek==[0-9][0-9.]*' .github/workflows/test.yml | head -n1 | cut -d= -f3)
if [ -z "$prek_version" ]; then
	echo "could not read the pinned prek version from .github/workflows/test.yml"
	exit 1
fi

persistent_prek="$HOME/.local/state/pollenprognos-card-prek/$prek_version/bin/prek"
if [ -x "$persistent_prek" ]; then
	prek() { "$persistent_prek" "$@"; }
elif command -v pipx >/dev/null 2>&1; then
	# --backend pip: pipx's own uv-detection can pick an incompatible
	# uv already on PATH (from an unrelated toolchain) and refuse to run.
	# Older pipx (reported: 1.4.3) predates the --backend flag entirely
	# and errors out on it ("unrecognized arguments"), so only pass it
	# when this pipx's own --help advertises it.
	if pipx run --help 2>&1 | grep -q -- '--backend'; then
		prek() { pipx run --backend pip --spec "prek==$prek_version" prek "$@"; }
	else
		prek() { pipx run --spec "prek==$prek_version" prek "$@"; }
	fi
elif command -v uv >/dev/null 2>&1; then
	prek() { uv tool run --from "prek==$prek_version" prek "$@"; }
else
	echo "missing: prek -- run npm run setup"
	exit 1
fi

if ! command -v gitleaks >/dev/null 2>&1; then
	echo "missing: gitleaks -- run npm run setup"
	exit 1
fi

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
