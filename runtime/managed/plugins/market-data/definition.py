"""Flat native entrypoint schema; ordinary backend code owns action variants."""
from .selection import CRITERIA
from .preferences import SCOPE_SCHEMA
from .wire import parameter_schema

TOOL_NAME = "pythia_market_data"
TOOLSET = "pythia-market-data"
ACTIONS = ["describe", "call", "search", "details", "resolve_save", "series", "read", "read_many",
           "get_preferences", "set_preferences", "inspect_identity", "inspect_subject",
           "refresh_identity", "inspect_repair", "apply_override", "revoke_override"]
TEXT = {"type": "string", "minLength": 1, "maxLength": 512}
SCHEMA = {
    "name": TOOL_NAME,
    "description": (
        "Inspect sources, search or resolve native investments, describe series and read prices/history by canonical subject. "
        "For workflow guidance, load skill_view(name='pythia-market-data:market-data'); skills_list discovers bundled skills. "
        "Use read_many to coordinate a watchlist or several reads; each item retains its source and full financial semantics. "
        "Preferences can be scoped by subject kind, currency, venue, interval, measurement, session or adjustment. "
        "Read criteria select measurement, interval, session, price adjustment, source class or venue; ambiguity requires more detail. "
        "Pinned reads require the retained full series descriptor. Selected-source failure never falls back. "
        "resolve_save, refresh_identity, set_preferences, apply_override and revoke_override write local feature state; "
        "search/details do not save identities. Overrides cite existing source evidence IDs, never supplied assertions."
    ),
    "parameters": {"type": "object", "additionalProperties": False, "required": ["action"], "properties": {
        "action": {"type": "string", "enum": ACTIONS},
        "provider": TEXT, "operation": {"type": "string", "enum": ["search", "details", "series", "latest", "history"]},
        "arguments": {"type": "object", "description": "Specialist arguments for explicit call, matching the native source schema."},
        "query": TEXT, "native_ref": parameter_schema("provider_ref"), "binding": parameter_schema("binding"),
        "scope": {"type": "string", "enum": ["company", "instrument", "listing", "crypto"]},
        "request": parameter_schema("read_request"), "criteria": CRITERIA,
        "reads": {"type": "array", "minItems": 1, "maxItems": 32, "items": {
            "type": "object", "additionalProperties": False, "required": ["request"], "properties": {
                "request": parameter_schema("read_request"), "criteria": CRITERIA,
                "series": {"type": "object", "description": "Retained full descriptor for pinned reads."}}}},
        "series": {"type": "object", "description": "Complete retained Series descriptor for a source-pinned read; validated by the wire contract."},
        "providers": {"type": "array", "maxItems": 16, "items": TEXT}, "mapping_id": TEXT,
        "preference_scope": SCOPE_SCHEMA,
        "subject": parameter_schema("subject"), "effect": {"type": "string", "enum": ["positive", "negative"]},
        "evidence_ids": {"type": "array", "maxItems": 100, "items": TEXT},
        "target": parameter_schema("subject"), "override_id": TEXT,
    }},
}
