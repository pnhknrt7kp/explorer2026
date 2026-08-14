#!/usr/bin/env bash
#
# deploy-draft.sh — put an unreleased draft in front of named reviewers.
#
# Deploys to Cloudflare Pages by direct upload, so the draft PDF never enters
# git and never reaches the public GitHub Pages site. Access control is a
# Cloudflare Access policy on the project (see README, "Sharing a draft").
#
# Usage:
#   ./deploy-draft.sh                              # deploys the current draft below
#   ./deploy-draft.sh 'assets/another draft.pdf'   # deploys a specific draft
#   TITLE='The Explorer 2026 — DRAFT' ./deploy-draft.sh
#   PROJECT=my-project ./deploy-draft.sh
#
set -euo pipefail

cd "$(dirname "$0")"

DRAFT="${1:-assets/Explorer Magazine 2026 draft.pdf}"

# The project name decides the pages.dev hostname, and that hostname is the only
# thing keeping the draft obscure in the moments before an Access policy applies.
# So it is kept in .deploy-project, which git ignores, rather than in this file —
# this repository is public.
PROJECT="${PROJECT:-$(cat .deploy-project 2>/dev/null || true)}"
if [[ -z "$PROJECT" ]]; then
  echo "error: no Cloudflare Pages project configured." >&2
  echo "       Put the project name in .deploy-project (git ignores it), or" >&2
  echo "       run with PROJECT=<name> ./deploy-draft.sh" >&2
  exit 1
fi
TITLE="${TITLE:-Explorer Magazine 2026 — DRAFT}"

if [[ ! -f "$DRAFT" ]]; then
  echo "error: no such draft: $DRAFT" >&2
  echo "drafts available in assets/:" >&2
  find assets -maxdepth 1 -iname '*.pdf' ! -name 'document.pdf' >&2
  exit 1
fi

# Refuse to ship a draft that git is tracking. Everything in assets/ except the
# released document.pdf is gitignored, so a tracked draft means either the rule
# was bypassed with `git add -f` or the file is the released edition itself —
# both worth stopping for, because this repository is public.
if git ls-files --error-unmatch "$DRAFT" >/dev/null 2>&1; then
  echo "error: $DRAFT is tracked by git, whose history is public." >&2
  echo "       Either this is the released edition (deploy it to GitHub Pages" >&2
  echo "       instead) or it was force-added; untrack it before sharing." >&2
  exit 1
fi

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# Copy only what the viewer needs. Naming the draft document.pdf means config.js
# needs no ?pdf= override, so reviewers get a clean URL with no way to guess at
# other files.
mkdir -p "$STAGE/assets"
cp index.html "$STAGE/"
cp -R css js vendor "$STAGE/"
cp "$DRAFT" "$STAGE/assets/document.pdf"

# Staged config only — the repo's own config.js is left alone, so the public
# 2025 site keeps its title and its published PDF.
sed -e "s|title: '[^']*'|title: '$TITLE'|" \
    -e "s|downloadUrl: '[^']*'|downloadUrl: ''|" \
    config.js > "$STAGE/config.js"

# Belt and braces behind the Access gate: nothing here should be indexed. This
# lives only in the staging copy — a robots.txt in the repo would also apply to
# the public site and deindex the released edition.
printf 'User-agent: *\nDisallow: /\n' > "$STAGE/robots.txt"

echo "Draft:   $DRAFT ($(du -h "$DRAFT" | cut -f1))"
echo "Title:   $TITLE"
echo "Project: $PROJECT"
echo

# Pages rejects a deploy for a project that does not exist yet and there is no
# --create flag, so make the first run self-sufficient. If this fails for any
# other reason the deploy below surfaces it properly.
npx --yes wrangler@latest pages project create "$PROJECT" \
  --production-branch main >/dev/null 2>&1 || true

npx --yes wrangler@latest pages deploy "$STAGE" \
  --project-name "$PROJECT" \
  --commit-dirty=true

echo
echo "Deployed. If this is a new project, add the Access policy before sharing"
echo "the URL — until you do, the draft is readable by anyone who has it."
echo "See README, \"Sharing a draft with reviewers\"."
