# Nagelfaringsprotokollet (process pointer)

**Anchor:** `NF_PROTOCOL`

The full protocol lives in the user-level installed skill `nagelfar`
(`~/.claude/skills/nagelfar/SKILL.md`). This file is a short pointer so that repo-local
searches find the process.

## What it is

Nagelfaringsprotokollet is **local, independent code review of feature branches before
merge**. `Nagelfararna` is the reviewer role: a fresh subagent **without the dev
session's context** that performs a clean audit and only writes findings (never touches
project code). The development team requests review, addresses findings, and replies in
`coms.md` after every push.

## When it is used, the fallback

**When BOTH Codex and Copilot are down, Nagelfar is the review for the PR; this is THE
fallback, not an optional extra layer.** Do not skip review just because the bots are
unavailable.

Conversely: **when the bots are up, do NOT run Nagelfar**; it costs tokens for review the
bots already give. The normal path is the Codex + Copilot double loop (see
`~/.claude/CLAUDE.md` § Code review-loop). Nagelfar only fills the gap when that loop
cannot run.

## Quickstart

Spawn the `nagelfararna` agent (`.claude/agents/nagelfararna.md`) with a neutral brief
(branch, base, what the feature should do, not the implementation reasoning). Alternative
bootstrap phrase:

```text
Act as Nagelfararna. Start Nagelfaringsprotokollet for branch
<branch>. Anchor: NF_PROTOCOL.
```

The branch name is optional; if omitted, `git branch --show-current` is used.

## Where things live

- Protocol + severity model + templates: `~/.claude/skills/nagelfar/`
- Agent (revir definition): `.claude/agents/nagelfararna.md`
- Per-branch working directory: `tmp/nagelfar/<branch-slug>/` (gitignored; slug = branch
  with `/` replaced by `-`)
- Channel file: `tmp/nagelfar/<branch-slug>/coms.md`; findings in `summary.md` +
  `issues/*.md`

## Prerequisites

The branch author runs the repo checks and they pass before review: `npm test` (vitest)
and `npm run build`.

## Severity & outcome (summary)

- Severity: `critical` / `important` / `improvement`
- Outcome: `approved` / `approved with follow-ups` / `changes requested`

See the full skill for the finding threshold, `coms.md` format and polling protocol.
