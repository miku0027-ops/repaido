"""Rules publishing compiles exact source and verifies the existing release."""
import importlib.util
import json
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location('deploy_rules', Path(__file__).resolve().parents[1] / 'scripts/deploy-firestore-rules.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class Client:
    project = 'repaido'
    release = 'projects/repaido/releases/cloud.firestore'

    def __init__(self, same=False, permissions=None, mismatch=False):
        self.requests=[]
        self.files=[{'name':'firestore.rules','content':'tested source'}]
        self.same=same
        self.permissions=list(deploy.PERMISSIONS) if permissions is None else permissions
        self.ruleset='projects/repaido/rulesets/prior'
        self.mismatch=mismatch

    def request(self, method, resource, body=None, **options):
        self.requests.append((method,resource,body,options))
        if resource.endswith(':testIamPermissions'):
            return {'permissions':self.permissions}
        if method=='GET' and resource==self.release:
            return {'name':self.release,'rulesetName':self.ruleset}
        if method=='GET':
            return {'source':{'files':self.files if self.same or resource.endswith('/new') else []}}
        if method=='POST':
            assert body=={'source':{'files':self.files}}
            return {'name':'projects/repaido/rulesets/new'}
        if method=='PATCH':
            assert body=={'release':{'name':self.release,'rulesetName':'projects/repaido/rulesets/new'}}
            if not self.mismatch:self.ruleset=body['release']['rulesetName']
            return {'name':self.release}


def test_missing_permissions_fail_before_rules_or_release_write(tmp_path):
    client=Client(permissions=['firebaserules.releases.get'])
    with pytest.raises(RuntimeError,match='rulesets.create'):
        deploy.publish(client,'tested source',tmp_path/'receipt.json')
    assert len(client.requests)==1 and client.requests[0][3]=={'iam':True}


def test_same_source_skips_rule_writes_and_records_digest(tmp_path):
    client=Client(same=True)
    deploy.publish(client,'tested source',tmp_path/'receipt.json')
    assert all(method=='GET' or resource.endswith(':testIamPermissions') for method,resource,*_ in client.requests)
    receipt=json.loads((tmp_path/'receipt.json').read_text())
    assert receipt['ruleset']==client.ruleset and len(receipt['source_sha256'])==64


def test_changed_source_is_compiled_read_back_and_published_before_receipt(tmp_path):
    client=Client()
    deploy.publish(client,'tested source',tmp_path/'receipt.json')
    assert [method for method,*_ in client.requests]==['POST','GET','GET','POST','GET','PATCH','GET']
    assert json.loads((tmp_path/'receipt.json').read_text())['ruleset'].endswith('/new')


def test_unconfirmed_release_does_not_record_publication(tmp_path):
    client=Client(mismatch=True)
    with pytest.raises(RuntimeError,match='did not match'):
        deploy.publish(client,'tested source',tmp_path/'receipt.json')
    assert not (tmp_path/'receipt.json').exists()


@pytest.mark.parametrize('release', [{}, {'name':'projects/other/releases/cloud.firestore','rulesetName':'projects/repaido/rulesets/prior'},
                                    {'name':'projects/repaido/releases/cloud.firestore','rulesetName':'projects/other/rulesets/prior'}])
def test_existing_release_identity_is_required_before_rules_write(tmp_path,release):
    client=Client()
    original=client.request
    def request(method,resource,*args,**options):
        if method=='GET' and resource==client.release:return release
        return original(method,resource,*args,**options)
    client.request=request
    with pytest.raises(RuntimeError,match='existing default'):
        deploy.publish(client,'tested source',tmp_path/'receipt.json')
    assert all(method!='PATCH' and (method!='POST' or resource.endswith(':testIamPermissions')) for method,resource,*_ in client.requests)
    assert not (tmp_path/'receipt.json').exists()


def test_compiled_source_mismatch_never_changes_active_release(tmp_path):
    client=Client()
    original=client.request
    def request(method,resource,*args,**options):
        if method=='GET' and resource.endswith('/new'):return {'source':{'files':[{'name':'firestore.rules','content':'different source'}]}}
        return original(method,resource,*args,**options)
    client.request=request
    with pytest.raises(RuntimeError,match='does not match'):
        deploy.publish(client,'tested source',tmp_path/'receipt.json')
    assert not any(method=='PATCH' for method,*_ in client.requests)
    assert not (tmp_path/'receipt.json').exists()


@pytest.mark.parametrize('status',[403,404,500])
def test_rules_http_failure_does_not_expose_auth_or_claim_publication(monkeypatch,status):
    import urllib.error
    def fail(request,**options):
        raise urllib.error.HTTPError(request.full_url,status,'Provider error',{},None)
    monkeypatch.setattr(deploy.urllib.request,'urlopen',fail)
    client=deploy.RulesClient.__new__(deploy.RulesClient)
    client.project='repaido';client.token='secret-test-credential'
    with pytest.raises(RuntimeError,match='HTTP '+str(status)) as error:
        client.request('GET',client.project+'/releases/cloud.firestore')
    assert client.token not in str(error.value)


def test_rule_source_fingerprints_do_not_trigger_republication(tmp_path):
    client=Client(same=True)
    client.files[0]['fingerprint']='server-computed-metadata'
    deploy.publish(client,'tested source',tmp_path/'receipt.json')
    assert not any(method=='PATCH' for method,*_ in client.requests)
