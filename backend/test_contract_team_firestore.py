"""Project team transactions against an isolated, loopback-only Firestore emulator.

The anonymous client always selects a unique demo project, never production.
Ordinary runs skip these tests until FIRESTORE_EMULATOR_HOST is explicitly set.
"""
import os
import re
import uuid

import pytest
from google.auth.credentials import AnonymousCredentials
from google.cloud import firestore

import main
from test_operations import api as local_api
from test_repaidians_work import work_api


def loopback_emulator():
    match=re.fullmatch(r'(127\.0\.0\.1|localhost|\[::1\]):([0-9]{1,5})',os.getenv('FIRESTORE_EMULATOR_HOST',''))
    return bool(match and 1<=int(match[2])<=65535)


pytestmark=pytest.mark.skipif(not loopback_emulator(),reason='Requires a loopback Firestore emulator')


@pytest.fixture(autouse=True)
def quiet_scheduler(monkeypatch):
    monkeypatch.setattr(main,'operations_tick',lambda:None)


@pytest.fixture
def api(local_api,monkeypatch):
    assert loopback_emulator(),'Refusing a non-loopback Firestore endpoint'
    client=firestore.Client(project='demo-repaido-contract-team-'+uuid.uuid4().hex[:10],credentials=AnonymousCredentials())
    monkeypatch.setattr(main,'USE_FIRESTORE',True)
    monkeypatch.setattr(main,'fb_db',client)
    assert main.operations_store.run(lambda u:u.tx is not None)
    yield local_api
    client.close()


def test_firestore_acceptance_keeps_roster_and_work_records_private(api):
    from test_contract_team_confirmation import test_accepted_offer_is_private_and_hr_commands_require_explicit_joining as workflow
    workflow(api)


def test_firestore_joining_and_finalized_team_unlock_only_the_actual_stage(api):
    from test_contract_team_confirmation import test_joining_then_team_confirmation_unlocks_only_permitted_stage as workflow
    workflow(api)


def test_firestore_concurrent_confirmation_replays_once(api):
    from test_contract_team_confirmation import test_confirmation_replay_is_idempotent_and_conflicting_request_is_rejected as workflow
    workflow(api)


def test_firestore_contractor_history_uses_real_scoped_projection(api):
    from test_contract_team_confirmation import test_credibility_counts_recorded_outcomes_without_private_project_content as workflow
    workflow(api)


def test_firestore_confirmation_drains_real_private_notice_outbox(work_api):
    from test_contract_team_notifications import test_confirmation_wakes_bounded_private_fanout_without_public_sharing as workflow
    workflow(work_api)
