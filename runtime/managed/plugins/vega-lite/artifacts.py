"""Local declarative Vega-Lite files with bounded inputs and explicit revisions."""
from contextlib import contextmanager
import hashlib
import json
import math
import os
import re
from pathlib import Path, PurePosixPath
import stat
from urllib.parse import quote
from uuid import uuid4

from jsonschema import Draft202012Validator, FormatChecker

MAX_BYTES = 256 * 1024
# Match Desk's browsable research boundary (server/workspace/files.ts).
EXCLUDED = frozenset({'attachments', '.git', '.pythia', '.private', 'node_modules',
                      '.next', '.cache', '__pycache__', '.venv', 'venv'})
SCHEMA = json.loads((Path(__file__).parent / 'artifact.schema.json').read_text())
VALIDATOR = Draft202012Validator(SCHEMA, format_checker=FormatChecker())
FORBIDDEN_KEYS = frozenset({'__proto__', 'prototype', 'constructor', 'url', 'href', 'element'})


def finite_number(value):
    if type(value) not in (int, float):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def scalar(value):
    return (value is None or isinstance(value, bool)
            or isinstance(value, str) and len(value) <= 4000 or finite_number(value))


def persistent_parameters(spec):
    params = spec.get('params', [])
    if not isinstance(params, list):
        raise ValueError('Vega-Lite params must be an array.')
    return {item['name'] for item in params
            if isinstance(item, dict) and isinstance(item.get('name'), str)
            and re.fullmatch(r'[A-Za-z_$][A-Za-z0-9_$]*', item['name'])
            and item['name'] not in FORBIDDEN_KEYS
            and 'select' not in item and 'expr' not in item
            and ('value' not in item or scalar(item['value']))}


def validate_binding(value, depth=0):
    """Vega copies binding fields into DOM attributes; admit known controls only."""
    if value in ('legend', 'scales'):
        return True
    if not isinstance(value, dict) or depth > 8:
        return False
    if 'input' not in value:
        return bool(value) and all(isinstance(child, dict) and validate_binding(child, depth + 1)
                                   for child in value.values())
    if value['input'] not in ('range', 'select', 'radio', 'checkbox', 'text', 'number'):
        return False
    if value['input'] in ('select', 'radio') and not isinstance(value.get('options'), list):
        return False
    allowed = {'input', 'name', 'min', 'max', 'step', 'options', 'labels', 'debounce'}
    for key, item in value.items():
        if key not in allowed:
            return False
        if key == 'input':
            continue
        if key == 'name':
            if not isinstance(item, str) or not 0 < len(item) <= 240:
                return False
            continue
        if key in ('options', 'labels'):
            if not isinstance(item, list) or len(item) > 1000:
                return False
            for option in item:
                if key == 'labels':
                    if not isinstance(option, str) or len(option) > 4000:
                        return False
                elif not scalar(option):
                    return False
            continue
        if not finite_number(item) or abs(item) > 1e15:
            return False
        if key == 'step' and item <= 0:
            return False
        if key == 'debounce' and not 0 <= item <= 60000:
            return False
    return True


def validate(artifact):
    """Check the envelope and local-only limits; Vega-Lite owns visual grammar."""
    content = (json.dumps(artifact, ensure_ascii=False, allow_nan=False, separators=(',', ':')) + '\n').encode('utf-8')
    if len(content) > MAX_BYTES:
        raise ValueError('Artifact exceeds 256 KiB.')
    error = next(VALIDATOR.iter_errors(artifact), None)
    if error:
        location = '.'.join(str(item) for item in error.absolute_path) or 'artifact'
        raise ValueError(f'Invalid artifact field: {location}.')
    spec = artifact['data']['spec']
    if not any(key in spec for key in ('mark', 'layer', 'facet', 'repeat', 'concat', 'hconcat', 'vconcat')):
        raise ValueError('Vega-Lite specification needs a mark or composition.')
    stack = [(spec, 0)]
    nodes = 0
    while stack:
        value, depth = stack.pop()
        nodes += 1
        if depth > 40 or nodes > 40000:
            raise ValueError('Vega-Lite specification is too complex.')
        if isinstance(value, dict):
            if FORBIDDEN_KEYS.intersection(value):
                raise ValueError('Use inline data; URLs, links and prototype keys are not supported in specifications.')
            if 'bind' in value and not validate_binding(value['bind']):
                raise ValueError('Bindings support only native safe input controls, legend or scales; arbitrary HTML attributes are not supported.')
            mark = value.get('mark')
            if mark == 'image' or isinstance(mark, dict) and mark.get('type') == 'image':
                raise ValueError('Image marks are not supported.')
            if 'sequence' in value:
                sequence = value['sequence']
                if not isinstance(sequence, dict):
                    raise ValueError('Data sequences require bounded numeric start, stop and step.')
                start, stop, step = sequence.get('start', 0), sequence.get('stop'), sequence.get('step', 1)
                if (any(not finite_number(number) for number in (start, stop, step))
                        or step == 0 or abs((stop - start) / step) > 10000):
                    raise ValueError('Data sequences are limited to 10000 values with numeric start, stop and step.')
            stack.extend((child, depth + 1) for child in value.values())
        elif type(value) in (int, float) and not finite_number(value):
            raise ValueError('Specification numbers must be finite JavaScript numbers.')
        elif isinstance(value, str) and len(value) > 16000:
            raise ValueError('Specification strings are limited to 16000 characters.')
        elif isinstance(value, list):
            if len(value) > 10000:
                raise ValueError('Specification arrays are limited to 10000 items.')
            stack.extend((child, depth + 1) for child in value)
    parameters = artifact['data'].get('parameters', {})
    declared = persistent_parameters(spec)
    if (FORBIDDEN_KEYS.intersection(parameters) or set(parameters) - declared
            or not all(scalar(value) for value in parameters.values())):
        raise ValueError('Saved parameters must name editable top-level Vega-Lite scalar variables, not selections or expressions.')
    return content


