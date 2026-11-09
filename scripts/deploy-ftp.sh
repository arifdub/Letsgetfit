#!/usr/bin/env bash
# LetsGetFit — upload the static site (public/) to the cPanel document root over FTPS.
#
# Used by .github/workflows/deploy.yml. Can also be run by hand with the same variables.
#
# Required environment variables (GitHub repository secrets):
#   FTP_SERVER     FTP host name, e.g. ftp.letsgetfit.site or the server's own host name
#                  (an optional ftp:// prefix and :port suffix are accepted)
#   FTP_USERNAME   cPanel FTP account
#   FTP_PASSWORD   its password
#   FTP_DIRECTORY  path of the letsgetfit.site document root as seen when logged in by FTP,
#                  e.g. "letsgetfit.site" or "public_html", or "/" if the FTP account is
#                  restricted to the document root itself
# Optional:
#   FTP_PORT         default 21
#   FTP_VERIFY_CERT  "true" (default) or "false" — only for hosts whose FTPS certificate
#                    does not match FTP_SERVER; see docs/DEPLOY-CPANEL.md
#   DEPLOY_SOURCE    folder to upload, default <repo>/public
#   DRY_RUN          "true" to list what would be uploaded without changing anything
#
# Safety rules (same as scripts/deploy.sh):
#   - Always encrypted (explicit FTPS). Plain FTP is refused, so the password never travels
#     in clear text.
#   - Stops before uploading anything unless the target folder contains the marker file
#     .letsgetfit-docroot that you create once in the real document root.
#   - Uploads only the contents of public/. Never deletes anything on the server, so
#     .well-known, cgi-bin and other host files are left alone.
#   - Uploads index.html last, so the new page never loads before its assets exist.

set -euo pipefail

fail() {
  echo "deploy-ftp: ERROR: $*" >&2
  exit 1
}
info() {
  echo "deploy-ftp: $*"
}

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
SOURCE="${DEPLOY_SOURCE:-$REPO_ROOT/public}"
MARKER=".letsgetfit-docroot"

missing=()
for name in FTP_SERVER FTP_USERNAME FTP_PASSWORD FTP_DIRECTORY; do
  [ -n "${!name:-}" ] || missing+=("$name")
done
[ "${#missing[@]}" -eq 0 ] || fail "missing setting(s): ${missing[*]}. Add them under GitHub > Settings > Secrets and variables > Actions."

command -v lftp >/dev/null 2>&1 || fail "lftp is not installed."

# ---- Normalise and validate settings ----
host="${FTP_SERVER#ftp://}"
host="${host#ftps://}"
host="${host%%/*}"
port="${FTP_PORT:-21}"
if [[ "$host" == *:* ]]; then
  port="${host##*:}"
  host="${host%:*}"
fi
[[ "$host" =~ ^[A-Za-z0-9.-]+$ ]] || fail "FTP_SERVER must be a host name (got an unexpected value)."
[[ "$port" =~ ^[0-9]{1,5}$ ]] || fail "FTP port must be a number."

dir="$FTP_DIRECTORY"
[[ "$dir" != *$'\n'* && "$dir" != *'"'* && "$dir" != *'\'* ]] || fail "FTP_DIRECTORY contains characters that are not allowed."
case "/$dir/" in
  */../*) fail "FTP_DIRECTORY must not contain .. segments." ;;
esac
[ -n "$dir" ] || dir="/"

case "${FTP_VERIFY_CERT:-true}" in
  true | yes | 1) verify="yes" ;;
  false | no | 0)
    verify="no"
    echo "::warning::FTPS certificate verification is turned off (FTP_VERIFY_CERT=false). The connection is still encrypted, but the server's identity is not checked." ;;
  *) fail "FTP_VERIFY_CERT must be true or false." ;;
esac

[[ "$FTP_USERNAME" != *$'\n'* && "$FTP_USERNAME" != *'"'* ]] || fail "FTP_USERNAME contains characters that are not allowed."

dry=""
index_cmd="put \"$SOURCE/index.html\" -o index.html"
if [ "${DRY_RUN:-false}" = "true" ]; then
  dry="--dry-run"
  index_cmd="echo dry run: index.html would be uploaded last"
  info "dry run: nothing will be changed on the server."
fi

# ---- Validate the source ----
[ -f "$SOURCE/index.html" ] || fail "$SOURCE/index.html is missing."
[ ! -e "$SOURCE/.well-known" ] || fail "public/.well-known must not exist; it is managed by the host."
for forbidden in .git .env node_modules config; do
  [ ! -e "$SOURCE/$forbidden" ] || fail "public/$forbidden must not be deployed."
done

info "uploading $(find "$SOURCE" -type f | wc -l | tr -d ' ') file(s) from public/ to $host:$port, folder \"$dir\"."

# The password is passed through the environment (LFTP_PASSWORD), never on the command line.
export LFTP_PASSWORD="$FTP_PASSWORD"
lftp_status=0
lftp <<LFTP || lftp_status=$?
set cmd:fail-exit yes
set net:timeout 30
set net:max-retries 3
set net:reconnect-interval-base 5
set net:reconnect-interval-max 30
set ftp:ssl-allow yes
set ftp:ssl-force yes
set ftp:ssl-protect-data yes
set ftp:ssl-protect-list yes
set ssl:verify-certificate $verify
set ftp:passive-mode yes
set xfer:clobber yes
open --env-password -u "$FTP_USERNAME" -p $port "ftp://$host"
cd "$dir"
cls -1a "$MARKER"
mirror --reverse --no-perms --parallel=2 --verbose=1 $dry --exclude-glob .well-known/ --exclude-glob .git/ --exclude '^index\.html$' "$SOURCE" .
$index_cmd
bye
LFTP
unset LFTP_PASSWORD

if [ "$lftp_status" -ne 0 ]; then
  fail "the upload stopped (lftp exit $lftp_status). Check the messages above. If it says the marker file is missing, create $MARKER in the letsgetfit.site document root and check FTP_DIRECTORY points at that folder."
fi
info "done."
