import time
import pytest
from fastapi.testclient import TestClient
import main

@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main, 'DB_PATH', str(tmp_path/'operations.db'))
    monkeypatch.setattr(main, 'USE_FIRESTORE', False)
    monkeypatch.setattr(main, 'fb_db', None)
    main.init_db()
    main.operations_store.init()
    with TestClient(main.app) as c:
        yield c

def test_create_cart_order(client):
    payload = {
        'customer_name': 'Tushar Das',
        'customer_phone': '+91 98765 43210',
        'delivery_address': 'Flat 302, Sai Residency, Patia',
        'city': 'Bhubaneswar',
        'pincode': '751024',
        'payment_method': 'upi',
        'items': [
            {
                'id': 'item-1',
                'title': 'Heavy Duty 1.5 Ton AC Capacitor',
                'price_paise': 65000,
                'quantity': 2,
                'shop_id': 'shop-1',
                'shop_name': 'Kalinga Cooling Spares',
                'category': 'ac'
            }
        ],
        'order_notes': 'Please call before delivery'
    }
    res = client.post('/operations/cart/orders', json=payload)
    assert res.status_code == 200
    order = res.json()
    assert order['subtotal_paise'] == 130000  # ₹1,300
    assert order['delivery_fee_paise'] == 0   # Free over ₹999
    assert order['gst_paise'] == int(130000 * 0.18)
    assert order['total_paise'] == 130000 + int(130000 * 0.18)
    assert order['status'] == 'confirmed'
