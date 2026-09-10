#!/bin/sh
# npm run setup — one-command contributor bootstrap for the local quality
# gate. Wires .pre-commit-config.yaml into this clone's Git hooks by
# running prek through `pipx run --spec prek==X.Y.Z` (or the uv
# equivalent) instead of relying on a `prek` already on PATH.
#
# That removes the whole class of "wrong prek version" problems Codex
# found across three rounds on PR #346 (no version check at all; treating
# any core.hooksPath as the one known dispatcher and skipping bootstrap
# entirely; a stale prek shadowing a freshly pipx-installed one on PATH):
# `pipx run --spec`/`uv tool run --from` always resolve the exact pinned
# spec from their own cache, regardless of what else is installed or
# where it sits on PATH. `prek install` embeds the absolute path it was
# invoked from into the generated hook script (verified against a real
# pipx cache), so the Git hook itself execs that cached, version-pinned
# binary directly on every commit -- no pipx/uv overhead per commit, only
# during this setup step.
#
# gitleaks has no such wrapper (a Go binary, not a Python package) and is
# still expected to be a real installed binary on PATH.
#
# core.hooksPath handling: ANY custom hooks path means this clone's own
# .git/hooks won't run (a maintainer-machine convention routes ALL repos
# through one global dispatcher instead) -- hook installation is skipped
# in that case, without trying to identify which dispatcher it is. The
# prek/gitleaks checks above still run either way, since `npm run check`
# needs them regardless of how hooks are wired.
#
# Idempotent: safe to re-run any time (e.g. after .github/workflows/test.yml
# bumps the pinned prek version).
set -eu
cd "$(dirname "$0")/.."

echo "npm run setup: bootstrapping the local quality gate"

# Single source of truth for the pinned version: the same
# `pipx run --spec prek==X.Y.Z` CI uses in .github/workflows/test.yml.
prek_version=$(grep -o 'prek==[0-9][0-9.]*' .github/workflows/test.yml | head -n1 | cut -d= -f3)
if [ -z "$prek_version" ]; then
	echo "could not read the pinned prek version from .github/workflows/test.yml"
	exit 1
fi

if command -v pipx >/dev/null 2>&1; then
	# --backend pip: pipx's own uv-detection can pick an incompatible
	# uv already on PATH (from an unrelated toolchain) and refuse to run;
	# pip's ephemeral-venv path has no such conflict.
	prek() { pipx run --backend pip --spec "prek==$prek_version" prek "$@"; }
elif command -v uv >/dev/null 2>&1; then
	prek() { uv tool run --from "prek==$prek_version" prek "$@"; }
else
	echo "missing: pipx or uv, needed to run the pinned prek==$prek_version"
	echo "without depending on whatever else might be on PATH. Install one:"
	echo "  https://pipx.pypa.io/stable/installation/"
	echo "  https://docs.astral.sh/uv/getting-started/installation/"
	exit 1
fi

echo "resolving prek==$prek_version ..."
prek --version

if command -v gitleaks >/dev/null 2>&1; then
	echo "gitleaks already installed ($(gitleaks version 2>&1 | head -n1))"
else
	echo "missing: gitleaks. Install it, e.g.:"
	echo "  brew install gitleaks"
	echo "or download a release: https://github.com/gitleaks/gitleaks/releases"
	exit 1
fi

hooks_path=$(git config --get core.hooksPath 2>/dev/null || true)
if [ -n "$hooks_path" ]; then
	echo "core.hooksPath is set to '$hooks_path', so this clone's own"
	echo ".git/hooks won't run -- skipping hook installation ('prek install'"
	echo "would refuse anyway). If that path already runs prek for opted-in"
	echo "repos (the maintainer-machine convention), run:"
	echo "  git config prek.enabled true"
	echo "Otherwise wire prek into whatever '$hooks_path' runs yourself."
	echo "gitleaks is installed and prek==$prek_version is cached;"
	echo "'npm run check' works regardless."
	exit 0
fi

prek install
prek install --hook-type pre-push
echo "OK: pre-commit/pre-push hooks installed from .pre-commit-config.yaml"
echo "Run 'npm run check' any time to run the same gate CI does."
