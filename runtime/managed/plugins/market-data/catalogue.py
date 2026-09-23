"""Display metadata for explicitly adopted identities; never matching evidence."""
import json

from .identity_db import dumps, native_key, evidence_rows
from .search_ranking import normalized


def providers(store):
    """Retained source names for filtering; no evidence or availability claim."""
    with store.database.connection() as db:
        return [row[0] for row in db.execute(
            "SELECT DISTINCT json_extract(native_key, '$.provider') FROM mappings ORDER BY 1")]


def remember(store, native, scope, label):
    with store._access() as db:
        search_text = ' '.join(str(label.get(key) or '') for key in ('name', 'symbol')) + ' ' + native['native_id']
        db.execute('INSERT OR REPLACE INTO catalogue_labels VALUES (?, ?, ?, ?)',
                   (native_key(native), scope, dumps(label), search_text.casefold()))


def entries(store, query, native_keys):
    # Access repairs existing evidence associations, but discovery never ingests
    # connector assertions or creates identities. Filter stored labels in SQLite
    # and include exact live candidates for association lookup. This avoids
    # decoding every saved metadata/evidence document for a narrow search.
    with store._access() as db:
        db.create_function('pythia_native_id', 1, lambda value: json.loads(value)['native_id'].casefold())
        db.create_function('pythia_search_text', 1, normalized)
        select = '''SELECT m.id, m.native_key, m.scope, m.intent_subject,
            m.target, m.status, m.evidence_ids, l.data FROM mappings m LEFT JOIN catalogue_labels l
            ON l.native_key=m.native_key AND l.scope=m.scope WHERE '''
        words = normalized(query).split() or [query.casefold()]
        condition = ' AND '.join('instr(pythia_search_text(COALESCE(l.search_text, pythia_native_id(m.native_key))), ?) > 0' for _ in words)
        rows = {row['id']: row for row in db.execute(select + condition, words)}
        keys = list(native_keys)
        for start in range(0, len(keys), 100):
            # Details may enrich a search reference with qualifiers. Fetch the
            # same native catalogue identity, then require unique compatible
            # qualifiers in the search owner before attaching a retained ID.
            refs = [json.loads(key) for key in keys[start:start + 100]]
            clauses = ['(json_extract(m.native_key,\'$.provider\')=? AND json_extract(m.native_key,\'$.native_scope\')=? AND json_extract(m.native_key,\'$.native_id\')=?)'] * len(refs)
            args = [ref[field] for ref in refs for field in ('provider', 'native_scope', 'native_id')]
            rows.update((row['id'], row) for row in db.execute(select + ' OR '.join(clauses), args))
        result = []
        for row in sorted(rows.values(), key=lambda item: item['id']):
            value = dict(row)
            value['native_ref'] = json.loads(value.pop('native_key'))
            value['label'] = json.loads(value.pop('data')) if row['data'] else None
            value['evidence'] = evidence_rows(db, json.loads(value.pop('evidence_ids')))
            result.append(value)
        return result
