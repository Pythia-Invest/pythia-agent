"""Profile-bound feature operations; providers own their metadata and selectors."""
import copy
from contextlib import contextmanager, nullcontext

from .cache import ReadCache, ReadCancelled
from .identity import IdentityStore
from .preferences import Preferences
from .selection import CRITERIA, available, compatible_ref, fingerprint, native_access_scope, matches, permits_implicit, caches_observations
from .wire import WireError, require, validate, validate_parameters


def envelope(data, *, mutation=False, issues=(), outcome="ok"):
    result = {"schema_version": 1, "outcome": outcome, "data": data, "issues": list(issues)}
    if mutation:
        result["effect"] = "local_write"
    return result


class Backend:
    def __init__(self, data_dir, *, source_call=None, source_projection=None, access_scope=None, identity=None, cache=None):
        # Injection is an ordinary code/test boundary, never part of native args.
        from .execution import call_source
        from .contributions import project
        self._call = source_call or call_source
        self._project = source_projection or project
        self._access_scope = access_scope or native_access_scope
        self.identity = identity or IdentityStore(data_dir)
        self.preferences = Preferences(self.identity.database)
        self.cache = cache or ReadCache()
        self.metadata_cache = ReadCache(max_entries=128, ttl_seconds=300)

    def context(self):
        sources, _invalid = self._project()
        self.identity.evidence_versions.update({source["contribution"]["provider"]: source["contribution"]["adapter_version"] for source in sources})
        native_scope = self._access_scope()
        return sources, {"fingerprint": fingerprint({"native": native_scope, "sources": sources}),
                         "cacheable": native_scope.get("cacheable", True)}

    def source(self, provider, operation, arguments):
        sources, access = self.context()
        if not available(sources, provider, operation):
            from .execution import failure
            return failure("unavailable")
        def call():
            return self._call(provider, operation, copy.deepcopy(arguments))
        if operation in ('latest', 'history', 'read_batch') and access['cacheable'] and caches_observations(sources, provider):
            try:
                return self.cache.coalesce(fingerprint({'native_read': operation, 'provider': provider, 'arguments': arguments, 'access': access}), call)
            except ReadCancelled:
                from .execution import failure
                return failure('cancelled')
        if operation != "series" or not access["cacheable"] or not caches_observations(sources, provider):
            return call()
        key = fingerprint({"provider": provider, "arguments": arguments, "access": access})
        def describe():
            cached = self.metadata_cache.get(key)
            if cached is not None:
                return cached
            result = call()
            if result.get("outcome") in ("ok", "empty") and self.context()[1] == access:
                age = next((source["contribution"].get("cadence", {}).get("series", 300)
                            for source in sources if source["contribution"]["provider"] == provider), 300)
                self.metadata_cache.put(key, result, ttl_seconds=age)
            return result
        return self.metadata_cache.coalesce(key, describe)

    @contextmanager
    def publication(self, generation, preference_revision):
        # Both mapping and preference writers use this same SQLite write lock.
        # The separate readonly preference snapshot is stable while it is held.
        with self.identity.current_generation(generation) if generation is not None else nullcontext():
            require(preference_revision is None or self.preferences.get()["revision"] == preference_revision, "read", "stale preference revision")
            yield

    def bindings(self, binding):
        validate("binding", binding)
        if "provider" in binding:
            return [{"native_ref": binding, "mapping": None}]
        return [{"native_ref": mapping["provider_ref"], "mapping": mapping}
                for mapping in self.identity.bindings(binding)["mappings"]]

    def details(self, native_ref):
        native = validate("provider_ref", native_ref)
        return self.source(native["provider"], "details", {"native_ref": native})

    def resolve(self, native_ref, scope, mapping_id=None):
        native = validate("provider_ref", native_ref)
        require(scope in ("company", "instrument", "listing", "crypto"), "identity", "invalid subject scope")
        response = self.details(native)
        if response.get("outcome") not in ("ok", "partial"):
            return response
        data = response.get("data")
        require(type(data) is list and len(data) <= 10000, "identity", "invalid candidate response")
        candidates = [item for item in data if type(item) is dict and compatible_ref(native, item.get("provider_ref"))]
        if len(candidates) != 1:
            return envelope(data, outcome="partial" if data else "empty", issues=[{"code": "ambiguous_identity", "message": "Select one fully qualified native reference before saving identity.", "severity": "warning"}])
        chosen = candidates[0]
        actual = validate("provider_ref", chosen["provider_ref"])
        require(actual["provider"] == native["provider"], "identity", "source provider differs")
        evidence = chosen.get("evidence")
        require(type(evidence) is list, "identity", "source has no normalized evidence contract")
        ids = self.identity.ingest(actual, evidence)
        if mapping_id is not None:
            saved = self.identity.inspect(mapping_id)
            require(saved["native_ref"] == actual, "identity", "refresh cannot replace native intent")
            result = self.identity.refresh(mapping_id, ids)
        else:
            result = self.identity.save(actual, scope, ids)
        return envelope(result, mutation=True, issues=response.get("issues", []))

    def series(self, binding, criteria):
        result, issues = [], []
        bindings = self.bindings(binding)
        if "provider" not in binding:
            sources, _ = self.context()
            orders = self.preferences.get()["orders"]
            explicit = set(orders["latest"]) | set(orders["history"])
            for rule in self.preferences.get()["scopes"]:
                if all((binding.get("kind") if key == "subject_kind" else criteria.get(key)) == value
                       for key, value in rule["scope"].items()):
                    explicit.update(rule["providers"])
            excluded = [entry for entry in bindings if not permits_implicit(sources, entry["native_ref"]["provider"], explicit)]
            bindings = [entry for entry in bindings if permits_implicit(sources, entry["native_ref"]["provider"], explicit)]
            if excluded:
                issues.append({"code": "explicit_source_required", "message": "Some sources require an explicit native reference or saved source preference for discovery.", "severity": "warning"})
        if len(bindings) > 8:
            return envelope([], outcome="error", issues=[{"code": "candidate_limit", "message": "Too many native bindings; choose a narrower native reference or pinned descriptor.", "severity": "error"}])
        for entry in bindings:
            native = entry["native_ref"]
            response = self.describe_series(native, criteria)
            issues.extend(response.get("issues", []))
            if response.get("outcome") not in ("ok", "empty", "partial"):
                continue
            for value in response.get("data", []):
                series = validate("series", value)
                require(compatible_ref(native, series["provider_ref"]), "series", "source binding differs")
                if matches(series, criteria):
                    if entry["mapping"] is not None:
                        series["subject"] = binding
                    result.append(series)
        outcome = "partial" if issues and result else "ok" if result else "error" if issues else "empty"
        return envelope(result, issues=issues, outcome=outcome)

    def describe_series(self, native, criteria):
        # Optional filtering is declared on the native series operation. It lets
        # a connector expose explicitly requested specialist feeds without
        # changing ordinary defaults or making transport choose a dataset.
        sources, _ = self.context()
        accepts = any('criteria' in op.get('parameters', {}).get('properties', {})
            for source in sources if source['contribution']['provider'] == native['provider']
            for op in source['operations'] if op['operation'] == 'series')
        return self.source(native['provider'], 'series', {'native_ref': native, **({'criteria': criteria} if accepts else {})})

    def handle(self, request):
        require(type(request) is dict, "backend", "expected request object")
        self.context()  # Native feature eligibility applies to local actions too.
        action = request.get("action")
        shapes = {
            "search": ({"provider", "query"}, set()), "details": ({"native_ref"}, set()),
            "resolve_save": ({"native_ref", "scope"}, set()), "series": ({"binding"}, {"criteria"}),
            "read": ({"request"}, {"criteria", "series"}), "read_many": ({"reads"}, set()), "get_preferences": (set(), set()),
            "set_preferences": ({"operation", "providers"}, {"preference_scope"}),
            "inspect_identity": ({"mapping_id"}, set()), "inspect_subject": ({"subject"}, set()),
            "refresh_identity": ({"mapping_id"}, set()), "inspect_repair": (set(), set()),
            "apply_override": ({"mapping_id", "effect", "evidence_ids"}, {"target"}),
            "revoke_override": ({"override_id"}, set()),
        }
        require(action in shapes, "backend", "unknown action")
        required, optional = shapes[action]
        fields = set(request) - {"action"}
        require(required <= fields <= required | optional, "backend", "invalid action fields")
        criteria = request.get("criteria", {})
        validate_parameters(CRITERIA, criteria)
        if action == "search":
            require(type(request["query"]) is str and 1 <= len(request["query"]) <= 512, "search", "invalid query")
            return self.source(request["provider"], "search", {"query": request["query"]})
        if action == "details":
            return self.details(request["native_ref"])
        if action == "resolve_save":
            return self.resolve(request["native_ref"], request["scope"])
        if action == "series":
            return self.series(request["binding"], criteria)
        if action == "read":
            from .reads import read
            key = fingerprint({"request": request, "access": self.context()[1], "preferences": self.preferences.get()["revision"], "identity": self.identity.cache_token()})
            return self.cache.coalesce(key, lambda: read(self, request["request"], criteria, request.get("series")))
        if action == "read_many":
            from .coordinated import read_many
            return envelope(read_many(self, request["reads"]))
        if action == "get_preferences":
            return envelope(self.preferences.get())
        if action == "set_preferences":
            return envelope(self.preferences.set(request["operation"], request["providers"], request.get("preference_scope")), mutation=True)
        if action == "inspect_identity":
            mapping_id = request["mapping_id"]
            value = self.identity.inspect(mapping_id)
            value.update(history=self.identity.history(mapping_id), overrides=self.identity.overrides(mapping_id))
            return envelope(value)
        if action == "inspect_subject":
            return envelope(self.identity.subject(request["subject"]))
        if action == "refresh_identity":
            value = self.identity.inspect(request["mapping_id"])
            return self.resolve(value["native_ref"], value["mapping"]["target"]["kind"], request["mapping_id"])
        if action == "inspect_repair":
            return envelope(self.identity.repair_status())
        if action == "apply_override":
            return envelope(self.identity.apply_override(request["mapping_id"], request["effect"], request["evidence_ids"], request.get("target")), mutation=True)
        if action == "revoke_override":
            return envelope(self.identity.revoke_override(request["override_id"]), mutation=True)
        raise WireError("backend: unknown action")
