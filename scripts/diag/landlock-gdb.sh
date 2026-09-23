#!/bin/bash
# TEMPORARY diagnosis — see .github/workflows/diag-landlock.yml. Catch one SIGSEGV under gdb and print where it was.
set -u
sudo apt-get update -q > /dev/null 2>&1
sudo apt-get install -y -q gdb > /dev/null 2>&1 || { echo "no gdb"; exit 0; }
root=$(pwd)
koffi=$(cd packages/core && node -p 'require.resolve("koffi")')

catch() {
	local label=$1
	shift
	for i in $(seq 1 40); do
		gdb -q -batch -nx \
			-ex "set pagination off" -ex "set confirm off" \
			-ex "handle SIGPIPE nostop noprint pass" -ex "handle SIGUSR1 nostop noprint pass" -ex "handle SIGUSR2 nostop noprint pass" \
			-ex run -ex "bt 40" -ex "info registers" -ex "x/16i \$pc-32" -ex "info sharedlibrary" \
			--args "$@" > /tmp/gdb.out 2>&1
		if grep -q "received signal SIGSEGV" /tmp/gdb.out; then
			echo "=== $label: SIGSEGV on attempt $i"
			grep -v "^\[New Thread\|^\[Thread .* exited\|^\[Inferior" /tmp/gdb.out
			return
		fi
	done
	echo "=== $label: no SIGSEGV in 40 attempts under gdb"
	tail -15 /tmp/gdb.out
}

catch "variadic syscall" node -e "const k = require('$koffi'); k.load('libc.so.6').func('long syscall(long number, ...)')(444, 'void *', null, 'size_t', 0, 'uint32_t', 1)"
catch "landlockAbi" node --experimental-strip-types --no-warnings -e "import('$root/packages/core/src/sandbox/linux/landlock.ts').then((m) => console.log(m.landlockAbi()))"
ws=$(mktemp -d)
cd "$ws" || exit 1
catch "runner" node --experimental-strip-types --no-warnings "$root/packages/core/src/sandbox/runner-entry.ts" --lyra-sandbox-runner --workspace "$ws" --mode workspace-write -- /bin/bash -c 'echo hi > f.txt && cat f.txt'
