"""`just check`: no rule compares a source, plugin or provider name with a literal (ADR 0044, A2; ADR 0042).

Scans the builder's deciding modules and core's `identity/*.py`. The adapters and the audits may know their own
source. A lookup keyed by provider (`LABELS`, `ALIASES`), a provenance assignment, and membership in a record named
`source` are no comparison, so they pass. Rules test a row's kind of evidence (`model.Evidence`) or trust instead.
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BUILDER = ROOT / "tooling" / "reference-builder" / "reference_builder"
CORE = ROOT / "runtime" / "managed" / "core" / "identity"
DECIDING = ("assemble", "claims", "linking", "pipeline", "receipts", "reconcile", "rules", "schema")
NAMED = frozenset({"source", "plugin", "provider"})


def _named(node: ast.AST) -> bool:
    return (isinstance(node, ast.Attribute) and node.attr in NAMED or isinstance(node, ast.Name) and node.id in NAMED
            or isinstance(node, ast.Subscript) and isinstance(node.slice, ast.Constant) and node.slice.value in NAMED)


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
        if isinstance(node, ast.Compare):
            left = node.left
            for op, right in zip(node.ops, node.comparators):
                membership = isinstance(op, (ast.In, ast.NotIn))  # `"x" in source` reads a record, names nothing
                if _named(left) and _literal(right) or not membership and _named(right) and _literal(left):
                    found.append(f"{path.relative_to(ROOT)}:{node.lineno}: {ast.unparse(node)}")
                left = right
    return found


def main() -> int:
    found = [hit for path in [BUILDER / f"{name}.py" for name in DECIDING] + sorted(CORE.glob("*.py"))
             for hit in name_comparisons(path)]
    for hit in found:
        print(f"{hit}\n  a rule names a source: test the row's kind of evidence or its trust level instead", file=sys.stderr)
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
