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
#   FTP_CERT_FINGERPRINT  SHA-1 fingerprint (AA:BB:...) of the FTP server's certificate.
#                    Trusts exactly that certificate even if it is self-signed, which is
#                    common for cPanel FTP. Safer than turning verification off.
#   FTP_VERIFY_CERT  "true" (default) or "false" — last resort only; see docs/DEPLOY-CPANEL.md
#   DEPLOY_SOURCE    folder to upload, default <repo>/public
#   DRY_RUN          "true" to list what would be uploaded without changing anything
#   SITE_URL         live address, default https://letsgetfit.site/ (used to prove the folder)
#
# Safety rules (same as scripts/deploy.sh):
#   - Always encrypted (explicit FTPS). Plain FTP is refused, so the password never travels
#     in clear text.
#   - Only uploads into a folder proven to be the document root of SITE_URL: either it holds
#     the marker file .letsgetfit-docroot, or a random probe file uploaded there is served
#     back by the live site. The proven folder then gets the marker for next time.
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

pin_cmd=""
if [ -n "${FTP_CERT_FINGERPRINT:-}" ]; then
  fingerprint="$(printf '%s' "$FTP_CERT_FINGERPRINT" | tr '[:lower:]' '[:upper:]' | tr -d '[:space:]')"
  [[ "$fingerprint" =~ ^([0-9A-F]{2}:){19}[0-9A-F]{2}$ ]] || fail "FTP_CERT_FINGERPRINT must be a SHA-1 fingerprint like 5A:56:...:5F (20 pairs)."
  # lftp: trust this one certificate (by fingerprint) while still verifying everything else.
  pin_cmd="set ssl:verify-certificate/$fingerprint no"
  info "trusting the pinned FTP certificate $fingerprint."
fi

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

SITE_URL="${SITE_URL:-https://letsgetfit.site/}"
SITE_URL="${SITE_URL%/}/"
[[ "$SITE_URL" =~ ^https?://[A-Za-z0-9.:-]+/$ ]] || fail "SITE_URL must look like https://letsgetfit.site/"
domain="${DEPLOY_DOMAIN:-$(printf '%s' "$SITE_URL" | sed -E 's#^https?://([^/:]+).*#\1#')}"
[[ "$domain" =~ ^[A-Za-z0-9.-]+$ ]] || fail "could not work out the domain from SITE_URL."

# The password is passed through the environment (LFTP_PASSWORD), never on the command line.
export LFTP_PASSWORD="$FTP_PASSWORD"

# Run lftp commands (one per argument) on a fresh FTPS connection.
run_lftp() {
  {
    cat <<LFTP
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
$pin_cmd
set ftp:passive-mode yes
set xfer:clobber yes
open --env-password -u "$FTP_USERNAME" -p $port "ftp://$host"
LFTP
    printf '%s\n' "$@"
    echo bye
  } | lftp
}

has_marker() {
  run_lftp "cd \"$1\"" "cls -1a \"$MARKER\"" >/dev/null 2>&1
}

# Upload a random file into a folder and check the live site serves it back. This proves the
# folder is the document root of SITE_URL, so we can never deploy into another site's folder.
probe_folder() {
  local folder="$1" token name tmp body ok=1
  token="$(od -An -tx1 -N16 /dev/urandom | tr -d ' \n')"
  name="letsgetfit-probe-$token.txt"
  tmp="$(mktemp)"
  printf '%s' "$token" > "$tmp"
  if run_lftp "cd \"$folder\"" "put \"$tmp\" -o \"$name\"" >/dev/null 2>&1; then
    for attempt in 1 2 3; do
      body="$(curl --silent --location --max-time 15 "$SITE_URL$name" || true)"
      if [ "$body" = "$token" ]; then
        ok=0
        break
      fi
      sleep 2
    done
    run_lftp "cd \"$folder\"" "rm \"$name\"" >/dev/null 2>&1 || echo "::warning::could not remove the probe file $name; delete it in File Manager."
  fi
  rm -f "$tmp"
  return $ok
}

# ---- Connect once to surface login, TLS or certificate problems straight away ----
if ! run_lftp "pwd" >/dev/null; then
  fail "could not log in over FTPS (see the lftp message above). Check FTP_SERVER, FTP_USERNAME and FTP_PASSWORD. If it says the certificate is not trusted, see 'Certificate errors' in docs/DEPLOY-CPANEL.md."
fi
info "logged in over FTPS."

# ---- Find the document root ----
target=""
if has_marker "$dir"; then
  target="$dir"
  info "found $MARKER in the configured folder."
elif [ -n "$dry" ]; then
  fail "dry run: $MARKER was not found in the configured folder, and a dry run does not search for the site folder. Run a normal deploy once, or create the marker."
else
  info "$MARKER not found in the configured folder; looking for the folder that serves $SITE_URL."
  candidates=()
  add_candidate() {
    local c="$1" existing
    c="$(printf '%s' "$c" | sed -E 's#/+#/#g')"
    [ -n "$c" ] || return 0
    for existing in "${candidates[@]}"; do [ "$existing" = "$c" ] && return 0; done
    candidates+=("$c")
  }
  add_candidate "$dir"
  add_candidate "$dir/public_html"
  add_candidate "/domains/$domain/public_html"
  add_candidate "domains/$domain/public_html"
  add_candidate "$dir/domains/$domain/public_html"
  add_candidate "/$domain/public_html"
  add_candidate "$domain"
  add_candidate "public_html"
  add_candidate "/public_html"
  add_candidate "/"
  n=0
  for candidate in "${candidates[@]}"; do
    n=$((n + 1))
    if probe_folder "$candidate"; then
      target="$candidate"
      info "location $n of ${#candidates[@]} is the live document root of $SITE_URL (proved with a probe file)."
      break
    fi
    info "location $n of ${#candidates[@]}: not the live site folder."
  done
  [ -n "$target" ] || fail "could not find the folder that serves $SITE_URL. Check that the domain points at this hosting account and that FTP_DIR is the site's public_html folder (on Eco Web Hosting: /domains/$domain/public_html)."
  # Remember it for next time.
  empty="$(mktemp)"
  run_lftp "cd \"$target\"" "put \"$empty\" -o \"$MARKER\"" >/dev/null 2>&1 || echo "::warning::could not create $MARKER; the next deploy will search again."
  rm -f "$empty"
  if [ "$target" != "$dir" ]; then
    echo "::notice::The site folder differs from the FTP_DIR secret. Set FTP_DIR to the folder for location $n (see the deploy guide) to skip the search next time."
  fi
fi

info "uploading $(find "$SOURCE" -type f | wc -l | tr -d ' ') file(s) from public/ to $host:$port."
lftp_status=0
run_lftp "cd \"$target\"" \
  "mirror --reverse --no-perms --parallel=2 --verbose=1 $dry --exclude-glob .well-known/ --exclude-glob .git/ --exclude '^index\\.html\$' \"$SOURCE\" ." \
  "$index_cmd" || lftp_status=$?
unset LFTP_PASSWORD

if [ "$lftp_status" -ne 0 ]; then
  fail "the upload stopped (lftp exit $lftp_status). Check the messages above. If it says the certificate is not trusted, see 'Certificate errors' in docs/DEPLOY-CPANEL.md."
fi
info "done."
