#!/bin/sh
# Runs every browser test: starts the host and test servers, then each suite.
# The PlayTheater suite needs a PlayTheater server (PT=http://host:port, admin / secret1)
# and is skipped without one.
cd "$(dirname "$0")"
sh ./start.sh || exit 1
fail=0
for t in launcher store apps romm playtheater phone; do
  echo "== $t"
  node "$t.js" || fail=1
done
exit $fail
