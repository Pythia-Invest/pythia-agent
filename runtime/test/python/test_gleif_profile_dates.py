"""Synthetic GLEIF date/timestamp shapes; source JSON:API docs cited by fixtures."""
import unittest

from test_gleif_connector import (
    FIRST, STAMP, Transport, connector, parent, plugin, profiles, record, records, wire,
)


def fields(summary):
    return {field['key']: field for field in summary['fields']}


class GleifProfileDates(unittest.TestCase):
    def test_native_instants_and_period_dates_preserve_source_precision(self):
        row = record()
        row['attributes']['registration']['nextRenewalDate'] = '2027-03-01T01:15:00.123+02:00'
        summary = profiles.profile(row, STAMP)
        relation = parent()
        relation['data']['attributes']['registration']['lastUpdateDate'] = '2025-10-03T08:10:12Z'
        relation['data']['attributes']['validTo'] = '2026-01-01T00:00:00Z'
        profiles.add_parent(summary, 'direct', 'direct-parent-relationship', relation, records.BASE)
        values = fields(summary)
        for key, expected in {
            'record_updated_at': STAMP,
            'next_renewal_at': '2027-03-01T01:15:00.123+02:00',
            'direct_parent_last_update': '2025-10-03T08:10:12Z',
            'direct_parent_valid_from': '2020-01-01T00:00:00Z',
            'direct_parent_valid_to': '2026-01-01T00:00:00Z',
        }.items():
            self.assertEqual((values[key]['value'], values[key]['value_type']), (expected, 'instant'))
        for key, expected in [('startDate', '2024-01-01'), ('endDate', '2024-12-31')]:
            item = values['direct_parent_period_0_' + key]
            self.assertEqual((item['value'], item['value_type']), (expected, 'date'))

    def test_reporting_exceptions_classify_actual_date_not_field_name(self):
        summary = profiles.profile(record(), STAMP)
        exception = {'data': {'type': 'reporting-exceptions', 'attributes': {'lei': FIRST,
            'category': 'ULTIMATE_ACCOUNTING_CONSOLIDATION_PARENT', 'reason': 'NON_PUBLIC',
            'validFrom': '2024-02-29', 'validTo': '2025-03-01T00:00:00Z'}}}
        profiles.add_parent(summary, 'ultimate', 'ultimate-parent-reporting-exception', exception, records.BASE)
        values = fields(summary)
        self.assertEqual(values['ultimate_exception_validFrom']['value_type'], 'date')
        self.assertEqual(values['ultimate_exception_validTo']['value_type'], 'instant')

    def test_malformed_registration_dates_are_rejected_before_shared_cache(self):
        url = records.endpoint(FIRST)
        for bad in ('2025-02-29', '2026-13-01T00:00:00Z', '2026-01-01T25:00:00Z',
                    '2026-01-01T00:00:00', '2026-01-01T00:00:00+24:00',
                    '2026-01-01T00:00:00+01:60', '', 7):
            with self.subTest(value=bad):
                malformed = record()
                malformed['attributes']['registration']['lastUpdateDate'] = bad
                transport = Transport({url: {'data': malformed}})
                reader = plugin.Reader(wire, connector, transport=transport)
                rejected = reader.invoke('resolve', {'identifiers': {'lei': FIRST}})
                self.assertEqual(rejected['issues'][0]['code'], 'invalid_response')
                transport.responses[url] = {'data': record()}
                recovered = reader.invoke('profile', {'native_ref': records.reference(FIRST)})
                self.assertEqual(recovered['outcome'], 'ok', recovered)
                self.assertEqual(len(transport.calls), 2)

    def test_invalid_parent_period_retains_profile_without_poisoning_parent_cache(self):
        url, parent_url = records.endpoint(FIRST), records.endpoint(FIRST, 'direct-parent-relationship')
        row = record()
        row['relationships']['direct-parent'] = {'links': {'relationship-record': parent_url}}
        malformed = parent()
        malformed['data']['attributes']['relationship']['periods'][0]['endDate'] = '2024-02-30'
        transport = Transport({url: {'data': row}, parent_url: malformed})
        reader = plugin.Reader(wire, connector, transport=transport)
        args = {'native_ref': records.reference(FIRST)}
        rejected = reader.invoke('profile', args)
        self.assertEqual(rejected['outcome'], 'partial')
        self.assertEqual(rejected['issues'][0]['code'], 'invalid_response')
        self.assertEqual(rejected['data']['relationships'], [])
        transport.responses[parent_url] = parent()
        recovered = reader.invoke('profile', args)
        self.assertEqual(recovered['outcome'], 'ok', recovered)
        self.assertEqual(len(transport.calls), 3)


if __name__ == '__main__':
    unittest.main()
