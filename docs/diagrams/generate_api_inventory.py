"""Write a source-route inventory without contacting production services.

Run with the backend virtual environment from the repository root. Importing
the three FastAPI apps registers routes; no lifespan or scheduler is started.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))
os.environ['REPAIDO_STORAGE'] = 'sqlite'

with tempfile.TemporaryDirectory(prefix='repaido-api-inventory-') as scratch:
    os.environ['REPAIDO_DB'] = str(Path(scratch) / 'inventory.db')
    import main  # noqa: E402
    import work_service  # noqa: E402
    import work_worker  # noqa: E402

    routes = []
    for service, app in (('main', main.app), ('work', work_service.app),
                         ('worker', work_worker.app)):
        for route in app.routes:
            if not getattr(route, 'methods', None) or route.path in {
                '/openapi.json', '/docs', '/docs/oauth2-redirect', '/redoc'
            }:
                continue
            for method in sorted(route.methods - {'HEAD', 'OPTIONS'}):
                routes.append({
                    'service': service, 'method': method, 'path': route.path,
                    'module': route.endpoint.__module__.removeprefix('backend.'),
                })

revision = subprocess.check_output(
    ['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
output = ROOT / 'docs' / 'diagrams' / 'api_inventory.json'
output.write_text(json.dumps({
    'note': ('FastAPI source-route inventory generated in isolated SQLite mode. '
             'Excludes OpenAPI/docs, HEAD and OPTIONS. Not a live deployment audit.'),
    'source_revision': revision,
    'routes': routes,
}, indent=2) + '\n')
print(f'Wrote {output} ({len(routes)} method/path declarations)')
