"""Pinned native shared custom-pool fallback; synthetic profiles, no inference.

Run with the pinned interpreter and pass its source directory. No live stores,
listeners, model requests, or credential values are consumed or printed.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

source = Path(sys.argv[1]).resolve()
repository = Path(__file__).resolve().parents[2]
python = source / '.venv/bin/python'
hermes = source / '.venv/bin/hermes'

with tempfile.TemporaryDirectory(prefix='pythia-shared-provider-') as temp:
    root = Path(temp).resolve() / 'hermes'
    root.mkdir()
    (root / 'config.yaml').write_text('''model:
  provider: custom:research
  default: synthetic-model
providers:
  research:
    api: http://127.0.0.1:12345/v1
    transport: codex_responses
    key_env: SYNTHETIC_PROVIDER_KEY
''')
    environment = {'PATH': os.environ['PATH'], 'HOME': temp, 'HERMES_HOME': str(root),
                   'HERMES_DISABLE_LAZY_INSTALLS': '1', 'PYTHONPATH': str(source)}
    def native(code, home=root):
        return subprocess.run([str(python), '-c', code], env={**environment, 'HERMES_HOME': str(home)},
            text=True, check=True, capture_output=True).stdout

    native('''from hermes_cli.auth import write_credential_pool
write_credential_pool('custom:research', [{'id':'shared','label':'Synthetic','auth_type':'api_key',
  'priority':0,'source':'manual','access_token':'synthetic-shared','base_url':'http://127.0.0.1:12345/v1'}])
''')
    for name in ('first', 'second'):
        home = root / 'profiles' / name
        home.mkdir(parents=True)
        (home / 'config.yaml').write_text('model: {}\n')
        (home / '.env').write_text('')
        script = '''import { execFileSync } from 'node:child_process';
import { inheritModelDefaults } from './scripts/dev/runtime-config.mjs';
const [hermes,profile] = process.argv.slice(1);
inheritModelDefaults({profile}, '', {execute: (_paths,args) => execFileSync(hermes,args,{encoding:'utf8',env:process.env})});
'''
        subprocess.run(['node', '--input-type=module', '-e', script, str(hermes), name],
            cwd=repository, env=environment, check=True, capture_output=True)
        native('''import socket
socket.socket.connect=lambda *_a,**_k: (_ for _ in ()).throw(AssertionError('No network'))
from hermes_cli.runtime_provider import resolve_runtime_provider
r=resolve_runtime_provider(requested='custom:research')
assert r['api_key']=='synthetic-shared'
assert r['api_mode']=='codex_responses'
assert r['base_url']=='http://127.0.0.1:12345/v1'
''', home)
        auth = json.loads((home / 'auth.json').read_text()) if (home / 'auth.json').exists() else {}
        assert not auth.get('credential_pool', {}).get('custom:research')
        assert not (home / '.env').read_text()
    # Root rotation is seen by a profile without copying or startup validation.
    native('''from hermes_cli.auth import read_credential_pool,write_credential_pool
entries=read_credential_pool('custom:research')
entries[0]['access_token']='synthetic-rotated'
write_credential_pool('custom:research',entries)
''')
    native('''from hermes_cli.runtime_provider import resolve_runtime_provider
assert resolve_runtime_provider(requested='custom:research')['api_key']=='synthetic-rotated'
''', root / 'profiles/first')
    # Explicit native profile credential wins; the other profile stays shared.
    native('''from hermes_cli.auth import write_credential_pool
write_credential_pool('custom:research',[{'id':'local','source':'manual','priority':0,
 'auth_type':'api_key','access_token':'synthetic-override','base_url':'http://127.0.0.1:12345/v1'}])
from hermes_cli.runtime_provider import resolve_runtime_provider
assert resolve_runtime_provider(requested='custom:research')['api_key']=='synthetic-override'
''', root / 'profiles/first')
    native('''from hermes_cli.runtime_provider import resolve_runtime_provider
assert resolve_runtime_provider(requested='custom:research')['api_key']=='synthetic-rotated'
''', root / 'profiles/second')
print('Native shared routing, root credential fallback, rotation and profile override passed.')
