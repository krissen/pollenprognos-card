#!/bin/sh
# npm run setup — one-command contributor bootstrap for the local quality
# gate. This is "path (a)" from CONTRIBUTING.md: an ordinary clone gets
# prek + gitleaks installed and the hooks in .pre-commit-config.yaml wired
# into this clone's own .git/hooks via `prek install`.
#
# Maintainer machines that route all repos through a global
# core.hooksPath dispatcher are "path (b)": that dispatcher already runs
# prek when `git config prek.enabled true` is set, and `prek install`
# actively refuses to install into .git/hooks when core.hooksPath points
# outside the repo (verified: exit 2, "Refusing to install hooks"). This
# script detects that case and skips straight to telling you the one
# command you need.
#
# Idempotent: safe to re-run any time (e.g. after `.pre-commit-config.yaml`
# changes bump the pinned prek version).
set -eu
cd "$(dirname "$0")/.."

echo "npm run setup: bootstrapping the local quality gate"

hooks_path=$(git config --get core.hooksPath 2>/dev/null || true)
if [ -n "$hooks_path" ]; then
	echo "core.hooksPath is set to '$hooks_path' (maintainer-machine"
	echo "convention) -- prek install would refuse here anyway. Run:"
	echo "  git config prek.enabled true"
	echo "instead; the dispatcher at $hooks_path already runs prek for any"
	echo "repo that opts in that way. See CONTRIBUTING.md for details."
	exit 0
fi

if command -v prek >/dev/null 2>&1; then
	echo "prek already installed ($(prek --version))"
elif command -v pipx >/dev/null 2>&1; then
	echo "installing prek==0.5.2 via pipx"
	pipx install "prek==0.5.2"
elif command -v uv >/dev/null 2>&1; then
	echo "installing prek==0.5.2 via uv tool"
	uv tool install "prek==0.5.2"
else
	echo "missing: prek, and neither pipx nor uv is installed to fetch it."
	echo "Install pipx or uv, or install prek directly:"
	echo "  https://github.com/j178/prek#installation"
	exit 1
fi

if command -v gitleaks >/dev/null 2>&1; then
	echo "gitleaks already installed ($(gitleaks version 2>&1 | head -n1))"
else
	echo "missing: gitleaks. Install it, e.g.:"
	echo "  brew install gitleaks"
	echo "or download a release: https://github.com/gitleaks/gitleaks/releases"
	exit 1
fi

prek install
prek install --hook-type pre-push
echo "OK: pre-commit/pre-push hooks installed from .pre-commit-config.yaml"
echo "Run 'npm run check' any time to run the same gate CI does."
