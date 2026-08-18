#!/usr/bin/env bash
# Update the installed Mac app from this fork.
#
# The daily "Upstream sync" workflow already rebases this branch onto
# upstream and refuses to publish a branch whose tests fail, so pulling
# here is safe by construction. This script just turns the current branch
# into a fresh /Applications/OpenMausBot.app.
#
# A locally built app carries an ad-hoc signature, and macOS refuses to
# apply updates to an app that is not signed with a Developer ID, so the
# in-app updater cannot install anything here. The update feed is left in
# place anyway: this build tracks upstream closely, so the check reports
# "up to date" instead of erroring, and this script is what actually
# updates the app.
#
# --auto is the unattended mode used by the LaunchAgent: it does nothing
# unless there is something new to build, and never interrupts a running
# app.
set -euo pipefail

cd "$(dirname "$0")/.."
APP="/Applications/OpenMausBot.app"
AUTO=${1:-}

notify() { osascript -e "display notification \"$2\" with title \"$1\"" >/dev/null 2>&1 || true; }

if [ "$AUTO" = "--auto" ]; then
  # the sync workflow rebases this branch onto upstream, so origin moving
  # is the signal that a new version exists
  BRANCH=$(git rev-parse --abbrev-ref HEAD)
  git fetch -q origin "$BRANCH"
  if [ "$(git rev-parse HEAD)" = "$(git rev-parse '@{u}')" ]; then
    echo "$(date '+%Y-%m-%d %H:%M') nothing new upstream"
    exit 0
  fi
  if pgrep -qf "$APP/Contents/MacOS"; then
    echo "$(date '+%Y-%m-%d %H:%M') update available but the app is running — will retry"
    exit 0
  fi
  # Take the synced branch verbatim rather than merging into it: local
  # edits must never be able to stall an update. Anything uncommitted is
  # stashed first, so it is recoverable with `git stash list`.
  if [ -n "$(git status --porcelain)" ]; then
    git stash push -q -u -m "auto-update $(date '+%Y-%m-%d %H:%M')"
    echo "$(date '+%Y-%m-%d %H:%M') local changes stashed before updating"
  fi
  git reset -q --hard "@{u}"
  trap 'notify "OpenMausBot update failed" "See ~/Library/Logs/openmausbot-update.log"' ERR
fi

pnpm() { command pnpm "$@" 2>/dev/null || corepack pnpm "$@"; }

if [ "$AUTO" != "--auto" ]; then
  # Installing means replacing the bundle, which quits the running app —
  # from the user's side that looks exactly like a crash. Never do it
  # behind their back.
  if [ "$AUTO" != "--force" ] && pgrep -qf "$APP/Contents/MacOS"; then
    echo "OpenMausBot is open. Quit it first, or re-run with --force to have"
    echo "this script quit it for you." >&2
    exit 0
  fi
  echo "==> Pulling $(git rev-parse --abbrev-ref HEAD)"
  git pull --rebase --autostash
fi

