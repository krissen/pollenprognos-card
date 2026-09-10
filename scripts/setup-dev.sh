#!/bin/sh
# npm run setup — one-command contributor bootstrap for the local quality
# gate. Always installs the command-line prerequisites (prek, gitleaks) that
# `npm run check` needs, regardless of how this machine wires Git hooks.
#
# Wiring the hooks into commit/push is "path (a)" from CONTRIBUTING.md,
# for an ordinary clone: `prek install` / `prek install --hook-type
# pre-push` writes them into this clone's own .git/hooks.
#
# "Path (b)" is a maintainer machine that routes ALL repos' hooks through a
# global core.hooksPath dispatcher: `prek install` actively refuses to
# write into .git/hooks there (verified: exit 2, "Refusing to install
# hooks because core.hooksPath is configured outside this repository"),
# because Git would never read that file anyway. Any core.hooksPath value
# means this clone's own .git/hooks won't run -- not just the one
# maintainer dispatcher this repo happens to use -- so hook installation
# is skipped whenever it's set, without trying to identify which
# dispatcher it is. The binaries are still installed either way.
#
# Idempotent: safe to re-run any time (e.g. after .github/workflows/test.yml
# bumps the pinned prek version -- installed version is checked and
# reinstalled/upgraded if it doesn't match).
set -eu
cd "$(dirname "$0")/.."

echo "npm run setup: bootstrapping the local quality gate"

# Single source of truth for the pinned version: the same
# `pipx run --spec prek==X.Y.Z` CI uses in .github/workflows/test.yml.
# A mismatched local prek would run a different quality gate than CI.
prek_version=$(grep -o 'prek==[0-9][0-9.]*' .github/workflows/test.yml | head -n1 | cut -d= -f3)
if [ -z "$prek_version" ]; then
	echo "could not read the pinned prek version from .github/workflows/test.yml"
	exit 1
fi

# `hash -r` (POSIX) forgets any PATH lookup the current shell already
# cached for `prek`, so re-checking after an install doesn't just repeat
# a stale answer.
resolved_prek_version() {
	hash -r 2>/dev/null || true
	if command -v prek >/dev/null 2>&1; then
		prek --version | awk '{print $2}'
	fi
}

installed_version=$(resolved_prek_version)

if [ "$installed_version" = "$prek_version" ]; then
	echo "prek $installed_version already installed (matches the pinned version)"
else
	if command -v pipx >/dev/null 2>&1; then
		if [ -n "$installed_version" ]; then
			echo "installed prek $installed_version does not match pinned $prek_version -- reinstalling via pipx"
		else
			echo "installing prek==$prek_version via pipx"
		fi
		pipx install --force "prek==$prek_version"
	elif command -v uv >/dev/null 2>&1; then
		echo "installing prek==$prek_version via uv tool (force, in case a different version is on PATH)"
		uv tool install --force "prek==$prek_version"
	else
		if [ -n "$installed_version" ]; then
			echo "installed prek $installed_version does not match pinned $prek_version,"
			echo "and neither pipx nor uv is installed to fix it."
		else
			echo "missing: prek, and neither pipx nor uv is installed to fetch it."
		fi
		echo "Install pipx or uv, or install prek==$prek_version directly:"
		echo "  https://github.com/j178/prek#installation"
		exit 1
	fi

	# The installer can succeed while a DIFFERENT prek (e.g. a system
	# package earlier on PATH than pipx's/uv's bin dir) still shadows it.
	# Re-resolve for real instead of trusting the installer's exit code.
	installed_version=$(resolved_prek_version)
	if [ "$installed_version" != "$prek_version" ]; then
		echo "installed prek==$prek_version, but 'prek --version' on PATH"
		echo "still resolves to $installed_version at $(command -v prek 2>/dev/null || echo 'nowhere')."
		echo "Something earlier on PATH is shadowing the pinned install --"
		echo "check 'echo \$PATH' and pipx's/uv's bin directory ordering."
		exit 1
	fi
	echo "prek $installed_version now on PATH (matches the pinned version)"
fi

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
	echo ".git/hooks won't run -- skipping 'prek install' (it would refuse"
	echo "anyway). If that path already runs prek for opted-in repos (the"
	echo "maintainer-machine convention), run:"
	echo "  git config prek.enabled true"
	echo "Otherwise wire prek into whatever '$hooks_path' runs yourself."
	echo "prek and gitleaks are installed; 'npm run check' works regardless."
	exit 0
fi

prek install
prek install --hook-type pre-push
echo "OK: pre-commit/pre-push hooks installed from .pre-commit-config.yaml"
echo "Run 'npm run check' any time to run the same gate CI does."
