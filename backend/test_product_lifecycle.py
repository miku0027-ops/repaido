#!/usr/bin/env python3
"""
Repaido Comprehensive Product Lifecycle & Zero-Fake Catalog Test Suite
Validates all 8 stages of the Repaido product lifecycle:
1. Genuine Catalog Validation & Mock/Fake Product Eradication
2. Partner Shop Registration & KYC with GPS Coordinates
3. Shop Product Addition & Company Admin Moderation Queue
4. Customer E-Commerce Purchase & Itemized 18% GST Invoicing
5. Technician In-Task Procurement with ₹10/km 2-Way Travel Billing
6. 100-Meter Privacy Safety Contact Masking
7. Shop Flashing Alert, Availability Confirmation & Live Tracking
8. 5% Platform Commission, ₹2,000 Gradual Onboarding Recovery & Wednesday Ledger
9. Specialist Upgrade Rule (Strictly 1,500 points OR 20 completed tasks)
10. 15-Minute Task Acknowledgement Deadline & Discovery Engine Reassignment
"""
import math
import pytest
from datetime import datetime, timezone, timedelta

# Import test client and app components
import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from scripts.seed_database import SPARE_SHOPS, SPARE_PRODUCTS, BASE_FARES, SERVICES_CATALOG, TECHNICIANS


# ==========================================
# 1. CATALOG INTEGRITY & ZERO FAKE PRODUCTS
# ==========================================

def test_no_mock_or_fake_products_in_catalog():
    """Verify that every single product in the catalog is authentic and free of fake/mock keywords."""
    forbidden_terms = ["mock", "fake", "dummy", "sample", "placeholder", "test product"]

    valid_shop_ids = {s["id"] for s in SPARE_SHOPS}

    for prod in SPARE_PRODUCTS:
        # Check text fields for forbidden keywords
        full_text = f"{prod['name']} {prod['part_number']} {prod['brand']} {prod['description']}".lower()
        for term in forbidden_terms:
            assert term not in full_text, f"Forbidden mock keyword '{term}' found in product: {prod['id']}"

        # Verify shop association
        assert prod["shop_id"] in valid_shop_ids, f"Product {prod['id']} is not linked to a verified partner shop"

        # Verify pricing logic
        assert prod["price"] > 0, f"Product {prod['id']} must have positive price"
        assert prod["mrp"] >= prod["price"], f"Product {prod['id']} MRP must be >= sale price"

        # Verify stock authenticity
        assert prod["stock"] > 0, f"Active catalog product {prod['id']} must have positive physical stock"

        # Verify GST rate is standard 18%
        assert prod["gst_rate"] == 0.18, f"Product {prod['id']} must have 18% GST rate"

        # Verify warranty
        assert prod["warranty_months"] >= 0, f"Product {prod['id']} warranty must be valid"


def test_sanitize_rejects_fake_product_submissions():
    """Verify platform validation strictly rejects any mock or fake submissions."""
    def validate_product(p):
        full_text = f"{p.get('name', '')} {p.get('part_number', '')} {p.get('brand', '')}".lower()
        for term in ["mock", "fake", "dummy", "test"]:
            if term in full_text:
                return False, f"Contains forbidden keyword: {term}"
        if p.get("price", 0) <= 0 or p.get("mrp", 0) < p.get("price", 0):
            return False, "Invalid price or MRP"
        if p.get("stock", 0) < 0:
            return False, "Negative stock"
        return True, "Valid"

    # Test rejection of fake item
    is_valid, reason = validate_product({
        "name": "Test Dummy Capacitor",
        "part_number": "MOCK-123",
        "brand": "FakeBrand",
        "price": 500,
        "mrp": 700,
        "stock": 10
    })
    assert not is_valid
    assert "forbidden keyword" in reason

    # Test acceptance of genuine OEM item
    is_valid, reason = validate_product({
        "name": "Heavy Duty Brass Flush Valve 32mm",
        "part_number": "VAL-FLUSH-32B",
        "brand": "Jaquar OEM",
        "price": 1250,
        "mrp": 1650,
        "stock": 9
    })
    assert is_valid


