#!/usr/bin/env python3
"""Bounded, isolated real-HTTP load evidence for the standalone work API.

Always creates its own temporary SQLite database and loopback Uvicorn process.
No remote target or production store argument is accepted. Tokens are genuine
local sessions in that temporary database; authentication is not bypassed.
"""
import argparse
import asyncio
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import platform
import secrets
import socket
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / 'backend'


def bounded_int(lower, upper):
    def parse(value):
        parsed = int(value)
        if not lower <= parsed <= upper:
            raise argparse.ArgumentTypeError(f'Must be between {lower} and {upper}.')
        return parsed
    return parse


def fixture(database, accounts, catalog_size):
    os.environ['REPAIDO_STORAGE'] = 'sqlite'
    os.environ['REPAIDO_DB'] = str(database)
    os.environ['REPAIDO_PUSH_ENABLED'] = 'false'
    sys.path.insert(0, str(BACKEND))
    import main
    import repaidians
    import work_runtime
    work_runtime.initialize(main)
    now = time.time()
    sessions = []
    with main.db() as connection:
        connection.execute('INSERT INTO users VALUES(?,?,?,?,?)', ('load-owner', 'Local fixture contractor', 'owner@fixture.invalid', 'not-a-password', int(now)))
        for index in range(accounts):
            uid = f'load-member-{index}'
            token = secrets.token_urlsafe(32)
            trade = 'ac' if index % 2 == 0 else 'electrician'
            skills = ['AC service'] if trade == 'ac' else ['Electrical wiring']
            connection.execute('INSERT INTO users VALUES(?,?,?,?,?)', (uid, uid, f'{uid}@fixture.invalid', 'not-a-password', int(now)))
            connection.execute('INSERT INTO sessions VALUES(?,?,?)', (hashlib.sha256(token.encode()).hexdigest(), uid, int(now) + 3600))
            sessions.append({'id': uid, 'token': token, 'trade': trade, 'skills': skills})
    def write(u):
        u.put('workers', 'load-owner', {'id': 'load-owner', 'name': 'Local fixture contractor', 'status': 'approved', 'contractor_verified': True})
        for account in sessions:
            member = repaidians.member_ensure(u, {'id': account['id'], 'name': account['id']})
            member.update(trade=account['trade'], skills=account['skills'], city='Balasore', experienceYears=4, workStatus='available')
            repaidians.index_member(u, member)
    main.operations_store.run(write)
    sectors = [('HVAC', ['AC service']), ('Electrical', ['Electrical wiring']), ('Plumbing', ['Pipe fittings']), ('Cleaning', ['Home cleaning'])]
    for index in range(catalog_size):
        sector, skills = sectors[index % len(sectors)]
        uid = f'load-project-{index:06d}'
        project = {'id': uid, 'owner_id': 'load-owner', 'owner_name': 'Local fixture contractor',
                   'title': f'{sector} local fixture project {index}', 'status': 'planning', 'version': 1,
                   'starts_at': now + 86400, 'ends_at': now + 86400 * 30, 'team': [], 'goals': [],
                   'site': 'PRIVATE SITE: never return in discovery', 'scope': 'PRIVATE SCOPE',
                   'hiring': {'status': 'open', 'sector': sector, 'skills': skills, 'city': 'Balasore',
                              'area': 'Public fixture district', 'summary': 'Local-only load fixture published hiring scope',
                              'openings': 3, 'daily_rate_paise': 80000, 'minimum_experience': 2,
                              'worker_role': 'any', 'deadline': now + 86400 * 10, 'terms': 'Local-only fixture terms'}}
        main.operations_store.run(lambda u, project=project: u.put('contract_projects', project['id'], project))
    return sessions


def percentile(values, proportion):
    if not values:
        return None
    ordered = sorted(values)
    return round(ordered[min(len(ordered) - 1, int((len(ordered) - 1) * proportion))], 3)


