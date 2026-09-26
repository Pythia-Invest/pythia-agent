"""Profile-bound feature operations; providers own their metadata and selectors.

Identity is core's (ADR 0037): a Pythia subject reads through the native
references core binds or derives for it, in core's order.
"""
import copy
from contextlib import contextmanager

from .cache import ReadCache, ReadCancelled
from .preferences import Preferences
from .selection import CRITERIA, available, compatible_ref, fingerprint, native_access_scope, matches, permits_implicit, caches_observations
from .wire import WireError, require, validate, validate_parameters


def envelope(data, *, mutation=False, issues=(), outcome="ok"):
    result = {"schema_version": 1, "outcome": outcome, "data": data, "issues": list(issues)}
    if mutation:
        result["effect"] = "local_write"
    return result


class Backend:
    def __init__(self, data_dir, *, source_call=None, source_projection=None, access_scope=None, subjects=None, cache=None):
        # Injection is an ordinary code/test boundary, never part of native args.
        from .execution import call_source
        from .contributions import project
        from ._platform import price_sources
        self._call = source_call or call_source
        self._project = source_projection or project
        self._access_scope = access_scope or native_access_scope
        self._subjects = subjects or price_sources
        self.preferences = Preferences(data_dir)
        self.cache = cache or ReadCache()
        self.metadata_cache = ReadCache(max_entries=128, ttl_seconds=300)

    def context(self):
        sources, _invalid = self._project()
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
    def publication(self, preference_revision):
        require(preference_revision is None or self.preferences.get()["revision"] == preference_revision, "read", "stale preference revision")
        yield

    def route(self, binding):
        """What a binding reads: an explicit reference itself, or core's references for a subject.

        Returns {"asset_class", "refs"}; an unknown subject or a device without reference data has no refs."""
        validate("binding", binding)
        if "provider" in binding:
            return {"asset_class": None, "refs": [binding]}
        found = self._subjects(binding["id"])
        return {"asset_class": found.get("asset_class"), "refs": list(found.get("refs") or [])} if found else {"asset_class": None, "refs": []}

    def details(self, native_ref):
        native = validate("provider_ref", native_ref)
        return self.source(native["provider"], "details", {"native_ref": native})

    def series(self, binding, criteria):
        result, issues = [], []
        route = self.route(binding)
        refs = route["refs"]
        if "provider" not in binding:
            sources, _ = self.context()
            orders = self.preferences.get()["orders"]
            explicit = set(orders["latest"]) | set(orders["history"])
            facts = {**criteria, "asset_class": route["asset_class"]}
            for rule in self.preferences.get()["scopes"]:
                if all(facts.get(key) == value for key, value in rule["scope"].items()):
                    explicit.update(rule["providers"])
            permitted = [ref for ref in refs if permits_implicit(sources, ref["provider"], explicit)]
            if len(permitted) < len(refs):
                issues.append({"code": "explicit_source_required", "message": "Some sources require an explicit native reference or saved source preference for discovery.", "severity": "warning"})
            refs = permitted
        if len(refs) > 8:
            return envelope([], outcome="error", issues=[{"code": "candidate_limit", "message": "Too many native bindings; choose a narrower native reference or pinned descriptor.", "severity": "error"}])
        for native in refs:
            response = self.describe_series(native, criteria)
            issues.extend(response.get("issues", []))
            if response.get("outcome") not in ("ok", "empty", "partial"):
                continue
            for value in response.get("data", []):
                series = validate("series", value)
                require(compatible_ref(native, series["provider_ref"]), "series", "source binding differs")
                if matches(series, criteria):
                    if "provider" not in binding:
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
            "details": ({"native_ref"}, set()), "series": ({"binding"}, {"criteria"}),
            "read": ({"request"}, {"criteria", "series"}), "read_many": ({"reads"}, set()), "get_preferences": (set(), set()),
            "set_preferences": ({"operation", "providers"}, {"preference_scope"}),
        }
        require(action in shapes, "backend", "unknown action")
        required, optional = shapes[action]
        fields = set(request) - {"action"}
        require(required <= fields <= required | optional, "backend", "invalid action fields")
        criteria = request.get("criteria", {})
        validate_parameters(CRITERIA, criteria)
        if action == "details":
            return self.details(request["native_ref"])
        if action == "series":
            return self.series(request["binding"], criteria)
        if action == "read":
            from .reads import read
            key = fingerprint({"request": request, "access": self.context()[1], "preferences": self.preferences.get()["revision"]})
            return self.cache.coalesce(key, lambda: read(self, request["request"], criteria, request.get("series")))
        if action == "read_many":
            from .coordinated import read_many
            return envelope(read_many(self, request["reads"]))
        if action == "get_preferences":
            return envelope(self.preferences.get())
        if action == "set_preferences":
            return envelope(self.preferences.set(request["operation"], request["providers"], request.get("preference_scope")), mutation=True)
        raise WireError("backend: unknown action")

    def subject_scope(self, reads):
        """What the Pythia-view reads of a batch route through now; a change invalidates reused results."""
        scope = []
        for item in reads:
            view = item.get("request", {}).get("view", {})
            if view.get("kind") == "pythia":
                try:
                    scope.append(self.route(view.get("subject"))["refs"])
                except WireError:  # the read itself reports its invalid request
                    scope.append(None)
        return scope
