"""Private optional score boundary, bounded features and deterministic fallback."""
import json
import threading
import time
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

import hire_ranking
import hire_ranking_client as client
import hire_ranking_service as service

FEATURES = {'completed': 3, 'review_count': 3, 'rating': 4.0, 'experience_years': 4.0,
            'search_match': 0.0, 'has_query': False, 'available_now': True}
URL = 'https://repaido-hire-ranking-123.us-central1.run.app'
CALLER = 'api-runtime@example.iam.gserviceaccount.com'


@pytest.fixture
def scoring_api(monkeypatch):
    monkeypatch.setenv('REPAIDO_HIRE_RANKING_AUDIENCE', URL)
    monkeypatch.setenv('REPAIDO_HIRE_RANKING_CALLER_EMAIL', CALLER)
    monkeypatch.setattr(client, '_failed_until', 0)
    with TestClient(service.create_app()) as api:
        yield api


def test_private_scorer_checks_google_audience_and_exact_verified_service_account(scoring_api, monkeypatch):
    from google.oauth2 import id_token
    claims = {'iss': 'https://accounts.google.com', 'email': CALLER, 'email_verified': True}
    verifier = Mock(return_value=claims)
    monkeypatch.setattr(id_token, 'verify_oauth2_token', verifier)
    endpoint = '/internal/hiring/rank'
    assert scoring_api.post(endpoint, json={'candidates': [FEATURES]}).status_code == 401
    result = scoring_api.post(endpoint, headers={'Authorization': 'Bearer signed-fixture'}, json={'candidates': [FEATURES]})
    assert result.status_code == 200
    assert result.json() == hire_ranking.rank({'candidates': [FEATURES]})
    assert result.json()['scores'][0]['score'] == 33.5
    assert verifier.call_args.kwargs['audience'] == URL
    for change in ({'email': 'stranger@example.iam.gserviceaccount.com'}, {'iss': 'https://untrusted.test'}, {'email_verified': False}):
        verifier.return_value = {**claims, **change}
        assert scoring_api.post(endpoint, headers={'Authorization': 'Bearer signed-fixture'}, json={'candidates': [FEATURES]}).status_code == 403
    verifier.side_effect = ValueError('bad signature')
    assert scoring_api.post(endpoint, headers={'Authorization': 'Bearer forged'}, json={'candidates': [FEATURES]}).status_code == 403
    monkeypatch.delenv('REPAIDO_HIRE_RANKING_CALLER_EMAIL')
    assert scoring_api.post(endpoint, json={'candidates': [FEATURES]}).status_code == 503


@pytest.mark.parametrize('features', [
    [], [FEATURES] * 13,
    [{**FEATURES, 'completed': 2}], [{**FEATURES, 'review_count': 0}],
    [{**FEATURES, 'rating': None}],
    [{**FEATURES, 'experience_years': 61}],
    [{**FEATURES, 'available_now': 'true'}], [{**FEATURES, 'customer_id': 'private-id'}],
])
def test_scorer_rejects_unbounded_incoherent_or_private_features(scoring_api, features):
    scoring_api.app.dependency_overrides[service.caller_identity] = lambda: {'email': CALLER}
    response = scoring_api.post('/internal/hiring/rank', json={'candidates': features})
    assert response.status_code == 422


def test_feature_cache_is_bounded_copied_and_changes_with_evidence(monkeypatch):
    now = [100]
    monkeypatch.setattr(hire_ranking.time, 'monotonic', lambda: now[0])
    cache = hire_ranking.FeatureCache(limit=2, ttl=60)
    result = cache.rank({'candidates': [FEATURES]})
    result['scores'][0]['score'] = -1
    assert cache.rank({'candidates': [FEATURES]})['scores'][0]['score'] == 33.5
    assert cache.rank({'candidates': [{**FEATURES, 'available_now': False}]})['scores'][0]['score'] == 23.5
    cache.rank({'candidates': [{**FEATURES, 'completed': 4}]})
    assert len(cache.rows) == 2
    now[0] += 61
    cache.rank({'candidates': [FEATURES]})
    assert len(cache.rows) == 2


