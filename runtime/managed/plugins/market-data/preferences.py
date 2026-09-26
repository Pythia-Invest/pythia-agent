"""Source orders and narrowly scoped exceptions: the investor's market-data source choices.

They live in the feature's private `preferences.sqlite3`. A device that ran the
retired market-data identity layer (ADR 0012, removed per ADR 0037) kept them in
`identity.sqlite3` beside its provider mappings. The first open copies them here
and renames that file `identity-retired.sqlite3`: the mappings are not migrated
(core re-derives or resolves every address from open identifiers) and the file
is kept for inspection, never deleted.
"""
from contextlib import contextmanager
import json
import logging
import os
from pathlib import Path
import sqlite3
import stat

from .wire import require, validate_parameters
from .selection import CRITERIA

logger = logging.getLogger(__name__)
ORDER_SCHEMA = {"type": "array", "maxItems": 16,
                "items": {"type": "string", "pattern": "^[a-z][a-z0-9_-]*$", "maxLength": 64}}
SCOPE_SCHEMA = {"type": "object", "additionalProperties": False, "properties": {
    "asset_class": {"type": "string", "enum": ["equity", "crypto"]},
    **{key: CRITERIA["properties"][key] for key in ("currency", "venue", "interval", "measurement", "session", "price_adjustment")}}}
DDL = """
CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
INSERT OR IGNORE INTO metadata VALUES ('preference_revision', 0);
CREATE TABLE IF NOT EXISTS source_preferences (operation TEXT PRIMARY KEY, providers TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS scoped_source_preferences (operation TEXT NOT NULL, scope TEXT NOT NULL,
 providers TEXT NOT NULL, PRIMARY KEY(operation, scope));
"""
LEGACY, RETIRED = "identity.sqlite3", "identity-retired.sqlite3"
# Retired subject kinds and the asset class a scoped rule for them now names. Listing rules win
# over instrument and company rules that map to the same scope.
LEGACY_KINDS = {"listing": "equity", "instrument": "equity", "company": "equity", "crypto": "crypto"}


def dumps(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def require_private(path, *, directory=False, absent=False):
    try:
        info = path.lstat()
    except FileNotFoundError:
        if absent:
            return
        raise
    expected = stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)
    if not expected or info.st_mode & 0o077 or info.st_uid != os.getuid():
        raise PermissionError("Market-data state must be private, owned and not symlinked")


def applicable_order(preferences, operation, asset_class, criteria, default=()):
    """Explicit choices first, then `default` (core's order for the subject)."""
    facts = {**criteria, "asset_class": asset_class}
    matches = [rule for rule in preferences.get("scopes", []) if rule["operation"] == operation
               and all(facts.get(key) == value for key, value in rule["scope"].items())]
    # More constrained scopes win; equally constrained market/asset choices
    # precede data-kind and currency choices. No insertion-order rule engine.
    dimensions = ("venue", "asset_class", "measurement", "interval", "session", "price_adjustment", "currency")
    matches.sort(key=lambda rule: (-len(rule["scope"]), *(-int(key in rule["scope"]) for key in dimensions)))
    orders = [rule["providers"] for rule in matches] + [preferences["orders"][operation]]
    explicit = list(dict.fromkeys(provider for order in orders for provider in order))
    return explicit, list(dict.fromkeys([*explicit, *default]))


