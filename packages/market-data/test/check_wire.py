"""Provider-free structural/semantic fixture validation; emits lossless values for TS."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "runtime/managed/plugins/market-data"))
from wire import WireError, encode, validate, validate_parameters, parameter_schema
from wire_schema import schema

examples = ROOT / "packages/market-data/examples"
valid = json.loads((examples / "valid.json").read_text())
invalid = json.loads((examples / "invalid.json").read_text())
assert json.loads((examples.parent / "schema.json").read_text()) == schema()
for fixture in valid:
    value = validate(fixture["kind"], fixture["value"])
    assert json.loads(encode(fixture["kind"], value)) == fixture["value"], fixture["name"]
for fixture in invalid:
    try:
        validate(fixture["kind"], fixture["value"])
    except WireError:
        pass
    else:
        raise AssertionError(f"Accepted invalid fixture: {fixture['name']}")
# Actual wire requests/native refs also validate through their expanded tool schema.
for fixture in valid:
    if fixture["kind"] == "read_result":
        request = fixture["value"]["request"]
        assert validate_parameters(parameter_schema("read_request"), request) == validate("read_request", request)
        series = fixture["value"]["series"]
        if series:
            native = series["provider_ref"]
            assert validate_parameters(parameter_schema("provider_ref"), native) == validate("provider_ref", native)
expanded = parameter_schema("read_request")
expanded["properties"]["schema_version"]["enum"] = [999]
assert parameter_schema("read_request")["properties"]["schema_version"]["enum"] == [1]
# The native bridge reuses bounded structural validation without coercion.
parameters = {"type": "object", "$comment": "inert native contribution annotation",
              "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 10},
                             "weights": {"type": "array", "items": {"type": "number"}, "maxItems": 2}},
              "required": ["limit"], "additionalProperties": False}
assert validate_parameters(parameters, {"limit": 2, "weights": [0.5, 1]}) == {"limit": 2, "weights": [0.5, 1]}
for arguments in ({"limit": True}, {"limit": "2"}, {"limit": 11}, {"limit": 1, "secret": "not-echoed"}, {"limit": 1, "weights": [float("nan")]}):
    try:
        validate_parameters(parameters, arguments)
    except WireError as error:
        assert "not-echoed" not in str(error)
    else:
        raise AssertionError("Accepted invalid native arguments")
for unsupported in ({**parameters, "if": {}}, {**parameters, "additionalProperties": True}, {**parameters, "$ref": "arbitrary"}):
    try:
        validate_parameters(unsupported, {"limit": 2})
    except WireError:
        pass
    else:
        raise AssertionError("Ignored unsupported native schema")
if "--json-schema" in sys.argv:
    from jsonschema import Draft202012Validator, FormatChecker
    Draft202012Validator.check_schema(schema())
    for fixture in valid + invalid:
        validator = Draft202012Validator(schema(fixture["kind"]), format_checker=FormatChecker())
        structurally_valid = not list(validator.iter_errors(fixture["value"]))
        assert structurally_valid == (not fixture.get("structural", False)), fixture["name"]
print(json.dumps([json.loads(encode(f["kind"], f["value"])) for f in valid]))