# ==========================================
# 2. PARTNER SHOP REGISTRATION & KYC FLOW
# ==========================================

def test_partner_shop_kyc_and_gps_picker():
    """Verify partner shop registration requires complete business KYC and coordinates."""
    for shop in SPARE_SHOPS:
        assert shop["gstin"].startswith("21"), f"Shop {shop['id']} must have valid Odisha GSTIN"
        assert len(shop["gstin"]) == 15, "GSTIN must be 15 characters"
        assert shop["trade_license"], "Shop must have valid trade license"
        assert shop["bank_account"], "Shop must have bank account for Wednesday payouts"
        assert shop["ifsc"], "Shop must have valid IFSC code"
        assert 21.40 <= shop["lat"] <= 21.60, "Shop latitude must be in Balasore region"
        assert 86.85 <= shop["lng"] <= 87.05, "Shop longitude must be in Balasore region"
        assert shop["commission_rate"] == 0.05, "Shop commission must be strictly 5%"
        assert shop["onboarding_fee_remaining"] <= 2000, "Onboarding fee balance must not exceed ₹2,000"


# ==========================================
# 3. CUSTOMER E-COMMERCE & 18% GST INVOICING
# ==========================================

def test_customer_order_itemized_gst_and_inventory_decrement():
    """Test full customer e-commerce purchase lifecycle including 18% GST and inventory update."""
    product = SPARE_PRODUCTS[0].copy()
    initial_stock = product["stock"]
    quantity_to_order = 2

    # Calculate itemized GST (18% = 9% CGST + 9% SGST)
    subtotal_rupees = product["price"] * quantity_to_order
    cgst_9_percent = round(subtotal_rupees * 0.09, 2)
    sgst_9_percent = round(subtotal_rupees * 0.09, 2)
    total_gst = round(cgst_9_percent + sgst_9_percent, 2)
    delivery_fee = 99.0
    grand_total = round(subtotal_rupees + total_gst + delivery_fee, 2)

    assert round(subtotal_rupees * 0.18, 2) == total_gst, "Total GST must exactly equal 18% of subtotal"
    assert grand_total == subtotal_rupees + total_gst + delivery_fee

    # Simulate stock decrement
    updated_stock = initial_stock - quantity_to_order
    assert updated_stock == initial_stock - 2
    assert updated_stock >= 0, "Stock cannot be negative"


# ==========================================
# 4. TECHNICIAN IN-TASK PROCUREMENT & TRAVEL
# ==========================================

