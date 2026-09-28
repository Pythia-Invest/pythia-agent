"""Profile-bound feature operations; providers own their metadata and selectors.

Identity and source selection are core's (ADR 0037, ADR 0040): a Pythia subject
reads through the native references core binds or derives for it, in core's one
source order (the investor's `source_order`, then core's default order).
"""
import copy
from contextlib import contextmanager
from contextvars import ContextVar
import json
import logging
from pathlib import Path
import sqlite3

from .cache import ReadCache, ReadCancelled
from .selection import CRITERIA, available, compatible_ref, fingerprint, native_access_scope, matches, permits_implicit, caches_observations
from .wire import WireError, require, validate, validate_parameters


logger = logging.getLogger(__name__)
# One request loads each subject's routing once, however many checks read it.
_ROUTES = ContextVar("market_data_routes", default=None)
# This feature's former source choices: its own store, and the identity file it replaced (ADR 0012, retired by 0037).
RETIRED = (("preferences.sqlite3", "preferences-retired.sqlite3"), ("identity.sqlite3", "identity-retired.sqlite3"))


def _saved_orders(path):
    """The non-empty per-operation orders and the count of scoped choices a retired file holds."""
    db = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True, timeout=2)
    try:
        tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        orders = {row[0]: json.loads(row[1]) for row in db.execute("SELECT operation, providers FROM source_preferences")} \
            if "source_preferences" in tables else {}
        scoped = db.execute("SELECT count(*) FROM scoped_source_preferences").fetchone()[0] \
            if "scoped_source_preferences" in tables else 0
    finally:
        db.close()
    return {operation: order for operation, order in orders.items() if order}, scoped


def retire_source_choices(data_dir):
    """Set aside this feature's former source choices once: core's `source_order` is the one order (ADR 0040).

    Nothing is copied into settings.json and nothing is deleted. Each file is renamed, never overwriting an
    earlier one; a warning names the choices a file held, so the investor can put them in `source_order`.
    An empty (or unreadable) file is renamed silently."""
    directory = Path(data_dir)
    for name, retired in RETIRED:
        path, target = directory / name, directory / retired
        if not path.is_file() or path.is_symlink() or target.exists():
            continue
        try:
            orders, scoped = _saved_orders(path)
        except (sqlite3.Error, ValueError):
            orders, scoped = {}, 0
        try:
            path.rename(target)
        except OSError:  # another process set it aside first
            continue
        if orders or scoped:
            logger.warning("Market-data source choices retired: Pythia now has one source order, source_order in"
                           " settings.json (empty: free sources first). %s is kept as %s; its orders %s and %s"
                           " scoped choices no longer apply.", name, retired, orders, scoped)


def core_price_sources(subject_id):
    from ._platform import platform
    try:
        support = platform()
    except RuntimeError:  # no enabled core with platform support v1
        return {"asset_class": None, "refs": [], "reason": "core_unavailable"}
    return support.price_sources(subject_id)


def core_check_read(subject_id, native_ref, stated):
    from ._platform import platform
    support = platform()
    check = getattr(support, "check_read", None)  # an older core has no read check
    return check(subject_id, native_ref, stated) if check else None


def stated(series):
    """What a source's own series say about the reference they describe: its currency and venue code."""
    qualifiers = next((value["provider_ref"].get("qualifiers") or {} for value in series), {})
    return {key: qualifiers[key] for key in ("currency", "venue") if qualifiers.get(key)}


def envelope(data, *, issues=(), outcome="ok"):
    return {"schema_version": 1, "outcome": outcome, "data": data, "issues": list(issues)}


CONFLICT_ISSUE = {"code": "binding_conflict", "severity": "warning",
                  "message": "A source's own record states another venue or currency than this instrument's reference data; it is not used."}


def unverified_issue(provider, label):
    return {"code": "unverified_source", "severity": "warning",
            "message": f"{provider} is unverified for this instrument: {label} (its own record against the reference data)."}
ISSUER_ISSUE = {"code": "issuer_subject", "severity": "error",
                "message": "An issuer has no price. Read one of its securities or listings; pythia_identity_subject lists them."}


