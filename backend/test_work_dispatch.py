import base64
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import work_dispatch
from test_repaidians import api


def enabled(monkeypatch):
    monkeypatch.setenv('REPAIDO_WORK_EVENT_DISPATCH_ENABLED','true')
    monkeypatch.setenv('REPAIDO_WORK_EVENT_QUEUE','projects/repaido/locations/us-central1/queues/repaido-work-events')
    monkeypatch.setenv('REPAIDO_WORK_EVENT_WORKER_URL','https://repaido-work-worker-123.us-central1.run.app')
    monkeypatch.setenv('REPAIDO_WORK_EVENT_CALLER_EMAIL','repaido-work-scheduler@repaido.iam.gserviceaccount.com')


def test_events_require_complete_trusted_configuration(monkeypatch):
    monkeypatch.delenv('REPAIDO_WORK_EVENT_DISPATCH_ENABLED',raising=False)
    assert work_dispatch.configuration() is None
    enabled(monkeypatch)
    assert work_dispatch.configuration()
    for bad in ('https://external.example','http://worker.run.app','https://worker.run.app:bad','https://worker.run.app/private','https://worker.run.app/?token=x'):
        monkeypatch.setenv('REPAIDO_WORK_EVENT_WORKER_URL',bad)
        assert work_dispatch.configuration() is None


def test_task_is_coalesced_and_contains_no_private_event_data(monkeypatch):
    enabled(monkeypatch)
    work_dispatch.ATTEMPTS.clear()
    calls=[]
    class Transport:
        def post(self,url,**kwargs):
            calls.append((url,kwargs));return SimpleNamespace(status_code=409)
    assert work_dispatch.submit(Transport(),now=100)
    assert work_dispatch.submit(Transport(),now=109)
    assert len(calls)==1
    assert work_dispatch.submit(Transport(),now=110)
    assert calls[0][1]['json']['task']['name']!=calls[1][1]['json']['task']['name']
    task=calls[0][1]['json']['task']
    assert base64.b64decode(task['httpRequest']['body'])==b'{"limit":40}'
    assert task['httpRequest']['oidcToken']['audience']=='https://repaido-work-worker-123.us-central1.run.app'
    assert task['httpRequest']['url'].endswith('/internal/work/dispatch')
    assert calls[0][1]['timeout']==2


def test_only_successfully_committed_outbox_writes_signal_a_worker(api,monkeypatch):
    enabled(monkeypatch)
    marker=[];token=work_dispatch.PENDING.set(marker)
    try:
        def fail(u):
            u.put('rp_work_project_queue','failed',{'active':True})
            raise ValueError('rollback')
        with pytest.raises(ValueError):api.core.operations_store.run(fail)
        assert marker==[]
        assert api.core.operations_store.run(lambda u:u.get('rp_work_project_queue','failed')) is None
        api.core.operations_store.run(lambda u:u.put('rp_work_project_queue','inactive',{'active':False}))
        assert marker==[]
        api.core.operations_store.run(lambda u:u.put('rp_work_project_queue','committed',{'active':True}))
        assert marker==[True]
    finally:work_dispatch.PENDING.reset(token)


def test_worker_submission_occurs_after_the_response_body(api,monkeypatch):
    enabled(monkeypatch)
    submitted=[];monkeypatch.setattr(work_dispatch,'submit',lambda:submitted.append('sent'))
    @api.core.app.post('/event-test')
    def event_test():
        api.core.operations_store.run(lambda u:u.put('rp_work_project_queue','request',{'active':True}))
        assert submitted==[]
        return {'saved':True}
    # The existing fixture has already built its ASGI stack; use a new wrapper.
    wrapper=work_dispatch.WorkEventDispatchMiddleware(api.core.app)
    with TestClient(wrapper) as client:
        assert client.post('/event-test').json()=={'saved':True}
    assert submitted==['sent']
