import pytest
from starlette.testclient import TestClient
import main

@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main, 'DB_PATH', str(tmp_path / 'operations.db'))
    monkeypatch.setattr(main, 'USE_FIRESTORE', False)
    monkeypatch.setattr(main, 'fb_db', None)
    monkeypatch.setenv('REPAIDO_ADMIN_KEY', 'test-operator-key')
    with TestClient(main.app) as client:
        yield client

def test_b2b_wholesale_lifecycle_and_pdf(client):
    # 1. Create a B2B wholesale listing
    listing_payload = {
        'title': 'Pure Copper Refrigeration Coil 1/2" 50ft',
        'category': 'hvac',
        'part_number': 'COP-TUBE-50FT',
        'hsn_code': '74112100',
        'unit': 'Rolls',
        'moq': 10,
        'base_price_paise': 145000,
        'mrp_paise': 235000,
        'bulk_slabs': [
            {'min_qty': 10, 'max_qty': 24, 'price_paise': 145000, 'discount_label': 'Wholesale'},
            {'min_qty': 25, 'max_qty': None, 'price_paise': 132000, 'discount_label': 'Distributor'}
        ],
        'stock': 300,
        'lead_time_days': 2,
        'supply_capacity': '2,000 Rolls / Month',
        'description': 'Phosphorus deoxidized seamless copper coil ASTM B280',
        'specifications': {'OD': '1/2 Inch', 'Wall': '0.8mm'},
        'shop_id': 'shop-bls-01',
        'shop_name': 'Maa Tarini Spare Hub'
    }
    res = client.post('/operations/b2b/listings', json=listing_payload)
    assert res.status_code == 200
    listing_id = res.json()['listing']['id']

    # 2. Retrieve listings
    get_res = client.get('/operations/b2b/listings')
    assert get_res.status_code == 200
    assert any(l['id'] == listing_id for l in get_res.json()['listings'])

    # 3. Create buyer RFQ
    rfq_payload = {
        'listing_id': listing_id,
        'item_title': 'Pure Copper Refrigeration Coil 1/2" 50ft',
        'category': 'hvac',
        'hsn_code': '74112100',
        'unit': 'Rolls',
        'shop_id': 'shop-bls-01',
        'shop_name': 'Maa Tarini Spare Hub',
        'customer_name': 'Biswajit Mohapatra',
        'customer_phone': '+91 94381 22334',
        'customer_email': 'biswajit.infra@gmail.com',
        'buyer_company_name': 'Kalinga HVAC Engineering Solutions',
        'buyer_gstin': '21AAACK1928J1Z9',
        'delivery_address': 'Plot 42, Ganeswarpur Industrial Estate',
        'delivery_city': 'Balasore',
        'delivery_pincode': '756019',
        'quantity_requested': 35,
        'target_price_paise': 129000,
        'urgency': 'within_7_days',
        'notes': 'Required for commercial hospital VRF project'
    }
    rfq_res = client.post('/operations/b2b/rfq', json=rfq_payload)
    assert rfq_res.status_code == 200
    rfq_id = rfq_res.json()['rfq']['id']

    # 4. Generate official quotation from shop
    quote_payload = {
        'rfq_id': rfq_id,
        'offered_rate_paise': 128000,
        'quantity': 35,
        'gst_rate': 0.18,
        'freight_charges_paise': 65000,
        'payment_terms': '30% Advance via Repaido Escrow, 70% upon delivery inspection',
        'delivery_timeline': 'Dispatched within 2 Business Days via Express Cargo',
        'warranty_terms': '1 Year Full Replacement Guarantee + ASTM B280 Test Certificates',
        'validity_days': 15,
        'authorized_signatory': 'Sarat Chandra Nayak',
        'signatory_designation': 'Director of Commercial Wholesale'
    }
    quote_res = client.post('/operations/b2b/quotation', json=quote_payload)
    assert quote_res.status_code == 200
    quote_number = quote_res.json()['quotation']['quote_number']
    assert quote_res.json()['quotation']['taxable_paise'] == 35 * 128000
    assert quote_res.json()['quotation']['grand_total_paise'] == (35 * 128000) + int(35 * 128000 * 0.18) + 65000

    # 5. Fetch branded Repaido PDF
    pdf_res = client.get(f'/operations/b2b/quotation/{quote_number}/pdf')
    assert pdf_res.status_code == 200
    assert pdf_res.headers['content-type'] == 'application/pdf'
    assert pdf_res.content.startswith(b'%PDF-')
    assert len(pdf_res.content) > 1000
