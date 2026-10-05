"""Comprehensive end-to-end ecosystem synchronization test:
Verifies Shop, Worker, Customer, and Admin flows working seamlessly together.
"""
import time, uuid
from datetime import datetime, timezone
import main
from test_operations import api, auth, ADMIN, command

SHOP_BODY = {
    'owner_name': 'Subrat Mahapatra',
    'name': 'Balasore Spares & Hardware Hub',
    'address': 'Station Road, Near Town Hall, Balasore',
    'city': 'Balasore',
    'postal_code': '756001',
    'location': {'lat': 21.4934, 'lng': 86.9135},
    'categories': 'AC & Appliance Spares, Electricals, Plumbing',
    'business_reference': 'BLS-TRADE-2026-99',
    'consent': True
}

def test_full_ecosystem_synchronization(api):
    now = time.time()
    worker_uid = 'worker'
    customer_uid = 'customer'
    shop_uid = 'shop'

    # =========================================================================
    # STEP 1: SHOP PARTNER ONBOARDING & ADMIN APPROVAL
    # =========================================================================
    r_shop = api.post('/operations/shop/application', headers=auth(shop_uid), json=SHOP_BODY)
    assert r_shop.status_code == 200, r_shop.text
    shop_id = r_shop.json()['shop']['id']

    # Admin reviews and approves shop
    r_shop_approve = api.post(f'/operations/admin/shops/{shop_id}/review', headers=ADMIN, json={
        'expected_version': 1,
        'decision': 'approved',
        'reason': 'Verified owner KYC, trade licence and physical premises',
        'evidence_reference': 'CASE-SHOP-2026-001',
        'identity_checked': True,
        'business_checked': True,
        'address_checked': True
    })
    assert r_shop_approve.status_code == 200, r_shop_approve.text
    assert r_shop_approve.json()['shop']['status'] == 'approved'

    # Shop lists product in inventory
    prod_id = 'ac-capacitor-45mfd'
    r_stock = api.put(f'/operations/shop/inventory/{prod_id}', headers=auth(shop_uid), json={
        'expected_version': 0,
        'name': 'Heavy Duty 45uF Motor Run Capacitor',
        'sku': 'CAP-45UF-AC',
        'category': 'AC & Appliance Repair',
        'condition': 'new',
        'compatibility': '1.5 Ton and 2.0 Ton Split ACs',
        'price_paise': 45000,  # ₹450
        'on_hand': 10,
        'low_stock': 2,
        'status': 'approved'
    })
    assert r_stock.status_code == 200, r_stock.text
    assert r_stock.json()['stock'] == 10

    # Shop lists equipment in rental inventory
    tool_id = 'rotary-hammer-drill'
    r_rental = api.put(f'/operations/shop/rental-inventory/{tool_id}', headers=auth(shop_uid), json={
        'expected_version': 0,
        'name': 'Bosch Professional Rotary Hammer Drill',
        'category': 'Power Tools',
        'description': 'Heavy duty masonry drilling and chiseling machine',
        'condition': 'Excellent working condition with safety guard',
        'instructions': 'Use supplied ear protection. Clean dust after operation.',
        'total_units': 3,
        'daily_paise': 30000,    # ₹300/day
        'weekly_paise': 150000,  # ₹1500/week
        'monthly_paise': 450000, # ₹4500/month
        'deposit_paise': 200000, # ₹2000 deposit
        'replacement_value_paise': 1200000,
        'delivery_fee_paise': 0,
        'fulfillment': 'pickup',
        'active': True
    })
    assert r_rental.status_code == 200, r_rental.text
    assert r_rental.json()['total_units'] == 3

    # =========================================================================
    # STEP 2: WORKER ONBOARDING & ONLINE AVAILABILITY
    # =========================================================================
    r_worker = api.post('/operations/worker/onboarding', headers=auth(worker_uid), json={
        'name': 'Rajesh Kumar Pradhan',
        'dob': '1995-04-12',
        'city': 'Balasore',
        'home_address': 'OT Road, Gopalgaon, Balasore',
        'location': {'lat': 21.4940, 'lng': 86.9140},
        'requested_role': 'technician',
        'categories': ['ac'],
        'skills': ['AC servicing', 'Capacitor replacement', 'Gas charging'],
        'tools': ['Multimeter', 'Manifold gauge', 'Flaring tool', 'Vacuum pump'],
        'experience_years': 5,
        'radius_km': 6,
        'partner_policy_version': api.get('/operations/partner-policy').json()['version'],
        'partner_policy_sections': [s['id'] for s in api.get('/operations/partner-policy').json()['sections']],
        'terms_version': 'field-service-v1'
    })
    assert r_worker.status_code == 200, r_worker.text

    # Record verification documents in test fixture and approve worker
    main.operations_store.run(lambda u: u.put('verification', worker_uid, {'worker_id': worker_uid, 'identity_status': 'approved', 'bank_status': 'verified', 'fund_account_id': 'fa_test'}))
    r_worker_approve = api.post(f'/operations/admin/workers/{worker_uid}/review', headers=ADMIN, json={
        'decision': 'approved',
        'role': 'technician',
        'reason': 'Aadhaar, address and trade tools verified in full',
        'evidence_reference': 'CASE-KYC-2026-002'
    })
    assert r_worker_approve.status_code == 200, r_worker_approve.text

    # Worker turns Online switch ON with fresh GPS
    r_avail = api.post('/operations/worker/availability', headers=auth(worker_uid), json={
        'online': True,
        'position': {
            'lat': 21.4938,
            'lng': 86.9138,
            'accuracy': 12.0,
            'captured_at': now
        }
    })
    assert r_avail.status_code == 200, r_avail.text
    assert r_avail.json()['worker']['online'] is True

    # =========================================================================
    # STEP 3: CUSTOMER BOOKING & AUTOMATIC DISPATCH ASSIGNMENT
    # =========================================================================
    booking_payload = {
        'service_id': 'ac-service',
        'service_terms_version': 0,
        'city': 'Balasore',
        'address': 'Plot 42, Sahadevkhunta, Near Bus Stand, Balasore',
        'phone': '9876543210',
        'location': {'lat': 21.4950, 'lng': 86.9150},
        'starts_at': datetime.fromtimestamp(now + 7200, timezone.utc).isoformat(),
        'notes': 'AC fan motor hums but cooling does not start',
        'idempotency_key': str(uuid.uuid4())
    }
    r_book = api.post('/operations/bookings', headers=auth(customer_uid), json=booking_payload)
    assert r_book.status_code == 201, r_book.text
    job = r_book.json()
    job_id = job['id']

    # Because worker Rajesh is online in Balasore within radius for 'ac', job was automatically assigned & offered!
    assert job['state'] == 'offered'
    assert job['worker_id'] == worker_uid

    # =========================================================================
    # STEP 4: WORKER ACCEPTANCE, DEPARTURE & DOORSTEP ARRIVAL VERIFICATION
    # =========================================================================
    job = command(api, job, 'accept', uid=worker_uid)
    assert job['state'] == 'accepted'

    job = command(api, job, 'ack_reminder', uid=worker_uid)
    job = command(api, job, 'depart', uid=worker_uid)
    assert job['state'] == 'en_route'
    assert job['tracking_consent'] is True

    # Worker sends live GPS update en route (~2km away)
    job = command(api, job, 'position', uid=worker_uid, payload={
        'lat': 21.4800,
        'lng': 86.9000,
        'accuracy': 15.0,
        'captured_at': time.time()
    })

    # Customer checks live tracking
    r_cust_job = api.get(f'/operations/jobs/{job_id}', headers=auth(customer_uid))
    assert r_cust_job.status_code == 200, r_cust_job.text
    cust_view = r_cust_job.json()
    assert cust_view['state'] == 'en_route'
    assert cust_view['distance_metres'] is not None

    # Worker arrives at customer site (within 100m)
    job = command(api, job, 'position', uid=worker_uid, payload={
        'lat': 21.4950,
        'lng': 86.9150,
        'accuracy': 10.0,
        'captured_at': time.time()
    })
    assert job['state'] == 'arrived'

    # Customer retrieves Doorstep Arrival PIN
    r_otp = api.get(f'/operations/jobs/{job_id}/arrival-code', headers=auth(customer_uid))
    assert r_otp.status_code == 200, r_otp.text
    arrival_pin = r_otp.json()['code']

    # Worker verifies arrival PIN and starts task
    job = command(api, job, 'start', uid=worker_uid, payload={'code': arrival_pin})
    assert job['state'] == 'in_progress'

    # =========================================================================
    # STEP 5: WORK EXECUTION & IN-TASK SPARE PARTS PROCUREMENT WITH SHOP
    # =========================================================================
    # Worker diagnoses faulty capacitor, proposes replacement part from partner shop
    job = command(api, job, 'propose_parts', uid=worker_uid, payload={
        'items': [{'product_id': prod_id, 'quantity': 1}]
    })
    assert job['proposal']['status'] == 'pending'
    proposal_id = job['proposal']['id']

    # Customer approves proposed replacement parts
    job = command(api, job, 'approve_parts', uid=customer_uid, payload={
        'proposal_id': proposal_id
    })
    assert job['proposal']['status'] in ('approved', 'awaiting_payment')
    proposal_order_id = job['proposal']['id']

    # For procurement v3, capture parts advance to transition proposal to approved and release shop order
    import integrations
    attempt = {
        'id': proposal_order_id,
        'order_id': 'order_parts_sync',
        'kind': 'parts',
        'job_id': job_id,
        'amount_paise': 45000,
        'currency': 'INR',
        'status': 'created',
        'created_at': time.time()
    }
    main.operations_store.run(lambda u: u.put('payments', proposal_order_id, attempt))
    payment_payload = {
        'id': 'pay_parts_sync',
        'order_id': 'order_parts_sync',
        'amount': 45000,
        'currency': 'INR',
        'status': 'captured',
        'captured': True
    }
    main.operations_store.run(lambda u: integrations.apply_payment(u, payment_payload))

    # Shop sees purchase order in its queue
    r_shop_orders = api.get('/operations/shop/purchase-orders', headers=auth(shop_uid))
    assert r_shop_orders.status_code == 200, r_shop_orders.text
    orders = r_shop_orders.json()['orders']
    assert len(orders) >= 1
    target_order = next(o for o in orders if o['job_id'] == job_id)
    assert target_order['status'] == 'requested'

    # Shop accepts and prepares parts
    r_decision = api.post(f"/operations/shop/purchase-orders/{target_order['id']}/decision", headers=auth(shop_uid), json={
        'expected_version': target_order['version'],
        'decision': 'accept'
    })
    assert r_decision.status_code == 200, r_decision.text

    # Refresh job state on worker's device to get newest version after advance capture
    job = api.get(f'/operations/jobs/{job_id}', headers=auth(worker_uid)).json()

    # Worker leaves to collect parts from partner shop
    job = command(api, job, 'collect_parts', uid=worker_uid, payload={
        'return_policy': 'pickup-return-v1'
    })
    assert job['state'] == 'collecting_parts'

    # Worker arrives at shop (position near shop coordinates: 21.4934, 86.9135)
    job = command(api, job, 'position', uid=worker_uid, payload={
        'lat': 21.4934,
        'lng': 86.9135,
        'accuracy': 8.0,
        'captured_at': time.time()
    })

    # Shop generates pickup OTP
    r_pickup_code = api.get(f"/operations/shop/purchase-orders/{target_order['id']}/otp", headers=auth(shop_uid))
    assert r_pickup_code.status_code == 200, r_pickup_code.text
    pickup_otp = r_pickup_code.json()['code']

    # Worker enters shop's pickup OTP to verify receipt of parts
    r_verify_pickup = api.post(f"/operations/jobs/{job_id}/purchase-orders/{target_order['id']}/verify-pickup", headers=auth(worker_uid), json={
        'code': pickup_otp
    })
    assert r_verify_pickup.status_code == 200, r_verify_pickup.text
    assert r_verify_pickup.json()['status'] == 'picked_up'

    # Worker returns to customer site and installs parts
    job = api.get(f'/operations/jobs/{job_id}', headers=auth(worker_uid)).json()
    job = command(api, job, 'position', uid=worker_uid, payload={
        'lat': 21.4950,
        'lng': 86.9150,
        'accuracy': 10.0,
        'captured_at': time.time()
    })
    job = command(api, job, 'return_to_site', uid=worker_uid)
    assert job['state'] == 'in_progress'
    assert job['proposal']['status'] == 'received'

    job = command(api, job, 'install_parts', uid=worker_uid)
    assert job['proposal']['status'] == 'installed'

    # =========================================================================
    # STEP 6: WORK COMPLETION, CUSTOMER SIGN-OFF & VERIFIED RATING
    # =========================================================================
    # Worker uploads after repair photo / forgotten note and submits completion
    job = command(api, job, 'submit_completion', uid=worker_uid, payload={
        'notes': 'Replaced AC capacitor with genuine 45uF part, tested cooling airflow for 15 mins. Temp reached 21C.',
        'forgotten_info': 'Initial capacitor visual inspection showed mild bulging at terminals.'
    })
    assert job['state'] == 'completion_pending'

    # Customer verifies completed repair and confirms sign-off
    cust_job = api.get(f'/operations/jobs/{job_id}', headers=auth(customer_uid)).json()
    assert 'accept_completion' in cust_job['allowed_actions']

    job = command(api, cust_job, 'accept_completion', uid=customer_uid)
    assert job['state'] == 'completed'
    assert 'review' in job['allowed_actions']

    # Customer submits 5-star verified review
    job = command(api, job, 'review', uid=customer_uid, payload={
        'rating': 5,
        'text': 'Prompt arrival, genuine parts provided, AC cooling restored perfectly! Very polite and professional.'
    })
    assert job['review']['rating'] == 5
    assert job['review']['verified_booking'] is True

    # Verify worker ratings and completed tasks updated
    worker_profile = api.get('/operations/worker/me', headers=auth(worker_uid)).json()['worker']
    assert worker_profile['completed_tasks'] == 1
    assert worker_profile['rating_sum'] == 5
    assert worker_profile['rating_count'] == 1

    # =========================================================================
    # STEP 7: SHOP PAYABLES SETTLEMENT SYNCHRONIZATION
    # =========================================================================
    # Run procurement tick to sweep payables
    main.procurement_tick()

    r_payables = api.get('/operations/shop/payables', headers=auth(shop_uid))
    assert r_payables.status_code == 200, r_payables.text
    payables = r_payables.json()['payables']
    assert len(payables) == 1
    assert payables[0]['amount_paise'] == 45000  # ₹450 credited to shop ledger
    assert payables[0]['shop_id'] == shop_id

    print('\n[SUCCESS] Ecosystem synchronization: 100% verified across Shop, Worker, Customer, and Admin!')