async def exercise(base, accounts, concurrency, duration, maximum_requests):
    import httpx
    durations = []
    statuses = Counter()
    failures = Counter()
    completed = 0
    started = time.perf_counter()
    deadline = started + duration
    issued = 0
    async with httpx.AsyncClient(base_url=base, timeout=10, trust_env=False,
                                limits=httpx.Limits(max_connections=concurrency, max_keepalive_connections=concurrency)) as client:
        async def worker(slot):
            nonlocal issued, completed
            sequence = slot
            while time.perf_counter() < deadline and issued < maximum_requests:
                issued += 1
                account = accounts[sequence % len(accounts)]
                sequence += concurrency
                before = time.perf_counter()
                try:
                    response = await client.get('/api/repaidians/work/jobs',
                        headers={'Authorization': 'Bearer ' + account['token']},
                        params={'city': 'Balasore', 'experience': 4, 'limit': 20})
                    statuses[str(response.status_code)] += 1
                    if response.status_code == 200:
                        payload = response.json()
                        if not payload.get('items') or any(item['trade'] != account['trade'] for item in payload['items']):
                            failures['wrong_account_relevance_or_empty_page'] += 1
                        if 'PRIVATE SITE' in response.text or 'PRIVATE SCOPE' in response.text:
                            failures['private_data_leak'] += 1
                    elif response.status_code != 503:
                        failures[f'http_{response.status_code}'] += 1
                except Exception as error:
                    statuses['transport_error'] += 1
                    failures[type(error).__name__] += 1
                durations.append((time.perf_counter() - before) * 1000)
                completed += 1
        await asyncio.gather(*(worker(index) for index in range(concurrency)))
    elapsed = time.perf_counter() - started
    return {'requests': completed, 'elapsed_seconds': round(elapsed, 3),
            'requests_per_second': round(completed / elapsed, 3), 'status_counts': dict(statuses),
            'correctness_failures': dict(failures), 'latency_ms': {'p50': percentile(durations, .5),
                'p95': percentile(durations, .95), 'p99': percentile(durations, .99), 'maximum': round(max(durations, default=0), 3)}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--concurrency', type=bounded_int(1, 64), default=8)
    parser.add_argument('--duration-seconds', type=bounded_int(1, 60), default=10)
    parser.add_argument('--maximum-requests', type=bounded_int(1, 10000), default=2000)
    parser.add_argument('--accounts', type=bounded_int(2, 64), default=16)
    parser.add_argument('--catalog-size', type=bounded_int(40, 2000), default=160)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if os.getenv('K_SERVICE'):
        parser.error('Run this isolated harness in a development environment, never a deployed service.')
    with tempfile.TemporaryDirectory(prefix='repaido-work-load-') as directory:
        temporary = Path(directory)
        accounts = fixture(temporary / 'fixture.db', args.accounts, args.catalog_size)
        with socket.socket() as reservation:
            reservation.bind(('127.0.0.1', 0))
            port = reservation.getsockname()[1]
        environment = {**os.environ, 'REPAIDO_STORAGE': 'sqlite', 'REPAIDO_DB': str(temporary / 'fixture.db'),
                       'REPAIDO_PUSH_ENABLED': 'false', 'REPAIDO_BUILD_ID': 'local-isolated-load',
                       'REPAIDO_WORK_MAX_INFLIGHT': '64', 'REPAIDO_WORK_MAX_WAITING': '64'}
        with (temporary / 'server.log').open('w') as server_log:
            server = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'work_service:app', '--host', '127.0.0.1',
                                       '--port', str(port), '--no-proxy-headers', '--log-level', 'warning'],
                                      cwd=BACKEND, env=environment, stdout=server_log, stderr=subprocess.STDOUT)
            try:
                import urllib.request
                opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
                base = f'http://127.0.0.1:{port}'
                for _ in range(100):
                    if server.poll() is not None:
                        raise RuntimeError('Standalone API startup failed: ' + (temporary / 'server.log').read_text()[-3000:])
                    try:
                        with opener.open(base + '/health', timeout=1) as response:
                            health = json.load(response)
                            assert health['storage'] == 'sqlite' and health['service'] == 'repaido-work-api'
                            break
                    except (OSError, ValueError):
                        time.sleep(.1)
                else:
                    raise RuntimeError('Standalone API did not become healthy within ten seconds.')
                result = asyncio.run(exercise(base, accounts, args.concurrency, args.duration_seconds, args.maximum_requests))
                report = {'scope': 'local temporary SQLite fixture; real HTTP and real local session authentication',
                          'production_capacity_claim': False, 'python': platform.python_version(),
                          'platform': platform.platform(), 'cpu_count': os.cpu_count(),
                          'workload': {'concurrency': args.concurrency, 'accounts': args.accounts,
                                       'catalog_size': args.catalog_size, 'target_duration_seconds': args.duration_seconds,
                                       'maximum_requests': args.maximum_requests}, **result}
                rendered = json.dumps(report, indent=2) + '\n'
                if args.output:
                    args.output.parent.mkdir(parents=True, exist_ok=True)
                    args.output.write_text(rendered)
                print(rendered, end='')
                return 1 if result['correctness_failures'] or not result['status_counts'].get('200') else 0
            finally:
                server.terminate()
                try:
                    server.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait(timeout=5)


if __name__ == '__main__':
    raise SystemExit(main())
