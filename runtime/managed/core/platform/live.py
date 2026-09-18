"""Demand-owned snapshots and status; transport health is not data freshness."""
import asyncio
import copy
import json
import time
import uuid

from .access import fingerprint


class LiveReads:
    def __init__(self, read, access, *, subscribe=None, limit=256, grace=2):
        self.read, self.access = read, access
        self.limit, self.grace = limit, grace
        self.resources, self.closed = {}, False
        self.tasks = set()  # Includes resources finishing cancellation/cleanup.
        self.bytes = 0
        self.subscribe = subscribe

    async def attach(self, requests, publish):
        handles = []
        try:
            for request in requests:
                denied = None
                try:
                    access = await self.access(request)
                except Exception as error:
                    access, denied = None, error
                key = fingerprint(request)
                resource = self.resources.get(key)
                if resource is None:
                    if len(self.tasks) >= self.limit:
                        raise ValueError('subscription_limit')
                    resource = {'request': copy.deepcopy(request), 'listeners': {}, 'event': None,
                                'generation': uuid.uuid4().hex, 'revision': 0, 'empty_since': None, 'bytes': 0, 'key': key}
                    self.resources[key] = resource
                    resource['task'] = asyncio.create_task(self.refresh(key, resource))
                    self.tasks.add(resource['task'])
                    resource['task'].add_done_callback(self.tasks.discard)
                listener = uuid.uuid4().hex
                resource['listeners'][listener] = publish
                release = resource.pop('release', None)
                if release: release.cancel()
                resource['empty_since'] = None
                handles.append((resource, listener))
                if denied:
                    await self.emit(key, resource, {'type': 'reset', 'state': 'unavailable', 'code': getattr(denied, 'code', 'unavailable')})
                elif resource['event'] and resource.get('scope') == access:
                    await publish(key, copy.deepcopy(resource['event']))
            return handles
        except BaseException:
            self.detach(handles)
            raise

    def detach(self, handles):
        for resource, listener in handles:
            resource['listeners'].pop(listener, None)
            if not resource['listeners']:
                resource['empty_since'] = time.monotonic()
                release = resource.pop('release', None)
                if release: release.cancel()
                def expire(resource=resource):
                    if resource['listeners']: return
                    key = resource['key']
                    if self.resources.get(key) is resource: self.resources.pop(key)
                    resource['task'].cancel()
                resource['release'] = asyncio.get_running_loop().call_later(self.grace, expire)

    async def emit(self, key, resource, event):
        size = len(json.dumps(event, allow_nan=False).encode())
        if size > 4_000_000 or self.bytes - resource['bytes'] + size > 16_000_000:
            event = {'type': 'reset', 'state': 'unavailable', 'code': 'response_limit'}
            size = 128
        self.bytes += size - resource['bytes']
        resource['bytes'] = size
        resource['revision'] += 1
        event.update(schema_version=1, generation=resource['generation'], revision=resource['revision'], _scope=resource.get('scope'))
        resource['event'] = event
        for publish in list(resource['listeners'].values()):
            await publish(key, copy.deepcopy(event))

    async def refresh(self, key, resource):
        due, scope, previous = 0, None, None
        retry_delay = 1
        stop, mode = None, None
        loop = asyncio.get_running_loop()
        try:
            while not self.closed:
                empty = resource['empty_since']
                if empty is not None and time.monotonic() - empty >= self.grace:
                    break
                if not resource['listeners']:
                    await asyncio.sleep(0.1)
                    continue
                try:
                    current = await self.access(resource['request'])
                    if scope != current:
                        if stop:
                            await asyncio.to_thread(stop)
                            stop = None
                        mode = None
                        resource.pop('pending', None)
                        if scope is not None:
                            resource['generation'] = uuid.uuid4().hex
                            previous = None
                            resource['scope'] = current
                            await self.emit(key, resource, {'type': 'reset', 'state': 'loading'})
                        scope, due = current, 0
                        resource['scope'] = current
                    if mode is None and time.monotonic() >= due:
                        generation = resource['generation']
                        def receive(event, expected=generation):
                            def enqueue():
                                if resource['generation'] == expected:
                                    resource['pending'] = event
                            if not self.closed:
                                loop.call_soon_threadsafe(enqueue)
                        stop = await self.subscribe(resource['request'], receive) if self.subscribe else None
                        mode = 'push' if stop else 'poll'
                    if mode == 'push':
                        event = resource.pop('pending', None)
                        if event is not None:
                            if event.get('state') == 'stale':
                                retained = (resource.get('event') or {}).get('data')
                                if retained is not None: event['data'] = retained
                            await self.emit(key, resource, event)
                            if event.get('state') in ('stale', 'unavailable') and event.get('code') != 'no_recent_observation':
                                await asyncio.to_thread(stop)
                                stop, mode = None, None
                                retry = event.get('retry_after_seconds', 0)
                                if type(retry) not in (int, float) or not 0 <= retry <= 86400:
                                    retry = 0
                                due = time.monotonic() + max(300 if event['state'] == 'unavailable' else 15, retry)
                        await asyncio.sleep(1)
                        continue
                    if mode == 'poll' and time.monotonic() >= due:
                        value, cadence = await self.read(resource['request'])
                        # Do not publish data whose access or selection changed during execution.
                        if current != await self.access(resource['request']):
                            continue
                        due = time.monotonic() + cadence
                        retry_delay = 1
                        comparable = fingerprint(value)
                        if comparable != previous:
                            await self.emit(key, resource, {'type': 'snapshot', 'state': 'ready',
                                'data': value, 'refreshAfterSeconds': cadence})
                            previous = comparable
                except asyncio.CancelledError:
                    raise
                except Exception as error:
                    code = getattr(error, 'code', 'source_unavailable')
                    denied = getattr(error, 'status', 503) in (400, 401, 403, 404, 409, 422)
                    if denied and stop:
                        await asyncio.to_thread(stop)
                        stop, mode = None, None
                        resource.pop('pending', None)
                        resource['generation'] = uuid.uuid4().hex
                        scope = None
                    retained = (resource.get('event') or {}).get('data')
                    await self.emit(key, resource, {'type': 'reset' if denied else 'status',
                        'state': 'unavailable' if denied else 'stale', 'code': code,
                        **getattr(error, 'detail', {}),
                        **({'data': retained} if not denied and retained is not None else {})})
                    previous = None
                    retry_delay = min(60, retry_delay * 2)
                    due = time.monotonic() + max(300 if denied else retry_delay, getattr(error, 'retry_after', 0) or 0)
                await asyncio.sleep(1)
        finally:
            release = resource.pop('release', None)
            if release: release.cancel()
            try:
                if stop: await asyncio.to_thread(stop)
            finally:
                if self.resources.get(key) is resource: self.resources.pop(key)
                self.bytes -= resource['bytes']

    async def close(self):
        self.closed = True
        tasks = list(self.tasks)
        for task in tasks:
            if not task.cancelling(): task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