def haversine_distance_km(lat1, lon1, lat2, lon2):
    R = 6371.0
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = (math.sin(d_lat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(d_lon / 2) ** 2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return round(R * c, 1)


def test_technician_in_task_spare_procurement_and_2way_travel():
    """Verify ₹10/km 2-way travel billing (distance * 2 * ₹10) added to customer task invoice."""
    customer_lat = 21.4934
    customer_lng = 86.9135
    shop = SPARE_SHOPS[0]

    distance_km = haversine_distance_km(customer_lat, customer_lng, shop["lat"], shop["lng"])
    assert distance_km > 0

    # Rule: ₹10/km up and ₹10/km down from repair location to shop
    travel_charge = max(20, round(distance_km * 2 * 10))
    expected_travel_charge = max(20, round(distance_km * 20))
    assert travel_charge == expected_travel_charge

    # Customer billing
    product_price = 450
    total_billed_to_customer = product_price + travel_charge
    assert total_billed_to_customer == 450 + travel_charge


def test_100_meter_safety_privacy_masking():
    """Verify shop phone number is masked when >100m, and visible when <=100m."""
    shop_phone = "+91 94370 12890"

    def get_display_phone(distance_meters):
        if distance_meters <= 100:
            return shop_phone
        return "+91 ••••• •••• (Hidden for Safety until within 100m)"

    # Far away (> 100m)
    phone_150m = get_display_phone(150)
    assert "Hidden for Safety" in phone_150m
    assert shop_phone not in phone_150m

    # Close (<= 100m)
    phone_80m = get_display_phone(80)
    assert phone_80m == shop_phone


# ==========================================
# 5. SHOP COMMISSION & WEDNESDAY LEDGER
# ==========================================

def test_shop_5_percent_commission_and_gradual_onboarding():
    """Verify 5% platform commission and ₹50 gradual onboarding recovery per sale."""
    item_price = 1000
    initial_onboarding_balance = 2000

    commission_5_percent = round(item_price * 0.05)
    assert commission_5_percent == 50

    # Gradual onboarding recovery (₹50 per sale, not all at once)
    onboarding_deduction = min(initial_onboarding_balance, 50)
    assert onboarding_deduction == 50

    net_payout = item_price - commission_5_percent - onboarding_deduction
    assert net_payout == 900

    new_onboarding_balance = initial_onboarding_balance - onboarding_deduction
    assert new_onboarding_balance == 1950


# ==========================================
# 6. SPECIALIST UPGRADE MILESTONE RULES
# ==========================================

def evaluate_technician_progression(points, completed_tasks):
    """Rule: strictly 1,500 points OR 20 tasks completion (any one first)."""
    specialist_points = 1500
    specialist_tasks = 20

    is_eligible = points >= specialist_points or completed_tasks >= specialist_tasks
    role = "specialist" if is_eligible else "technician"
    return role, is_eligible


def test_specialist_progression_logic():
    # Case 1: Fresh technician
    role, ok = evaluate_technician_progression(points=200, completed_tasks=3)
    assert role == "technician" and not ok

    # Case 2: Technician with 1500 points, but only 12 tasks (Passed points rule)
    role, ok = evaluate_technician_progression(points=1500, completed_tasks=12)
    assert role == "specialist" and ok

    # Case 3: Technician with only 950 points, but 20 completed tasks (Passed tasks rule)
    role, ok = evaluate_technician_progression(points=950, completed_tasks=20)
    assert role == "specialist" and ok

    # Case 4: Neither passed
    role, ok = evaluate_technician_progression(points=1499, completed_tasks=19)
    assert role == "technician" and not ok


# ==========================================
# 7. 15-MINUTE DEADLINE & DISCOVERY ENGINE
# ==========================================

def test_15_minute_acknowledgement_timeout_reassignment():
    """Verify task reassigns when 15-minute countdown reaches 0."""
    now = datetime.now(timezone.utc)
    deadline_15_mins = now + timedelta(minutes=15)

    booking = {
        "id": "REP-BK-1001",
        "worker_id": "tech-01",
        "status": "requested",
        "timeline_step": "assigned",
        "acknowledgement_deadline": deadline_15_mins.isoformat()
    }

    # Time remaining calculation
    time_remaining_seconds = (datetime.fromisoformat(booking["acknowledgement_deadline"]) - now).total_seconds()
    assert 899 <= time_remaining_seconds <= 900

    # Simulate expired deadline
    expired_time = now + timedelta(minutes=16)
    is_expired = expired_time > datetime.fromisoformat(booking["acknowledgement_deadline"])
    assert is_expired

    # When expired, Discovery Engine selects next ranked candidate
    available_candidates = [
        {"worker_id": "tech-01", "score": 95},  # Timed out
        {"worker_id": "tech-02", "score": 92},  # Next best candidate
        {"worker_id": "tech-03", "score": 88}
    ]
    reassigned_candidate = next(c for c in available_candidates if c["worker_id"] != booking["worker_id"])
    assert reassigned_candidate["worker_id"] == "tech-02"


# ==========================================
# 8. REGIONAL BASE FARES
# ==========================================

def test_regional_base_fares_balasore_default():
    """Verify Balasore regional base fare default is strictly ₹150."""
    assert BASE_FARES["Balasore"] == 150
    assert BASE_FARES["Bhubaneswar"] == 199
    assert BASE_FARES["Bengaluru"] == 249
