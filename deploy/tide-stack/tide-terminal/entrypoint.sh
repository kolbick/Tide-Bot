#!/bin/sh
set -eu

if [ -z "${OPEN_TERMINAL_API_KEY:-}" ] && [ -z "${OPEN_TERMINAL_API_KEY_FILE:-}" ]; then
	printf '%s\n' 'OPEN_TERMINAL_API_KEY or OPEN_TERMINAL_API_KEY_FILE is required.' >&2
	exit 1
fi

# Multi-user mode needs to create isolated Unix accounts. No Docker socket or
# host bind mount is present in the Tide-Bot Compose overlay.
exec open-terminal "$@"
