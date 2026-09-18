"""Bounded native read coordination, shared by the agent, HTTP and CLI.

Connectors opt into read_batch through their existing native contribution.
Otherwise independent reads run with bounded concurrency. No source retry,
substitution, discovery registry, or observation archive is introduced.
"""
from concurrent.futures import ThreadPoolExecutor
from contextvars import copy_context, ContextVar

from .reads import prepare_read
from .selection import CRITERIA, fingerprint
from .wire import require, validate, validate_parameters, validate_read_result

_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix='pythia-read-group')
_inside = ContextVar('pythia_parallel_read', default=False)


def validate_input(item):
    require(type(item) is dict and {"request"} <= set(item) <= {"request", "criteria", "series"}, "reads", "invalid read fields")
    validate("read_request", item["request"])
    validate_parameters(CRITERIA, item.get("criteria", {}))
    if "series" in item:
        validate("series", item["series"])
    return item


def parallel(function, values):
    if _inside.get():
        return [function(value) for value in values]
    def call(value):
        token = _inside.set(True)
        try: return function(value)
        finally: _inside.reset(token)
    tasks = [_pool.submit(copy_context().run, call, value) for value in values]
    return [task.result() for task in tasks]


def read_many(backend, items):
    require(type(items) is list and 1 <= len(items) <= 32, "reads", "expected one to 32 reads")
    for item in items:
        validate_input(item)
    keys = [fingerprint(item) for item in items]
    unique = dict(zip(keys, items))
    results, plans, groups = {}, {}, {}

    def prepare(pair):
        key, item = pair
        plan = prepare_read(backend, item["request"], item.get("criteria", {}), item.get("series"))
        try:
            execution = next(plan)
            return key, plan, execution, None
        except StopIteration as done:
            return key, None, None, done.value

    for key, plan, execution, result in parallel(prepare, list(unique.items())):
        if plan is None:
            results[key] = result
        else:
            plans[key] = plan
            provider, operation, arguments = execution
            native_key = fingerprint(arguments)
            groups.setdefault((provider, operation), {}).setdefault(native_key, {"arguments": arguments, "keys": []})["keys"].append(key)
    sources, _ = backend.context()

    def execute(group):
        (provider, operation), entries = group
        entries = list(entries.values())
        batch = next((op for source in sources if source["contribution"]["provider"] == provider
                      for op in source["operations"] if op["operation"] == "read_batch" and op["available"]), None)
        if batch is not None:
            # The native argument limit and response budget are independent.
            # Respect both without truncating requested windows or observations.
            declared = batch.get("parameters", {}).get("properties", {}).get("reads", {}).get("maxItems", 32)
            maximum = min(32, declared) if type(declared) is int and declared > 0 else 32
            chunks, chunk, count = [], [], 0
            for entry in entries:
                limit = entry["arguments"]["request"]["limit"]
                if chunk and (len(chunk) >= maximum or count + limit > 2000):
                    chunks.append(chunk)
                    chunk, count = [], 0
                chunk.append(entry)
                count += limit
            chunks.append(chunk)
            rows = []
            for chunk in chunks:
                response = backend.source(provider, "read_batch", {"reads": [entry["arguments"] for entry in chunk]})
                data = response.get("data")
                rows.extend(data if isinstance(data, list) and len(data) == len(chunk) else [response] * len(chunk))
        else:
            rows = [backend.source(provider, operation, entry["arguments"]) for entry in entries]
        return [(key, raw) for entry, raw in zip(entries, rows) for key in entry["keys"]]

    for group in parallel(execute, list(groups.items())):
        for key, raw in group:
            try:
                plans[key].send(raw)
            except StopIteration as done:
                results[key] = validate_read_result(done.value)
    return [results[key] for key in keys]
