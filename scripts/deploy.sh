#!/usr/bin/env bash
# LetsGetFit — copy the deployable static files (public/) into the site's document root.
#
# Run by cPanel Git Version Control through .cpanel.yml ("Deploy HEAD Commit"), or by hand:
#   bash scripts/deploy.sh
#
# Settings are read from a server-local file OUTSIDE the repository and web root:
#   ${LETSGETFIT_DEPLOY_CONFIG:-$HOME/.config/letsgetfit/deploy.env}
# See config/deploy.env.example and docs/DEPLOY-CPANEL.md.
#
# Safety rules:
#   - Fails without copying anything if the config or destination is missing or looks wrong.
#   - The destination must contain the marker file .letsgetfit-docroot, created by you once.
#   - Copies only the contents of public/. Never .git, scripts, tests, config or docs.
#   - Never deletes files in the destination (no mirroring), so .well-known, cgi-bin and
#     other host-managed files are left alone.
#   - Backs up the files it is about to overwrite to a directory outside the web root.
#   - Never runs database migrations.

set -euo pipefail
umask 022

fail() {
  echo "deploy: ERROR: $*" >&2
  exit 1
}
info() {
  echo "deploy: $*"
}

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
SOURCE_DIR="$REPO_ROOT/public"
CONFIG="${LETSGETFIT_DEPLOY_CONFIG:-$HOME/.config/letsgetfit/deploy.env}"
MARKER=".letsgetfit-docroot"

[ -n "${HOME:-}" ] || fail "HOME is not set."
[ -f "$CONFIG" ] || fail "settings file not found: $CONFIG (copy config/deploy.env.example there and set DEPLOYPATH)."

# Read KEY=value lines without executing the file.
read_setting() {
  local key="$1" value
  value="$(grep -E "^${key}=" "$CONFIG" | tail -n 1 | cut -d= -f2- || true)"
  value="${value%$'\r'}"
  value="${value#\"}"
  value="${value%\"}"
  value="${value#\'}"
  value="${value%\'}"
  printf '%s' "$value"
}

DEPLOYPATH="$(read_setting DEPLOYPATH)"
BACKUP_DIR="$(read_setting BACKUP_DIR)"
KEEP_BACKUPS="$(read_setting KEEP_BACKUPS)"
BACKUP_DIR="${BACKUP_DIR:-$HOME/letsgetfit-backups}"
KEEP_BACKUPS="${KEEP_BACKUPS:-5}"
STATE_DIR="$HOME/.local/state/letsgetfit"

# ---- Validate the destination ----
[ -n "$DEPLOYPATH" ] || fail "DEPLOYPATH is empty in $CONFIG."
case "$DEPLOYPATH" in
  /*) ;;
  *) fail "DEPLOYPATH must be an absolute path (got: $DEPLOYPATH)." ;;
esac
case "/$DEPLOYPATH/" in
  */../* | */./*) fail "DEPLOYPATH must not contain . or .. segments." ;;
esac
[ -d "$DEPLOYPATH" ] || fail "DEPLOYPATH does not exist or is not a directory: $DEPLOYPATH"
DEST="$(cd "$DEPLOYPATH" && pwd -P)"
HOME_REAL="$(cd "$HOME" && pwd -P)"

[ "$DEST" != "/" ] || fail "refusing to deploy to /."
[ "$DEST" != "$HOME_REAL" ] || fail "refusing to deploy to the home directory itself."
case "$DEST/" in
  "$REPO_ROOT"/*) fail "DEPLOYPATH is inside the repository checkout." ;;
esac
case "$REPO_ROOT/" in
  "$DEST"/*) fail "the repository checkout is inside DEPLOYPATH, which would expose .git. Clone it outside the web root." ;;
esac
[ -f "$DEST/$MARKER" ] || fail "marker file $DEST/$MARKER not found. Create it once to confirm this is the letsgetfit.site document root: touch \"$DEST/$MARKER\""
[ -w "$DEST" ] || fail "DEPLOYPATH is not writable: $DEST"

[[ "$KEEP_BACKUPS" =~ ^[0-9]+$ ]] || fail "KEEP_BACKUPS must be a whole number."
case "$BACKUP_DIR" in
  /*) ;;
  *) fail "BACKUP_DIR must be an absolute path." ;;
esac
case "$BACKUP_DIR/" in
  "$DEST"/*) fail "BACKUP_DIR must be outside the document root." ;;
esac

# ---- Validate the source ----
[ -f "$SOURCE_DIR/index.html" ] || fail "public/index.html is missing; is this a complete checkout?"
[ ! -e "$SOURCE_DIR/.well-known" ] || fail "public/.well-known must not exist; it is managed by the host."
for forbidden in .git .env node_modules config; do
  [ ! -e "$SOURCE_DIR/$forbidden" ] || fail "public/$forbidden must not be deployed."
done

# Top-level entries of the release (including dotfiles such as .htaccess).
mapfile -t ENTRIES < <(cd "$SOURCE_DIR" && find . -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)
[ "${#ENTRIES[@]}" -gt 0 ] || fail "public/ is empty."

COMMIT="unknown"
if command -v git >/dev/null 2>&1; then
  COMMIT="$(git -C "$REPO_ROOT" rev-parse --short=12 HEAD 2>/dev/null || echo unknown)"
fi
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

# ---- Back up what will be overwritten ----
mkdir -p "$BACKUP_DIR" "$STATE_DIR"
chmod 700 "$BACKUP_DIR" "$STATE_DIR" 2>/dev/null || true
EXISTING=()
for entry in "${ENTRIES[@]}"; do
  [ -e "$DEST/$entry" ] && EXISTING+=("$entry")
done
if [ "${#EXISTING[@]}" -gt 0 ]; then
  BACKUP_FILE="$BACKUP_DIR/docroot-$STAMP.tar.gz"
  tar -czf "$BACKUP_FILE" -C "$DEST" -- "${EXISTING[@]}"
  info "backed up ${#EXISTING[@]} existing item(s) to $BACKUP_FILE"
  # Keep only the newest KEEP_BACKUPS archives.
  mapfile -t OLD < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'docroot-*.tar.gz' -printf '%f\n' | LC_ALL=C sort -r | tail -n +"$((KEEP_BACKUPS + 1))")
  for old in "${OLD[@]}"; do
    rm -f -- "$BACKUP_DIR/$old"
  done
fi

# ---- Copy ----
for entry in "${ENTRIES[@]}"; do
  cp -R -- "$SOURCE_DIR/$entry" "$DEST/"
  # Shared hosts often refuse group- or world-writable files.
  if [ -d "$DEST/$entry" ]; then
    find "$DEST/$entry" -type d -exec chmod 755 {} +
    find "$DEST/$entry" -type f -exec chmod 644 {} +
  else
    chmod 644 "$DEST/$entry"
  fi
done

printf '%s commit=%s dest=%s items=%s\n' "$STAMP" "$COMMIT" "$DEST" "${#ENTRIES[@]}" >> "$STATE_DIR/deploy.log"
info "deployed commit $COMMIT to $DEST (${#ENTRIES[@]} top-level item(s))."
