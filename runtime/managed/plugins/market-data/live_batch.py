"""Gather compatible live reads before entering the existing shared reader."""
import asyncio
import copy
from datetime import datetime, timedelta, timezone
import json

from ._platform import platform

AdmissionError = platform().admission.AdmissionError


def materialize(resource):
    request = copy.deepcopy(resource['arguments'])
    window = resource.get('window')
    if window:
        end = datetime.now(timezone.utc).replace(second=0, microsecond=0)
        start = end - timedelta(days=window['days'])
        def edge(value):
            return {'kind': 'session_date', 'value': value.date().isoformat()} if window['kind'] == 'sessions' else {
                'kind': 'instant', 'value': value.isoformat().replace('+00:00', 'Z')}
        for item in request['reads']:
            item['request']['window'] = {'start': edge(start), 'end': edge(end)}
    return request


def validate_window(resource):
    if 'window' not in resource:
        return
    window = resource['window']
    reads = resource['arguments'].get('reads', [])
    if (not isinstance(window, dict) or set(window) != {'kind', 'days'}
            or window['kind'] not in ('sessions', 'rolling') or type(window['days']) is not int
            or not 1 <= window['days'] <= 90
            or resource['arguments'].get('action') != 'read_many' or len(reads) != 1
            or reads[0].get('request', {}).get('operation') != 'history'):
        raise AdmissionError('invalid_request', 400)


class LiveBatch:
    def __init__(self, run):
        self.run, self.pending, self.timer = run, [], None
        self.tasks = set()

    async def read(self, resource):
        request = materialize(resource)
        if request.get('action') != 'read_many' or len(request['reads']) != 1:
            return json.loads(await self.run(request, None))
        future = asyncio.get_running_loop().create_future()
        self.pending.append((request['reads'][0], future))
        if self.timer is None:
            self.timer = asyncio.get_running_loop().call_later(.01, self.flush)
        raw = await future
        result = raw['data'][0]
        if result.get('outcome') == 'error':
            issues = [item for item in result.get('issues', []) if item.get('severity', 'error') == 'error']
            terminal = {'unavailable', 'authentication_failed', 'access_denied', 'reauthorization_required', 'unsupported_series', 'invalid_request', 'invalid_window', 'unsupported_window'}
            selected = next((item for item in issues if item['code'] in terminal), None) or next((item for item in issues if item['code'] == 'rate_limit'), None) or next(iter(issues), {'code': 'source_unavailable'})
            failure = AdmissionError(selected['code'], 403 if selected['code'] in terminal else 503)
            failure.retry_after = selected.get('retry_after_seconds', raw.get('retry_after_seconds'))
            failure.detail = {key: selected[key] for key in ('retry_after_seconds', 'limit_origin') if key in selected}
            raise failure
        return raw

    def flush(self):
        batch, self.pending, self.timer = self.pending, [], None
        # Quotes never wait behind histories. Native/pinned sources can be
        # separated without resolving identity in the transport.
        groups = {}
        for index, (item, future) in enumerate(batch):
            if future.cancelled():
                continue
            request = item['request']
            source = item.get('series', {}).get('provider_ref', {}).get('provider') or request['view'].get('subject', {}).get('provider')
            # Unknown canonical selection is resolved by the domain per item;
            # connector native batching still combines compatible resolutions.
            groups.setdefault((request['operation'], source or index), []).append((item, future))
        for group in groups.values():
            size = 4 if group[0][0]['request']['operation'] == 'history' else 32
            for offset in range(0, len(group), size):
                task = asyncio.create_task(self.execute(group[offset:offset + size]))
                self.tasks.add(task)
                task.add_done_callback(self.tasks.discard)

    async def close(self):
        if self.timer: self.timer.cancel()
        for _, future in self.pending: future.cancel()
        self.pending.clear()
        tasks = list(self.tasks)
        for task in tasks: task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    async def execute(self, entries):
        try:
            value = json.loads(await self.run({'action': 'read_many', 'reads': [item for item, _ in entries]}, None,
                                             lambda: all(future.cancelled() for _, future in entries)))
            if not isinstance(value.get('data'), list) or len(value['data']) != len(entries):
                raise AdmissionError('invalid_response', 502)
            ages = value.get('delivery', {}).get('max_age_seconds', [15] * len(entries))
            for index, (_, future) in enumerate(entries):
                if not future.done():
                    future.set_result({**value, 'data': [value['data'][index]],
                        'delivery': {**value.get('delivery', {}), 'max_age_seconds': [ages[index]]}})
        except BaseException as error:
            for _, future in entries:
                if not future.done():
                    future.set_exception(error)
