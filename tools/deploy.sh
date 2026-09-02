#!/usr/bin/env bash
# Deploys the plugin + a WordPress-ready copy of the game to the Kinsta
# staging site over the `typhoontexasnew-staging` SSH alias (see AGENTS.md /
# ~/.ssh/config on this machine).
#
# index.html's asset references and the Board API constant assume same-path
# hosting (see DATABASE.md#front-end-integration) — this script never edits
# the repo's index.html itself, only a generated copy under
# waterpark-leaderboard/game/ (gitignored, rebuilt every run):
#   - "assets/...          -> "/wp-content/plugins/waterpark-leaderboard/game-assets/...
#   - absolute Kinsta dev API constant -> relative /wp-json/... path
# The repo's own index.html keeps working unmodified against
# `python3 server.py` for local dev.
#
# No --delete on the rsync of the plugin folder itself — this only ever adds
# forward; run a manual cleanup if a file needs to go away.
set -euo pipefail
cd "$(dirname "$0")/.."

REMOTE_ALIAS="typhoontexasnew-staging"
REMOTE_WP_PATH="/www/typhoontexasnew_475/public"
REMOTE_PLUGIN_PATH="${REMOTE_WP_PATH}/wp-content/plugins/waterpark-leaderboard"
ASSET_URL_BASE="/wp-content/plugins/waterpark-leaderboard/game-assets/"
RELATIVE_API="/wp-json/waterpark-leaderboard/v1"

echo "== Staging game-assets/ from assets/ =="
rm -rf waterpark-leaderboard/game-assets
cp -R assets waterpark-leaderboard/game-assets

# A stray restrictive directory mode (e.g. 700 from however a folder got
# created) is invisible locally — the same user owns and can read it — but
# silently 404s once served by a different user (nginx/php-fpm) on staging.
# Caught this exact way once already (letter-collect/); normalize forward so
# it can't happen from an asset folder we haven't hit yet.
find waterpark-leaderboard/game-assets -type d -exec chmod 755 {} +
find waterpark-leaderboard/game-assets -type f -exec chmod 644 {} +

echo "== Rewriting index.html -> waterpark-leaderboard/game/index.html =="
mkdir -p waterpark-leaderboard/game
sed \
  -e "s#\"assets/#\"${ASSET_URL_BASE}#g" \
  -e "s#https://env-typhoontexasnew-dev\.kinsta\.cloud/wp-json/waterpark-leaderboard/v1#${RELATIVE_API}#g" \
  index.html > waterpark-leaderboard/game/index.html

echo "== Sanity-checking the rewrite =="
if grep -q '"assets/' waterpark-leaderboard/game/index.html; then
  echo "ERROR: unrewritten \"assets/ reference survived the sed pass" >&2
  exit 1
fi
if grep -q 'env-typhoontexasnew-dev.kinsta.cloud' waterpark-leaderboard/game/index.html; then
  echo "ERROR: absolute dev API URL survived the sed pass" >&2
  exit 1
fi

echo "== Syncing plugin to staging =="
rsync -az --exclude ".DS_Store" waterpark-leaderboard/ "${REMOTE_ALIAS}:${REMOTE_PLUGIN_PATH}/"

echo "== Flushing rewrite rules =="
ssh "${REMOTE_ALIAS}" "wp --path='${REMOTE_WP_PATH}' rewrite flush"

echo "== Done. Game served at: https://env-typhoontexasnew-dev.kinsta.cloud/play/ =="