def test_remote_opt_in_sends_only_anonymous_features_and_validates_same_engine(monkeypatch):
    monkeypatch.setenv('REPAIDO_HIRE_RANKING_URL', URL)
    monkeypatch.setattr(client, '_failed_until', 0)
    monkeypatch.setattr(client, 'ready_identity_token', lambda url: 'service-identity')
    expected = hire_ranking.rank({'candidates': [FEATURES]})
    response = SimpleNamespace(read=lambda size: json.dumps(expected).encode())
    class Reply:
        def __enter__(self): return response
        def __exit__(self, *args): pass
    calls = []
    def send(request, timeout):
        calls.append(request)
        assert timeout == 1
        assert request.full_url == URL + '/internal/hiring/rank'
        assert request.headers['Authorization'] == 'Bearer service-identity'
        assert json.loads(request.data) == {'candidates': [FEATURES]}
        return Reply()
    monkeypatch.setattr(client, 'send_scoring', send)
    assert client.rank_candidates([FEATURES]) == expected
    assert len(calls) == 1
    response.read = lambda size: b'{"version":"old-engine","scores":[]}'
    assert client.rank_candidates([FEATURES]) == expected
    assert client.rank_candidates([FEATURES]) == expected
    assert len(calls) == 2


@pytest.mark.parametrize('url', ['', 'http://localhost:8000', 'https://outside.example', URL + '/unexpected'])
def test_disabled_or_untrusted_remote_url_never_requests_identity_or_network(monkeypatch, url):
    monkeypatch.setenv('REPAIDO_HIRE_RANKING_URL', url)
    monkeypatch.setattr(client, 'identity_token', Mock(side_effect=AssertionError('Remote identity requested')))
    monkeypatch.setattr(client, 'send_scoring', Mock(side_effect=AssertionError('Network requested')))
    assert client.rank_candidates([FEATURES]) == hire_ranking.rank({'candidates': [FEATURES]})


def test_timeout_falls_back_without_leaking_upstream_details(monkeypatch, caplog):
    monkeypatch.setenv('REPAIDO_HIRE_RANKING_URL', URL)
    monkeypatch.setattr(client, '_failed_until', 0)
    monkeypatch.setattr(client, 'ready_identity_token', lambda url: 'sensitive-service-token')
    send = Mock(side_effect=TimeoutError('private-provider-response'))
    monkeypatch.setattr(client, 'send_scoring', send)
    assert client.rank_candidates([FEATURES]) == hire_ranking.rank({'candidates': [FEATURES]})
    assert 'sensitive-service-token' not in caplog.text and 'private-provider-response' not in caplog.text


def test_slow_identity_refresh_never_delays_requests_or_creates_unbounded_workers(monkeypatch):
    entered, release = threading.Event(), threading.Event()
    monkeypatch.setenv('REPAIDO_HIRE_RANKING_URL', URL)
    for key, value in (('_token', None), ('_token_url', None), ('_failed_until', 0), ('_token_refreshing', False)):
        monkeypatch.setattr(client, key, value)
    calls = []
    def slow_identity(url):
        calls.append(url)
        entered.set()
        assert release.wait(2), 'Test must release its identity worker'
        return SimpleNamespace(valid=True, token='fresh-service-identity')
    monkeypatch.setattr(client, 'identity_token', slow_identity)
    monkeypatch.setattr(client, 'send_scoring', Mock(side_effect=AssertionError('No identity is ready')))
    expected = hire_ranking.rank({'candidates': [FEATURES]})
    started = time.perf_counter()
    try:
        for _ in range(20):
            assert client.rank_candidates([FEATURES]) == expected
        assert time.perf_counter() - started < 0.25
        assert entered.wait(0.5) and calls == [URL]
    finally:
        release.set()
        client._refresh_worker.join(timeout=1)
    assert client.ready_identity_token(URL) == 'fresh-service-identity'


def test_scoring_transport_never_redirects_service_identity():
    assert client.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://untrusted.test') is None
