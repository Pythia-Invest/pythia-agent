"""Synthetic GLEIF branch relationship records; fixtures cite JSON:API docs."""
from copy import deepcopy
import unittest

from test_gleif_connector import (
    FIRST, SECOND, STAMP, Transport, connector, parent, plugin, profiles, record, records, wire,
)


def branch():
    row = record()
    row['attributes']['entity']['category'] = 'BRANCH'
    row['relationships']['head-office'] = {'links': {
        'lei-record': records.endpoint(FIRST) + '/head-office',
        'relationship-record': records.endpoint(FIRST, 'head-office-relationship')}}
    return row


def relationship():
    value = parent()
    attributes = value['data']['attributes']
    attributes['relationship']['type'] = 'IS_INTERNATIONAL_BRANCH_OF'
    attributes['registration'].update(corroborationLevel='FULLY_CORROBORATED', lastUpdateDate=STAMP)
    return value


class GleifBranches(unittest.TestCase):
    def test_head_office_is_a_typed_relationship_with_distinct_native_identity(self):
        url, relation_url = records.endpoint(FIRST), records.endpoint(FIRST, 'head-office-relationship')
        transport = Transport({url: {'data': branch()}, relation_url: relationship()})
        reader = plugin.Reader(wire, connector, transport=transport)
        result = reader.invoke('profile', {'native_ref': records.reference(FIRST)})
        self.assertEqual(result['outcome'], 'ok', result)
        summary = result['data']
        self.assertEqual(summary['provider_ref'], records.reference(FIRST))
        self.assertEqual(summary['relationships'], [{'kind': 'IS_INTERNATIONAL_BRANCH_OF',
            'target': {'scheme': 'lei', 'value': SECOND, 'name': None}, 'source_url': relation_url}])
        fields = {field['key']: field for field in summary['fields']}
        self.assertEqual(fields['head_office_status']['value'], 'ACTIVE')
        self.assertEqual(fields['head_office_registration']['value'], 'LAPSED')
        self.assertEqual(fields['head_office_corroboration']['value'], 'FULLY_CORROBORATED')
        self.assertEqual(fields['head_office_last_update']['value_type'], 'instant')
        self.assertEqual(fields['head_office_period_0_endDate']['value_type'], 'date')
        self.assertEqual([request['url'] for request, _ in transport.calls], [url, relation_url])

    def test_only_the_constructed_relationship_endpoint_is_admitted(self):
        row = branch()
        expected = records.endpoint(FIRST, 'head-office-relationship')
        self.assertEqual(profiles.parent_requests(row), [('head-office', 'head-office-relationship', expected)])
        # The separate entity resource is not fetched or used as relationship proof.
        row['relationships']['head-office']['links']['lei-record'] = 'https://elsewhere.invalid/entity'
        self.assertEqual(profiles.parent_requests(row), [('head-office', 'head-office-relationship', expected)])
        for url in ('https://elsewhere.invalid/relationship', records.endpoint(SECOND, 'head-office-relationship'),
                    expected + '?follow=true'):
            row['relationships']['head-office']['links']['relationship-record'] = url
            with self.assertRaisesRegex(ValueError, 'invalid_response'):
                profiles.parent_requests(row)
        with self.assertRaisesRegex(ValueError, 'invalid_request'):
            records.endpoint(FIRST, 'head-office')

    def test_incorrect_nodes_types_and_identifiers_cannot_publish_a_branch_edge(self):
        mutations = [
            lambda r: r['startNode'].update(id=SECOND),
            lambda r: r['startNode'].update(type='ISIN'),
            lambda r: r['endNode'].update(type='ISIN'),
            lambda r: r['endNode'].update(id='NOT_A_LEI'),
            lambda r: r['endNode'].update(id=FIRST),
            lambda r: r.update(type='IS_DIRECTLY_CONSOLIDATED_BY'),
        ]
        for change in mutations:
            payload = relationship()
            change(payload['data']['attributes']['relationship'])
            summary = profiles.profile(branch(), STAMP)
            with self.assertRaisesRegex(ValueError, 'invalid_response'):
                profiles.add_parent(summary, 'head-office', 'head-office-relationship', payload, records.BASE)
            self.assertEqual(summary['relationships'], [])

    def test_inactive_and_time_bounded_records_preserve_facts_without_current_edge(self):
        variations = [
            lambda a: a['relationship'].update(status='INACTIVE'),
            lambda a: a.update(validTo='2026-01-01T00:00:00Z'),
            lambda a: a['relationship']['periods'].append(
                {'type': 'RELATIONSHIP_PERIOD', 'endDate': '2025-12-31'}),
        ]
        for change in variations:
            payload = relationship()
            change(payload['data']['attributes'])
            summary = profiles.profile(branch(), STAMP)
            profiles.add_parent(summary, 'head-office', 'head-office-relationship', payload, records.BASE)
            self.assertEqual(summary['relationships'], [])
            fields = {field['key']: field['value'] for field in summary['fields']}
            self.assertEqual(fields['head_office_reported_lei'], SECOND)
            self.assertEqual(fields['head_office_corroboration'], 'FULLY_CORROBORATED')

    def test_malformed_branch_payload_is_partial_retryable_and_never_cached(self):
        url, relation_url = records.endpoint(FIRST), records.endpoint(FIRST, 'head-office-relationship')
        malformed = relationship()
        malformed['data']['attributes']['validFrom'] = '2025-02-30'
        transport = Transport({url: {'data': branch()}, relation_url: malformed})
        reader = plugin.Reader(wire, connector, transport=transport)
        args = {'native_ref': records.reference(FIRST)}
        failed = reader.invoke('profile', args)
        self.assertEqual(failed['outcome'], 'partial')
        self.assertEqual(failed['issues'][0]['code'], 'invalid_response')
        self.assertTrue(failed['data']['fields'])
        self.assertEqual(failed['data']['relationships'], [])
        transport.responses[relation_url] = deepcopy(relationship())
        repaired = reader.invoke('profile', args)
        self.assertEqual(repaired['outcome'], 'ok', repaired)
        self.assertEqual(repaired['data']['relationships'][0]['target']['value'], SECOND)
        self.assertEqual([request['url'] for request, _ in transport.calls], [url, relation_url, relation_url])


if __name__ == '__main__':
    unittest.main()
