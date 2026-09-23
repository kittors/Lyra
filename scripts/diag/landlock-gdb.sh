#!/bin/bash
# TEMPORARY diagnosis — see .github/workflows/diag-landlock.yml. Catch one SIGSEGV of the runner under gdb.
set -u
sudo apt-get install -y -q gdb > /dev/null 2>&1 || { echo "no gdb"; exit 0; }
root=$(pwd)
entry="$root/packages/core/src/sandbox/runner-entry.ts"
# Load in the background, the way a test run has several files going at once.
STRESS_ONLY=runner-ts STRESS_COUNT=100000 STRESS_PARALLEL=6 timeout 1200 node --experimental-strip-types --no-warnings scripts/diag/landlock-stress.ts > /dev/null 2>&1 &
for i in $(seq 1 500); do
	ws=$(mktemp -d)
	cd "$ws" || exit 1
	gdb -q -batch -nx \
		-ex "set pagination off" -ex "set confirm off" \
		-ex "handle SIGPIPE nostop noprint pass" -ex "handle SIGUSR1 nostop noprint pass" -ex "handle SIGUSR2 nostop noprint pass" \
		-ex run -ex "info threads" -ex "thread apply all bt 30" -ex "info registers" -ex "x/12i \$pc-24" \
		--args node --experimental-strip-types --no-warnings "$entry" --lyra-sandbox-runner --workspace "$ws" --mode workspace-write -- /bin/bash -c 'echo hi > f.txt && cat f.txt' > /tmp/gdb.out 2>&1
	cd "$root" || exit 1
	if grep -q "received signal SIGSEGV" /tmp/gdb.out; then
		echo "SIGSEGV on attempt $i"
		cat /tmp/gdb.out
		exit 0
	fi
done
echo "no SIGSEGV in 500 attempts under gdb"
tail -30 /tmp/gdb.out
