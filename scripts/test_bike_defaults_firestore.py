"""Opt-in native REST checks. Loopback demo projects only; no cloud credentials."""
import importlib.util
import json
import os
from pathlib import Path
import re
import urllib.error
import urllib.request
import uuid

import pytest

SPEC = importlib.util.spec_from_file_location('native_launch_defaults', Path(__file__).with_name('configure-bike-launch-defaults.py'))
defaults = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(defaults)


@pytest.fixture
def db():
    host = os.getenv('FIRESTORE_EMULATOR_HOST', '')
    if os.getenv('REPAIDO_DEFAULTS_FIRESTORE_TEST') != '1' or not re.fullmatch(r'(127\.0\.0\.1|localhost):[1-9][0-9]{0,4}', host):
        pytest.skip('Explicit loopback Firestore emulator required.')
    project = 'demo-bike-defaults-' + uuid.uuid4().hex[:12]
    prefix = f'projects/{project}/databases/(default)/documents/'
    base = 'http://' + host + '/v1/' + prefix.rstrip('/')

    class Local:
        def request(self, suffix, body=None):
            request = urllib.request.Request(base+suffix, data=json.dumps(body).encode() if body is not None else None,
                                             headers={'Content-Type':'application/json'})
            with urllib.request.urlopen(request, timeout=10) as response:
                return json.load(response)

        def read(self, url, *, missing_ok=False):
            assert url.startswith(defaults.BASE+'/')
            try: return self.request(url[len(defaults.BASE):])
            except urllib.error.HTTPError as error:
                if missing_ok and error.code == 404: return None
                raise

        def commit(self, writes):
            # Only the test project differs; preserve every mask/precondition/value.
            def move(value):
                if isinstance(value, str) and value.startswith(defaults.DOCS):
                    return prefix+value[len(defaults.DOCS):]
                if isinstance(value, dict): return {key:move(item) for key,item in value.items()}
                if isinstance(value, list): return [move(item) for item in value]
                return value
            return self.request(':commit', {'writes': move(writes)})

        def put(self, path, row):
            return self.commit([{'update': defaults.document(path,row)}])

        def get(self, path):
            raw = self.read(defaults.BASE+'/'+path, missing_ok=True)
            return defaults.cloud.decode_document(raw) if raw else None

    local=Local()
    local.put(defaults.POLICY, {'version':1,'enabled':False,'service_center':None,
        'service_area_reviewed':True,'base_paise':800,'per_km_paise':500,'terms':'preserve actual company terms'})
    return local


def test_native_atomic_defaults_preserve_fares_and_require_real_review_and_funding(db):
    writes, _ = defaults.plan(db)
    result = db.commit(writes)
    assert result['commitTime'] and len(result['writeResults']) == len(writes)
    policy, payroll = db.get(defaults.POLICY), db.get(defaults.PAYROLL)
    assert policy['version']==2 and policy['base_paise']==800 and policy['per_km_paise']==500
    assert policy['terms']=='preserve actual company terms'
    assert policy['service_center']==defaults.CENTRE
    assert policy['enabled'] is False and policy['service_area_reviewed'] is False
    assert payroll['monthly_salary_paise']==700000 and payroll['monthly_funding_paise']==0
    assert payroll['enabled'] is False and payroll['funding_acknowledged'] is False and payroll['roster']==[]
    assert db.get(writes[-1]['update']['name'][len(defaults.DOCS):])['action']=='BikeLaunchDefaultsPrepared'
    assert defaults.plan(db)[0]==[]


def test_native_concurrent_company_edit_rolls_back_entire_default_commit(db):
    writes, _ = defaults.plan(db)
    db.put(defaults.POLICY, {'version':2,'enabled':False,'service_center':{'lat':21.5,'lng':86.9}})
    with pytest.raises(urllib.error.HTTPError): db.commit(writes)
    assert db.get(defaults.POLICY)['service_center']=={'lat':21.5,'lng':86.9}
    assert db.get(defaults.PAYROLL) is None
    assert db.get(writes[-1]['update']['name'][len(defaults.DOCS):]) is None


def test_native_payroll_only_verify_precondition_prevents_racing_service_activation(db):
    db.put(defaults.POLICY, {'version':2,'enabled':False,'service_center':defaults.CENTRE})
    writes, _ = defaults.plan(db)
    assert 'verify' in writes[0]
    db.put(defaults.POLICY, {'version':3,'enabled':True,'service_center':defaults.CENTRE})
    with pytest.raises(urllib.error.HTTPError): db.commit(writes)
    assert db.get(defaults.PAYROLL) is None
    assert db.get(defaults.POLICY)['enabled'] is True


def test_native_existing_payroll_and_its_private_evidence_are_preserved(db):
    original={'version':8,'enabled':True,'monthly_funding_paise':700000,'funding_reference':'actual-private-evidence'}
    db.put(defaults.PAYROLL, original)
    writes, _=defaults.plan(db)
    db.commit(writes)
    assert {key:db.get(defaults.PAYROLL)[key] for key in original}==original


def test_native_concurrent_payroll_creation_preserves_new_roster_and_rolls_back_centre(db):
    writes, _=defaults.plan(db)
    original={'version':1,'enabled':False,'roster':[{'driver_id':'actual-test-operator','active':True}]}
    db.put(defaults.PAYROLL, original)
    with pytest.raises(urllib.error.HTTPError): db.commit(writes)
    assert db.get(defaults.POLICY)['service_center'] is None
    assert db.get(defaults.PAYROLL)['roster']==original['roster']
