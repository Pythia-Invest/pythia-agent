#!/bin/sh
set -eu
umask 077

repo=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
channel=stable
operation=install
for argument in "$@"; do
  case "$argument" in
    --preview) channel=preview ;;
    --recover-initialization) operation=recover-initialization ;;
    *) printf 'Usage: ./install.sh [--preview] [--recover-initialization]\n' >&2; exit 2 ;;
  esac
done

for command in flock; do
  command -v "$command" >/dev/null 2>&1 || {
    printf 'Pythia install requires the Ubuntu command: %s\n' "$command" >&2
    exit 1
  }
done

home=${HOME:?HOME is required}
state_base=${XDG_STATE_HOME:-"$home/.local/state"}
data_base=${XDG_DATA_HOME:-"$home/.local/share"}
cache_base=${XDG_CACHE_HOME:-"$home/.cache"}
state_root=${PYTHIA_INSTALL_STATE_HOME:-"$state_base"}/pythia
runtime_root=${PYTHIA_INSTALL_DATA_HOME:-"$data_base"}/pythia/runtime
cache_root=${PYTHIA_INSTALL_CACHE_HOME:-"$cache_base"}/pythia/downloads
mkdir -p "$state_root" "$runtime_root" "$cache_root"
[ ! -L "$state_root" ] && [ ! -L "$runtime_root" ] && [ ! -L "$cache_root" ] || {
  printf 'Pythia install roots must be real directories, not symlinks.\n' >&2
  exit 1
}
chmod 700 "$state_root" "$runtime_root" "$cache_root"
[ ! -L "$state_root/lifecycle.lock" ] || {
  printf 'Pythia lifecycle lock must not be a symlink.\n' >&2
  exit 1
}
: >"$state_root/lifecycle.lock"
chmod 600 "$state_root/lifecycle.lock"
exec 9>"$state_root/lifecycle.lock"
flock -n 9 || {
  printf 'Another Pythia install, update, rebuild, start, stop, or uninstall is running.\n' >&2
  exit 1
}

node_root="$runtime_root/node/22.16.0"
if [ "$operation" = recover-initialization ]; then
  [ -x "$node_root/bin/node" ] || {
    printf 'Pythia initialization recovery requires the owned Node runtime at %s. Rerun the originating installer to restore that exact runtime, then retry recovery.\n' "$node_root/bin/node" >&2
    exit 1
  }
  exec env PYTHIA_CHECKOUT="$repo" \
    "$node_root/bin/node" "$repo/scripts/install/cli.mjs" recover-initialization \
      --channel "$channel"
fi

for command in git curl tar xz sha256sum ssh-keygen; do
  command -v "$command" >/dev/null 2>&1 || {
    printf 'Pythia install requires the Ubuntu command: %s\n' "$command" >&2
    exit 1
  }
done

"$repo/scripts/install/platform.sh"

# Stable binds to verified release identity. Preview records the current base
# revision while intentionally allowing the current local source tree.
verified_revision=$("$repo/scripts/install/preflight.sh" "$repo" "$channel" revision)

download() {
  url=$1
  destination=$2
  expected=$3
  if [ -f "$destination" ]; then
    actual=$(sha256sum "$destination" | awk '{print $1}')
    [ "$actual" = "$expected" ] && return
    printf 'Cached download has the wrong SHA-256: %s\n' "$destination" >&2
    exit 1
  fi
  temporary="$destination.$$.partial"
  rm -f "$temporary"
  curl --fail --location --proto '=https' --tlsv1.2 --max-time 300 \
    --output "$temporary" "$url"
  actual=$(sha256sum "$temporary" | awk '{print $1}')
  [ "$actual" = "$expected" ] || {
    rm -f "$temporary"
    printf 'Download SHA-256 mismatch for %s\n' "$url" >&2
    exit 1
  }
  chmod 600 "$temporary"
  mv "$temporary" "$destination"
}

