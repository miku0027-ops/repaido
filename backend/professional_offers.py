"""Professional-funded Home offers, published by their owner and frozen in quotes."""
import re, time, uuid
from fastapi import APIRouter, Depends
from pydantic import Field
from operations import Input, fail
from integrations import audit

TERMS = 'Professional-funded saving on the first billing period’s agreed service fee. Tax, materials, travel and extras excluded. No coupon stacking. Only completed, approved visits are billed. Availability and the written quote require confirmation.'

class Offer(Input):
    service_id: str = Field(min_length=1, max_length=60)
    percent: int = Field(ge=1, le=50, strict=True)
    ends_at: float

def active_offers(u, worker_id=None, city=None):
    now = time.time()
    rows = []
    for offer in u.all('professional_offers'):
        if not offer.get('active') or not offer['starts_at'] <= now < offer['ends_at']: continue
        if worker_id and offer['worker_id'] != worker_id: continue
        w = u.get('workers', offer['worker_id'])
        approved = (u.get('home_availability', offer['worker_id']) or {}).get('approved_services', [])
        if not w or w['status'] != 'approved' or offer['service_id'] not in approved: continue
        if city and w['city'].strip().casefold() != city.strip().casefold(): continue
        # A discount must fit inside the professional's accepted earnings share.
        policy = u.get('policies', 'current') or {}
        if w.get('settlement_policy_version') != policy.get('version') or offer['bps'] > policy.get('worker_share_bps', 0): continue
        name=re.sub(r'(?<!\w)(?:\+?\d[\s().-]*){8,15}(?!\w)', '[contact hidden]', w['name'])
        name=re.sub(r'[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}', '[contact hidden]', name)
        rows.append({**offer, 'worker_name': name, 'terms': TERMS})
    return sorted(rows, key=lambda o: (-o['bps'], o['ends_at'], o['id']))

def quote_offer(u, worker_id, service_id, base, visits):
    offer = next((o for o in active_offers(u, worker_id) if o['service_id'] == service_id), None)
    if not offer: return None
    # Same per-visit integer rounding as invoicing; the displayed saving is exact.
    discount = sum((base // visits + (i < base % visits)) * offer['bps'] // 10000 for i in range(visits))
    return {**offer, 'eligible_base_paise': base, 'discount_paise': discount,
            'discounted_base_paise': base - discount, 'funded_by': 'professional'}

def install(core):
    r = APIRouter(prefix='/operations/worker/home-offers', tags=['Professional offers'])
    store = core.operations_store
    def own(u, user):
        w = u.get('workers', user['id'])
        if not w or w['status'] != 'approved' or not user.get('phone_verified'):
            fail('APPROVAL_REQUIRED', 'Use your phone-verified, approved professional account.', 403)
        return w
    @r.get('')
    def read(user=Depends(core.current_user)):
        def load(u):
            w = own(u, user)
            from home_plans import OFFERINGS
            approved = (u.get('home_availability', w['id']) or {}).get('approved_services', [])
            return {'services': [s for s in OFFERINGS if s['id'] in approved],
                    'offers': [o for o in u.all('professional_offers') if o['worker_id'] == w['id']], 'terms': TERMS}
        return store.run(load)
    @r.post('')
    def publish(body: Offer, user=Depends(core.current_user)):
        def save(u):
            w = own(u, user); now = time.time()
            if not now + 60 < body.ends_at <= now + 90 * 86400:
                fail('INVALID_EXPIRY', 'Choose an expiry within the next 90 days.', 422)
            if body.service_id not in (u.get('home_availability', w['id']) or {}).get('approved_services', []):
                fail('SERVICE_NOT_APPROVED', 'Publish offers only for your reviewed Home services.', 422)
            policy = u.get('policies', 'current') or {}
            if not policy.get('version') or w.get('settlement_policy_version') != policy['version'] or body.percent * 100 > policy.get('worker_share_bps', 0):
                fail('EARNINGS_REQUIRED', 'Accept the current earnings policy and keep the offer within your earnings share.', 422)
            for old in u.all('professional_offers'):
                if old['worker_id'] == w['id'] and old['service_id'] == body.service_id and old.get('active'):
                    old['active'] = False; u.put('professional_offers', old['id'], old)
            offer = dict(id=str(uuid.uuid4()), worker_id=w['id'], service_id=body.service_id,
                         bps=body.percent*100, starts_at=now, ends_at=body.ends_at, active=True)
            u.put('professional_offers', offer['id'], offer)
            audit(u, 'ProfessionalOfferPublished', w['id'], offer_id=offer['id'])
            return offer
        return store.run(save)
    @r.delete('/{offer_id}')
    def withdraw(offer_id: str, user=Depends(core.current_user)):
        def save(u):
            own(u, user); offer = u.get('professional_offers', offer_id)
            if not offer or offer['worker_id'] != user['id']: fail('NOT_FOUND', 'Offer not found.', 404)
            offer['active'] = False; u.put('professional_offers', offer_id, offer)
            audit(u, 'ProfessionalOfferWithdrawn', user['id'], offer_id=offer_id)
            return {'withdrawn': True}
        return store.run(save)
    core.app.include_router(r)