# ── local patches ──────────────────────────────────────────────────────
# Applied to the working tree for the duration of the build and reverted
# after, so this branch never edits a file upstream owns and rebases can
# never conflict. A patch that no longer applies is reported and skipped:
# an update must never be blocked by a local change. See patches/README.md.
PATCHED_FILES=()
FAILED_PATCHES=()
restore_tree() {
  if [ ${#PATCHED_FILES[@]} -gt 0 ]; then
    git checkout -- "${PATCHED_FILES[@]}" 2>/dev/null || true
    for f in "${PATCHED_FILES[@]}"; do
      git ls-files --error-unmatch "$f" >/dev/null 2>&1 || rm -f "$f"
    done
    # dist-server is a checked-in build output, so patched sources leave it
    # dirty; it is regenerated on every build anyway
    git checkout -- dist-server 2>/dev/null || true
  fi
  [ -f "${ICON_DIR:-}/app-icon.orig.png" ] && cp "$ICON_DIR/app-icon.orig.png" electron/resources/app-icon.png 2>/dev/null || true
}
trap restore_tree EXIT

shopt -s nullglob
patches=(patches/*.patch)
if [ ${#patches[@]} -gt 0 ]; then
  echo "==> Applying ${#patches[@]} local patch(es)"
  if [ -n "$(git status --porcelain -- ':!patches')" ]; then
    echo "    working tree is dirty — commit or stash first" >&2
    exit 1
  fi
  for p in "${patches[@]}"; do
    if git apply --check "$p" 2>/dev/null; then
      while IFS= read -r f; do PATCHED_FILES+=("$f"); done < <(git apply --numstat "$p" | cut -f3)
      git apply "$p"
      echo "    ok   $(basename "$p")"
    else
      FAILED_PATCHES+=("$(basename "$p")")
      echo "    SKIP $(basename "$p") — no longer applies to this version" >&2
    fi
  done
fi

echo "==> Installing dependencies"
pnpm install

echo "==> Checking types and tests"
pnpm typecheck
pnpm test

echo "==> Building"
pnpm build
pnpm build:server
pnpm build:speech
pnpm build:updater

# Pad the Dock icon (see scripts/make-dock-icon.py). Applied to the build,
# never committed, so this branch keeps touching zero upstream files — and
# skipped automatically once upstream ships a padded icon.
ICON_DIR="$PWD/build/.dock-icon"
# Expanding an empty array counts as unset under `set -u` in the bash 3.2
# macOS ships, so the use below is guarded — and now that upstream ships a
# padded icon, empty is the normal case.
ICON_ARGS=()
icon_python() {
  for py in python3 /usr/local/bin/python3 /opt/homebrew/bin/python3 \
            /Library/Frameworks/Python.framework/Versions/Current/bin/python3; do
    if command -v "$py" >/dev/null 2>&1 && "$py" -c "import PIL" >/dev/null 2>&1; then
      echo "$py"; return
    fi
  done
  if [ ! -x build/.icon-venv/bin/python3 ]; then
    python3 -m venv build/.icon-venv >&2 && build/.icon-venv/bin/pip install --quiet pillow >&2
  fi
  echo "build/.icon-venv/bin/python3"
}
set +e
"$(icon_python)" scripts/make-dock-icon.py "$ICON_DIR"
icon_status=$?
set -e
if [ "$icon_status" -eq 0 ]; then
  # electron/resources/app-icon.png is what app.dock.setIcon() uses and it
  # is packed into the asar, so it has to be in place before packaging
  cp electron/resources/app-icon.png "$ICON_DIR/app-icon.orig.png"
  cp "$ICON_DIR/app-icon.png" electron/resources/app-icon.png
  ICON_ARGS=(-c.mac.icon="$ICON_DIR/icon.icns")
elif [ "$icon_status" -ne 3 ]; then
  echo "icon step failed ($icon_status) — building with the stock icon" >&2
fi

CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder --mac ${ICON_ARGS[@]+"${ICON_ARGS[@]}"} --publish never

echo "==> Installing to $APP"
osascript -e 'tell application "OpenMausBot" to quit' >/dev/null 2>&1 || true
# give the app a moment to release its files
for _ in 1 2 3 4 5; do pgrep -q -f "$APP/Contents/MacOS" || break; sleep 1; done
rm -rf "$APP"
cp -R release/mac-arm64/OpenMausBot.app "$APP"
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true

VERSION=$(defaults read "$APP/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null || echo installed)
echo "==> Done — $VERSION"
if [ ${#FAILED_PATCHES[@]} -gt 0 ]; then
  echo "    skipped patches: ${FAILED_PATCHES[*]} (upstream changed that code)"
  notify "OpenMausBot updated, ${#FAILED_PATCHES[@]} patch(es) skipped" "${FAILED_PATCHES[*]} no longer apply — see patches/README.md"
elif [ "$AUTO" = "--auto" ]; then
  notify "OpenMausBot updated" "Now on $VERSION"
fi
[ "$AUTO" = "--auto" ] || echo "    Launch it with: open -a OpenMausBot"
