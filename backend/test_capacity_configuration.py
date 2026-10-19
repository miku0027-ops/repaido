"""Capacity planning stays read-only and release staging cannot promote traffic."""
import importlib.util
from pathlib import Path
import pytest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('configure_resilience', ROOT/'scripts/configure-resilience.py')
capacity=importlib.util.module_from_spec(spec); spec.loader.exec_module(capacity)
PROFILE={'min_instances':1,'max_instances':16,'concurrency':24,'cpu':1,'memory':'1Gi','max_inflight':24,'max_waiting':16}
IMAGE='us-central1-docker.pkg.dev/repaido/backend/api@sha256:'+'a'*64


def inventory():
    return {'metadata':{'name':'repaido-api'},'spec':{'template':{'spec':{'containerConcurrency':24,
        'containers':[{'image':IMAGE,'env':[{'name':'SECRET','value':'must-never-print'}],'resources':{'limits':{'cpu':'1'}}}]}}},
        'status':{'latestReadyRevisionName':'api-1','latestCreatedRevisionName':'api-1','traffic':[{'revisionName':'api-1','percent':100}]}}


def test_plan_inventory_withholds_all_env_and_secret_bindings():
    value=capacity.summary(inventory())
    assert 'must-never-print' not in str(value) and 'SECRET' not in str(value)
    assert value['images']==[IMAGE] and value['traffic'][0]['percent']==100


@pytest.mark.parametrize('key,value', [('max_instances',101), ('max_waiting',0), ('concurrency',25), ('cpu',4), ('memory','512Mi'), ('min_instances',17)])
def test_capacity_rejects_unreviewed_or_inconsistent_bounds(key,value):
    with pytest.raises(ValueError): capacity.capacity({**PROFILE,key:value})


def test_staging_preserves_image_routes_secrets_and_sets_correct_service_gate():
    for service,prefix in [('repaido-api','REPAIDO_API'),('repaido-work-api','REPAIDO_WORK')]:
        args=capacity.update_arguments(service,'repaido','us-central1',PROFILE,'b'*40,IMAGE)
        assert '--no-traffic' in args and '--image='+IMAGE in args
        assert '--update-env-vars='+prefix+'_MAX_INFLIGHT=24,'+prefix+'_MAX_WAITING=16' in args
        assert not any('secret' in item or 'ingress' in item or 'allow-unauthenticated' in item or item=='deploy' for item in args)


def test_release_guards_detect_revision_image_canary_and_dirty_source(monkeypatch):
    current=capacity.summary(inventory())
    monkeypatch.setattr(capacity.subprocess,'check_output',lambda args,**kw:'b'*40 if args[1]=='rev-parse' else '')
    capacity.validate_release('b'*40,True,'api-1',IMAGE,current)
    for changed in [{**current,'latest_created_revision':'api-2'}, {**current,'images':['different@sha256:'+'c'*64]},
                    {**current,'traffic':[{'revision':'api-1','percent':90},{'revision':'api-2','percent':10}]}]:
        with pytest.raises(ValueError): capacity.validate_release('b'*40,True,'api-1',IMAGE,changed)
    with pytest.raises(ValueError): capacity.validate_release('b'*40,False,'api-1',IMAGE,current)
    monkeypatch.setattr(capacity.subprocess,'check_output',lambda args,**kw:'b'*40 if args[1]=='rev-parse' else ' M file')
    with pytest.raises(ValueError): capacity.validate_release('b'*40,True,'api-1',IMAGE,current)
