"""Core's one path for plugin claims (ADR 0037, amendment "ingest"; ADR 0044 A1, A3 and A4).

A plugin returns claim batches from the operations core dispatches (a catalogue page, a resolve or lookup answer).
`ingest` places every record and relation of one batch in identity.sqlite3:

- **Joins by identifier agreement at the record's own scope** (`self` values only, never an echo of a resolve's
  question; `joins`): a listing by ISIN with its operating MIC and currency, then FIGI, then CAIP-19 deployment, and a
  line that states no currency, failing those, by its security's one line on its exchange (none there with another
  FIGI, else it stays `unmatched`); a security by ISIN, then share-class FIGI, then canonical CAIP-19; an issuer by
  LEI, then CIK; a market or protocol by the plugin's own native reference. Never by issuer, ticker, symbol or name;
  an `underlying` or `unqualified` value never joins.
- **Conflicts.** A second subject found, or a single-valued value confirm-level evidence about the subject or its parent
  states otherwise (or that names another subject), makes the claim a `conflict`: the record stays with the first
  subject, its values beside the others' (at confirm level they contest the fact, which `queue_ops.surface` asks about
  when the subject becomes relevant), nothing is re-parented, and a new listing with a contested security gets none.
- **Introduced subjects** only under a key scheme the contract's `introduces` declares for the kind (the key the
  identifiers give, the same on every install, or `native`), a listing only with an operating MIC or a chain; else the
  claim is `unmatched`. The plugin's record binds what it introduced (`device.bind_introduced`).
- **Keys move up only,** by a confirm-level record: a better key for a device subject, or the subject the plugin's own
  provisional one is (a canonical CAIP-19 for a provisional coin), writes a device alias and re-points the rows.

No queue row is written. A record is kept under its native reference, or one without (a token a DeFi source names only
by CAIP-19) under a digest of its level and identifiers (`claim_ref`). An unchanged record writes nothing, and a
`complete` scope's last page marks the records no page of it carried `not_seen`, keeping their subjects and bindings.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import asdict
from typing import Any, Iterable, Mapping

from . import device, lifecycle, relations
from .joins import Joins
from .claims import BatchOrigin, ClaimBatch, IdentifierValue, RecordAttributes, RecordClaim, RelationClaim, batch_to_json, check_batch
from .declared import NATIVE
from .model import ProviderRef
from .schemes import (
    INSTRUMENT_KINDS, SCHEME_LEVEL, SINGLE_VALUED, IdentifierError, Kind, Level, Scheme, provisional_id, subject_id,
    subject_kind, ticker_mic)
from .store import IdentityStore, now as stamp
from .trust import CONFIRM
from .vocabulary import IdentifierRole

COUNTS = ("joined", "introduced", "conflicts", "unmatched", "rejected", "not_seen")
PLACED = ("joined", "introduced", "conflict", "unmatched")  # the states a record keeps until it changes
DEPTH = {Level.ISSUER: 0, Level.SECURITY: 1, Level.COMPOSITE: 2, Level.LISTING: 3}
RANK = ("isin", "lei", "figi", "cik", "caip19", "cgs_isin", "pythia", "provisional")  # key schemes, best first
RECORD = "#record"  # the scope of a record kept by digest: no contract can declare it (a native scope is a namespace)


def ingest(store: IdentityStore, ref, info, batch: ClaimBatch, *, plugins: Iterable = (), now: str | None = None,
           seen: Iterable[tuple[str, str]] = ()) -> dict[str, Any]:
    """Place one plugin's batch in one transaction. `ref` is the installed reference (None without one), `plugins` the
    installed plugins whose levels weigh evidence (the batch's own at its own), and `seen` the records earlier pages of
    the same scope carried. Returns how many records and relations had each outcome, and the subjects placed. Raises
    `ClaimError` for a batch that breaks its contract."""
    check_batch(batch, info.manifest)
    run = _Ingest(store, ref, info, batch, list(plugins), now or stamp())
    wire = batch_to_json(batch)["claims"]
    records = sorted(((claim, raw) for claim, raw in zip(batch.claims, wire) if isinstance(claim, RecordClaim)),
                     key=_order)  # issuers first, so a record finds the parents its batch introduces, in any order
    with store.transaction():
        for claim, raw in records:
            run.record(claim, raw)
        for claim in batch.claims:
            if isinstance(claim, RelationClaim):
                run.relation(claim)
        if batch.complete:
            run.not_seen(set(seen))
        if run.changed:
            device.bump(store)
    return {**run.counts, "subjects": list(dict.fromkeys(run.subjects))}


class _Ingest:
    def __init__(self, store: IdentityStore, ref, info, batch: ClaimBatch, plugins: list, now: str):
        self.store, self.ref, self.manifest, self.batch, self.now = store, ref, info.manifest, batch, now
        self.plugin, self.plugins = info.manifest.plugin, [*plugins, info]
        self.granted = device.levels(self.plugins)
        self.joins = Joins(ref, store, self.granted)
        self.confirm = self.granted[self.plugin] == CONFIRM
        resolve = info.manifest.resolve
        self.echoes = set(resolve.echoes) if batch.origin is BatchOrigin.RESOLVE and resolve else set()
        self.counts = dict.fromkeys(COUNTS, 0)
        self.subjects: list[str] = []
        self.changed = False

    # ---- records ---------------------------------------------------------------------------------------------------

    def record(self, claim: RecordClaim, raw: dict) -> None:
        native = claim_ref(self.manifest.provider, claim)
        rows = self.store.select("SELECT claim, scope, subject_id, state FROM claims WHERE plugin = ? AND native_scope = ?"
                                 " AND native_id = ?", (self.plugin, native.native_scope, native.native_id))
        before = rows[0] if rows else None
        if before is not None and before["state"] in PLACED and json.loads(before["claim"]) == raw and (
                self.batch.scope in (None, before["scope"])):
            self._count(before["state"], before["subject_id"])  # unchanged: nothing to write
            return
        db = self.store.db
        db.execute("SAVEPOINT record")
        try:
            self.store.put_claim(self.plugin, self.manifest.provider, raw, self.batch.scope, native.wire())
            state, subject = self._place(claim, native, before["subject_id"] if before is not None else None)
            device.place_claim(self.store, self.plugin, native, subject, state)
        except (ValueError, TypeError):  # values core cannot place: this record only
            db.execute("ROLLBACK TO record")
            state, subject = "rejected", None
        db.execute("RELEASE record")
        self.changed = self.changed or state != "rejected"
        self._count(state, subject)

    def _place(self, claim: RecordClaim, native: ProviderRef, previous: str | None) -> tuple[str, str | None]:
        """The record's state and subject, writing what it introduces and states."""
        level, own = claim.level, self._own(claim)
        if level not in INSTRUMENT_KINDS:
            return self._native(claim)
        found = self.joins.candidates(level, own, claim.attributes)
        prior = previous and device.current_id(self.ref, self.store, previous)
        prior = prior if prior and self.joins.held(prior) else None
        attributes = claim.attributes
        if not (found or prior) and level is Level.LISTING and Scheme.ISIN in own and attributes.operating_mic \
                and not attributes.currency:  # a line with no currency joins its security's one line on its exchange
            found = self.joins.venue_line(own[Scheme.ISIN], own.get(Scheme.FIGI), attributes.operating_mic)
            if found is None:  # several there, or one with another FIGI: never a second line on that exchange
                return "unmatched", None
        if prior and found and prior not in found:  # the record now names another subject than its own
            row = device.subject_row(self.store, prior)
            if not (self.confirm and len(found) == 1 and row is not None and row["introduced_by"] == self.plugin):
                self._evidence(claim, native, self._ids(prior), keep=True)
                return "conflict", prior
            self._alias(prior, found[0])  # the subject its own provisional one is, named by its identifiers
            prior = found[0]
        target = prior or (found[0] if found else None)
        if target is None:
            return self._introduce(claim, native, level, own)
        conflict = len(set(found) - {target}) > 0 or self._contradicts(claim, device.load_subject(
            self.ref, self.store, target, self.plugins))
        row = device.subject_row(self.store, target)
        own_subject = (row is not None and row["introduced_by"] == self.plugin and target == prior
                       and not (self.ref is not None and device.in_reference(self.ref, target)))
        if own_subject:  # its own record, updated: a new name renames it, and a parent it lacked is found
            parent, contested = (row["parent_id"], False) if row["parent_id"] else self._parent(claim, level)
            conflict = conflict or contested
            self._label(target, claim, parent)
        key = self._key(level, own, claim.attributes)
        if not conflict and self.confirm and row is not None and key and _better(key, target) and not (
                self.ref is not None and device.in_reference(self.ref, target)):
            self._alias(target, key)  # a better key for a device subject: its saved ID follows
            target = key
        self._evidence(claim, native, self._ids(target), keep=conflict)
        return ("conflict" if conflict else "introduced" if own_subject else "joined"), target

    def _introduce(self, claim: RecordClaim, native: ProviderRef, level: Level,
                   own: Mapping[Scheme, str]) -> tuple[str, str | None]:
        """Introduce the record's subject under the key its contract lets it (`_new_key`), else leave it unmatched."""
        key = self._new_key(level, own, claim)
        if key is None:
            return "unmatched", None
        parent, contested = self._parent(claim, level)
        self._label(key, claim, parent)
        if claim.native_ref is not None:  # a record with no reference of its own has nothing to bind
            device.bind_introduced(self.store, self.plugin, claim.native_ref, key)
        self._evidence(claim, native, self._ids(key), keep=False)
        return ("conflict" if contested else "introduced"), key

    def _new_key(self, kind: Level | Kind, own: Mapping[Scheme, str], claim: RecordClaim) -> str | None:
        """The ID a record may introduce its subject under: the key its identifiers give, of a scheme `introduces`
        declares for the kind, else its own native reference where `native` is declared. A listing needs an operating
        MIC or a chain."""
        tags = self.manifest.introduces.get(kind, ())
        key = self._key(kind, own, claim.attributes) if kind in INSTRUMENT_KINDS else None
        if key is not None and _tag(key) not in tags:
            return None
        if key is None and NATIVE in tags and (native := claim.native_ref) is not None:
            key = provisional_id(kind, native.provider, native.native_scope, native.native_id)
        placed = kind is not Level.LISTING or bool(claim.attributes.operating_mic) or bool(key and _tag(key) == "caip19")
        return key if placed else None

    def _parent(self, claim: RecordClaim, level: Level) -> tuple[str | None, bool]:
        """The parent the record's identifiers name at the parent's scope, or one they introduce (a security under a
        new line), else none; whether two subjects are named, a contest that leaves it none."""
        up = device.PARENT.get(level)
        own = {scheme: value for scheme, value in self._own(claim).items() if SCHEME_LEVEL[scheme] is up}
        if not own:
            return None, False
        found = self.joins.candidates(up, own, claim.attributes)
        if found:  # one parent whose confirm-level evidence agrees; two, or a disagreement, are a contest
            return (found[0], False) if len(found) == 1 and not self._disagrees(found[0], own) else (None, True)
        key = self._key(up, own, claim.attributes)
        if key is None or _tag(key) not in self.manifest.introduces.get(up, ()):
            return None, False
        grandparent, contested = self._parent(claim, up)
        self._label(key, claim, grandparent, kind=up)
        return key, contested

    def _native(self, claim: RecordClaim) -> tuple[str, str | None]:
        """A market's or protocol's record: the subject the contract addresses by its reference, else the one its
        reference keys, introduced where `native` is declared for the kind."""
        declared = self._declared(claim.native_ref)
        if declared:
            return "joined", declared
        native = claim.native_ref
        key = device.current_id(self.ref, self.store, provisional_id(claim.level, native.provider, native.native_scope,
                                                                      native.native_id))
        row = device.subject_row(self.store, key)
        if row is None and NATIVE not in self.manifest.introduces.get(claim.level, ()):
            return "unmatched", None
        if row is not None and row["introduced_by"] != self.plugin:  # a clone of its provider introduced it
            return "joined", key
        self._label(key, claim, None)
        device.bind_introduced(self.store, self.plugin, native, key)
        return "introduced", key

    # ---- joins -----------------------------------------------------------------------------------------------------

    def _own(self, claim: RecordClaim) -> dict[Scheme, str]:
        """The identifiers a record states for itself, ticker aside, without those it only echoes."""
        return {item.scheme: item.value for item in claim.identifiers if item.role is IdentifierRole.SELF
                and item.scheme not in self.echoes and item.scheme is not Scheme.TICKER_MIC}

    def _disagrees(self, subject: str, own: Mapping[Scheme, str]) -> bool:
        """Whether confirm-level evidence about a subject states another value of one of these identifiers."""
        evidence = (device.load_subject(self.ref, self.store, subject, self.plugins) or {"evidence": []})["evidence"]
        return any(item.subject_id == subject and item.scheme in own and item.value != own[item.scheme]
                   and own[item.scheme] not in {other.value for other in evidence if other.scheme == item.scheme
                                                and other.subject_id == subject} for item in evidence)

    def _contradicts(self, claim: RecordClaim, subject: dict | None) -> bool:
        """Whether a single-valued value the record states is one that confirm-level evidence about the subject, or its
        parent at the value's level, states otherwise, or one that names another subject there."""
        for item in self._stated(claim):
            owner = subject["ids"].get(SCHEME_LEVEL[item.scheme]) if subject else None
            if item.scheme not in SINGLE_VALUED or owner is None:
                continue
            stated = {found.value for found in subject["evidence"]
                      if found.scheme == item.scheme and found.subject_id == owner}
            named = self.joins.holders(item.scheme, item.value, SCHEME_LEVEL[item.scheme])
            if (stated and item.value not in stated) or (named and owner not in named):
                return True
        return False

    # ---- writes ----------------------------------------------------------------------------------------------------

    def _stated(self, claim: RecordClaim) -> list[IdentifierValue]:
        """The identifiers the record states as evidence about its subject and its parents: its own (a crypto asset
        record's deployments aside), and a listing's ticker at its operating MIC."""
        items = [item for item in claim.identifiers if item.role is IdentifierRole.SELF and item.scheme not in self.echoes
                 and (claim.level not in DEPTH or DEPTH[item.level] <= DEPTH[claim.level])]
        attributes = claim.attributes
        if claim.level is Level.LISTING and attributes.ticker and attributes.operating_mic and not any(
                item.scheme is Scheme.TICKER_MIC for item in items):
            try:
                items.append(IdentifierValue(Scheme.TICKER_MIC, ticker_mic(attributes.ticker, attributes.operating_mic)))
            except IdentifierError:  # a ticker the venue form does not take: kept in the record only
                pass
        return items

    def _evidence(self, claim: RecordClaim, native: ProviderRef, ids: Mapping[Level, str | None], *, keep: bool) -> None:
        """Write what the record states as device evidence on the subjects it identifies. A joined or introduced
        record's replaces its earlier statements; a conflicting one's is kept beside them and everyone else's."""
        if not keep:
            self.store.db.execute("DELETE FROM device_assertions WHERE plugin = ? AND native_scope = ? AND native_id = ?",
                                  (self.plugin, native.native_scope, native.native_id))
        for item in self._stated(claim):
            owner = ids.get(SCHEME_LEVEL[item.scheme])
            if owner:
                device.put_assertion(self.store, owner, item.scheme, item.value, plugin=self.plugin, ref=native,
                                     retrieved_at=claim.provenance.retrieved_at)

    def _label(self, subject: str, claim: RecordClaim, parent: str | None, *, kind: Level | None = None) -> None:
        """Write a subject's label from the record: its own (`kind` None) with the record's attributes, or a parent the
        record introduces with the attributes that describe it."""
        attributes = {key: value for key, value in asdict(claim.attributes).items()
                      if value not in (None, (), {}, []) and key != "name"}
        name = claim.attributes.name
        if kind is Level.SECURITY:
            attributes = {key: value for key, value in attributes.items() if key in ("asset_class", "kind")}
        elif kind is not None:
            attributes = {key: value for key, value in attributes.items() if key == "country"}
            name = claim.attributes.issuer_name
        status = str(claim.attributes.status) if kind is None and claim.attributes.status else "active"
        device.put_subject(self.store, subject, plugin=self.plugin, name=name[:512] if name else None,
                           parent_id=parent, attributes=attributes, status=status, seen=self.now)

    def _alias(self, old: str, new: str) -> None:
        device.put_alias(self.store, old, new, self.now)
        lifecycle.rekey(self.store, self.ref, self.store.metadata(lifecycle.REKEYED) or "", again=True)

    def _ids(self, subject: str) -> dict:
        return (device.load_subject(self.ref, self.store, subject, self.plugins) or {"ids": {}})["ids"]

    def _key(self, level: Level | Kind, own: Mapping[Scheme, str], attributes: RecordAttributes) -> str | None:
        return subject_id(level, own, operating_mic=attributes.operating_mic, currency=attributes.currency,
                          country=attributes.country) if level in INSTRUMENT_KINDS else None

    def _declared(self, native: ProviderRef) -> str | None:
        """The subject the plugin's contract addresses by this reference (`addressing.subjects`)."""
        return next((subject for subject, item in self.manifest.subjects.items()
                     if (item.native_scope, item.native_id) == (native.native_scope, native.native_id)), None)

    def _count(self, state: str, subject: str | None) -> None:
        self.counts["conflicts" if state == "conflict" else state] += 1
        self.subjects += [subject] if subject else []

    # ---- relations and the end of a scope --------------------------------------------------------------------------

    def relation(self, claim: RelationClaim) -> None:
        """Keep a plugin relation between the subjects its ends name (`relations.keep`)."""
        start, end = self._end(claim.from_key), self._end(claim.to_key)
        outcome, wrote = relations.keep(self.store, self.ref, self.plugin, claim, start, end) \
            if start and end and start != end else ("unmatched", False)
        self.changed = self.changed or wrote
        self.counts[outcome] += 1

    def _end(self, key: IdentifierValue | ProviderRef) -> str | None:
        """The subject a relation end names: the one its plugin's record was placed on (or the contract addresses by
        that reference), or the one subject a global identifier names."""
        if isinstance(key, ProviderRef):
            rows = self.store.select("SELECT subject_id FROM claims WHERE plugin = ? AND native_scope = ? AND native_id = ?"
                                     " AND state IN ('joined', 'introduced')", (self.plugin, key.native_scope, key.native_id))
            found = rows[0][0] if rows else self._declared(key)
            return device.current_id(self.ref, self.store, found) if found else None
        named = self.joins.holders(key.scheme, key.value, key.level)
        return named[0] if len(named) == 1 else None

    def not_seen(self, seen: set[tuple[str, str]]) -> None:
        """The scope's last page: its records no page carried are no longer offered. Their subjects and bindings stay."""
        carried = seen | {(ref.native_scope, ref.native_id) for claim in self.batch.claims
                          if isinstance(claim, RecordClaim) and (ref := claim_ref(self.manifest.provider, claim))}
        rows = self.store.select("SELECT native_scope, native_id FROM claims WHERE plugin = ? AND scope = ? AND state IN"
                                 " (SELECT value FROM json_each(?))", (self.plugin, self.batch.scope, json.dumps(PLACED)))
        gone = [(self.plugin, *row) for row in rows if tuple(row) not in carried]
        self.store.db.executemany("UPDATE claims SET state = 'not_seen' WHERE plugin = ? AND native_scope = ?"
                                  " AND native_id = ?", gone)
        self.counts["not_seen"] = len(gone)
        self.changed = self.changed or bool(gone)


def claim_ref(provider: str, claim: RecordClaim) -> ProviderRef:
    """The key a record is kept under: its native reference, else a digest of its level and identifiers, so a renamed
    record keeps its row and a record naming other identifiers is another."""
    if claim.native_ref is not None:
        return claim.native_ref
    stated = json.dumps([str(claim.level), sorted((str(item.scheme), item.value, str(item.role))
                                                  for item in claim.identifiers)])
    return ProviderRef(provider, "sha256:" + hashlib.sha256(stated.encode()).hexdigest(), RECORD)


def _order(pair: tuple[RecordClaim, dict]) -> tuple:
    """Records in an order their arrival never changes: by level from the issuer down, then by native reference."""
    claim, raw = pair
    native = (claim.native_ref.native_scope, claim.native_ref.native_id) if claim.native_ref else ("", "")
    return DEPTH.get(claim.level, len(DEPTH)), *native, json.dumps(raw, sort_keys=True)


def _tag(key: str) -> str:
    return key.split(":", 2)[1]


def _better(key: str, current: str) -> bool:
    """Whether `key` ranks above the key scheme of `current` (subject_key@2's precedence)."""
    return RANK.index(_tag(key)) < RANK.index(_tag(current)) if _tag(key) in RANK and _tag(current) in RANK else False
