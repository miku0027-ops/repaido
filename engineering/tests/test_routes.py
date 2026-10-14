from pathlib import Path
from engineering.server.catalog import Catalog


def test_literal_router_prefix_is_part_of_endpoint_and_runtime_match(tmp_path):
    (tmp_path / 'backend').mkdir()
    (tmp_path / 'backend/routes.py').write_text('''
def install(core):
    r = APIRouter(prefix='/operations/local-business')
    @r.get('/policy')
    def policy(): return {}
''')
    catalog = Catalog(tmp_path)
    assert 'route:routes:GET:/operations/local-business/policy' in catalog.nodes
    assert 'route:routes:GET:/policy' not in catalog.nodes
    endpoint = catalog.nodes['route:routes:GET:/operations/local-business/policy']
    handlers = [e for e in catalog.edges.values() if e['source'] == endpoint['id'] and e['label'] == 'handler']
    assert len(handlers) == 1
    assert 'def policy' in catalog.source(handlers[0]['target'])['code']


def test_dynamic_router_prefix_is_reported_not_invented(tmp_path):
    (tmp_path / 'backend').mkdir()
    (tmp_path / 'backend/routes.py').write_text('''
r = APIRouter(prefix=environment_prefix)
@r.get('/policy')
def policy(): return {}
''')
    catalog = Catalog(tmp_path)
    assert not any(n['kind'] == 'endpoint' for n in catalog.nodes.values())
    assert 'Dynamic router prefix' in catalog.notes[0]
