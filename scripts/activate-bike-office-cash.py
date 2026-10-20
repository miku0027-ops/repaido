#!/usr/bin/env python3
"""Explicit Cloud Shell maintenance for the owner's confirmed office cash pilot.

Calls the existing payroll and bike-policy handlers in one native transaction.
No HTTP server, account impersonation, role grants or payment records are created.
Cloud IAM authorizes access; the active Cloud Shell account is the audit actor.
Secret bindings are read into memory from the actual serving revision only.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import runpy
import subprocess
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'backend'))
PROJECT = 'repaido'
CENTRE = {'lat': 21.4934, 'lng': 86.9135}


def activate(u, *, driver_id, vehicle_id, period, policy_version, payroll_version, actor,
             coverage_paise=700000, preserve_saved_roster=False, expected_active_riders=1):
    from fastapi import FastAPI, Response
    from types import SimpleNamespace
    import bike_payroll
    import bike_rides
    from integrations import audit
    from local_business import digest
    from operations import fail

    p, payroll = bike_rides.policy(u), bike_payroll.policy(u)
    active = [row['driver_id'] for row in payroll['roster'] if row.get('active')]
    if type(coverage_paise) is not int or type(expected_active_riders) is not int or \
            expected_active_riders not in (1, 2, 3) or coverage_paise != expected_active_riders * bike_payroll.SALARY_PAISE:
        fail('CASH_COVERAGE_MISMATCH', 'Confirm the full office cash reserve for the expected salary roster.', 422)
    if not preserve_saved_roster and expected_active_riders != 1:
        fail('ROSTER_REVIEW_REQUIRED', 'Existing multiple-rider salaries require preserving the saved roster.', 409)
    identity = dict(driver_id=driver_id, vehicle_id=vehicle_id, period=period,
                    coverage_paise=coverage_paise, centre=CENTRE, radius_metres=8000)
    if preserve_saved_roster:
        identity['saved_roster_ids'] = sorted(active)
        identity['expected_active_riders'] = expected_active_riders
    intent = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
    key = digest('office-cash-pilot:'+driver_id+':'+period)
    previous = u.get('bike_launch_maintenance', key)
    if previous:
        if previous['intent'] != intent:
            fail('MAINTENANCE_CONFLICT', 'The saved pilot setup has different settings.', 409)
        if p['version'] != previous['policy_version'] or payroll['version'] != previous['payroll_version']:
            fail('MAINTENANCE_CHANGED', 'Company settings changed after setup; preserve them and review in Company Admin.', 409)
        return {**{name:value for name,value in previous.items() if name != 'previous_funding'},
                'status':'already_saved', 'mutations_performed':False,
                'bookings_available':bike_rides.public_policy(p,u)['bookings_available']}
    if period != bike_payroll.period_at():
        fail('CURRENT_SALARY_FUNDING_REQUIRED', 'The confirmed office cash reserve belongs to another month.', 422)
    if p['version'] != policy_version or payroll['version'] != payroll_version:
        fail('STALE', 'Company settings changed; inspect the latest versions before setup.', 409)
    if p['enabled']:
        fail('PILOT_ALREADY_ACTIVE', 'Review the existing active service instead of changing its launch settings.', 409)
    if p.get('service_center') != CENTRE or p['service_area_radius_metres'] != 8000:
        fail('SERVICE_AREA_CHANGED', 'The saved operating area differs from the delegated Balasore pilot defaults.', 409)
    if p['service_radius_metres'] != 4000 or p['pickup_radius_metres'] != 4000:
        fail('PILOT_LIMITS_CHANGED', 'The saved trip and pickup limits differ from the agreed pilot.', 409)
    month = u.get('bike_salary_periods', period) or {}
    obligations = set(month.get('driver_ids', [])) | set(active)
    if preserve_saved_roster:
        if len(active) != expected_active_riders or len(set(active)) != expected_active_riders or driver_id not in active:
            fail('SAVED_ROSTER_CHANGED', 'The saved roster differs from the reviewed rider count or selected rider.', 409)
        if obligations != set(active):
            fail('OTHER_SALARY_OBLIGATIONS', 'Additional earned salaries need their own confirmed coverage.', 409)
        roster = [{'driver_id':uid,'active':True} for uid in active]
    else:
        if obligations - {driver_id}:
            fail('OTHER_SALARY_OBLIGATIONS', 'The confirmed cash covers one rider; preserve and review other salary obligations.', 409)
        roster = [{'driver_id':driver_id,'active':True}]
    if payroll.get('monthly_funding_paise', 0) > coverage_paise:
        fail('EXISTING_COVERAGE_HIGHER', 'Preserve the higher recorded coverage and review it before setup.', 409)

    # These handlers use this Unit instead of opening independent transactions.
    # Their approval, funding, agreement, dispatch and policy gates stay intact.
    class SharedStore:
        def run(self, callback):
            return callback(u)
    def closed_identity():
        raise RuntimeError('This maintenance process exposes no authenticated HTTP server')
    core = SimpleNamespace(app=FastAPI(), operations_store=SharedStore(),
                           operator=closed_identity, current_user=closed_identity)
    bike_payroll.install(core)
    bike_rides.install(core)
    def endpoint(path, method):
        return next(route.endpoint for route in core.app.routes
                    if getattr(route,'path',None) == path and method in getattr(route,'methods',set()))
    reference = 'office-cash-reserve-'+period+'-'+key[:16]
    funding = bike_payroll.Policy(expected_version=payroll_version, enabled=True,
        salary_payment_method='office_cash', cash_collection_point='Company office',
        monthly_funding_paise=coverage_paise, funding_period=period, funding_reference=reference,
        funding_evidence=f'Platform owner confirmed INR {coverage_paise//100} available and reserved at the company office for {expected_active_riders} rider salary obligations for {period}. Salary remains owed until actual handover and rider receipt.',
        funding_acknowledged=True, roster=roster)
    endpoint('/operations/bike-rides/payroll','PUT')(body=funding,response=Response(),admin={'id':actor})
    bike_rides.authorized_vehicle(u,vehicle_id,driver_id)
    body = {name:p[name] for name in bike_rides.Policy.model_fields if name != 'expected_version' and name in p}
    body.update(expected_version=policy_version,enabled=True,service_area_reviewed=True)
    endpoint('/operations/bike-rides/admin/policy','PUT')(body=bike_rides.Policy(**body),admin={'id':actor})
    saved, salary = bike_rides.policy(u), bike_payroll.policy(u)
    public = bike_rides.public_policy(saved,u)
    if not public['bookings_available']:
        fail('PILOT_NOT_READY', 'Readiness changed; no pilot settings were committed.', 409)
    record = dict(id=key,intent=intent,actor_id=actor,source='explicit_cloud_shell_native_maintenance',
                  policy_version=saved['version'],payroll_version=salary['version'],
                  funding_period=period,office_cash_coverage_paise=coverage_paise,
                  active_rider_count=expected_active_riders,
                  salary_payment_method='office_cash',salary_paid=False,
                  rider_online_created=False,bookings_available=True)
    # Preserve the prior financial declaration privately when replacing it with
    # the owner's newly confirmed reserve. Do not print evidence in the receipt.
    history = {name:payroll.get(name) for name in ('version','monthly_funding_paise',
        'funding_period','funding_reference','funding_evidence','funding_acknowledged',
        'salary_payment_method','cash_collection_point')}
    u.put('bike_launch_maintenance',key,{**record,'previous_funding':history})
    audit(u,'BikeOfficeCashPilotActivated',actor,maintenance_id=key,
          driver_id=driver_id,vehicle_id=vehicle_id,funding_period=period,
          office_cash_coverage_paise=coverage_paise,active_rider_count=expected_active_riders,salary_paid=False,
          area_review_source='owner_delegated_saved_balasore_pilot_defaults')
    return {**record,'status':'activated','mutations_performed':True}


def read_bound_value(reader, setup, revision, name):
    entry = setup['environment'](revision).get(name,{})
    if isinstance(entry.get('value'),str) and entry['value'].strip():
        return entry['value']
    ref = entry.get('valueFrom',{}).get('secretKeyRef') or {}
    aliases = dict(item.split(':',1) for item in revision.get('metadata',{}).get('annotations',{}).get('run.googleapis.com/secrets','').split(',') if ':' in item)
    secret = aliases.get(ref.get('name'),ref.get('name',''))
    if '/' not in secret:
        secret = 'projects/repaido/secrets/'+secret
    version = str(ref.get('key',''))
    if not re.fullmatch(r'projects/(repaido|133610574058)/secrets/[A-Za-z0-9_-]+',secret) or not re.fullmatch(r'[1-9][0-9]*|latest',version):
        raise setup['SetupError']('The actual serving '+name+' binding could not be resolved.')
    url='https://secretmanager.googleapis.com/v1/'+secret+'/versions/'+version+':access'
    request=urllib.request.Request(url,headers={'Authorization':'Bearer '+reader,'X-Goog-User-Project':PROJECT})
    try:
        with urllib.request.urlopen(request,timeout=20) as response:payload=json.load(response)['payload']
        value=base64.b64decode(payload['data'],validate=True)
        if 'dataCrc32c' in payload:
            import google_crc32c
            if google_crc32c.value(value) != int(payload['dataCrc32c']):raise ValueError()
        return value.decode('utf-8')
    except Exception:
        raise setup['SetupError']('The actual serving secret binding could not be loaded; no settings were written.') from None


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory',required=True)
    parser.add_argument('--driver-id',required=True)
    parser.add_argument('--vehicle-id',required=True)
    parser.add_argument('--period',required=True,choices=['2026-10'])
    parser.add_argument('--expected-policy-version',type=int,required=True)
    parser.add_argument('--expected-payroll-version',type=int,required=True)
    parser.add_argument('--office-cash-available-paise',type=int,required=True,choices=[700000,1400000,2100000])
    parser.add_argument('--preserve-saved-roster',action='store_true')
    parser.add_argument('--expected-active-riders',type=int,choices=[1,2,3],default=1)
    parser.add_argument('--apply',action='store_true')
    args=parser.parse_args()
    setup=runpy.run_path(str(ROOT/'infra/bike-runtime/activate.py'))
    runner=setup['Runner']()
    directory,manifest=setup['load'](args.directory)
    if not (directory/'promoted.json').is_file():
        raise setup['SetupError']('The verified live API promotion receipt is required.')
    candidate=json.loads((directory/'candidate.json').read_text())
    setup['recover_promotion'](runner,type('Args',(),{'directory':str(directory)})())
    revision=runner.cloud('run','revisions','describe',candidate['revision'],'--region=us-central1')
    if setup['quota_binding'](revision) != manifest['quota_secret_version']:
        raise setup['SetupError']('Serving quota identity changed; no settings were written.')
    if os.getenv('FIRESTORE_EMULATOR_HOST'):
        raise setup['SetupError']('Cloud maintenance cannot use an emulator.')
    summary={'project':PROJECT,'action':'activate_confirmed_office_cash_pilot',
             'funding_period':args.period,'office_cash_coverage_paise':args.office_cash_available_paise,
             'preserve_saved_roster':args.preserve_saved_roster,'expected_active_riders':args.expected_active_riders,
             'salary_paid':False,'rider_online_created':False,'apply_requested':args.apply}
    if not args.apply:
        print(json.dumps(summary,indent=2));return
    token=runner.run(['gcloud','auth','print-access-token'],raw=True).strip()
    accounts=runner.run(['gcloud','auth','list','--filter=status:ACTIVE','--format=value(account)'],raw=True).strip().splitlines()
    if len(accounts)!=1 or not accounts[0]:
        raise setup['SetupError']('One active Cloud Shell audit identity is required.')
    for name in setup['ENVIRONMENT']:
        entry=setup['environment'](revision).get(name,{})
        if entry.get('value') != setup['ENVIRONMENT'][name]:
            raise setup['SetupError']('Serving dispatch configuration changed.')
        os.environ[name]=entry['value']
    for name in ('GOOGLE_ROUTES_API_KEY','REPAIDO_BIKE_PROMO_QUOTA_SECRET'):
        os.environ[name]=read_bound_value(token,setup,revision,name)
    from google.cloud.firestore import Client
    from google.oauth2.credentials import Credentials
    from types import SimpleNamespace
    from operations import Store
    database=Client(project=PROJECT,credentials=Credentials(token),client_options={'quota_project_id':PROJECT})
    try:
        core=SimpleNamespace(USE_FIRESTORE=True,fb_db=database,
            fs_collection=database.collection,
            fs_doc=lambda collection,key:database.collection(collection).document(key))
        result=Store(core).run(lambda u:activate(u,driver_id=args.driver_id,vehicle_id=args.vehicle_id,
            period=args.period,policy_version=args.expected_policy_version,
            payroll_version=args.expected_payroll_version,actor='cloud-shell:'+accounts[0],
            coverage_paise=args.office_cash_available_paise,preserve_saved_roster=args.preserve_saved_roster,
            expected_active_riders=args.expected_active_riders))
        setup['write_json'](directory/'office-cash-activated.json',result)
        public=setup['get_json'](manifest['baseline']['url'],'/api/operations/bike-rides/policy')
        print(json.dumps({**summary,'status':result['status'],
            'policy_version':result['policy_version'],'payroll_version':result['payroll_version'],
            'bookings_available_reported_by_server':public.get('bookings_available'),
            'receipt':str(directory/'office-cash-activated.json')},indent=2))
    finally:
        database.close()


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Do not echo cloud response bodies, secret values or funding evidence.
        from fastapi import HTTPException
        if isinstance(error,HTTPException):
            detail=error.detail if isinstance(error.detail,dict) else {}
            print('STOP: '+str(detail.get('message','Native business validation rejected the setup.')),file=sys.stderr)
        else:
            print('STOP: '+str(error) if type(error).__name__=='SetupError' else 'STOP: '+type(error).__name__+'; preserve records and inspect before retrying.',file=sys.stderr)
        raise SystemExit(1)
