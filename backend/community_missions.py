"""Real, reviewed repair-knowledge and reuse contributions.

An operator publishes the scope and deadline. Joining earns nothing. Owned
evidence and an independent decision are required for the existing shared
Captain points ledger; this module never creates cash rewards or transfers.
"""
import time
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import Field, model_validator

from operations import Input, fail
from integrations import audit
from local_business import digest, document


class Mission(Input):
    expected_version: int = Field(default=0, ge=0, strict=True)
    title: str = Field(min_length=5, max_length=100)
    kind: Literal['repair_knowledge', 'reuse_drive']
    city: str = Field(min_length=2, max_length=80)
    instructions: str = Field(min_length=40, max_length=3000)
    evidence_requirements: str = Field(min_length=20, max_length=1200)
    starts_at: float = Field(ge=0, allow_inf_nan=False)
    ends_at: float = Field(ge=0, allow_inf_nan=False)
    active: bool = False

    @model_validator(mode='after')
    def dates(self):
        if not self.starts_at < self.ends_at <= self.starts_at + 180 * 86400:
            raise ValueError('Set a positive mission duration of at most 180 days.')
        if any(len(value.strip()) < minimum for value, minimum in [(self.title,5),(self.city,2),(self.instructions,40),(self.evidence_requirements,20)]):
            raise ValueError('Describe the mission, city and evidence requirements clearly.')
        return self


class Submission(Input):
    request_id: str = Field(min_length=16, max_length=100)
    expected_version: int = Field(ge=1, strict=True)
    note: str = Field(min_length=40, max_length=3000)
    document_ids: list[str] = Field(min_length=1, max_length=3)
    knowledge_text: str = Field(default='', max_length=6000)
    publish_knowledge: bool = False


class Decision(Input):
    expected_version: int = Field(ge=1, strict=True)
    request_id: str = Field(min_length=16, max_length=100)
    decision: Literal['verified', 'rework', 'rejected']
    note: str = Field(min_length=20, max_length=1500)
    evidence_reference: str = Field(min_length=8, max_length=300)
    resubmit_by: float | None = Field(default=None, ge=0, allow_inf_nan=False)


class Appeal(Input):
    expected_version: int = Field(ge=1, strict=True)
    request_id: str = Field(min_length=16, max_length=100)
    reason: str = Field(min_length=20, max_length=1500)


def public_mission(row):
    return {key: row[key] for key in ('id', 'version', 'title', 'kind', 'city', 'instructions', 'evidence_requirements', 'starts_at', 'ends_at', 'active')} | {
        'points_per_verified_contribution': 10,
        'reward_terms': 'Up to 10 non-cash Captain points after independent review. The shared daily limit is 50 points. Joining and unverified submissions earn no points.'}


def contribution_view(row, admin=False):
    return {key: value for key, value in row.items() if key not in ('fingerprint',) and (admin or key not in ('reviewer_id', 'evidence_reference'))}


