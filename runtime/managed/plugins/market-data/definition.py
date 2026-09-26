"""Flat native entrypoint schema; ordinary backend code owns action variants."""
from .selection import CRITERIA
from .preferences import SCOPE_SCHEMA
from .wire import parameter_schema

TOOL_NAME = "pythia_market_data"
TOOLSET = "pythia-market-data"
ACTIONS = ["describe", "call", "details", "series", "read", "read_many", "get_preferences", "set_preferences"]
TEXT = {"type": "string", "minLength": 1, "maxLength": 512}
SCHEMA = {
    "name": TOOL_NAME,
    "description": (
        "Inspect sources, describe series and read prices/history for a Pythia subject or an explicit provider reference. "
        "A Pythia subject is {kind, id}: a subject id from pythia_identity_search or pythia_identity_subject and its level, "
        "the id's prefix; its reads use the sources core binds for it. For workflow guidance, load skill_view(name='pythia-market-data:market-data'); skills_list discovers bundled skills. "
        "Use read_many to coordinate a watchlist or several reads; each item retains its source and full financial semantics. "
        "Preferences can be scoped by asset class, currency, venue, interval, measurement, session or adjustment. "
        "Read criteria select measurement, interval, session, price adjustment, source class or venue; ambiguity requires more detail. "
        "Pinned reads require the retained full series descriptor. Selected-source failure never falls back. "
        "set_preferences writes local feature state."
    ),
    "parameters": {"type": "object", "additionalProperties": False, "required": ["action"], "properties": {
        "action": {"type": "string", "enum": ACTIONS},
        "provider": TEXT, "operation": {"type": "string", "enum": ["details", "series", "latest", "history"]},
        "arguments": {"type": "object", "description": "Specialist arguments for explicit call, matching the native source schema."},
        "native_ref": parameter_schema("provider_ref"), "binding": parameter_schema("binding"),
        "request": parameter_schema("read_request"), "criteria": CRITERIA,
        "reads": {"type": "array", "minItems": 1, "maxItems": 32, "items": {
            "type": "object", "additionalProperties": False, "required": ["request"], "properties": {
                "request": parameter_schema("read_request"), "criteria": CRITERIA,
                "series": {"type": "object", "description": "Retained full descriptor for pinned reads."}}}},
        "series": {"type": "object", "description": "Complete retained Series descriptor for a source-pinned read; validated by the wire contract."},
        "providers": {"type": "array", "maxItems": 16, "items": TEXT},
        "preference_scope": SCOPE_SCHEMA,
    }},
}
