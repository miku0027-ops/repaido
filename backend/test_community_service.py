from fastapi.testclient import TestClient
from types import SimpleNamespace

import community_service
from test_repaidians import api,auth,profile,post


def test_optional_community_runtime_preserves_native_auth_and_excludes_other_domains(api):
    profile(api);post(api)
    core=SimpleNamespace(**vars(api.core))
    application=community_service.create_app(core)
    with TestClient(application) as client:
        assert client.get('/health').json()['service']=='repaido-community-api'
        assert client.get('/api/repaidians/bootstrap',headers=auth()).json()['timeline']['items']
        assert client.get('/repaidians/professional/workspace',headers=auth()).json()['member']['id']=='alice'
        assert client.get('/repaidians/professional/workspace').status_code==401
        for path in ('/operations/jobs','/repaidians/work/jobs','/internal/work/dispatch','/catalog'):
            assert client.get(path,headers=auth()).status_code==404
