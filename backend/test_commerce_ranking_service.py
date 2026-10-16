"""The optional private scorer transports only bounded anonymous evidence."""
import json
import threading
import time
from types import SimpleNamespace
from unittest.mock import Mock
import pytest
from fastapi.testclient import TestClient
import commerce_ranking as ranking
import commerce_ranking_client as client
import commerce_ranking_service as service
from test_commerce_ranking import FEATURES
URL='https://repaido-commerce-ranking-123.us-central1.run.app'
CALLER='api-runtime@example.iam.gserviceaccount.com'


def test_private_service_checks_google_audience_and_exact_verified_service_identity(monkeypatch):
    monkeypatch.setenv('REPAIDO_COMMERCE_RANKING_AUDIENCE',URL)
    monkeypatch.setenv('REPAIDO_COMMERCE_RANKING_CALLER_EMAIL',CALLER)
    from google.oauth2 import id_token
    claims={'iss':'https://accounts.google.com','email':CALLER,'email_verified':True}
    verifier=Mock(return_value=claims);monkeypatch.setattr(id_token,'verify_oauth2_token',verifier)
    with TestClient(service.create_app()) as api:
        url='/internal/commerce/rank';body={'candidates':[FEATURES]}
        assert api.post(url,json=body).status_code==401
        assert api.post(url,json=body,headers={'Authorization':'Bearer fixture'}).json()==ranking.rank(body)
        assert verifier.call_args.kwargs['audience']==URL
        for change in ({'email':'wrong@example.iam.gserviceaccount.com'},{'iss':'https://unknown.test'},{'email_verified':False}):
            verifier.return_value={**claims,**change}
            assert api.post(url,json=body,headers={'Authorization':'Bearer fixture'}).status_code==403
        monkeypatch.delenv('REPAIDO_COMMERCE_RANKING_CALLER_EMAIL')
        assert api.post(url,json=body).status_code==503


@pytest.mark.parametrize('url',['','http://localhost:8000','https://untrusted.test',URL+'/path'])
def test_disabled_or_untrusted_remote_never_asks_identity_or_network(monkeypatch,url):
    monkeypatch.setenv('REPAIDO_COMMERCE_RANKING_URL',url)
    monkeypatch.setattr(client,'identity_token',Mock(side_effect=AssertionError('No identity discovery')))
    monkeypatch.setattr(client,'send_scoring',Mock(side_effect=AssertionError('No outbound call')))
    assert client.rank_candidates([FEATURES])==ranking.rank({'candidates':[FEATURES]})


def test_remote_parity_no_pii_malformed_and_timeout_fallback(monkeypatch,caplog):
    monkeypatch.setenv('REPAIDO_COMMERCE_RANKING_URL',URL)
    monkeypatch.setattr(client,'_failed_until',0)
    monkeypatch.setattr(client,'ready_identity_token',lambda url:'PRIVATE_IDENTITY')
    expected=ranking.rank({'candidates':[FEATURES]});payload=[json.dumps(expected).encode()];calls=[]
    class Reply:
        def __enter__(self):return SimpleNamespace(read=lambda n:payload[0])
        def __exit__(self,*args):pass
    def send(request,timeout):
        calls.append(request)
        assert timeout==1 and request.full_url==URL+'/internal/commerce/rank'
        assert json.loads(request.data)=={'candidates':[FEATURES]}
        return Reply()
    monkeypatch.setattr(client,'send_scoring',send)
    assert client.rank_candidates([FEATURES])==expected
    payload[0]=b'{"version":"stale-version","scores":[]}'
    assert client.rank_candidates([FEATURES])==expected
    assert client.rank_candidates([FEATURES])==expected and len(calls)==2
    monkeypatch.setattr(client,'_failed_until',0)
    monkeypatch.setattr(client,'send_scoring',Mock(side_effect=TimeoutError('PRIVATE_UPSTREAM')))
    assert client.rank_candidates([FEATURES])==expected
    assert 'PRIVATE_' not in caplog.text


def test_background_identity_discovery_is_bounded_and_never_delays_native_rank(monkeypatch):
    entered,release=threading.Event(),threading.Event()
    monkeypatch.setenv('REPAIDO_COMMERCE_RANKING_URL',URL)
    for key,value in (('_token',None),('_token_url',None),('_failed_until',0),('_token_refreshing',False)):monkeypatch.setattr(client,key,value)
    calls=[]
    def identity(url):
        calls.append(url);entered.set();assert release.wait(2)
        return SimpleNamespace(valid=True,token='fixture')
    monkeypatch.setattr(client,'identity_token',identity)
    monkeypatch.setattr(client,'send_scoring',Mock(side_effect=AssertionError('No token ready')))
    started=time.perf_counter()
    try:
        for _ in range(20):assert client.rank_candidates([FEATURES])==ranking.rank({'candidates':[FEATURES]})
        assert time.perf_counter()-started<.25
        assert entered.wait(.5) and calls==[URL]
    finally:
        release.set();client._refresh_worker.join(timeout=1)
    assert client.ready_identity_token(URL)=='fixture'


def test_transport_never_redirects_service_tokens():
    assert client.NoRedirect().redirect_request(None,None,302,'',{},'https://untrusted.test') is None
