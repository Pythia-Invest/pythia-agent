"""Shared source selection/cache regressions; source fixtures are synthetic only."""
import copy
from contextlib import closing
import json
import os
from pathlib import Path
import sys
from types import SimpleNamespace
from unittest.mock import patch
from importlib import import_module
import sqlite3
import tempfile
import unittest

from market_data_read_fixtures import Backend, CRITERIA, Sources, SUBJECT, read_module, request, run_read, wire
from market_data_fixture import native


class SharedReadsTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.sources = Sources()
        self.backend = self.sources.backend(self.directory.name)

    def price_calls(self):
        return [call for call in self.sources.calls if call[1] in ("latest", "history")]

    def test_retired_source_choice_actions_are_unknown(self):
        for action in ("get_preferences", "set_preferences"):
            with self.assertRaises(wire.WireError):
                self.backend.handle({"action": action})

    def test_window_compatibility_is_checked_before_observation_execution(self):
        self.sources.definitions["ibkr"][0]["read_support"] = {"operations": ["history"], "window_kind": "instant"}
        value = run_read(self.backend)
        self.assertEqual(value["provenance"]["provider"], "synthetic_other")
        self.assertEqual([provider for provider, _, _ in self.price_calls()], ["synthetic_other"])

    def test_a_utc_daily_series_serves_a_dated_window_as_whole_utc_days(self):
        series = copy.deepcopy(self.sources.definitions["ibkr"][0])
        series.update(timezone="UTC", read_support={"operations": ["history"], "window_kind": "instant", "max_span_seconds": 367 * 86400})
        dated = request()
        # A date-to-date year across 29 February.
        dated["window"] = {"start": {"kind": "session_date", "value": "2027-09-28"}, "end": {"kind": "session_date", "value": "2028-09-28"}}
        days = read_module.utc_days(dated, series)
        self.assertEqual(days["window"], {"start": {"kind": "instant", "value": "2027-09-28T00:00:00+00:00"},
                                          "end": {"kind": "instant", "value": "2028-09-28T23:59:59+00:00"}})
        self.assertTrue(read_module.supports_read(series, days))
        # Exchange-dated series keep their session dates.
        self.assertIs(read_module.utc_days(dated, {**series, "timezone": "America/New_York"}), dated)

    def test_coordinated_reads_deduplicate_and_reuse_qualified_metadata(self):
        item = {"request": request(), "criteria": CRITERIA}
        results = self.backend.handle({"action": "read_many", "reads": [item, item]})["data"]
        self.assertEqual(results[0], results[1])
        self.assertEqual(len(self.price_calls()), 1)
        self.assertEqual(len([call for call in self.sources.calls if call[1] == "series"]), 1)
        again = self.backend.handle({"action": "read_many", "reads": [item]})["data"][0]
        self.assertEqual(again, results[0])
        self.assertEqual(len(self.sources.calls), 2)
        self.sources.access["connection"] = "different-access"
        self.backend.handle({"action": "read_many", "reads": [item]})
        self.assertEqual(len(self.sources.calls), 4)

    def test_batch_dispatch_preserves_per_item_failure_without_substitution(self):
        original_project = self.sources.project
        def project():
            sources, invalid = original_project()
            for source in sources:
                source["operations"].append({"operation": "read_batch", "available": True})
            return sources, invalid
        self.backend._project = project
        batches = []
        original_call = self.sources.call
        def call(provider, operation, arguments):
            if operation != "read_batch": return original_call(provider, operation, arguments)
            batches.append((provider, arguments))
            return {"schema_version": 1, "outcome": "error", "data": None, "issues": [{"code": "access_denied", "severity": "error", "message": "Synthetic entitlement denial."}]}
        self.backend._call = call
        item = {"request": request(), "criteria": CRITERIA}
        results = self.backend.handle({"action": "read_many", "reads": [item, item]})["data"]
        self.assertEqual([row["outcome"] for row in results], ["error", "error"])
        self.assertEqual([row[0] for row in batches], ["ibkr"])
        self.assertEqual(len(batches[0][1]["reads"]), 1)
        self.assertIn("access_denied", [issue["code"] for issue in results[0]["issues"]])
        self.assertEqual(self.price_calls(), [])

    def test_close_criteria_preserve_measurement_distinction(self):
        selection = import_module(f"{wire.__package__}.selection")
        series = self.sources.definition("ibkr", "close")
        series.update(measurement="close", shape="scalar", fields={"value": series["fields"]["close"]})
        wire.validate("series", series)
        self.assertTrue(selection.matches(series, {"measurement": "close", "currency": "USD"}))
        self.assertFalse(selection.matches(series, {"measurement": "last_trade"}))
        self.assertFalse(selection.matches(series, {"measurement": "ohlc"}))

    def test_native_batch_limit_and_observation_budget_preserve_all_valid_reads(self):
        schema = {"type": "object", "additionalProperties": False, "required": ["reads"], "properties": {
            "reads": {"type": "array", "minItems": 1, "maxItems": 2, "items": {
                "type": "object", "additionalProperties": False, "required": ["request", "source_selector"],
                "properties": {"request": wire.parameter_schema("read_request"), "source_selector": {"type": "string"}}}}}}
        original_project, original_call = self.sources.project, self.sources.call
        batches = []
        def project():
            sources, invalid = original_project()
            for source in sources:
                source["operations"].append({"operation": "read_batch", "available": True, "parameters": schema})
            return sources, invalid
        def call(provider, operation, arguments):
            if operation != "read_batch": return original_call(provider, operation, arguments)
            # Model the admitted native schema, not a permissive batch mock.
            wire.validate_parameters(schema, arguments)
            batches.append([item["request"]["limit"] for item in arguments["reads"]])
            return {"schema_version": 1, "outcome": "ok", "issues": [], "data": [
                original_call(provider, item["request"]["operation"], item) for item in arguments["reads"]]}
        self.backend._project, self.backend._call = project, call
        for limits, expected in (([3, 4, 5], [[3, 4], [5]]), ([1100, 1200, 1300], [[1100], [1200], [1300]])):
            with self.subTest(limits=limits):
                batches.clear()
                items = [{"request": {**request(), "limit": limit}, "criteria": CRITERIA} for limit in limits]
                results = self.backend.handle({"action": "read_many", "reads": [*items, items[0]]})["data"]
                self.assertEqual(batches, expected)
                self.assertEqual([row["outcome"] for row in results], ["ok"] * 4)
                self.assertEqual([row["request"]["limit"] for row in results], [*limits, limits[0]])
                self.assertEqual(results[0], results[-1])

    def test_compatibility_is_checked_before_committing_to_preferred_source(self):
        self.sources.definitions["ibkr"][0]["session"] = "extended"
        result = run_read(self.backend)
        self.assertEqual(result["series"]["provider_ref"]["provider"], "synthetic_other")
        self.assertEqual([(provider, op) for provider, op, _ in self.sources.calls],
                         [("ibkr", "series"), ("synthetic_other", "series"), ("synthetic_other", "history")])
        # A failed read is never reinterpreted as proof of incompatibility.
        self.sources.calls.clear()
        self.sources.fail.add(("synthetic_other", "history"))
        self.backend.cache.entries.clear()
        failed = run_read(self.backend)
        self.assertEqual(failed["outcome"], "error")
        self.assertEqual([(provider, op) for provider, op, _ in self.price_calls()], [("synthetic_other", "history")])

    def test_broker_requires_explicit_intent_for_reads_and_discovery(self):
        self.sources.policies["ibkr"] = {"requires_broker_app": True}
        result = run_read(self.backend)
        self.assertEqual(result["series"]["provider_ref"]["provider"], "synthetic_other")
        self.assertTrue(all(call[0] == "synthetic_other" for call in self.sources.calls))
        self.sources.calls.clear()
        found = self.backend.series(SUBJECT, CRITERIA)
        self.assertEqual([item["provider_ref"]["provider"] for item in found["data"]], ["synthetic_other"])
        self.assertTrue(all(call[0] == "synthetic_other" for call in self.sources.calls))
        self.sources.ready["synthetic_other"] = False
        self.sources.calls.clear()
        self.assertEqual(run_read(self.backend)["issues"][0]["code"], "explicit_source_required")
        self.assertEqual(self.sources.calls, [])
        native = self.sources.refs["ibkr"]
        direct = run_read(self.backend, read_request=request({"kind": "pythia", "subject": native}))
        self.assertEqual(direct["outcome"], "ok")
        self.assertEqual(self.backend.series(native, CRITERIA)["data"][0]["provider_ref"], native)
        pinned = run_read(self.backend, direct["series"], read_request=request({"kind": "source", "series_id": direct["series"]["id"]}))
        self.assertEqual(pinned["outcome"], "ok")

    def test_a_broker_source_the_investor_names_serves_subject_reads_as_it_serves_the_page(self):
        self.sources.policies["ibkr"] = {"requires_broker_app": True}
        self.sources.named = ["ibkr"]  # source_order = ibkr: core puts it first and the page reads it
        self.assertEqual(run_read(self.backend)["provenance"]["provider"], "ibkr")
        self.assertEqual([item["provider_ref"]["provider"] for item in self.backend.series(SUBJECT, CRITERIA)["data"]],
                         ["ibkr", "synthetic_other"])

    def test_metadata_and_generic_read_failures_preserve_safe_source_issues(self):
        issue = {"code": "broker_unreachable", "message": "Check the configured broker endpoint.", "severity": "error", "source_code": "502"}
        for operation in ("series", "history"):
            original = self.sources.call
            def call(provider, op, arguments):
                if op == operation:
                    return {"schema_version": 1, "outcome": "error", "data": None, "issues": [issue]}
                return original(provider, op, arguments)
            self.backend._call = call
            result = run_read(self.backend)
            self.assertEqual(result["outcome"], "error")
            self.assertIn(issue, result["issues"])
            self.assertTrue(all(item[0] == "ibkr" for item in self.sources.calls))

    def test_source_cache_policy_bypasses_existing_hits_and_publication(self):
        run_read(self.backend)
        self.assertEqual(len(self.price_calls()), 1)
        self.sources.policies["ibkr"] = {"observation_cache": "disabled"}
        for _ in range(2):
            self.assertEqual(run_read(self.backend)["outcome"], "ok")
        self.assertEqual(len(self.price_calls()), 3)
        self.backend.cache.entries.clear()
        run_read(self.backend)
        self.assertEqual(len(self.backend.cache.entries), 0)
        self.sources.order("synthetic_other", "ibkr")
        run_read(self.backend)
        run_read(self.backend)
        self.assertEqual(len([call for call in self.price_calls() if call[0] == "synthetic_other"]), 1)

    def test_a_subject_read_needs_no_saved_choice(self):
        with tempfile.TemporaryDirectory() as directory:
            sources = Sources()
            sources.providers = ("ibkr",)
            backend = sources.backend(directory)
            first = run_read(backend)
            self.assertEqual(first["outcome"], "ok")
            self.assertEqual(first["series"]["subject"], SUBJECT)
            self.assertEqual(first["selection"]["reason"], "preference")
            self.assertNotIn("preference_revision", first["selection"])
            wire.validate_read_result(first)
            self.assertEqual(run_read(backend), first)
            self.assertEqual(len([call for call in sources.calls if call[1] == "history"]), 1)

    def test_reads_follow_cores_later_order_and_pinned_descriptor_survives_restart(self):
        first = run_read(self.backend)
        retained = copy.deepcopy(first)
        self.assertEqual(first["series"]["provider_ref"]["provider"], "ibkr")
        self.assertEqual(first["series"]["subject"], SUBJECT)
        self.sources.order("synthetic_other", "ibkr")
        second = run_read(self.backend)
        self.assertEqual(second["series"]["provider_ref"]["provider"], "synthetic_other")
        self.assertEqual(first, retained)
        descriptor = retained["series"]
        restarted = self.sources.backend(self.directory.name)
        pinned = run_read(restarted, descriptor, read_request=request({"kind": "source", "series_id": descriptor["id"]}))
        self.assertEqual(pinned["series"]["id"], retained["series"]["id"])
        self.assertEqual(pinned["series"]["subject"], self.sources.refs["ibkr"])
        self.assertEqual(pinned["selection"]["reason"], "pinned")
        self.assertEqual([call[0] for call in self.price_calls()], ["ibkr", "synthetic_other", "ibkr"])
        wire.validate_read_result(pinned)

    def test_selected_source_failure_never_reads_backup_metadata_or_prices(self):
        for failed_operation in ("series", "history"):
            self.sources.calls.clear()
            self.sources.fail = {("ibkr", failed_operation)}
            result = run_read(self.backend)
            self.assertEqual(result["outcome"], "error")
            self.assertTrue(all(call[0] == "ibkr" for call in self.sources.calls))
            self.assertEqual(result["selection"]["alternatives"], ["provider:synthetic_other"])
            self.assertIn("ibkr", result["issues"][0]["message"])
            self.assertEqual(result["observations"], [])

    def test_series_ambiguity_and_qualifiers_do_not_choose_arbitrary_listing(self):
        extra = self.sources.definition("ibkr", "second-route")
        extra["route"] = "DIRECT"
        self.sources.definitions["ibkr"].append(extra)
        result = run_read(self.backend)
        self.assertEqual(result["issues"][0]["code"], "ambiguous_series")
        self.assertEqual(self.price_calls(), [])
        narrowed = run_read(self.backend, criteria={**CRITERIA, "route": "SMART"})
        self.assertEqual(narrowed["series"]["id"], self.sources.definitions["ibkr"][0]["id"])
        self.sources.calls.clear()
        result = run_read(self.backend)
        self.assertEqual(result["issues"][0]["code"], "ambiguous_series")
        self.assertEqual(self.sources.calls, [])

    def test_too_many_bindings_fail_before_any_subset_is_queried(self):
        self.sources.extra = [native(400 + index) for index in range(8)]
        result = run_read(self.backend)
        self.assertEqual(result["issues"][0]["code"], "ambiguous_series")
        self.assertEqual(self.sources.calls, [])

    def test_native_view_needs_no_mapping_and_caller_descriptor_is_not_authority(self):
        backend = self.sources.backend(self.directory.name, canonical=False)
        self.sources.ready["synthetic_other"] = False
        native_request = request({"kind": "pythia", "subject": self.sources.refs["ibkr"]})
        result = run_read(backend, read_request=native_request)
        self.assertEqual(result["series"]["subject"], self.sources.refs["ibkr"])
        descriptor = copy.deepcopy(result["series"])
        descriptor["fields"]["close"]["unit"]["scale"] = "100"
        # Keep OHLC fields internally consistent, while tampering with intent.
        for field in ("open", "high", "low"):
            descriptor["fields"][field] = copy.deepcopy(descriptor["fields"]["close"])
        changed = run_read(backend, descriptor, read_request=request({"kind": "source", "series_id": descriptor["id"]}))
        self.assertEqual(changed["issues"][0]["code"], "invalid_response")

    def test_explicit_reference_may_omit_qualifiers_the_source_adds(self):
        # A page binding derived from open identifiers (ticker + MIC) carries no
        # venue or currency; the source's own series still answers it.
        backend = self.sources.backend(self.directory.name, canonical=False)
        self.sources.ready["synthetic_other"] = False
        qualified = self.sources.refs["ibkr"]
        bare = {key: value for key, value in qualified.items() if key != "qualifiers"}
        result = run_read(backend, read_request=request({"kind": "pythia", "subject": bare}))
        self.assertEqual(result["outcome"], "ok")
        self.assertEqual(result["series"]["provider_ref"], qualified)
        # Every qualifier the reference does carry must still match.
        other = {**bare, "qualifiers": {**qualified["qualifiers"], "venue": "VENUE_B"}}
        result = run_read(backend, read_request=request({"kind": "pythia", "subject": other}))
        self.assertEqual(result["issues"][0]["code"], "invalid_response")

    def test_cache_hit_rechecks_availability_config_and_caller_scope(self):
        descriptor = self.sources.definitions["ibkr"][0]
        pinned_request = request({"kind": "source", "series_id": descriptor["id"]})
        first = run_read(self.backend, descriptor, read_request=pinned_request)
        self.assertEqual(run_read(self.backend, descriptor, read_request=pinned_request), first)
        self.assertEqual(len(self.price_calls()), 1)
        self.sources.access["connection"] = "endpoint-b"  # readiness stays true
        run_read(self.backend, descriptor, read_request=pinned_request)
        self.assertEqual(len(self.price_calls()), 2)
        self.sources.access["platform"] = "cli"
        run_read(self.backend, descriptor, read_request=pinned_request)
        self.assertEqual(len(self.price_calls()), 3)
        self.sources.ready["ibkr"] = False
        result = run_read(self.backend, descriptor, read_request=pinned_request)
        self.assertEqual(result["issues"][0]["code"], "unavailable")
        self.assertEqual(len(self.price_calls()), 3)

    def test_canonical_secret_replacement_invalidates_cache_and_inflight_read(self):
        selection = import_module(f"{wire.__package__}.selection")
        with tempfile.TemporaryDirectory() as root:
            store = Path(root) / "secrets.json"
            store.write_text('{"synthetic":"first"}')
            store.chmod(0o600)
            modules = {"gateway.session_context": SimpleNamespace(get_session_env=lambda *_: "api_server"),
                       "hermes_cli.config": SimpleNamespace(load_config_readonly=lambda: {"endpoint": "unchanged"})}
            with patch.dict(os.environ, {"PYTHIA_CONFIG_ROOT": root}), patch.dict(sys.modules, modules):
                self.backend._access_scope = selection.native_access_scope
                with patch.object(Path, "open", side_effect=AssertionError("Secret contents must not be opened")):
                    self.assertTrue(selection.native_access_scope()["cacheable"])
                first = run_read(self.backend)
                self.assertEqual(run_read(self.backend), first)
                self.assertEqual(len(self.price_calls()), 1)
                old = store.stat()
                def rotate():
                    replacement = Path(root) / "replacement"
                    replacement.write_text('{"synthetic":"other"}')
                    replacement.chmod(0o600)
                    os.utime(replacement, ns=(old.st_atime_ns, old.st_mtime_ns))
                    replacement.replace(store)
                rotate()
                self.assertEqual(store.stat().st_size, old.st_size)
                self.assertEqual(store.stat().st_mtime_ns, old.st_mtime_ns)
                rotated = run_read(self.backend)
                self.assertEqual(rotated["outcome"], "ok")
                self.assertEqual(len(self.price_calls()), 2)
                self.backend.cache.entries.clear()
                self.sources.after_read = rotate
                changed = run_read(self.backend)
                self.assertEqual(changed["issues"][0]["code"], "selection_changed")
                self.assertEqual(len(self.backend.cache.entries), 0)
                access = self.backend.context()[1]["fingerprint"]
                serialized = json.dumps([first, rotated, changed])
                self.assertNotIn(access, serialized)
                self.assertNotIn(root, serialized)
                for file in Path(self.directory.name).iterdir():
                    if file.is_file():
                        self.assertNotIn(access.encode(), file.read_bytes())
                        self.assertNotIn(b'"synthetic":"other"', file.read_bytes())

    def test_unsafe_or_missing_secret_revision_bypasses_cache_without_blocking_reads(self):
        selection = import_module(f"{wire.__package__}.selection")
        with tempfile.TemporaryDirectory() as root:
            store = Path(root) / "secrets.json"
            modules = {"gateway.session_context": SimpleNamespace(get_session_env=lambda *_: "api_server"),
                       "hermes_cli.config": SimpleNamespace(load_config_readonly=lambda: {})}
            with patch.dict(os.environ, {"PYTHIA_CONFIG_ROOT": root}), patch.dict(sys.modules, modules):
                self.backend._access_scope = selection.native_access_scope
                for state in ("missing", "public_file", "unreadable", "symlink", "directory", "public_root"):
                    with self.subTest(state=state):
                        if state == "directory":
                            store.mkdir()
                        elif state == "symlink":
                            store.symlink_to(Path(root) / "unread-target")
                        elif state != "missing":
                            store.write_text("synthetic-only")
                            store.chmod(0 if state == "unreadable" else 0o644 if state == "public_file" else 0o600)
                        if state == "public_root":
                            Path(root).chmod(0o755)
                        before = len(self.price_calls())
                        self.assertFalse(self.backend.context()[1]["cacheable"])
                        self.assertEqual(run_read(self.backend)["outcome"], "ok")
                        self.assertEqual(run_read(self.backend)["outcome"], "ok")
                        self.assertEqual(len(self.price_calls()), before + 2)
                        self.assertEqual(len(self.backend.cache.entries), 0)
                        Path(root).chmod(0o700)
                        if store.is_dir():
                            store.rmdir()
                        elif store.exists() or store.is_symlink():
                            store.unlink()
                with patch.object(Path, "lstat", side_effect=PermissionError):
                    self.assertIsNone(selection.canonical_access_revision())

    def test_access_change_during_read_rejects_stale_cache_publication(self):
        sources = Sources()
        with tempfile.TemporaryDirectory() as directory:
            backend = sources.backend(directory)
            sources.after_read = lambda: sources.access.update(connection="new-endpoint")
            result = run_read(backend)
            self.assertEqual(result["issues"][0]["code"], "selection_changed")
            self.assertEqual(len(backend.cache.entries), 0)
            self.assertTrue(all(call[0] == "ibkr" for call in sources.calls))

    def test_completed_only_filters_partial_bars_without_false_freshness(self):
        def mixed(result):
            result["observations"][0]["completion"] = {"state": "completed", "basis": "source"}
            result["outcome"] = "partial"
            result["requirements_satisfied"] = False
            result["issues"] = [{"code": "synthetic_partial", "message": "Synthetic unproven period.", "severity": "warning"}]
            return result
        self.sources.read_transform = mixed
        result = run_read(self.backend, read_request=request(requirements={"completion": "completed"}))
        self.assertEqual(result["outcome"], "partial")
        self.assertEqual(len(result["observations"]), 1)
        self.assertTrue(result["requirements_satisfied"])
        self.assertEqual(result["freshness"]["status"], "unknown")
        self.assertEqual(result["coverage"]["status"], "partial")
        self.assertEqual([call[0] for call in self.price_calls()], ["ibkr"])


