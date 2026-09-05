#!/bin/sh
set -eu

repo=${1:?repository path is required}
repo=$(CDPATH= cd -- "$repo" && pwd -P)
channel=${2:?release channel is required}
output=${3:-human}
trust_file="$repo/release/allowed_signers"
semver='^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'

[ "$output" = human ] || [ "$output" = revision ] || {
  printf 'Usage: preflight.sh <repo> <stable|preview> [revision]\n' >&2
  exit 2
}

notice() {
  if [ "$output" = revision ]; then
    printf '%s\n' "$1" >&2
  else
    printf '%s\n' "$1"
  fi
}

fail() {
  printf 'Pythia install refused: %s\n' "$1" >&2
  exit 1
}

[ "$(git -C "$repo" rev-parse --show-toplevel)" = "$repo" ] ||
  fail "run ./install.sh from the root of its Git checkout."
head=$(git -C "$repo" rev-parse --verify HEAD^{commit})

case "$channel" in
  stable)
    [ -z "$(git -C "$repo" status --porcelain=v1 --untracked-files=normal)" ] ||
      fail "the checkout is dirty. Commit or remove local changes before installing."
    tag=$(git -C "$repo" tag --points-at HEAD | grep -E "$semver" || true)
    [ "$(printf '%s\n' "$tag" | grep -Ec "$semver" || true)" -eq 1 ] ||
      fail "stable installation requires HEAD to be an exact vMAJOR.MINOR.PATCH tag. Use --preview only when you intentionally want main."
    [ "$(git -C "$repo" cat-file -t "refs/tags/$tag" 2>/dev/null || true)" = tag ] ||
      fail "stable tag $tag is not an annotated tag."
    [ -f "$trust_file" ] || fail "the bootstrap signer file is missing: $trust_file"
    grep -Eq '^[^#[:space:]][^[:space:]]*[[:space:]]+.*ssh-(ed25519|rsa)[[:space:]]+' "$trust_file" ||
      fail "no trusted release signer is configured. The release owner must publish the first SSH signer before stable installation."
    if ! verification=$(LC_ALL=C git -C "$repo" \
      -c gpg.format=ssh \
      -c gpg.ssh.allowedSignersFile="$trust_file" \
      verify-tag "refs/tags/$tag" 2>&1); then
      fail "tag $tag is unsigned or is not signed by a configured Pythia release signer."
    fi
    [ "$(git -C "$repo" rev-parse "refs/tags/$tag^{commit}")" = "$head" ] ||
      fail "tag $tag does not resolve exactly to HEAD."
    notice "Selected stable release $tag ($head)."
    notice "Signature verification: $verification"
    notice 'First-install trust notice: this checkout supplies its own signer file.'
    notice 'That is trust on first use; compare a published signer fingerprint out of band when one is available.'
    ;;
  preview)
    notice "Selected current source ($head). Preview may include local changes and is not a signed or automatically update-safe release."
    ;;
  *) fail "unknown release channel: $channel" ;;
esac

if [ "$output" = revision ]; then
  printf '%s\n' "$head"
fi
