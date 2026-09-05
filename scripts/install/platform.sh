#!/bin/sh
set -eu

os_release=${1:-/etc/os-release}
kernel=${2:-$(uname -s)}
machine=${3:-$(uname -m)}
git_version=${4:-$(git --version | awk '{print $3}')}

[ "$kernel" = Linux ] || {
  printf 'Pythia installation currently supports Ubuntu Linux only.\n' >&2
  exit 1
}
case "$machine" in
  x86_64|amd64) ;;
  *) printf 'Pythia installation currently supports Ubuntu x86-64 only.\n' >&2; exit 1 ;;
esac
[ -f "$os_release" ] || {
  printf 'Pythia could not identify Ubuntu: %s is missing.\n' "$os_release" >&2
  exit 1
}
os_id=$(sed -n 's/^ID=//p' "$os_release" | head -1 | tr -d '"' | tr '[:upper:]' '[:lower:]')
[ "$os_id" = ubuntu ] || {
  printf 'Pythia installation currently supports Ubuntu only (found %s).\n' "${os_id:-unknown}" >&2
  exit 1
}

git_major=$(printf '%s' "$git_version" | cut -d. -f1)
git_minor=$(printf '%s' "$git_version" | cut -d. -f2)
case "$git_major:$git_minor" in
  *[!0-9:]*|:*) printf 'Pythia could not parse Git version %s.\n' "$git_version" >&2; exit 1 ;;
esac
if [ "$git_major" -lt 2 ] || { [ "$git_major" -eq 2 ] && [ "$git_minor" -lt 43 ]; }; then
  printf 'Pythia requires Git 2.43 or newer; found %s.\n' "$git_version" >&2
  exit 1
fi
