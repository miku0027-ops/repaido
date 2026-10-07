"""Shared bootstrap for the independently deployed Repaidians work services.

The existing authentication and transactional store remain the authority. Importing
main installs its routers but does not run its lifespan; none of those routers or
its operational scheduler are mounted in these service applications.
"""
import os
from types import SimpleNamespace


def shared_core():
    import main
    from fastapi import FastAPI
    import repaidians
    core = SimpleNamespace(**vars(main))
    # Install onto a temporary router host to obtain the shared actor dependency
    # bound to this facade. Those social routes are deliberately not exposed.
    core.app = FastAPI()
    repaidians.install(core)
    return core


def initialize(core):
    if os.getenv('REPAIDO_STORAGE', 'sqlite').lower() == 'firestore' and not core.USE_FIRESTORE:
        raise RuntimeError('Firestore was requested but is unavailable; ephemeral fallback is prohibited.')
    if not core.USE_FIRESTORE:
        # A standalone development service can authenticate existing SQLite
        # sessions without seeding catalogues or launching unrelated schedulers.
        with core.db() as connection:
            connection.execute('PRAGMA journal_mode=WAL')
            connection.executescript('''
                CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT NOT NULL,
                    email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, created_at INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
            ''')
        core.operations_store.init()
    import repaidians
    import repaidians_opportunities
    import repaidians_work
    import work_push
    repaidians.initialize(core)
    repaidians_opportunities.initialize(core)
    repaidians_work.initialize(core)
    work_push.initialize(core)
    import custom_contracts
    custom_contracts.initialize(core)
    import account_profile
    import transactional_mail
    account_profile.initialize(core)
    transactional_mail.initialize(core)


def health(core, service):
    return {'status': 'ok', 'service': service,
            'storage': 'firestore' if core.USE_FIRESTORE else 'sqlite',
            'build_id': os.getenv('REPAIDO_BUILD_ID', 'local')}