def install(core):
    store = core.operations_store
    r = APIRouter(prefix='/operations/local-business/missions', tags=['Community missions'])

    def get(u, mid):
        row = u.get('community_missions', mid)
        if not row:
            fail('NOT_FOUND', 'Community mission not found.', 404)
        return row

    def command(u, uid, request_id, payload):
        key = digest('community-mission-command:' + uid + ':' + request_id)
        fp = digest(payload)
        old = u.get('community_mission_commands', key)
        if old and old['fingerprint'] != fp:
            fail('KEY_REUSED', 'Use a new request for changed contribution details.', 409)
        return key, fp, old

    def record(u, key, fp):
        u.put('community_mission_commands', key, dict(id=key, fingerprint=fp))

    @r.get('')
    def board(cursor: str | None = Query(default=None, max_length=100)):
        def read(u):
            now = time.time()
            rows = u.find('community_missions', 'active', True, limit=51, after=cursor)
            return dict(missions=[public_mission(row) for row in rows[:50] if row['starts_at'] <= now < row['ends_at']],
                        next_cursor=rows[49]['id'] if len(rows) > 50 else None, server_time=now)
        return store.run(read)

    @r.get('/mine')
    def mine(cursor: str | None = Query(default=None, max_length=100), user=Depends(core.current_user)):
        def read(u):
            rows = u.find('community_contributions', 'user_id', user['id'], limit=51, after=cursor)
            return dict(contributions=[contribution_view(row) for row in rows[:50]], next_cursor=rows[49]['id'] if len(rows)>50 else None)
        return store.run(read)

    @r.get('/admin')
    def administration(active: bool = True, cursor: str | None = Query(default=None, max_length=100), admin=Depends(core.operator)):
        def read(u):
            rows = u.find('community_missions', 'active', active, limit=51, after=cursor)
            return dict(missions=[public_mission(row) for row in rows[:50]], next_cursor=rows[49]['id'] if len(rows)>50 else None)
        return store.run(read)

    @r.put('/admin/{mid}')
    def save_mission(mid: str, body: Mission, admin=Depends(core.operator)):
        if not __import__('re').fullmatch(r'[A-Za-z0-9_-]{8,100}', mid):
            fail('INVALID_ID', 'Choose a valid mission ID.', 422)
        def save(u):
            old = u.get('community_missions', mid)
            payload = body.model_dump(exclude={'expected_version'})
            if old and old['version'] == body.expected_version + 1 and all(old.get(k) == v for k,v in payload.items()):
                return public_mission(old)
            if (old or {}).get('version', 0) != body.expected_version:
                fail('STALE_VERSION', 'Refresh the mission before saving.', 409)
            if old and body.kind != old['kind']:
                fail('KIND_IMMUTABLE', 'Create a new mission for a different contribution type.', 409)
            row = dict(id=mid, **payload, version=body.expected_version + 1, created_at=(old or {}).get('created_at', time.time()), updated_at=time.time(), author_id=admin['id'])
            u.put('community_missions', mid, row)
            audit(u, 'CommunityMissionSaved', admin['id'], mission_id=mid, version=row['version'])
            return public_mission(row)
        return store.run(save)

    @r.post('/{mid}/join')
    def join(mid: str, user=Depends(core.current_user)):
        def save(u):
            key = digest('community-contribution:' + mid + ':' + user['id'])
            old = u.get('community_contributions', key)
            if old:
                return contribution_view(old)
            mission = get(u, mid)
            now = time.time()
            if not mission['active'] or not mission['starts_at'] <= now < mission['ends_at']:
                fail('MISSION_CLOSED', 'This mission is not accepting new contributors.', 409)
            row = dict(id=key, mission_id=mid, mission=public_mission(mission), user_id=user['id'],
                       city=mission['city'], kind=mission['kind'], state='joined', version=1, created_at=now,
                       updated_at=now, submit_by=mission['ends_at'], points=0, document_ids=[], history=[])
            u.put('community_contributions', key, row)
            return contribution_view(row)
        return store.run(save)

    def owned(u, cid, uid=None):
        row = u.get('community_contributions', cid)
        if not row or uid is not None and row['user_id'] != uid:
            fail('NOT_FOUND', 'Contribution not found.', 404)
        return row

    @r.post('/contributions/{cid}/submit')
    def submit(cid: str, body: Submission, user=Depends(core.current_user)):
        def save(u):
            row = owned(u, cid, user['id'])
            key, fp, old = command(u, user['id'], body.request_id, cid + ':submit:' + body.model_dump_json())
            if old:
                return contribution_view(row)
            if row['version'] != body.expected_version:
                fail('STALE_VERSION', 'Refresh your contribution before submitting.', 409)
            if row['state'] not in ('joined', 'rework') or time.time() > row['submit_by']:
                fail('SUBMISSION_CLOSED', 'This contribution cannot accept evidence now. Contact support about a missed deadline.', 409)
            if len(body.note.strip()) < 40:
                fail('DESCRIPTION_REQUIRED', 'Explain the completed contribution in at least 40 characters.', 422)
            if row['kind'] == 'repair_knowledge' and len(body.knowledge_text.strip()) < 100:
                fail('KNOWLEDGE_REQUIRED', 'Add your original repair knowledge, including safety limits, in at least 100 characters.', 422)
            if row['kind'] != 'repair_knowledge' and (body.knowledge_text or body.publish_knowledge):
                fail('KNOWLEDGE_NOT_APPLICABLE', 'Knowledge publication belongs to a repair-knowledge mission.', 422)
            if len(set(body.document_ids)) != len(body.document_ids):
                fail('DUPLICATE_EVIDENCE', 'Choose distinct evidence photos.', 422)
            for did in body.document_ids:
                photo = document(u, did, user['id'])
                if not photo.get('object') or photo.get('kind') == 'scrap_camera' or photo.get('weighing_collection_id') or u.get('cleanup_evidence_claims', did) or (u.get('captain_profiles', user['id']) or {}).get('photo_id') == did:
                    fail('EVIDENCE_USED', 'Upload fresh evidence for this contribution.', 409)
            for did in body.document_ids:
                u.put('cleanup_evidence_claims', did, dict(report_id='mission:' + cid, user_id=user['id']))
            row.update(note=body.note.strip(), knowledge_text=body.knowledge_text.strip(), publish_knowledge=body.publish_knowledge,
                       document_ids=body.document_ids, state='submitted', version=row['version'] + 1, updated_at=time.time(), submitted_at=time.time())
            row['history'].append(dict(state='submitted', at=time.time(), document_ids=body.document_ids))
            u.put('community_contributions', cid, row)
            record(u, key, fp)
            audit(u, 'CommunityContributionSubmitted', user['id'], contribution_id=cid)
            return contribution_view(row)
        return store.run(save)

    @r.get('/admin/contributions')
    def queue(state: Literal['joined','submitted','rework','rejected','appealed','verified']='submitted', cursor: str | None=Query(default=None,max_length=100), admin=Depends(core.operator)):
        def read(u):
            rows = u.find('community_contributions', 'state', state, limit=51, after=cursor)
            return dict(contributions=[contribution_view(row,True) for row in rows[:50]], next_cursor=rows[49]['id'] if len(rows)>50 else None)
        return store.run(read)

    @r.post('/admin/contributions/{cid}/review')
    def decide(cid: str, body: Decision, admin=Depends(core.operator)):
        def save(u):
            row = owned(u, cid)
            key, fp, old = command(u, admin['id'], body.request_id, cid + ':review:' + body.model_dump_json())
            if old:
                return contribution_view(row, True)
            if row['user_id'] == admin['id']:
                fail('INDEPENDENT_REVIEW_REQUIRED', 'Another operator must review your contribution.', 403)
            if row['version'] != body.expected_version:
                fail('STALE_VERSION', 'Refresh this contribution before reviewing.', 409)
            if row['state'] not in ('submitted', 'appealed'):
                fail('REVIEW_NOT_READY', 'Review a submitted contribution or its appeal.', 409)
            if len(body.note.strip()) < 20 or len(body.evidence_reference.strip()) < 8:
                fail('REVIEW_REQUIRED', 'Record your evidence check and reason.', 422)
            now = time.time()
            if body.decision == 'rework':
                if not body.resubmit_by or not now < body.resubmit_by <= now + 30 * 86400:
                    fail('DEADLINE_REQUIRED', 'Set a resubmission deadline within the next 30 days.', 422)
                row['submit_by'] = body.resubmit_by
            if body.decision == 'verified':
                from captain_rewards import record_contribution
                for did in row['document_ids']:
                    photo = document(u, did, row['user_id'])
                    if not photo.get('object') or (u.get('cleanup_evidence_claims', did) or {}).get('report_id') != 'mission:' + cid:
                        fail('EVIDENCE_REQUIRED', 'Inspect valid contribution evidence before awarding points.', 409)
                checks=[dict(label=label,passed=True) for label in ('Mission scope recorded at joining','Owned evidence claimed for this contribution','Independent operator reviewed completion','Review reference and reason recorded','Single award per contribution','Shared daily points limit applied')]
                award = record_contribution(u, row, row['user_id'], row['kind'], now, checks, identifier=digest('mission-points:' + cid))
                row.update(points=award['points'], points_note=award['reason'])
                if row['kind'] == 'repair_knowledge' and row.get('publish_knowledge'):
                    u.put('community_knowledge', cid, dict(id=cid, mission_id=row['mission_id'], title=row['mission']['title'], text=row['knowledge_text'], published_at=now, verification='Operator reviewed contribution; follow manufacturer guidance and qualified-professional requirements.'))
            row.update(state=body.decision, review_note=body.note.strip(), evidence_reference=body.evidence_reference.strip(), reviewer_id=admin['id'], reviewed_at=now, updated_at=now, version=row['version'] + 1)
            row['history'].append(dict(state=body.decision, at=now, note=body.note.strip()))
            u.put('community_contributions', cid, row)
            record(u, key, fp)
            audit(u, 'CommunityContributionReviewed', admin['id'], contribution_id=cid, decision=body.decision)
            return contribution_view(row, True)
        return store.run(save)

    @r.post('/contributions/{cid}/appeal')
    def appeal(cid: str, body: Appeal, user=Depends(core.current_user)):
        def save(u):
            row = owned(u, cid, user['id'])
            key, fp, old = command(u, user['id'], body.request_id, cid + ':appeal:' + body.model_dump_json())
            if old:
                return contribution_view(row)
            if row['version'] != body.expected_version:
                fail('STALE_VERSION', 'Refresh this contribution before appealing.', 409)
            if row['state'] != 'rejected' or row.get('appeal_reason'):
                fail('APPEAL_UNAVAILABLE', 'A rejected contribution can be appealed once. Contact support for further concerns.', 409)
            if len(body.reason.strip()) < 20:
                fail('APPEAL_REASON_REQUIRED', 'Explain why the decision needs another review.', 422)
            row.update(state='appealed', appeal_reason=body.reason.strip(), appealed_at=time.time(), updated_at=time.time(), version=row['version'] + 1)
            row['history'].append(dict(state='appealed', at=time.time(), note=body.reason.strip()))
            u.put('community_contributions', cid, row)
            record(u, key, fp)
            return contribution_view(row)
        return store.run(save)

    @r.get('/{mid}/knowledge')
    def knowledge(mid: str, cursor: str | None=Query(default=None,max_length=100)):
        def read(u):
            get(u, mid)
            rows = u.find('community_knowledge', 'mission_id', mid, limit=21, after=cursor)
            return dict(contributions=[row for row in rows[:20] if not row.get('withdrawn')], next_cursor=rows[19]['id'] if len(rows)>20 else None)
        return store.run(read)

    @r.delete('/contributions/{cid}/knowledge')
    def withdraw_knowledge(cid: str, user=Depends(core.current_user)):
        def save(u):
            row = owned(u, cid, user['id'])
            knowledge = u.get('community_knowledge', cid)
            if knowledge and not knowledge.get('withdrawn'):
                knowledge.update(withdrawn=True, text='', withdrawn_at=time.time())
                u.put('community_knowledge', cid, knowledge)
                row.update(publish_knowledge=False, version=row['version']+1, updated_at=time.time())
                u.put('community_contributions', cid, row)
                audit(u, 'CommunityKnowledgeWithdrawn', user['id'], contribution_id=cid)
            return contribution_view(row)
        return store.run(save)

    core.app.include_router(r)
