#!/usr/bin/env bash
#
# Symlinks gitignored .env* files from the main checkout into this worktree,
# then installs dependencies. Run from anywhere inside a worktree. Re-runnable.
#
# Master copy: ~/.scripts/worktree-setup/worktree-setup.sh
#
# Copy this into a repo at scripts/worktree-setup.sh, commit it, and point the
# repo's worktree setup hook at:
#
#   bash scripts/worktree-setup.sh
#
# Do not run it from the shared folder it was copied from. See README.md there.

set -euo pipefail

WORKTREE_ROOT="$(git rev-parse --show-toplevel)"
COMMON_DIR="$(cd "$(git rev-parse --git-common-dir)" && pwd)"
MAIN_REPO="$(dirname "$COMMON_DIR")"
cd "$WORKTREE_ROOT"

echo "==> Worktree setup"
echo "    worktree: $WORKTREE_ROOT"
echo "    source:   $MAIN_REPO"

if [ "$WORKTREE_ROOT" = "$MAIN_REPO" ]; then
  echo "    (this IS the main checkout; skipping env symlinks)"
else
  echo "==> Symlinking env files"
  linked=0
  kept=0
  while IFS= read -r -d '' src; do
    rel="${src#"$MAIN_REPO"/}"
    dest="$WORKTREE_ROOT/$rel"

    # Tracked env files already exist here; symlinking would dirty git status.
    if git -C "$MAIN_REPO" ls-files --error-unmatch -- "$rel" > /dev/null 2>&1; then
      continue
    fi

    # A regular file means local edits (some editors save via temp-file rename).
    if [ -e "$dest" ] && [ ! -L "$dest" ]; then
      echo "    kept (local file): $rel"
      kept=$((kept + 1))
      continue
    fi

    mkdir -p "$(dirname "$dest")"
    ln -sfn "$src" "$dest"
    echo "    linked:            $rel"
    linked=$((linked + 1))
  done < <(
    find "$MAIN_REPO" -type f \( -name ".env" -o -name ".env.*" \) \
      -not -path "*/node_modules/*" \
      -not -path "*/.git/*" \
      -not -name "*.example" \
      -not -name "*.bak" -not -name "*.bak.*" -not -name "*.bak-*" \
      -print0
  )
  echo "    done: $linked linked, $kept kept"
fi

if [ ! -f package.json ]; then
  echo "==> No package.json; skipping install"
  exit 0
fi

PM="$(sed -n 's/.*"packageManager"[[:space:]]*:[[:space:]]*"\([a-z]*\)@.*/\1/p' package.json | head -1)"
if [ -z "$PM" ]; then
  if [ -f pnpm-lock.yaml ]; then PM=pnpm
  elif [ -f bun.lockb ] || [ -f bun.lock ]; then PM=bun
  elif [ -f yarn.lock ]; then PM=yarn
  else PM=npm
  fi
fi

echo "==> $PM install"
"$PM" install

echo "==> Worktree ready"
