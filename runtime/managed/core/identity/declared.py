"""What a plugin's contract declares about subjects (ADR 0038, amendment "contract version 2").

- `introduces`: the subject kinds the plugin may introduce, each with the key schemes their IDs may use: an open
  identifier scheme registered for the kind (`schemes.KEY_SCHEMES`), or `native`, the plugin's own native reference
  in a declared native scope of that kind (`<kind>:provisional:<provider>:<scope>:<id>`). Core's ingest applies it
  per record; here it is only validated.
- `addressing.subjects`: the plugin's own native reference for a subject core keys (by an open identifier or a Pythia
  key), such as Yahoo's symbol for a maintained index or CoinGecko's coin id for a maintained crypto asset. Core
  derives the address from it without a call, under rule `declared_ref@1`. The address is `confirmed` only when the
  plugin's files are granted confirm (`trust.py`), and a confirm-level declaration also aliases the plugin's
  provisional ID for that reference to the subject (`aliases`). A display-level one gives an address, never an alias.
- `addressing.chain_codes`: the provider's own chain ids as CAIP-2 chains, for the token deployments it names.

Standard library only.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable, Mapping

from .schemes import CAIP2, KEY_SCHEMES, IdentifierError, Kind, provisional_id, registered_kind, subject_kind

DECLARED_RULE = "declared_ref@1"
NATIVE = "native"  # `introduces`: keyed by the plugin's own native reference
VERSION = 2        # the contract version that added these declarations


@dataclass(frozen=True, slots=True)
class DeclaredRef:
    native_scope: str
    native_id: str


def _fail(message: str) -> ValueError:
    from .manifest import ManifestError  # imported late: the manifest module imports this one
    return ManifestError(message)


def _mapping(value: Any, path: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise _fail(f"{path}: object required")
    return value


def parse(version: int, body: Mapping[str, Any], addressing: Mapping[str, Any], native: Iterable[Any]) -> dict[str, Any]:
    """The declarations as `Manifest` fields; raises ManifestError naming the first bad path. A version 1 contract
    declares none of them."""
    if version < VERSION:
        for path, block in (("introduces", body), ("addressing.subjects", addressing), ("addressing.chain_codes", addressing)):
            if path.rsplit(".", 1)[-1] in block:
                raise _fail(f"{path}: needs contract_version {VERSION}")
        return {}
    native = tuple(native)
    return {"introduces": introduces(body.get("introduces", {}), native),
            "subjects": subjects(addressing.get("subjects", {}), native),
            "chain_codes": chain_codes(addressing.get("chain_codes", {}))}


def introduces(value: Any, native: tuple[Any, ...]) -> dict[Kind, tuple[str, ...]]:
    """Kind -> the key schemes of the subjects the plugin may introduce of that kind."""
    found = {}
    for kind, tags in _mapping(value, "introduces").items():
        path = f"introduces.{kind}"
        if kind not in set(Kind):
            raise _fail(f"{path}: not a registered subject kind")
        kind = Kind(kind)
        if not isinstance(tags, list) or not tags or not all(isinstance(tag, str) for tag in tags) or len(set(tags)) != len(tags):
            raise _fail(f"{path}: a non-empty list of distinct key schemes is required")
        # `provisional` is what `native` mints, and a `pythia` key is Pythia's own: neither is a plugin's to name.
        allowed = (KEY_SCHEMES[kind] - {"provisional", "pythia"}) | {NATIVE}
        for tag in tags:
            if tag not in allowed:
                raise _fail(f"{path}: {tag} is not a key scheme of a {kind}")
        if NATIVE in tags and not any(scope.level == kind for scope in native):
            raise _fail(f"{path}: native needs a native scope at {kind}")
        found[kind] = tuple(tags)
    return found


def subjects(value: Any, native: tuple[Any, ...]) -> dict[str, DeclaredRef]:
    """Subject ID -> the plugin's own reference for it. One reference names one subject."""
    found: dict[str, DeclaredRef] = {}
    seen: set[tuple[str, str]] = set()
    for subject, item in _mapping(value, "addressing.subjects").items():
        path = f"addressing.subjects.{subject}"
        try:
            kind = registered_kind(subject)
        except IdentifierError:
            raise _fail(f"{path}: not a subject ID of a registered kind and key scheme") from None
        if subject.split(":", 2)[1] == "provisional":
            raise _fail(f"{path}: a provisional ID is not a core-keyed subject")
        entry = _mapping(item, path)
        if set(entry) != {"native_scope", "native_id"}:
            raise _fail(f"{path}: native_scope and native_id are required, and nothing else")
        scope, native_id = entry["native_scope"], entry["native_id"]
        if not any(item.native_scope == scope and item.level == kind for item in native):
            raise _fail(f"{path}.native_scope: not a native scope the contract declares at {kind}")
        if not isinstance(native_id, str) or not 0 < len(native_id) <= 512:
            raise _fail(f"{path}.native_id: non-empty text of at most 512 characters")
        if (scope, native_id) in seen:
            raise _fail(f"{path}: another subject has this native reference")
        seen.add((scope, native_id))
        found[subject] = DeclaredRef(scope, native_id)
    return found


def chain_codes(value: Any) -> dict[str, str]:
    """The provider's chain id -> its CAIP-2 chain."""
    table = _mapping(value, "addressing.chain_codes")
    for chain, caip2 in table.items():
        if not 0 < len(chain) <= 128:
            raise _fail("addressing.chain_codes: provider chain ids are short text")
        if not isinstance(caip2, str) or not CAIP2.match(caip2):
            raise _fail(f"addressing.chain_codes.{chain}: a CAIP-2 chain id")
    return dict(table)


def aliases(manifests: Iterable[Any]) -> dict[str, str]:
    """Provisional ID -> subject ID: the provisional ID a confirm-level plugin's reference had (a resolve residual, an
    uncurated coin) for each subject its contract declares that reference for, so the ID still resolves once the
    subject is keyed (ADR 0037, crypto keys). Only a confirm-level declaration aliases (ADR 0044 A3); an ID two
    declarations give different subjects stays unaliased."""
    named: dict[str, set[str]] = {}
    for manifest in manifests:
        if manifest.unaudited:
            continue
        for subject, ref in manifest.subjects.items():
            old = provisional_id(subject_kind(subject), manifest.provider, ref.native_scope, ref.native_id)
            named.setdefault(old, set()).add(subject)
    return {old: next(iter(new)) for old, new in named.items() if len(new) == 1}
