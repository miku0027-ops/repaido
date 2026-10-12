import time,uuid,hashlib
from datetime import datetime,timezone
import main
from operations import Booking
from test_operations import api,auth,onboard,PIN,book,command


def test_chosen_professional_is_requested_without_substitution(api):
    onboard(api,'worker');onboard(api,'worker2')
    job,body=book(api,preferred_worker_id='worker2')
    assert job['worker_id']=='worker2' and job['requested_worker_id']=='worker2'
    assert api.post('/operations/bookings',headers=auth('customer'),json=body).json()['id']==job['id']
    command(api,job,'decline','worker2')
    api.post('/operations/admin/tick',headers={'X-Admin-Key':'test-operator-key'})
    updated=api.get('/operations/jobs/'+job['id'],headers=auth('customer')).json()
    assert updated['state']=='searching' and updated['worker_id'] is None


def test_unavailable_or_ineligible_choice_does_not_create_a_booking(api):
    onboard(api,'worker')
    body=dict(service_id='ac-service',city='Balasore',address='Customer service address 123',phone='9876543210',location=PIN,starts_at=datetime.fromtimestamp(time.time()+7200,timezone.utc).isoformat(),idempotency_key=str(uuid.uuid4()),preferred_worker_id='stranger')
    result=api.post('/operations/bookings',headers=auth('customer'),json=body)
    assert result.status_code==409 and result.json()['detail']['code']=='PROFESSIONAL_UNAVAILABLE'
    assert api.get('/operations/jobs',headers=auth('customer')).json()['jobs']==[]


def test_default_none_keeps_legacy_retry_fingerprint(api):
    job,body=book(api)
    key=hashlib.sha256(('customer'+body['idempotency_key']).encode()).hexdigest()
    old=Booking(**body).model_dump_json(exclude={'preferred_worker_id'})
    assert main.operations_store.run(lambda u:u.get('booking_keys',key))['fingerprint']==hashlib.sha256(old.encode()).hexdigest()
