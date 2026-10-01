"""Synthetic idle transports exercise cleanup without aiohttp as a test dependency."""
import asyncio
import importlib
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from market_data_fixture import PLATFORM

live_http = importlib.import_module(PLATFORM + '.live_http')


class UpdateDisconnect(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.prepared, self.subscribed = asyncio.Queue(), asyncio.Queue()
        self.stopped = asyncio.Event()
        self.tasks, self.hubs, self.routes = [], [], {}
        loop = asyncio.get_running_loop()

        async def inspect(_): return 'allowed'
        async def poll(_): raise AssertionError('Silent push must not poll')
        async def subscribe(_, publish):
            self.subscribed.put_nowait(publish)
            return lambda: loop.call_soon_threadsafe(self.stopped.set)
        async def body(_):
            return {'resources': [{'plugin': 'synthetic', 'operation': 'query', 'arguments': {}}]}

        prepared = self.prepared
        class Response:
            def __init__(self, **_): self.prepared = False
            async def prepare(self, request):
                self.prepared = True
                prepared.put_nowait(request)
            async def write(self, _):
                raise AssertionError('Disconnect must be detected before any heartbeat or update')

        original = live_http.LiveReads
        def hub(*args, **kwargs):
            instance = original(*args, **kwargs)
            self.hubs.append(instance)
            return instance
        self.app = SimpleNamespace(router=SimpleNamespace(add_post=self.routes.__setitem__), on_shutdown=[])
        with patch.dict(sys.modules, {'aiohttp': SimpleNamespace(web=SimpleNamespace(StreamResponse=Response))}), \
                patch.object(live_http, 'LiveReads', hub):
            live_http.install(self.app, lambda _: None, body, lambda *args: self.fail(str(args)),
                              poll, inspect, subscribe)

    async def asyncTearDown(self):
        for task in self.tasks: task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
        for cleanup in self.app.on_shutdown: await cleanup(self.app)

    async def connect(self):
        request = SimpleNamespace(transport=SimpleNamespace(is_closing=lambda: False))
        task = asyncio.create_task(self.routes['/v1/pythia/updates'](request))
        self.tasks.append(task)
        self.assertIs(await asyncio.wait_for(self.prepared.get(), 1), request)
        return request, task

    async def test_silent_disconnect_starts_default_release_grace_promptly(self):
        request, task = await self.connect()
        await asyncio.wait_for(self.subscribed.get(), 1)
        request.transport = None
        await asyncio.wait_for(asyncio.shield(task), 1)
        self.assertFalse(self.stopped.is_set())
        await asyncio.wait_for(self.stopped.wait(), 3)
        self.assertFalse(self.hubs[0].resources)

    async def test_other_subscriber_and_reconnect_keep_shared_demand(self):
        first, first_task = await self.connect()
        await asyncio.wait_for(self.subscribed.get(), 1)
        second, second_task = await self.connect()
        hub = self.hubs[0]
        resource = next(iter(hub.resources.values()))
        first.transport.is_closing = lambda: True
        await asyncio.wait_for(asyncio.shield(first_task), 1)
        self.assertEqual(len(resource['listeners']), 1)
        self.assertNotIn('release', resource)
        self.assertFalse(self.stopped.is_set())
        second.transport = None
        await asyncio.wait_for(asyncio.shield(second_task), 1)
        self.assertIn('release', resource)
        third, third_task = await self.connect()
        self.assertIs(next(iter(hub.resources.values())), resource)
        self.assertNotIn('release', resource)
        self.assertTrue(self.subscribed.empty())
        self.assertFalse(self.stopped.is_set())
        third.transport = None
        await asyncio.wait_for(asyncio.shield(third_task), 1)
        await asyncio.wait_for(self.stopped.wait(), 3)
