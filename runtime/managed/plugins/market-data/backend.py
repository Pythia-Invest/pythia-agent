"""Profile-bound feature operations; providers own their metadata and selectors."""
import copy
from contextlib import contextmanager, nullcontext

from .cache import ReadCache, ReadCancelled
from .identity import IdentityStore
from .preferences import Preferences, applicable_order
from .request_context import cancelled
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

    def qualify_candidates(self, candidates, *, selected=False):
        from .identity_resolution import qualify_candidates
        return qualify_candidates(self, candidates, selected=selected)

    def resolve(self, native_ref, scope, mapping_id=None, *, search_adoption=False):
        native = validate("provider_ref", native_ref)
        require(scope in ("company", "instrument", "listing", "crypto"), "identity", "invalid subject scope")
        access = self.context()[1]
        response = self.details(native)
        if response.get("outcome") not in ("ok", "partial"):
            return response
        data = response.get("data")
        require(type(data) is list and len(data) <= 10000, "identity", "invalid candidate response")
        candidates = [item for item in data if type(item) is dict and compatible_ref(native, item.get("provider_ref"))]
        if len(candidates) != 1:
            return envelope(data, outcome="partial" if data else "empty", issues=[{"code": "ambiguous_identity", "message": "Select one fully qualified native reference before saving identity.", "severity": "warning"}])
        # Ordinary search selection retains source intent without external
        # reconciliation. Explicit resolve/refresh workflows still qualify it.
        chosen = candidates[0] if search_adoption else self.qualify_candidates(candidates, selected=True)[0]
        actual = validate("provider_ref", chosen["provider_ref"])
        require(actual["provider"] == native["provider"], "identity", "source provider differs")
        evidence = chosen.get("evidence")
        require(type(evidence) is list, "identity", "source has no normalized evidence contract")
        if search_adoption:
            explicit = chosen.get('kind', chosen.get('scope'))
            supported = {item.get('scope') for item in evidence if type(item) is dict and item.get('authority') == 'source_asserted'}
            if explicit in ('company', 'instrument', 'listing', 'crypto'):
                supported.add(explicit)
            if not supported:
                sources, _ = self.context()
                supported = {kind for source in sources if source['contribution']['provider'] == actual['provider']
                             for kind in source['contribution'].get('subject_kinds', [])}
            require(scope in supported, 'identity', 'source does not establish the requested subject scope')
        from .search import candidate
        label = candidate(chosen, actual['provider'], [scope])
        if cancelled():
            raise ReadCancelled()
        if self.context()[1] != access:
            return envelope(None, outcome='error', issues=[{'code': 'access_changed', 'message': 'Connected source access changed. Select the investment again.', 'severity': 'error'}])
        ids = self.identity.ingest(actual, evidence)
        if mapping_id is not None:
            saved = self.identity.inspect(mapping_id)
            require(saved["native_ref"] == actual, "identity", "refresh cannot replace native intent")
            result = self.identity.refresh(mapping_id, ids)
        else:
            result = self.identity.save(actual, scope, ids, retain_reference_evidence=search_adoption)
        from .catalogue import remember
        remember(self.identity, actual, scope, label)
        return envelope(result, mutation=True, issues=[*response.get("issues", []), *chosen.get('identity_issues', [])])

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

    def adoption_binding(self, saved):
        """Keep an explicit source usable when preferred reads exclude it.

        Adoption has no read criteria. Check default eligibility for the selected
        source's implemented price operations, without probing series or changing
        preferences. Actual reads still qualify their full requested semantics.
        """
        native, subject = saved['native_ref'], saved['intent_subject']
        mappings = self.identity.bindings(subject)['mappings']
        if not any(row['id'] == saved['mapping']['id'] for row in mappings):
            return native
        sources, _ = self.context()
        operations = [operation for operation in ('latest', 'history') if available(sources, native['provider'], operation)]
        if not operations or not available(sources, native['provider'], 'series'):
            return native
        preferences = self.preferences.get()
        for operation in operations:
            explicit, _ = applicable_order(preferences, operation, subject, {})
            if not any(available(sources, row['provider_ref']['provider'], operation)
                       and available(sources, row['provider_ref']['provider'], 'series')
                       and permits_implicit(sources, row['provider_ref']['provider'], explicit) for row in mappings):
                return native
        return subject

    def adopt_group(self, native_ref, scope, references):
        """Revalidate an instrument group; no provider/venue is selected by order."""
        from .identity_matching import compare
        from .identity_repair import evidence_current
        from .catalogue import remember
        from .search import candidate
        require(scope == 'instrument', 'identity', 'group adoption requires instrument scope')
        require(type(references) is list and 2 <= len(references) <= 8, 'identity', 'invalid reference group')
        refs = [validate('provider_ref', ref) for ref in references]
        require(native_ref in refs and len({fingerprint(ref) for ref in refs}) == len(refs), 'identity', 'invalid reference selection')
        access = self.context()[1]
        responses = [self.details(ref) for ref in refs]
        selected, issues = [], []
        for ref, response in zip(refs, responses):
            issues.extend(response.get('issues', []))
            if response.get('outcome') not in ('ok', 'partial'):
                return envelope(None, outcome='error', issues=issues or [{'code': 'source_error', 'message': 'A selected source could not be verified.', 'severity': 'error'}])
            data = response.get('data')
            require(type(data) is list and len(data) <= 10000, 'identity', 'invalid candidate response')
            matches = [row for row in data if type(row) is dict and compatible_ref(ref, row.get('provider_ref'))]
            if len(matches) != 1:
                return envelope(None, outcome='error', issues=[*issues, {'code': 'ambiguous_identity', 'message': 'Select a specific source reference; its identity is ambiguous.', 'severity': 'error'}])
            selected.append(matches[0])
        selected = self.qualify_candidates(selected, selected=True)
        for row in selected:
            ref = validate('provider_ref', row['provider_ref'])
            records = [validate('evidence', item) for item in row.get('evidence', [])]
            require(all(item['provider_ref'] == ref for item in records), 'identity', 'evidence native reference differs')
            row['evidence'] = records
            issues.extend(row.get('identity_issues', []))
        for index, row in enumerate(selected):
            for peer in selected[index:]:
                if (not evidence_current(row['evidence'] + peer['evidence'], self.identity.evidence_versions)
                        or compare(row['provider_ref'], row['evidence'], peer['provider_ref'], peer['evidence'], scope) != 'confirmed'):
                    return envelope(None, outcome='error', issues=[*issues, {'code': 'identity_not_qualified', 'message': 'These references are not currently proven to identify the same instrument. Select a source explicitly.', 'severity': 'error'}])
        if cancelled():
            raise ReadCancelled()
        if self.context()[1] != access:
            return envelope(None, outcome='error', issues=[{'code': 'access_changed', 'message': 'Connected source access changed. Select the investment again.', 'severity': 'error'}])
        # All source reads and pairwise proof precede persistence. Each save is
        # idempotent and retains its original intent; no listing is rewritten.
        saved = []
        for row in selected:
            ref = row['provider_ref']
            ids = self.identity.ingest(ref, row['evidence'])
            saved.append(self.identity.save(ref, scope, ids))
            remember(self.identity, ref, scope, candidate(row, ref['provider'], [scope]))
        targets = {fingerprint(item['mapping']['target']) for item in saved}
        if len(targets) != 1 or any(item['mapping']['status'] != 'confirmed' for item in saved):
            return envelope(None, outcome='error', issues=[*issues, {'code': 'ambiguous_identity', 'message': 'Retained identities require review before a shared instrument can be selected.', 'severity': 'error'}])
        subject = saved[0]['mapping']['target']
        return envelope({'subject': subject, 'binding': subject, 'identity_status': 'confirmed',
                         'mapping_id': saved[0]['mapping']['id']}, mutation=True, issues=issues)

    def handle(self, request):
        require(type(request) is dict, "backend", "expected request object")
        self.context()  # Native feature eligibility applies to local actions too.
        action = request.get("action")
        shapes = {
            "search_catalogue": ({"query"}, {"limit", "providers"}), "adopt_search": ({"native_ref", "scope"}, {'references', 'binding_mode'}),
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
        if action == 'search_catalogue':
            from .search import search
            key = fingerprint({'search': request, 'access': self.context()[1], 'identity': self.identity.cache_token()})
            return self.cache.coalesce(key, lambda: search(self, request['query'], request.get('limit', 30), request.get('providers')))
        if action == 'adopt_search':
            binding_mode = request.get('binding_mode', 'preferred' if 'references' in request else 'source')
            require(binding_mode in ('preferred', 'source'), 'identity', 'invalid binding mode')
            require(binding_mode != 'source' or 'references' not in request, 'identity', 'source binding requires one reference')
            if request.get('references') is not None:
                return self.adopt_group(request['native_ref'], request['scope'], request['references'])
            result = self.resolve(request['native_ref'], request['scope'], search_adoption=True)
            if result.get('effect') != 'local_write':
                if result.get('outcome') == 'error':
                    return result
                return envelope(None, outcome='error', issues=[*result.get('issues', []), {
                    'code': 'identity_not_selected', 'message': 'No unique investment reference could be selected.', 'severity': 'error'}])
            from .search import status
            saved = result['data']
            subject = saved['intent_subject']
            return envelope({'subject': subject, 'binding': saved['native_ref'] if binding_mode == 'source' else self.adoption_binding(saved),
                             'identity_status': status(saved['mapping']['status']), 'mapping_id': saved['mapping']['id']},
                            mutation=True, issues=result['issues'])
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
