import copy
import importlib.util
import json
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location('maps_setup', Path(__file__).with_name('configure-google-bike-map.py'))
maps = importlib.util.module_from_spec(spec)
spec.loader.exec_module(maps)


class Client:
    def __init__(self, key=True, document=None):
        self.key = {'name': maps.KEY, 'restrictions': copy.deepcopy(maps.RESTRICTIONS)} if key else None
        self.document = document
        self.calls = []

    def request(self, url, method='GET', body=None, missing=False):
        self.calls.append((url, method, body))
        if url.startswith(maps.DOCUMENT):
            if method == 'PATCH':
                assert url.endswith('currentDocument.exists=false')
                self.document = body
            return self.document
        if method == 'POST':
            self.key = {'name': maps.KEY, 'restrictions': copy.deepcopy(body['restrictions'])}
            return {'done': True}
        if url.endswith('/keyString'):
            return {'keyString': 'public-but-do-not-print-fixture-key'}
        return self.key


def test_inventory_does_not_write_or_read_key_value():
    client = Client(key=False)
    assert maps.configure(client)['key_exists'] is False
    assert all(method == 'GET' and not url.endswith('/keyString') for url, method, _ in client.calls)


def test_dedicated_key_configuration_is_recoverable_and_does_not_print_value():
    client = Client(key=False)
    result = maps.configure(client, True)
    assert result['status'] == 'configured'
    assert 'public-but-do-not-print' not in json.dumps(result)
    assert client.document['fields']['browser_key']['stringValue'] == 'public-but-do-not-print-fixture-key'
    client.calls.clear()
    assert maps.configure(client, True)['status'] == 'already_configured'
    assert all(method == 'GET' for _, method, _ in client.calls)


def test_preserves_existing_config_and_rejects_unrestricted_key():
    client = Client(document={'fields': {'browser_key': {'stringValue': 'another-key'}}})
    with pytest.raises(RuntimeError, match='no config was replaced'):
        maps.configure(client, True)
    assert all(method == 'GET' for _, method, _ in client.calls)
    client.key['restrictions']['browserKeyRestrictions'] = {}
    with pytest.raises(RuntimeError, match='different website restrictions'):
        maps.configure(client, True)
    assert all(method == 'GET' for _, method, _ in client.calls)


def test_rejects_server_routing_key_even_with_matching_referrers():
    client = Client()
    client.key['restrictions']['apiTargets'] = [{'service': 'routes.googleapis.com'}]
    with pytest.raises(RuntimeError, match='different API'):
        maps.configure(client, True)
    assert all(method == 'GET' for _, method, _ in client.calls)
