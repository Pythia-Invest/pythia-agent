"""`just check`: no rule compares a field named source, plugin or provider with a literal (ADR 0044, A2; ADR 0042).

Scans every builder module except the adapters and audits named below, which may know their own source, and core's
`identity/*.py`. It catches `x.source == "sec"`, `row["plugin"] in (...)`, `row.get("provider") != SEC` and a
`match` on such a field with a string case. A lookup keyed by provider (`LABELS`, `ALIASES`), a provenance
assignment, and membership in a record named `source` are no comparison, so they pass. Rules test a row's kind of
evidence (`model.Evidence`) or trust instead. Core's plugin trust follows a digest of the plugin's files, never its
name (`identity/trust.py`).
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BUILDER = ROOT / "tooling" / "reference-builder" / "reference_builder"
CORE = ROOT / "runtime" / "managed" / "core" / "identity"
ADAPTERS = {"fetch", "firds", "gleif", "mic", "openfigi", "sec", "sec_evidence", "sec_probe"}
AUDITS = {"drift", "firds_audit", "invariant_checks", "invariant_names", "invariants", "read_checks", "sec_audit",
          "source_drift", "truth", "truth_report"}
NAMED = frozenset({"source", "plugin", "provider"})


def _key(node: ast.AST) -> bool:
    return isinstance(node, ast.Constant) and node.value in NAMED


def _named(node: ast.AST) -> bool:
    """`x.source`, `source`, `x["source"]` or `x.get("source", ...)`."""
    return (isinstance(node, ast.Attribute) and node.attr in NAMED or isinstance(node, ast.Name) and node.id in NAMED
            or isinstance(node, ast.Subscript) and _key(node.slice)
            or isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "get"
            and bool(node.args) and _key(node.args[0]))


def _literal(node: ast.AST) -> bool:
    """A string, a collection of strings, or a constant's name (`firds.SOURCE`)."""
    if isinstance(node, ast.Constant):
        return isinstance(node.value, str)
    if isinstance(node, (ast.Tuple, ast.List, ast.Set)):
        return bool(node.elts) and all(_literal(item) for item in node.elts)
    name = node.id if isinstance(node, ast.Name) else node.attr if isinstance(node, ast.Attribute) else ""
    return name.isupper()


def name_comparisons(path: Path) -> list[str]:
    found = []
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        hit = False
        if isinstance(node, ast.Compare):
            left = node.left
            for op, right in zip(node.ops, node.comparators):
                membership = isinstance(op, (ast.In, ast.NotIn))  # `"x" in source` reads a record, names nothing
                hit = hit or _named(left) and _literal(right) or not membership and _named(right) and _literal(left)
                left = right
        elif isinstance(node, ast.Match) and _named(node.subject):
            hit = any(isinstance(p, ast.MatchValue) and _literal(p.value)
                      for case in node.cases for p in ast.walk(case.pattern))
        if hit:
            found.append(f"{path.relative_to(ROOT)}:{node.lineno}: {ast.unparse(node).splitlines()[0]}")
    return found


def scanned() -> list[Path]:
    return [path for path in sorted(BUILDER.glob("*.py")) if path.stem not in ADAPTERS | AUDITS] + sorted(CORE.glob("*.py"))


def main() -> int:
    found = [hit for path in scanned() for hit in name_comparisons(path)]
    for hit in found:
        print(f"{hit}\n  a rule names a source: test the row's kind of evidence or its trust level instead", file=sys.stderr)
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