class Preferences:
    def __init__(self, data_dir):
        # The caller supplies native PluginState.data_dir, never a global profile.
        directory = Path(data_dir)
        require_private(directory, directory=True, absent=True)
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        require_private(directory, directory=True)
        self.path = directory / "preferences.sqlite3"
        require_private(self.path, absent=True)
        descriptor = os.open(self.path, os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
        os.close(descriptor)
        require_private(self.path)
        with self.connection() as db:
            db.executescript(DDL)
        legacy = directory / LEGACY
        if legacy.is_file() and not legacy.is_symlink():
            try:
                with self.transaction() as db:
                    counts = self._migrate(db, legacy)
            except sqlite3.Error:  # an unreadable file is set aside as it is
                logger.warning("The retired market-data identity file is unreadable; kept as %s", RETIRED, exc_info=True)
                counts = None
            # Set aside only after the copy committed; a crash in between copies again (idempotent).
            legacy.replace(legacy.with_name(RETIRED))
            if counts:
                logger.warning("Retired the market-data identity file: %d source choices copied, %d scoped choices"
                               " shadowed by a more specific one, %d provider mappings not migrated; kept as %s",
                               *counts, RETIRED)

    def _migrate(self, db, legacy):
        """Copy the retired identity file's source choices into this store."""
        old = sqlite3.connect(f"{legacy.resolve().as_uri()}?mode=ro", uri=True)
        try:
            tables = {row[0] for row in old.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            orders = old.execute("SELECT operation, providers FROM source_preferences").fetchall() \
                if "source_preferences" in tables else []
            scoped = old.execute("SELECT operation, scope, providers FROM scoped_source_preferences").fetchall() \
                if "scoped_source_preferences" in tables else []
            mappings = old.execute("SELECT count(*) FROM mappings").fetchone()[0] if "mappings" in tables else 0
        finally:
            old.close()
        for operation, providers in orders:
            db.execute("INSERT OR REPLACE INTO source_preferences VALUES (?, ?)", (operation, providers))
        ranked = sorted(scoped, key=lambda row: list(LEGACY_KINDS).index(json.loads(row[1]).get("subject_kind", "listing")))
        shadowed = 0
        for operation, scope, providers in ranked:
            value = json.loads(scope)
            if "subject_kind" in value:
                value["asset_class"] = LEGACY_KINDS[value.pop("subject_kind")]
            added = db.execute("INSERT OR IGNORE INTO scoped_source_preferences VALUES (?, ?, ?)",
                               (operation, dumps(value), providers)).rowcount
            shadowed += not added
        db.execute("UPDATE metadata SET value=value+1 WHERE key='preference_revision'")
        return len(orders) + len(ranked) - shadowed, shadowed, mappings

    @contextmanager
    def connection(self):
        require_private(self.path.parent, directory=True)
        require_private(self.path)
        db = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        db.execute("PRAGMA synchronous=FULL")
        try:
            yield db
        finally:
            db.close()

    @contextmanager
    def transaction(self):
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                yield db
                db.commit()
            except BaseException:
                db.rollback()
                raise

    def get(self):
        with self.connection() as db:
            db.execute("BEGIN")
            orders = {"latest": [], "history": []}
            orders.update({row[0]: json.loads(row[1]) for row in db.execute("SELECT * FROM source_preferences")})
            revision = db.execute("SELECT value FROM metadata WHERE key='preference_revision'").fetchone()[0]
            scopes = [{"operation": row[0], "scope": json.loads(row[1]), "providers": json.loads(row[2])}
                      for row in db.execute("SELECT * FROM scoped_source_preferences ORDER BY operation, scope")]
            db.commit()
            return {"revision": revision, "orders": orders, "scopes": scopes}

    def set(self, operation, providers, scope=None):
        require(operation in ("latest", "history"), "preferences", "invalid operation")
        validate_parameters({"type": "object", "properties": {"providers": ORDER_SCHEMA},
                             "required": ["providers"], "additionalProperties": False}, {"providers": providers})
        require(len(providers) == len(set(providers)), "preferences", "duplicate source")
        if scope is not None:
            validate_parameters(SCOPE_SCHEMA, scope)
            require(bool(scope), "preferences", "use an unscoped order for defaults")
            with self.transaction() as db:
                current = db.execute("SELECT providers FROM scoped_source_preferences WHERE operation=? AND scope=?", (operation, dumps(scope))).fetchone()
                if (json.loads(current[0]) if current else []) != providers:
                    if providers:
                        db.execute("INSERT INTO scoped_source_preferences VALUES (?, ?, ?) ON CONFLICT(operation, scope) DO UPDATE SET providers=excluded.providers", (operation, dumps(scope), dumps(providers)))
                    else:
                        db.execute("DELETE FROM scoped_source_preferences WHERE operation=? AND scope=?", (operation, dumps(scope)))
                    db.execute("UPDATE metadata SET value=value+1 WHERE key='preference_revision'")
            return self.get()
        with self.transaction() as db:
            current = db.execute("SELECT providers FROM source_preferences WHERE operation=?", (operation,)).fetchone()
            if (json.loads(current[0]) if current else []) != providers:
                db.execute("INSERT INTO source_preferences VALUES (?, ?) ON CONFLICT(operation) DO UPDATE SET providers=excluded.providers", (operation, dumps(providers)))
                db.execute("UPDATE metadata SET value=value+1 WHERE key='preference_revision'")
        return self.get()
