#!/bin/sh
set -eu

pattern='(-----BEGIN ([A-Z0-9]+ )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AIza[0-9A-Za-z_-]{35})'

if git grep --cached -n -I -E "$pattern" -- . ':(exclude)scripts/scan-secrets.sh'; then
  echo "Potential secret material found in tracked content." >&2
  exit 1
fi

echo "No known secret signatures found in tracked content."