def clean_path(destination, suffix='.pythia-vega-lite.json'):
    if not isinstance(destination, str) or len(destination) > 1024 or '\\' in destination or any(ord(char) < 32 or ord(char) == 127 for char in destination):
        raise ValueError('Use a relative workspace destination.')
    path = PurePosixPath(destination)
    if (path.is_absolute() or str(path) != destination or '..' in path.parts or any(part in EXCLUDED for part in path.parts)
            or len(path.name) <= len(suffix) or not path.name.lower().endswith(suffix)):
        raise ValueError(f'Use a relative workspace destination ending in {suffix}.')
    return path


@contextmanager
def parent_directory(workspace, path, *, create_parents=False):
    directory = os.open(workspace, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in path.parts[:-1]:
            if create_parents:
                try:
                    os.mkdir(part, mode=0o700, dir_fd=directory)
                except FileExistsError:
                    pass
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
            os.close(directory)
            directory = child
        yield directory
    finally:
        os.close(directory)


def read_content(directory, name):
    descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
    with os.fdopen(descriptor, 'rb') as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_BYTES:
            raise ValueError('Visual must be a regular file no larger than 256 KiB.')
        content = source.read(MAX_BYTES + 1)
    if len(content) > MAX_BYTES:
        raise ValueError('Artifact exceeds 256 KiB.')
    return content


def result(destination, content, *, artifact=None):
    url = '/workspace/' + quote(destination, safe='/')
    data = {'path': destination, 'url': url, 'markdown': f'[Open research visual]({url})',
            'bytes': len(content), 'revision': hashlib.sha256(content).hexdigest()}
    if artifact is not None:
        data['artifact'] = artifact
    return {'schema_version': 1, 'data': data}


def create(artifact, destination, workspace):
    content = validate(artifact)
    destination = f'working/visuals/{uuid4().hex}.pythia-vega-lite.json' if destination is None else destination
    path = clean_path(destination)
    with parent_directory(workspace, path, create_parents=True) as directory:
        descriptor = os.open(path.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                             0o600, dir_fd=directory)
        try:
            with os.fdopen(descriptor, 'wb') as output:
                output.write(content)
        except BaseException:
            os.unlink(path.name, dir_fd=directory)
            raise
    return result(destination, content)


def read(destination, workspace):
    path = clean_path(destination)
    with parent_directory(workspace, path) as directory:
        content = read_content(directory, path.name)
    artifact = json.loads(content)
    validate(artifact)
    return result(destination, content, artifact=artifact)


def update(artifact, destination, workspace, revision):
    content = validate(artifact)
    path = clean_path(destination)
    if not isinstance(revision, str) or len(revision) != 64:
        raise ValueError('Read the visual first and supply its revision to update it.')
    with parent_directory(workspace, path) as directory:
        previous = read_content(directory, path.name)
        if hashlib.sha256(previous).hexdigest() != revision:
            raise ValueError('The visual changed. Read it again before updating.')
        # Publish a complete replacement; never truncate or follow the old file.
        temporary = f'.visual-{uuid4().hex}.tmp'
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                             0o600, dir_fd=directory)
        try:
            with os.fdopen(descriptor, 'wb') as output:
                output.write(content)
            # Catch edits during preparation as well as stale callers. This is
            # conflict detection, not a filesystem transaction with other editors.
            if hashlib.sha256(read_content(directory, path.name)).hexdigest() != revision:
                raise ValueError('The visual changed. Read it again before updating.')
            os.replace(temporary, path.name, src_dir_fd=directory, dst_dir_fd=directory)
        finally:
            try:
                os.unlink(temporary, dir_fd=directory)
            except FileNotFoundError:
                pass
    return result(destination, content)
