"""Private, verified customer setup and explicitly chosen service interests."""
import hashlib
import time
from fastapi import APIRouter, Depends, Response
from pydantic import Field, field_validator, model_validator
from operations import fail
import account_profile
import promotions


class Setup(account_profile.Request):
    name: str = Field(min_length=2, max_length=80)
    email: str = Field(min_length=3, max_length=254)
    categories: list[str] = Field(default_factory=list, max_length=3)
    primary_category: str = Field(default='', max_length=80)
    adapt_suggestions: bool = False
    city: str = Field(default='Balasore', max_length=80)

    @field_validator('name')
    @classmethod
    def clean_name(cls, value):
        value = value.strip()
        if len(value) < 2 or any(ord(c) < 32 for c in value):
            raise ValueError('Enter your name.')
        return value

    @field_validator('email')
    @classmethod
    def clean_email(cls, value):
        return account_profile.normalize_email(value)

    @model_validator(mode='after')
    def selected(self):
        if len(set(self.categories)) != len(self.categories):
            raise ValueError('Choose each interest once.')
        if self.primary_category and self.primary_category not in self.categories:
            raise ValueError('Choose your main interest from your selected services.')
        if self.categories and not self.primary_category:
            self.primary_category = self.categories[0]
        return self


def choices(catalog):
    labels = {c['id']: c['name'] for c in catalog['categories']}
    categories = dict.fromkeys(s['category'] for s in catalog['services'] if s.get('active', True))
    return [dict(id=key, name=labels.get(key, key.replace('_', ' ').title())) for key in categories] + [
        dict(id='transport', name='Bike & cab rides'), dict(id='market', name='Local shopping')]


def interests(u, uid):
    row = u.get('customer_onboarding', uid) or {}
    return row.get('categories', []), row.get('primary_category', '')


def state(u, user, catalog):
    row = u.get('customer_onboarding', user['id']) or {}
    access = u.get('account_creation_policy', user['id']) or {}
    contact = account_profile.ensure(u, user)
    available = choices(catalog)
    ids = {c['id'] for c in available}
    return dict(id=user['id'], completed=bool(row.get('completed_at')),
                required=bool(access.get('phone_required') and (not row.get('completed_at') or not user.get('phone_verified') or not user.get('phone'))),
                phone_verified=bool(user.get('phone_verified') and user.get('phone')),
                name=contact.get('name', user.get('name', '')), email=contact.get('email'),
                categories=[c for c in row.get('categories', []) if c in ids],
                primary_category=row.get('primary_category', '') if row.get('primary_category') in ids else '',
                adapt_suggestions=bool((u.get('discovery_preferences', user['id']) or {}).get('enabled')
                                       and promotions.prefs(u, user['id']).get('personalised')),
                choices=available)


def install(core):
    router = APIRouter(prefix='/account', tags=['Customer setup'])
    store = core.operations_store

    @router.get('/onboarding')
    def read(response: Response, user=Depends(core.current_user)):
        response.headers['Cache-Control'] = 'private, no-store'
        catalog = core.catalog()
        return store.run(lambda u: state(u, user, catalog))

    @router.put('/onboarding')
    def complete(body: Setup, response: Response, user=Depends(core.current_user)):
        response.headers['Cache-Control'] = 'private, no-store'
        if not user.get('phone_verified') or not user.get('phone'):
            fail('PHONE_VERIFICATION_REQUIRED', 'Verify your mobile number to finish setting up your account.', 403)
        catalog = core.catalog()
        allowed = {c['id'] for c in choices(catalog)}
        if any(c not in allowed for c in body.categories):
            fail('CATEGORY_UNAVAILABLE', 'One of those services is no longer listed. Refresh your choices.', 422)
        if body.city not in core.CITIES:
            fail('OUTSIDE_COVERAGE', 'Choose a supported service city.', 422)

        def save(u):
            uid = user['id']
            key, signature, old = account_profile._receipt(u, uid, body, 'customer-setup')
            if old:
                return state(u, user, catalog)
            contact = account_profile.ensure(u, user)
            account_profile.save_email(u, user, account_profile.Change(
                request_id=hashlib.sha256(('setup-email:' + body.request_id).encode()).hexdigest(),
                expected_version=contact['version'], email=body.email))
            contact = u.get('account_contacts', uid)
            contact.update(name=body.name, updated_at=time.time())
            u.put('account_contacts', uid, contact)
            previous = u.get('customer_onboarding', uid) or {}
            u.put('customer_onboarding', uid, dict(id=uid, categories=body.categories,
                  primary_category=body.primary_category, completed_at=previous.get('completed_at') or time.time(),
                  updated_at=time.time()))
            # Explicit selections are separate from observed behaviour. Never
            # manufacture visits or subscribe someone to push/email marketing.
            discovery = (u.get('discovery_preferences', uid) or {}) if body.adapt_suggestions else {}
            discovery.update(enabled=body.adapt_suggestions,
                             consent_version=discovery.get('consent_version', 2), updated_at=time.time())
            u.put('discovery_preferences', uid, discovery)
            prefs = promotions.prefs(u, uid)
            prefs.update(personalised=body.adapt_suggestions, city=body.city, updated_at=time.time())
            u.put('campaign_preferences', uid, prefs)
            if not body.adapt_suggestions:
                u.put('opportunity_interests', uid, {'signals': {}})
            account_profile._remember(u, key, signature, uid)
            return state(u, user, catalog)
        return store.run(save)

    core.app.include_router(router)
