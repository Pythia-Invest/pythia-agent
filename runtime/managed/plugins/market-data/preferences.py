"""Source orders and narrowly scoped exceptions in the existing feature store."""
import json

from .identity_db import dumps
from .wire import require, validate_parameters
from .selection import CRITERIA

ORDER_SCHEMA = {"type": "array", "maxItems": 16,
                "items": {"type": "string", "pattern": "^[a-z][a-z0-9_-]*$", "maxLength": 64}}
SCOPE_SCHEMA = {"type": "object", "additionalProperties": False, "properties": {
    "subject_kind": {"type": "string", "enum": ["company", "instrument", "listing", "crypto"]},
    **{key: CRITERIA["properties"][key] for key in ("currency", "venue", "interval", "measurement", "session", "price_adjustment")}}}

# Product defaults, not a plugin inventory: unknown native contributions remain
# eligible and follow deterministically. Broker access still requires opt-in.
DEFAULT_ORDER = ("coingecko", "coinmarketcap", "yahoo", "eodhd", "ibkr_mcp")


def applicable_order(preferences, operation, binding, criteria):
    facts = {**criteria}
    if "kind" in binding:
        facts["subject_kind"] = binding["kind"]
    matches = [rule for rule in preferences.get("scopes", []) if rule["operation"] == operation
               and all(facts.get(key) == value for key, value in rule["scope"].items())]
    # More constrained scopes win; equally constrained market/asset choices
    # precede data-kind and currency choices. No insertion-order rule engine.
    dimensions = ("venue", "subject_kind", "measurement", "interval", "session", "price_adjustment", "currency")
    matches.sort(key=lambda rule: (-len(rule["scope"]), *(-int(key in rule["scope"]) for key in dimensions)))
    orders = [rule["providers"] for rule in matches] + [preferences["orders"][operation]]
    explicit = list(dict.fromkeys(provider for order in orders for provider in order))
    return explicit, list(dict.fromkeys([*explicit, *DEFAULT_ORDER]))


class Preferences:
    def __init__(self, database):
        self.database = database
        with database.transaction() as db:
            db.execute("CREATE TABLE IF NOT EXISTS source_preferences (operation TEXT PRIMARY KEY, providers TEXT NOT NULL)")
            db.execute("INSERT OR IGNORE INTO metadata VALUES ('preference_revision', 0)")
            db.execute("CREATE TABLE IF NOT EXISTS scoped_source_preferences (operation TEXT NOT NULL, scope TEXT NOT NULL, providers TEXT NOT NULL, PRIMARY KEY(operation, scope))")

    def get(self):
        with self.database.connection() as db:
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
            with self.database.transaction() as db:
                current = db.execute("SELECT providers FROM scoped_source_preferences WHERE operation=? AND scope=?", (operation, dumps(scope))).fetchone()
                if (json.loads(current[0]) if current else []) != providers:
                    if providers:
                        db.execute("INSERT INTO scoped_source_preferences VALUES (?, ?, ?) ON CONFLICT(operation, scope) DO UPDATE SET providers=excluded.providers", (operation, dumps(scope), dumps(providers)))
                    else:
                        db.execute("DELETE FROM scoped_source_preferences WHERE operation=? AND scope=?", (operation, dumps(scope)))
                    db.execute("UPDATE metadata SET value=value+1 WHERE key='preference_revision'")
            return self.get()
        with self.database.transaction() as db:
            current = db.execute("SELECT providers FROM source_preferences WHERE operation=?", (operation,)).fetchone()
            if (json.loads(current[0]) if current else []) != providers:
                db.execute("INSERT INTO source_preferences VALUES (?, ?) ON CONFLICT(operation) DO UPDATE SET providers=excluded.providers", (operation, dumps(providers)))
                db.execute("UPDATE metadata SET value=value+1 WHERE key='preference_revision'")
        return self.get()
