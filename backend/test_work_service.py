"""Independent service routing, auth, admission and worker identity boundaries."""
import asyncio
import httpx
import pytest
from fastapi.testclient import TestClient

import main
import work_runtime
import work_service
import work_worker


@pytest.fixture
def service(tmp_path, monkeypatch):
    monkeypatch.setattr(main, 'DB_PATH', str(tmp_path / 'work-service.db'))
    monkeypatch.setattr(main, 'USE_FIRESTORE', False)
    monkeypatch.setattr(main, 'fb_db', None)
    monkeypatch.setenv('REPAIDO_STORAGE', 'sqlite')
    application = work_service.create_app()
    with TestClient(application) as client:
        yield client


def test_independent_service_health_and_no_unrelated_routes_or_catalog_seeds(service):
    for path in ('/health', '/repaidians/work/health', '/api/repaidians/work/health'):
        response = service.get(path)
        assert response.status_code == 200
        assert response.json()['service'] == 'repaido-work-api'
        assert response.json()['storage'] == 'sqlite'
        assert response.headers['cache-control'] == 'private, no-store'
    for path in ('/catalog', '/admin/bookings', '/operations/admin/tick', '/repaidians/feed'):
        assert service.get(path).status_code == 404
    with main.db() as connection:
        tables = {row['name'] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert 'users' in tables and 'operation_records' in tables
    assert 'services' not in tables and 'spare_catalog' not in tables


def test_work_and_company_reads_do_not_accept_guest_or_invalid_bearer(service):
    for path in ('/repaidians/work/jobs', '/api/repaidians/work/jobs', '/repaidians/companies', '/repaidians/placements/not-a-placement'):
        assert service.get(path).status_code == 401
        assert service.get(path, headers={'Authorization': 'Bearer unsigned-test-token'}).status_code == 401


def test_firestore_configuration_does_not_fall_back_to_sqlite(service, monkeypatch):
    monkeypatch.setenv('REPAIDO_STORAGE', 'firestore')
    with pytest.raises(RuntimeError, match='ephemeral fallback'):
        work_runtime.initialize(service.app.state.core)


def test_admission_timeout_and_release_after_overload(monkeypatch):
    monkeypatch.setenv('REPAIDO_WORK_MAX_INFLIGHT', '1')
    monkeypatch.setenv('REPAIDO_WORK_MAX_WAITING', '1')
    application = work_service.create_app()

    async def run():
        entered = asyncio.Event()
        release = asyncio.Event()

        @application.get('/repaidians/work/_test_slow')
        async def slow():
            entered.set()
            await release.wait()
            return {'ok': True}

        transport = httpx.ASGITransport(app=application)
        async with httpx.AsyncClient(transport=transport, base_url='http://work.test') as client:
            first = asyncio.create_task(client.get('/repaidians/work/_test_slow'))
            await entered.wait()
            queued = asyncio.create_task(client.get('/repaidians/work/_test_slow'))
            await asyncio.sleep(.02)
            rejected = await client.get('/repaidians/work/_test_slow')
            assert rejected.status_code == 503 and rejected.headers['retry-after'] == '1'
            timeout = await queued
            assert timeout.status_code == 503
            assert (await client.get('/health')).status_code == 200
            release.set()
            assert (await first).status_code == 200
            assert (await client.get('/repaidians/work/_test_slow')).status_code == 200
    asyncio.run(run())


def configure_scheduler(monkeypatch):
    monkeypatch.setenv('REPAIDO_WORK_WORKER_AUDIENCE', 'https://work-worker.example.run.app')
    monkeypatch.setenv('REPAIDO_WORK_SCHEDULER_EMAIL', 'scheduler@repaido.iam.gserviceaccount.com')


def test_worker_identity_is_fail_closed_and_never_accepts_admin_header(service, monkeypatch):
    monkeypatch.delenv('REPAIDO_WORK_WORKER_AUDIENCE', raising=False)
    monkeypatch.delenv('REPAIDO_WORK_SCHEDULER_EMAIL', raising=False)
    with TestClient(work_worker.create_app(), raise_server_exceptions=False) as client:
        response = client.post('/internal/work/dispatch', json={'limit': 1}, headers={'X-Admin-Key': 'local-test-key'})
        assert response.status_code == 503
        configure_scheduler(monkeypatch)
        assert client.post('/internal/work/dispatch', json={'limit': 1}).status_code == 401


@pytest.mark.parametrize('claims', [
    {'iss': 'https://securetoken.google.com/repaido', 'email': 'scheduler@repaido.iam.gserviceaccount.com', 'email_verified': True},
    {'iss': 'https://accounts.google.com', 'email': 'other@repaido.iam.gserviceaccount.com', 'email_verified': True},
    {'iss': 'https://accounts.google.com', 'email': 'scheduler@repaido.iam.gserviceaccount.com', 'email_verified': False},
])
def test_worker_rejects_wrong_issuer_caller_and_unverified_email(monkeypatch, claims):
    from google.oauth2 import id_token
    configure_scheduler(monkeypatch)
    monkeypatch.setattr(id_token, 'verify_oauth2_token', lambda *args, **kwargs: claims)
    with pytest.raises(Exception) as rejected:
        work_worker.scheduler_identity('Bearer signed-google-token')
    assert rejected.value.status_code == 403


def test_worker_verifies_exact_audience_and_allowed_google_caller(monkeypatch):
    from google.oauth2 import id_token
    configure_scheduler(monkeypatch)
    observed = []
    def verify(token, request, audience):
        observed.append((token, audience))
        return {'iss': 'https://accounts.google.com', 'email': 'scheduler@repaido.iam.gserviceaccount.com', 'email_verified': True}
    monkeypatch.setattr(id_token, 'verify_oauth2_token', verify)
    assert work_worker.scheduler_identity('Bearer signed-google-token')['email'] == 'scheduler@repaido.iam.gserviceaccount.com'
    assert observed == [('signed-google-token', 'https://work-worker.example.run.app')]


def test_profile_index_migration_runs_in_bounded_authenticated_worker_batches(service):
    import repaidians
    core = service.app.state.core
    stamp = repaidians.now_ms() - 86400000

    def seed(unit):
        for index in range(3):
            uid = 'legacy-professional-' + str(index)
            unit.put('rp_members', uid, {'id': uid, 'name': 'Legacy professional ' + str(index),
                'handle': 'legacy.' + str(index), 'trade': 'electrician', 'role': 'Member',
                'avatarUrl': '', 'bio': '', 'followersCount': 0, 'followingCount': 0, 'createdAt': stamp + index})
            unit.put('rp_member_directory', uid, {'id': uid, 'sortKey': repaidians.sort_key(stamp + index, uid)})
            unit.put('workers', uid, {'id': uid, 'status': 'approved', 'categories': ['electrician'],
                'role': 'specialist', 'city': 'Balasore', 'skills': ['Rewiring'], 'experience_years': 4})

    core.operations_store.run(seed)
    application = work_worker.create_app(core)
    with TestClient(application, raise_server_exceptions=False) as client:
        assert client.post('/internal/work/dispatch', json={'limit': 1}).status_code in (401, 503)
        assert not core.operations_store.run(lambda unit: unit.get('rp_members', 'legacy-professional-0')).get('professionalVersion')
        application.dependency_overrides[work_worker.scheduler_identity] = lambda: {'email': 'isolated-test-scheduler'}
        first = client.post('/internal/work/dispatch', json={'limit': 1})
        assert first.status_code == 200, first.text
        assert first.json()['profiles_indexing'] is True
        assert core.operations_store.run(lambda unit: unit.get('rp_members', 'legacy-professional-0'))['professionalVersion'] == 1
        assert not core.operations_store.run(lambda unit: unit.get('rp_members', 'legacy-professional-2')).get('professionalVersion')
        for _ in range(3):
            last = client.post('/internal/work/dispatch', json={'limit': 1})
            assert last.status_code == 200, last.text
        assert last.json()['profiles_indexing'] is False
        trial = core.operations_store.run(lambda unit: unit.get('rp_trials', 'legacy-professional-0'))
        assert trial['startsAt'] == stamp
        assert trial['endsAt'] == stamp + 60 * 86400000
