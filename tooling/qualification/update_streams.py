"""Provider-free loopback update-stream regression using pinned Hermes's Python.

Run: <prepared-hermes-source>/.venv/bin/python tooling/qualification/update_streams.py
Synthetic push callbacks exercise the native aiohttp transport without a profile.
"""
import asyncio
import importlib
import importlib.util
from pathlib import Path
import sys
import unittest

from aiohttp import ClientSession, ClientTimeout, web


class UpdateStreams(unittest.IsolatedAsyncioTestCase):
    async def test_silent_disconnect_sharing_and_reconnect_grace(self):
        root = Path(__file__).resolve().parents[2] / 'runtime/managed/core/platform'
        package = '_pythia_update_stream_fixture'
        spec = importlib.util.spec_from_file_location(package, root / '__init__.py',
                                                     submodule_search_locations=[str(root)])
        module = importlib.util.module_from_spec(spec)
        sys.modules[package] = module
        spec.loader.exec_module(module)
        live_http = importlib.import_module(package + '.live_http')
        subscribed, finished = asyncio.Queue(), asyncio.Queue()
        stopped = asyncio.Event()
        loop = asyncio.get_running_loop()

        @web.middleware
        async def completion(request, handler):
            try:
                return await handler(request)
            finally:
                finished.put_nowait(None)

        async def inspect(_): return 'allowed'
        async def poll(_): raise AssertionError('Silent push must not poll')
        async def subscribe(_, publish):
            subscribed.put_nowait(publish)
            return lambda: loop.call_soon_threadsafe(stopped.set)
        async def body(request): return await request.json()
        def error(code, status): return web.json_response({'error': code}, status=status)

        app = web.Application(middlewares=[completion])
        live_http.install(app, lambda _: None, body, error, poll, inspect, subscribe)
        # Match the native Hermes default explicitly: disconnect does not cancel
        # the handler, so only Pythia's transport check releases idle demand.
        runner = web.AppRunner(app, handler_cancellation=False)
        await runner.setup()
        try:
            site = web.TCPSite(runner, '127.0.0.1', 0)
            await site.start()
            base = f'http://127.0.0.1:{runner.addresses[0][1]}/v1/pythia/updates'
            request = {'resources': [{'plugin': 'synthetic', 'operation': 'query', 'arguments': {}}]}
            async with ClientSession(timeout=ClientTimeout(total=15)) as client:
                first = await client.post(base, json=request)
                self.assertEqual(first.status, 200)
                receive = await asyncio.wait_for(subscribed.get(), 1)
                second = await client.post(base, json=request)
                self.assertEqual(second.status, 200)
                first.close()
                await asyncio.wait_for(finished.get(), 1)
                self.assertFalse(stopped.is_set())

                # The other subscriber still receives the same native feed.
                receive({'type': 'snapshot', 'state': 'ready', 'data': {'value': 42}})
                line = await asyncio.wait_for(second.content.readline(), 1)
                self.assertIn(b'"value": 42', line)
                second.close()
                await asyncio.wait_for(finished.get(), 1)

                # Reconnect after detachment, before the existing two-second
                # grace expires: replay and later push reuse the subscription.
                third = await client.post(base, json=request)
                self.assertEqual(third.status, 200)
                self.assertIn(b'"value": 42', await asyncio.wait_for(third.content.readline(), 1))
                self.assertTrue(subscribed.empty())
                self.assertFalse(stopped.is_set())
                third.close()
                await asyncio.wait_for(finished.get(), 1)
                self.assertFalse(stopped.is_set())
                await asyncio.wait_for(stopped.wait(), 3)
        finally:
            await runner.cleanup()


if __name__ == '__main__':
    unittest.main()
