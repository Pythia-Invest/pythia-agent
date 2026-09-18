"""Synthetic source definitions and pre-proven mappings for shared-read tests.

Values are shaped by shared wire v1 and the native contribution seam, not real
provider responses. Cross-source mapping here is a test fixture, not a new rule.
"""
import copy
from importlib import import_module
import json
from pathlib import Path

from test_market_data_identity import PACKAGE, evidence, isin, native, identity

Backend = import_module(f"{PACKAGE}.backend").Backend
read_module = import_module(f"{PACKAGE}.reads")
wire = import_module(f"{PACKAGE}.wire")
EXAMPLE = next(f["value"] for f in json.loads((Path(__file__).resolve().parents[3] / "packages/market-data/examples/valid.json").read_text()) if f["name"] == "equity_daily")
SUBJECT = {"kind": "instrument", "id": "instrument:synthetic-shared"}
CRITERIA = {"measurement": "ohlc", "interval": {"kind": "day", "count": 1}, "session": "regular", "price_adjustment": "split", "market_data_type": "unknown", "currency": "USD"}


class Sources:
    def __init__(self):
        self.providers = ("ibkr", "synthetic_other")
        self.ready = {provider: True for provider in self.providers}
        self.calls = []
        self.access = {"platform": "api_server", "connection": "endpoint-a"}
        self.refs = {provider: {**native(301 if provider == "ibkr" else 302), "provider": provider} for provider in self.providers}
        self.definitions = {provider: [self.definition(provider)] for provider in self.providers}
        self.fail = set()
        self.policies = {}
        self.after_read = None
        self.read_transform = None

    def definition(self, provider, suffix="daily"):
        result = copy.deepcopy(EXAMPLE["series"])
        result.update(id=f"series:{provider}:{suffix}", provider_ref=self.refs[provider], subject=self.refs[provider], market_data_type="unknown")
        result["source_detail"] = {"namespace": provider, "values": {"read_selector": f"opaque-{provider}-{suffix}"}}
        return result

    def project(self):
        return [{"contribution": {"schema_version": 1, "provider": provider, "adapter_version": "1", "subject_kinds": ["instrument", "listing"], **self.policies.get(provider, {}),
                 "operations": [{"operation": op, "tool": f"{provider}_{op}", "effect": "read"} for op in ("search", "details", "series", "latest", "history")]},
                 "operations": [{"operation": op, "tool": f"{provider}_{op}", "effect": "read", "available": self.ready[provider], "parameters": {}}
                                for op in ("search", "details", "series", "latest", "history")]}
                for provider in self.providers], False

    def call(self, provider, operation, arguments):
        self.calls.append((provider, operation, copy.deepcopy(arguments)))
        if (provider, operation) in self.fail:
            return {"schema_version": 1, "outcome": "error", "data": None,
                    "issues": [{"code": "synthetic_failure", "message": "Synthetic source failure.", "severity": "error"}]}
        if operation in ("search", "details"):
            ref = self.refs[provider]
            records = evidence(ref, standard=isin(31), listing=True, version="1")
            return {"schema_version": 1, "outcome": "ok", "data": [{"provider_ref": ref, "evidence": records, "issues": []}], "issues": []}
        if operation == "series":
            return {"schema_version": 1, "outcome": "ok", "data": copy.deepcopy(self.definitions[provider]), "issues": []}
        selected = next(value for value in self.definitions[provider] if value["source_detail"]["values"]["read_selector"] == arguments["source_selector"])
        result = copy.deepcopy(EXAMPLE)
        result.update(request=arguments["request"], series=copy.deepcopy(selected))
        result["selection"].update(view=arguments["request"]["view"], reason="pinned")
        result["provenance"].update(provider=provider, native_ref=self.refs[provider], adapter_version="1")
        result["freshness"]["market_data_type"] = "unknown"
        if self.read_transform:
            result = self.read_transform(result)
        if self.after_read:
            self.after_read()
        return result

    def backend(self, directory, canonical=True, **kwargs):
        store = ProvenIdentity(directory, self) if canonical else identity.IdentityStore(directory)
        return Backend(directory, identity=store, source_call=self.call, source_projection=self.project,
                       access_scope=lambda: self.access, **kwargs)


class ProvenIdentity(identity.IdentityStore):
    def __init__(self, directory, sources):
        super().__init__(directory)
        self.sources = sources
        self.extra = []

    def bindings(self, subject):
        if subject != SUBJECT:
            return super().bindings(subject)
        mappings = [{"schema_version": 1, "id": "mapping:" + provider, "provider_ref": ref,
                     "target": SUBJECT, "status": "confirmed", "evidence_ids": ["evidence:synthetic-proof"],
                     "rule_version": "synthetic:1", "revision": 1, "active_override": None}
                    for provider, ref in self.sources.refs.items()]
        return {"generation": self.cache_token(), "mappings": mappings + self.extra}


def request(view=None, requirements=None):
    result = copy.deepcopy(EXAMPLE["request"])
    result["view"] = view or {"kind": "pythia", "subject": SUBJECT}
    if requirements:
        result["requirements"].update(requirements)
    return result


def run_read(backend, descriptor=None, *, read_request=None, criteria=None):
    message = {"action": "read", "request": read_request or request(), "criteria": CRITERIA if criteria is None else criteria}
    if descriptor is not None:
        message["series"] = descriptor
    return backend.handle(message)