class Backend:
    def __init__(self, data_dir, *, source_call=None, source_projection=None, access_scope=None, subjects=None, cache=None,
                 check_read=None):
        # Injection is an ordinary code/test boundary, never part of native args.
        from .execution import call_source
        from .contributions import project
        self._call = source_call or call_source
        self._project = source_projection or project
        self._access_scope = access_scope or native_access_scope
        self._subjects = subjects or core_price_sources
        self._check_read = check_read or core_check_read
        retire_source_choices(data_dir)
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
    def routing(self):
        """Share each subject's routing across one request's checks and reads."""
        token = _ROUTES.set({}) if _ROUTES.get() is None else None
        try:
            yield
        finally:
            if token is not None:
                _ROUTES.reset(token)

    def route(self, binding):
        """What a binding reads: an explicit reference itself, or core's references for a subject.

        Returns {"asset_class", "refs", "named", "reason"}; `named` lists the providers the investor named in
        `source_order`, and `reason` says why a subject has no refs:
        "issuer_subject", "no_reference_data", "unknown_subject" or "core_unavailable"."""
        validate("binding", binding)
        if "provider" in binding:
            return {"asset_class": None, "refs": [binding], "named": [], "reason": None}
        if binding["kind"] == "issuer":  # an issuer has no price; never ask a source
            return {"asset_class": None, "refs": [], "named": [], "reason": "issuer_subject"}
        memo = _ROUTES.get()
        if memo is not None and binding["id"] in memo:
            return memo[binding["id"]]
        found = self._subjects(binding["id"]) or {}
        route = {"asset_class": found.get("asset_class"), "refs": list(found.get("refs") or []),
                 "named": list(found.get("named") or []), "reason": found.get("reason")}
        if memo is not None:
            memo[binding["id"]] = route
        return route

    def check(self, binding, native, response):
        """Core's read check of what the series a source described state about themselves (ADR 0037), for the
        subject read or, for an explicit reference, the subject core last served it for: {"status", "label"}.
        A check never fails the read."""
        said = stated(response.get("data") or []) if response.get("outcome") == "ok" else {}
        try:
            outcome = self._check_read(None if "provider" in binding else binding["id"], native, said) if said else None
        except Exception:
            logger.warning("read check unavailable", exc_info=True)
            outcome = None
        return outcome if isinstance(outcome, dict) else {"status": "unchecked", "label": None}

    def details(self, native_ref):
        native = validate("provider_ref", native_ref)
        return self.source(native["provider"], "details", {"native_ref": native})

    def series(self, binding, criteria):
        result, issues = [], []
        route = self.route(binding)
        refs = route["refs"]
        if route["reason"] == "issuer_subject":
            return envelope([], outcome="error", issues=[ISSUER_ISSUE])
        if "provider" not in binding:
            sources, _ = self.context()
            permitted = [ref for ref in refs if permits_implicit(sources, ref["provider"], route["named"])]
            if len(permitted) < len(refs):
                issues.append({"code": "explicit_source_required", "message": "Some sources require an explicit native reference, a pinned series or a place in source_order for discovery.", "severity": "warning"})
            refs = permitted
        if len(refs) > 8:
            return envelope([], outcome="error", issues=[{"code": "candidate_limit", "message": "Too many native bindings; choose a narrower native reference or pinned descriptor.", "severity": "error"}])
        for native in refs:
            response = self.describe_series(native, criteria)
            issues.extend(response.get("issues", []))
            if response.get("outcome") not in ("ok", "empty", "partial"):
                continue
            checked = self.check(binding, native, response)
            if checked["status"] == "refused":
                issues.append(CONFLICT_ISSUE)
                continue
            if checked["status"] == "unverified":
                issues.append(unverified_issue(native["provider"], checked["label"]))
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
        with self.routing():
            return self._handle(request)

    def _handle(self, request):
        require(type(request) is dict, "backend", "expected request object")
        self.context()  # Native feature eligibility applies to local actions too.
        action = request.get("action")
        shapes = {
            "details": ({"native_ref"}, set()), "series": ({"binding"}, {"criteria"}),
            "read": ({"request"}, {"criteria", "series"}), "read_many": ({"reads"}, set()),
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
            key = fingerprint({"request": request, "access": self.context()[1]})
            return self.cache.coalesce(key, lambda: read(self, request["request"], criteria, request.get("series")))
        if action == "read_many":
            from .coordinated import read_many
            return envelope(read_many(self, request["reads"]))
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
