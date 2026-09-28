"""News coverage memory: an empty answer that contradicts items seen earlier is drift, not silence.

A news connector reports every provider key it asked for (a ticker or symbol) and the
publish times of the items it kept for each. When a later answer for the same keys is
empty although an item seen earlier falls inside its window, the connector reports a
drift warning instead of an ordinary empty list: the source stopped answering for a
subject it covered, as Yahoo's text search did for ASML.AS, SHEL.L, NESN.SW and BTC-USD.

The memory lives in the running process only and holds no content: a key, the newest
publish time seen and when. It is bounded and disposable.
"""
from __future__ import annotations

import threading
from collections import OrderedDict
from datetime import datetime, timezone


def _instant(value):
    try:
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else None


class NewsCoverage:
    def __init__(self, max_entries=2048):
        self.lock, self.max_entries = threading.Lock(), max_entries
        self.newest: OrderedDict[tuple[str, str], tuple[datetime, str]] = OrderedDict()

    def observe(self, provider, keys, items, start, end):
        """Remember `items` ({key: [publish times]}) and return the keys whose newest remembered item lies in
        [start, end) when nothing was returned for any key: [{key, newest, seen_at}]. Empty otherwise."""
        start, end = _instant(start), _instant(end)
        now = datetime.now(timezone.utc).isoformat()
        with self.lock:
            found = False
            for key in keys:
                times = [instant for value in items.get(key, ()) if (instant := _instant(value))]
                if not times:
                    continue
                found = True
                newest = max(times)
                known = self.newest.get((provider, key))
                if known is None or newest >= known[0]:
                    self.newest[(provider, key)] = (newest, now)
                self.newest.move_to_end((provider, key))
            while len(self.newest) > self.max_entries:
                self.newest.popitem(last=False)
            if found or start is None or end is None:
                return []
            return [{'key': key, 'newest': value[0].isoformat(), 'seen_at': value[1]}
                    for key in keys if (value := self.newest.get((provider, key))) and start <= value[0] < end]
