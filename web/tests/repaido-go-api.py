"""Disposable Go journey server. All writes remain in the supplied SQLite DB."""
from pathlib import Path
import runpy
from unittest.mock import patch

import uvicorn

# Reuse the real approval, payroll, bike policy and rider fixture. Prevent only
# its final server startup so this fixture can add a native car catalogue.
with patch('uvicorn.run'):
    fixture = runpy.run_path(str(Path(__file__).with_name('bike-fullstack-api.py')))

import local_business
import mobility_journeys
from fastapi.testclient import TestClient
from test_local_business import vehicle

local_business.route_metres = lambda origin, destination: 10000
mobility_journeys.road_route = lambda origin, destination: {'points': [origin, destination], 'distance_metres': 10000}
with TestClient(fixture['main'].app) as api:
    # The bike fixture has already registered and approved this same owner.
    with patch('test_local_business.register'):
        vehicle(api, name='Local Go cab')
        vehicle(api, name='Local Go self-drive', mode='rental')

uvicorn.run(fixture['main'].app, host='127.0.0.1', port=int(fixture['sys'].argv[2]))
