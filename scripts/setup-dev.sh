#!/bin/sh
# npm run setup — one-command contributor bootstrap for the local quality
# gate. Wires .pre-commit-config.yaml into this clone's Git hooks.
#
# Resolving the pinned version (`prek --version` below) always goes
# through `pipx run --spec prek==X.Y.Z` (or the uv equivalent), never a
# `prek` already on PATH -- that removes the "wrong version" class of bug
# regardless of what else is installed or where it sits on PATH.
#
# Actually WIRING the hooks is different: `prek install` embeds the
# absolute path it was invoked from into the generated hook script, so
# pointing it at an ephemeral `pipx run`/`uv tool run` cache entry bakes a
# path into .git/hooks/pre-commit that can silently stop existing later
# (pipx documents its run-cache as pruned after as little as 14 days;
# reported against this script). Once pruned, every commit fails with a
# missing-executable error until `npm run setup` is re-run. So once a
# hooks_path clone is confirmed (below), the pinned version is installed
# *persistently* (`pipx install --force` / `uv tool install --force`,
# not `run`) before `prek install` runs, so the embedded path survives.
#
# gitleaks has no such wrapper (a Go binary, not a Python package) and is
# still expected to be a real installed binary on PATH.
#
# core.hooksPath handling: ANY custom hooks path means this clone's own
# .git/hooks won't run (a maintainer-machine convention routes ALL repos
# through one global dispatcher instead) -- hook installation (and the
# persistent install above) is skipped in that case, without trying to
# identify which dispatcher it is. The prek/gitleaks checks above still
# run either way, since `npm run check` needs them regardless of how
# hooks are wired.
#
# Idempotent: safe to re-run any time (e.g. after .github/workflows/test.yml
# bumps the pinned prek version) -- `--force` re-pins the persistent
# install to whatever version is current.
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
	# uv already on PATH (from an unrelated toolchain) and refuse to run.
	# Older pipx (reported: 1.4.3) predates the --backend flag entirely
	# and errors out on it ("unrecognized arguments"), so only pass it
	# when this pipx's own --help advertises it.
	if pipx run --help 2>&1 | grep -q -- '--backend'; then
		pipx_backend_flag="--backend pip"
	else
		pipx_backend_flag=""
	fi
	# shellcheck disable=SC2086 # intentional word-splitting: empty when unsupported
	prek() { pipx run $pipx_backend_flag --spec "prek==$prek_version" prek "$@"; }
	backend="pipx"
elif command -v uv >/dev/null 2>&1; then
	prek() { uv tool run --from "prek==$prek_version" prek "$@"; }
	backend="uv"
else
	echo "missing: pipx or uv, needed to run the pinned prek==$prek_version"
	echo "without depending on whatever else might be on PATH. Install one:"
	echo "  https://pipx.pypa.io/stable/installation/"
	echo "  https://docs.astral.sh/uv/getting-started/installation/"
	exit 1
fi

echo "resolving prek==$prek_version ..."
prek --version

if ! command -v gitleaks >/dev/null 2>&1; then
	echo "missing: gitleaks. Install it, e.g.:"
	echo "  brew install gitleaks"
	echo "or download a release: https://github.com/gitleaks/gitleaks/releases"
	exit 1
fi
# A legacy gitleaks (pre-v8 `detect`/`protect` CLI, no `dir` subcommand)
# would report success here and then fail later, at `gitleaks dir .` in
# scripts/check.sh, with an unknown-command error -- check for `dir`
# explicitly rather than just presence on PATH.
if ! gitleaks --help 2>&1 | grep -q '^ *dir '; then
	echo "installed gitleaks is too old (no 'dir' subcommand -- needs v8+):"
	echo "  $(gitleaks version 2>&1 | head -n1)"
	echo "Upgrade it, e.g.:"
	echo "  brew upgrade gitleaks"
	echo "or download a current release: https://github.com/gitleaks/gitleaks/releases"
	exit 1
fi
echo "gitleaks already installed ($(gitleaks version 2>&1 | head -n1))"

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

# Install the pinned version persistently before wiring hooks, so the
# path `prek install` embeds in .git/hooks/{pre-commit,pre-push} outlives
# pipx's/uv's ephemeral run-cache pruning (see the top-of-file comment).
#
# Installed into a VERSION-SCOPED location, not pipx's/uv's shared "prek"
# app slot: that shared slot is a single global name, so a plain `pipx
# install --force prek==X`/`uv tool install --force prek` for one repo
# would silently overwrite the exact binary path already embedded in
# every other repo's hooks the moment that other repo pins a different
# prek version -- defeating the version pinning for whichever repo was
# set up first. Scoping the install directory by $prek_version means two
# repos pinning the same version safely share one binary, and two repos
# pinning different versions each get their own, never overwriting the
# other. `PIPX_HOME`/`PIPX_BIN_DIR` (pipx) and `UV_TOOL_DIR`/
# `UV_TOOL_BIN_DIR` (uv) redirect the install without touching either
# tool's shared/default namespace at all.
persist_root="$HOME/.local/state/pollenprognos-card-prek/$prek_version"
bin_dir="$persist_root/bin"
echo "installing prek==$prek_version persistently for the Git hooks ..."
if [ "$backend" = "pipx" ]; then
	# shellcheck disable=SC2086 # intentional word-splitting: empty when unsupported
	PIPX_HOME="$persist_root/pipx" PIPX_BIN_DIR="$bin_dir" \
		pipx install --force $pipx_backend_flag "prek==$prek_version"
else
	UV_TOOL_DIR="$persist_root/uv-tools" UV_TOOL_BIN_DIR="$bin_dir" \
		uv tool install --force --from "prek==$prek_version" prek
fi
prek_bin="$bin_dir/prek"

if [ ! -x "$prek_bin" ]; then
	echo "installed prek==$prek_version but $prek_bin is missing or not"
	echo "executable -- add $bin_dir to PATH, then re-run 'npm run setup'."
	exit 1
fi

# From here on, use the resolved persistent binary directly (not the
# ephemeral `prek` shell function defined above, and not a PATH lookup)
# so the embedded hook path is the persistent one.
"$prek_bin" install
"$prek_bin" install --hook-type pre-push
echo "OK: pre-commit/pre-push hooks installed from .pre-commit-config.yaml"
echo "Run 'npm run check' any time to run the same gate CI does."