class BackendMutationTests(unittest.TestCase):
    def test_a_subject_core_does_not_route_is_unresolved_without_source_calls(self):
        with tempfile.TemporaryDirectory() as directory:
            sources = Sources()
            for reason, words in ((None, "No installed source"), ("unknown_subject", "pythia_identity_search"),
                                  ("no_reference_data", "no readable reference data"), ("core_unavailable", "not loaded")):
                backend = Backend(directory, subjects=lambda _id, reason=reason: {"refs": [], "reason": reason},
                                  source_call=sources.call, source_projection=sources.project, access_scope=lambda: sources.access)
                issue = run_read(backend)["issues"][0]
                self.assertEqual(issue["code"], "unresolved_identity")
                self.assertIn(words, issue["message"])
            issuer = {"kind": "issuer", "id": "issuer:lei:" + "A" * 18 + "00"}
            result = run_read(sources.backend(directory), read_request=request({"kind": "pythia", "subject": issuer}))
            self.assertEqual(result["issues"][0]["code"], "issuer_subject")
            self.assertEqual(sources.backend(directory).handle({"action": "series", "binding": issuer})["issues"][0]["code"],
                             "issuer_subject")
            self.assertEqual(sources.calls, [])
            with self.assertRaises(wire.WireError):  # retired subject kinds are not subjects
                run_read(sources.backend(directory), read_request=request({"kind": "pythia", "subject": {"kind": "instrument", "id": "instrument:x"}}))

    def choices_file(self, path, scoped_kind):
        os.chmod(path.parent, 0o700)
        with closing(sqlite3.connect(path)) as db, db:
            db.executescript("""CREATE TABLE source_preferences (operation TEXT PRIMARY KEY, providers TEXT NOT NULL);
                CREATE TABLE scoped_source_preferences (operation TEXT NOT NULL, scope TEXT NOT NULL,
                  providers TEXT NOT NULL, PRIMARY KEY(operation, scope));""")
            db.execute("INSERT INTO source_preferences VALUES ('history', '[\"synthetic_other\"]')")
            db.execute("INSERT INTO scoped_source_preferences VALUES ('latest', ?, '[\"coingecko\"]')",
                       (json.dumps({scoped_kind: "crypto"}),))
        path.chmod(0o600)
        return path

    def test_former_source_choices_are_set_aside_once_logged_and_not_applied(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = self.choices_file(root / "preferences.sqlite3", "asset_class")
            legacy = self.choices_file(root / "identity.sqlite3", "subject_kind")
            sources = Sources()
            with self.assertLogs(level="WARNING") as logged:
                backend = sources.backend(directory)
            self.assertEqual(len(logged.output), 2)
            self.assertIn("source_order in settings.json", logged.output[0])
            self.assertIn("{'history': ['synthetic_other']} and 1 scoped", logged.output[0])
            self.assertFalse(store.exists() or legacy.exists())  # kept under a new name, never deleted
            self.assertTrue((root / "preferences-retired.sqlite3").is_file())
            self.assertTrue((root / "identity-retired.sqlite3").is_file())
            self.assertEqual(run_read(backend)["provenance"]["provider"], "ibkr")  # core's order, not the old choice
            with self.assertNoLogs(level="WARNING"):
                sources.backend(directory)
            # An empty store (every device's, in practice) is set aside without a warning.
            empty = root / "empty"
            empty.mkdir(mode=0o700)
            with closing(sqlite3.connect(empty / "preferences.sqlite3")) as db:
                db.execute("CREATE TABLE source_preferences (operation TEXT PRIMARY KEY, providers TEXT NOT NULL)")
            with self.assertNoLogs(level="WARNING"):
                sources.backend(str(empty))
            self.assertTrue((empty / "preferences-retired.sqlite3").is_file())
            # A file set aside earlier is never overwritten.
            self.choices_file(root / "identity.sqlite3", "subject_kind")
            with self.assertNoLogs(level="WARNING"):
                sources.backend(directory)
            self.assertTrue((root / "identity.sqlite3").is_file())

    def test_cache_bounds_expiry_detached_values_and_strict_fresh_bypass(self):
        from importlib import import_module
        from market_data_fixture import PACKAGE
        cache_type = import_module(f"{PACKAGE}.cache").ReadCache
        clock = [0]
        cache = cache_type(max_entries=1, max_bytes=1000, ttl_seconds=2, clock=lambda: clock[0])
        cache.put("a", {"value": "1.000"})
        detached = cache.get("a")
        detached["value"] = "changed"
        self.assertEqual(cache.get("a"), {"value": "1.000"})
        cache.put("b", {"value": "2"})
        self.assertIsNone(cache.get("a"))
        clock[0] = 2
        self.assertIsNone(cache.get("b"))
        cache.put("large", {"value": "x" * 2000})
        self.assertIsNone(cache.get("large"))
        with tempfile.TemporaryDirectory() as directory:
            sources = Sources()
            backend = sources.backend(directory)
            def unknown_freshness(result):
                result["outcome"] = "partial"
                result["requirements_satisfied"] = False
                result["issues"] = [{"code": "freshness_unknown", "message": "Synthetic unknown freshness.", "severity": "warning"}]
                return result
            sources.read_transform = unknown_freshness
            for _ in range(2):
                result = run_read(backend, read_request=request(requirements={"freshness": "fresh"}))
                self.assertFalse(result["requirements_satisfied"])
            self.assertEqual(len([c for c in sources.calls if c[1] == "history"]), 2)
            self.assertEqual(len(backend.cache.entries), 0)


if __name__ == "__main__":
    unittest.main()
