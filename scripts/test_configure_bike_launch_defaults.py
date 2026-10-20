"""Conditional, minimal default writes; never manufacture launch/funding approval."""
import datetime as dt
import importlib.util
import io
import json
from pathlib import Path
import unittest
from contextlib import redirect_stdout, redirect_stderr
from unittest.mock import patch
import urllib.parse

SPEC = importlib.util.spec_from_file_location('launch_defaults', Path(__file__).with_name('configure-bike-launch-defaults.py'))
defaults = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(defaults)
NOW = dt.datetime(2026, 10, 31, 20, tzinfo=dt.timezone.utc).timestamp()
PRIVATE = 'private-funding-reference-never-printed'


def raw(path, row):
    return {**defaults.document(path, row), 'updateTime': '2026-10-20T01:00:00.123456Z'}


class Reader:
    def __init__(self, centre=None, payroll=None, enabled=False):
        self.policy = raw(defaults.POLICY, {'version': 1, 'enabled': enabled,
            'service_center': centre, 'base_paise': 800, 'terms': PRIVATE})
        self.payroll = raw(defaults.PAYROLL, payroll) if payroll is not None else None
        self.calls = []

    def read(self, url, *, missing_ok=False):
        self.calls.append(url)
        assert missing_ok
        query = urllib.parse.urlsplit(url)
        row = self.policy if query.path.endswith('/'+defaults.POLICY) else self.payroll
        if row is None: return None
        fields = urllib.parse.parse_qs(query.query)['mask.fieldPaths']
        return {**row, 'fields': {k: v for k, v in row['fields'].items() if k in fields}}


def decode(write):
    return defaults.cloud.decode_document(write['update'])


class DefaultsTests(unittest.TestCase):
    def test_missing_defaults_are_minimal_conditional_unfunded_and_not_enrolled(self):
        reader = Reader()
        writes, summary = defaults.plan(reader, NOW)
        self.assertEqual(len(writes), 3)
        policy, payroll, audit = map(decode, writes)
        self.assertEqual(policy['service_center'], defaults.CENTRE)
        self.assertEqual(policy['version'], 2)
        self.assertIs(policy['service_area_reviewed'], False)
        self.assertNotIn('enabled', policy)
        self.assertNotIn('terms', policy)
        self.assertNotIn('base_paise', policy)
        self.assertEqual(set(writes[0]['updateMask']['fieldPaths']), set(policy)-{'_document_id'})
        self.assertEqual(writes[0]['currentDocument'], {'updateTime': reader.policy['updateTime']})
        self.assertEqual(writes[1]['currentDocument'], {'exists': False})
        self.assertEqual(payroll['monthly_salary_paise'], 700000)
        self.assertEqual(payroll['monthly_funding_paise'], 0)
        self.assertEqual(payroll['funding_period'], '2026-11')
        self.assertEqual(payroll['roster'], [])
        for key in ('enabled', 'funding_acknowledged'): self.assertIs(payroll[key], False)
        self.assertEqual(payroll['funding_reference'], '')
        self.assertEqual(payroll['funding_evidence'], '')
        self.assertEqual(audit['action'], 'BikeLaunchDefaultsPrepared')
        self.assertNotIn(PRIVATE, json.dumps(summary))
        self.assertFalse(summary['bookings_enabled'])

    def test_existing_location_and_payroll_are_preserved_without_any_write(self):
        reader = Reader({'lat': 21.5, 'lng': 86.9}, {'version': 12, 'funding_reference': PRIVATE})
        writes, summary = defaults.plan(reader, NOW)
        self.assertEqual(writes, [])
        self.assertEqual(summary['changes'], [])
        self.assertEqual(summary['centre'], 'existing_location_preserved')
        self.assertNotIn(PRIVATE, json.dumps(summary))

    def test_payroll_only_creation_still_verifies_paused_policy_snapshot_atomically(self):
        reader = Reader({'lat': 21.5, 'lng': 86.9})
        writes, summary = defaults.plan(reader, NOW)
        self.assertEqual(writes[0], {'verify': defaults.DOCS+defaults.POLICY,
            'currentDocument': {'updateTime': reader.policy['updateTime']}})
        self.assertEqual(summary['changes'], ['disabled_salary_template'])

    def test_existing_payroll_is_not_overwritten_when_centre_is_missing(self):
        writes, summary = defaults.plan(Reader(payroll={'version': 5, 'funding_reference': PRIVATE}), NOW)
        self.assertEqual(len(writes), 2)
        self.assertFalse(any(row.get('update', {}).get('name') == defaults.DOCS+defaults.PAYROLL for row in writes))
        self.assertEqual(summary['salary_template'], 'existing_policy_preserved')

    def test_live_or_unversioned_policy_stops_before_writes(self):
        for enabled in (True, None, 'false'):
            with self.assertRaises(defaults.cloud.InventoryError): defaults.plan(Reader(enabled=enabled), NOW)
        reader = Reader(); reader.policy.pop('updateTime')
        with self.assertRaises(defaults.cloud.InventoryError): defaults.plan(reader, NOW)

    def test_preview_cli_never_commits(self):
        class Preview(Reader):
            def commit_defaults(self, writes): raise AssertionError('preview must not write')
        output = io.StringIO()
        with patch.object(defaults.cloud, 'oauth_token', return_value='opaque'), patch.object(defaults, 'Writer', return_value=Preview()), redirect_stdout(output):
            self.assertEqual(defaults.main([]), 0)
        result = json.loads(output.getvalue())
        self.assertEqual(result['status'], 'preview')
        self.assertFalse(result['mutations_performed'])

    def test_uncertain_apply_response_is_not_retried_or_reported_as_saved(self):
        class Partial(Reader):
            def __init__(self): super().__init__(); self.commits=0
            def commit_defaults(self, writes): self.commits+=1; return {'writeResults': []}
        reader = Partial(); output = io.StringIO(); errors = io.StringIO()
        with patch.object(defaults.cloud, 'oauth_token', return_value='opaque'), patch.object(defaults, 'Writer', return_value=reader), redirect_stdout(output), redirect_stderr(errors):
            self.assertEqual(defaults.main(['--apply']), 1)
        self.assertEqual(reader.commits, 1)
        self.assertEqual(output.getvalue(), '')
        result = json.loads(errors.getvalue())
        self.assertEqual(result['status'], 'outcome_unknown_check_before_retry')
        self.assertIsNone(result['mutations_performed'])

    def test_success_records_actual_commit_and_preserves_noop_idempotency(self):
        class Saved(Reader):
            def commit_defaults(self, writes): return {'commitTime': '2026-10-20T01:00:01Z', 'writeResults': [{} for _ in writes]}
        output = io.StringIO()
        with patch.object(defaults.cloud, 'oauth_token', return_value='opaque'), patch.object(defaults, 'Writer', return_value=Saved()), redirect_stdout(output):
            self.assertEqual(defaults.main(['--apply']), 0)
        self.assertTrue(json.loads(output.getvalue())['mutations_performed'])
        output = io.StringIO()
        with patch.object(defaults.cloud, 'oauth_token', return_value='opaque'), patch.object(defaults, 'Writer', return_value=Reader(centre=defaults.CENTRE,payroll={})), redirect_stdout(output):
            self.assertEqual(defaults.main(['--apply']), 0)
        self.assertFalse(json.loads(output.getvalue())['mutations_performed'])


if __name__ == '__main__': unittest.main()