node_archive="$cache_root/node-v22.16.0-linux-x64.tar.xz"
if [ ! -x "$node_root/bin/node" ]; then
  [ ! -e "$node_root" ] || {
    printf 'Unrecognized partial Node runtime at %s; inspect and remove that exact directory before retrying.\n' "$node_root" >&2
    exit 1
  }
  download \
    'https://nodejs.org/dist/v22.16.0/node-v22.16.0-linux-x64.tar.xz' \
    "$node_archive" \
    'f4cb75bb036f0d0eddf6b79d9596df1aaab9ddccd6a20bf489be5abe9467e84e'
  node_stage="$runtime_root/node/.22.16.0.$$.stage"
  rm -rf "$node_stage"
  mkdir -p "$node_stage"
  tar -xJf "$node_archive" --strip-components=1 -C "$node_stage"
  mkdir -p "$(dirname "$node_root")"
  mv "$node_stage" "$node_root"
fi
[ "$($node_root/bin/node --version)" = v22.16.0 ] || {
  printf 'Installed Pythia Node runtime is not version 22.16.0.\n' >&2
  exit 1
}

uv_root="$runtime_root/uv/0.9.28"
uv_archive="$cache_root/uv-x86_64-unknown-linux-gnu-0.9.28.tar.gz"
if [ ! -x "$uv_root/uv" ]; then
  [ ! -e "$uv_root" ] || {
    printf 'Unrecognized partial uv runtime at %s; inspect and remove that exact directory before retrying.\n' "$uv_root" >&2
    exit 1
  }
  download \
    'https://github.com/astral-sh/uv/releases/download/0.9.28/uv-x86_64-unknown-linux-gnu.tar.gz' \
    "$uv_archive" \
    '66ad1822dd9cf96694b95c24f25bc05cff417a65351464da01682a91796d1f2b'
  uv_stage="$runtime_root/uv/.0.9.28.$$.stage"
  rm -rf "$uv_stage"
  mkdir -p "$uv_stage"
  tar -xzf "$uv_archive" --strip-components=1 -C "$uv_stage"
  mkdir -p "$(dirname "$uv_root")"
  mv "$uv_stage" "$uv_root"
fi
uv_version_json=$("$uv_root/uv" self version --output-format json)
uv_version=$(
  "$node_root/bin/node" -p 'JSON.parse(process.argv[1]).version' "$uv_version_json"
)
[ "$uv_version" = '0.9.28' ] || {
  printf 'Installed Pythia uv runtime is not version 0.9.28.\n' >&2
  exit 1
}

export UV_PYTHON_INSTALL_DIR="$runtime_root/python"
export UV_CACHE_DIR="$cache_root/uv"
"$uv_root/uv" python install 3.12.11
python_executable=$("$uv_root/uv" python find --python-preference only-managed 3.12.11)
[ "$($python_executable --version)" = 'Python 3.12.11' ] || {
  printf 'Installed Pythia Python runtime is not version 3.12.11.\n' >&2
  exit 1
}

export COREPACK_HOME="$runtime_root/corepack"
export PATH="$node_root/bin:$uv_root:$(dirname "$python_executable"):/usr/local/bin:/usr/bin:/bin"
"$node_root/bin/corepack" install --global pnpm@10.20.0
"$node_root/bin/corepack" enable --install-directory "$node_root/bin"
[ "$(pnpm --version)" = '10.20.0' ] || {
  printf 'Installed Pythia pnpm runtime is not version 10.20.0.\n' >&2
  exit 1
}


final_revision=$("$repo/scripts/install/preflight.sh" "$repo" "$channel" revision)
[ "$final_revision" = "$verified_revision" ] || {
  printf 'Pythia install refused: the verified checkout revision changed during preparation.\n' >&2
  exit 1
}

PYTHIA_CHECKOUT="$repo" \
PYTHIA_NODE_EXECUTABLE="$node_root/bin/node" \
PYTHIA_UV_EXECUTABLE="$uv_root/uv" \
PYTHIA_PYTHON_EXECUTABLE="$python_executable" \
  "$node_root/bin/node" "$repo/scripts/install/cli.mjs" install \
    --channel "$channel" --revision "$verified_revision"
