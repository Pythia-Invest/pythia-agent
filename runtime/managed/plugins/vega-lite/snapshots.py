"""Bounded local SVG export through the selected-source Vega runtime."""
import os
from pathlib import Path
import selectors
import subprocess
import tempfile
import time
from uuid import uuid4

from .artifacts import clean_path, parent_directory, read, result, validate

MAX_SVG_BYTES = 2 * 1024 * 1024


def render_svg(artifact):
    executable = os.environ.get('PYTHIA_NODE', '')
    if not executable or not Path(executable).is_absolute() or not os.access(executable, os.X_OK):
        raise ValueError('The managed Node runtime is unavailable; rebuild the selected source.')
    script = Path(__file__).parent / 'dist/snapshot.mjs'
    if not script.is_file() or script.is_symlink():
        raise ValueError('The bundled snapshot renderer is unavailable; rebuild the selected source.')
    content = validate(artifact)
    # No shell, inherited Node options, provider credentials, or external input
    # files. The bundled renderer installs a deny-all data loader.
    with tempfile.TemporaryFile() as source:
        source.write(content)
        source.seek(0)
        process = subprocess.Popen([executable, '--max-old-space-size=128', str(script)], stdin=source, stdout=subprocess.PIPE,
                                   stderr=subprocess.DEVNULL, env={}, close_fds=True)
        try:
            chunks = []
            total = 0
            deadline = time.monotonic() + 15
            with selectors.DefaultSelector() as selector:
                selector.register(process.stdout, selectors.EVENT_READ)
                while True:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise ValueError('Snapshot rendering timed out; simplify the visual.')
                    if not selector.select(min(remaining, .2)):
                        continue
                    chunk = os.read(process.stdout.fileno(), 65536)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > MAX_SVG_BYTES:
                        raise ValueError('Snapshot exceeds 2 MiB; simplify the visual.')
                    chunks.append(chunk)
            if process.wait(timeout=max(.01, deadline - time.monotonic())) != 0:
                raise ValueError('Snapshot rendering failed; check the Vega-Lite specification.')
            svg = b''.join(chunks)
            if not svg.lstrip().startswith(b'<svg'):
                raise ValueError('Snapshot renderer did not return SVG.')
            return svg
        except subprocess.TimeoutExpired as error:
            raise ValueError('Snapshot rendering timed out; simplify the visual.') from error
        finally:
            if process.poll() is None:
                process.kill()
            process.wait()
            process.stdout.close()


def export(destination, output, workspace):
    output = f'working/visuals/{uuid4().hex}.svg' if output is None else output
    path = clean_path(output, '.svg')
    artifact = read(destination, workspace)['data']['artifact']
    svg = render_svg(artifact)
    with parent_directory(workspace, path, create_parents=True) as directory:
        descriptor = os.open(path.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                             0o600, dir_fd=directory)
        try:
            with os.fdopen(descriptor, 'wb') as target:
                target.write(svg)
        except BaseException:
            os.unlink(path.name, dir_fd=directory)
            raise
    response = result(output, svg)
    response['data']['markdown'] = f"[Open visual snapshot]({response['data']['url']})"
    return response
