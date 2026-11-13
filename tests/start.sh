#!/bin/sh
# Starts what the browser tests use: the host (:8600, fresh data), the repository (:8611)
# and a pretend RomM (:8620). Stops earlier copies first.
cd "$(dirname "$0")/.."
for p in 8600 8611 8612 8620; do fuser -k $p/tcp >/dev/null 2>&1 || true; done
rm -rf "${PBS_DATA:-/tmp/pbs-test-data}"
(cd ui && npx vite build >/dev/null 2>&1) || { echo "ui build failed"; exit 1; }
nohup node host/server.mjs --port 8600 --data "${PBS_DATA:-/tmp/pbs-test-data}" > /tmp/pbs-host.log 2>&1 &
nohup node tests/static.mjs repository 8611 > /tmp/pbs-repo.log 2>&1 &
nohup node tests/static.mjs tests/repo 8612 > /tmp/pbs-repo2.log 2>&1 &
nohup node tests/fake-romm.mjs 8620 > /tmp/pbs-romm.log 2>&1 &
for i in 1 2 3 4 5 6 7 8 9 10; do curl -sf localhost:8600/ >/dev/null && curl -sf localhost:8611/index.json >/dev/null && curl -sf localhost:8620/api/heartbeat >/dev/null && echo ready && exit 0; sleep 0.5; done
echo "not ready"; cat /tmp/pbs-host.log; exit 1
