"""Repaido API: durable customer accounts, catalog, capacity-aware bookings.
Run: uvicorn main:app --host 127.0.0.1 --port 8000
"""
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
import uuid
import base64
import urllib.request
import asyncio
import logging
import sys
from contextlib import contextmanager, asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

# Firebase Admin SDK Initialization
fb_db = None
fb_auth_module = None
try:
    import firebase_admin
    from firebase_admin import credentials, firestore, auth as admin_auth
    service_account_path = os.getenv(
        'GOOGLE_APPLICATION_CREDENTIALS',
        os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'repaido-firebase-adminsdk-fbsvc-25535a3683.json'))
    )
    if not firebase_admin._apps:
        cred = credentials.Certificate(service_account_path) if os.path.exists(service_account_path) else credentials.ApplicationDefault()
        firebase_admin.initialize_app(cred, {'projectId': os.getenv('GOOGLE_CLOUD_PROJECT', 'repaido')})
    fb_db = firestore.client()
    fb_auth_module = admin_auth
    print('Firebase Admin SDK initialized with Cloud Firestore.')
except Exception as e:
    print(f'Firebase Admin init notice: {e}')

DB_PATH = os.getenv('REPAIDO_DB', 'repaido.db')
USE_FIRESTORE = fb_db is not None and os.getenv('REPAIDO_STORAGE', 'sqlite').lower() == 'firestore'
IST = ZoneInfo('Asia/Kolkata')
CITIES = ['Balasore', 'Bhadrak', 'Jajpur', 'Bhubaneswar', 'Cuttack', 'Puri', 'Berhampur', 'Rourkela', 'Sambalpur', 'Bengaluru', 'Mumbai', 'Delhi', 'Hyderabad', 'Pune', 'Chennai']
CITY_BASE_FARES_PAISE = {city: 15000 for city in CITIES}
CATEGORIES = [
    ('cleaning', 'Cleaning', 'A fresh start for every room'),
    ('ac', 'AC & appliances', 'Keep everyday essentials running'),
    ('salon', 'Salon & spa', 'A little time for yourself'),
    ('electrician', 'Electrician', 'Small fixes, expertly handled'),
    ('plumber', 'Plumber', 'Leave the leaks to us'),
    ('carpenter', 'Carpenter', 'Give your furniture a little care'),
    ('painting', 'Painting', 'A fresh perspective for your walls'),
    ('pest', 'Pest control', 'Make yourself at home again'),
]
SHOP_CATEGORIES = [
    'Electronics & Spare Parts', 'Plumbing Supplies', 'Electrical Equipment',
    'Hardware & Construction Tools', 'Paint & Wall Supplies', 'Automotive Parts',
    'Home Appliance Parts', 'Cleaning Supplies & Chemicals', 'Water Treatment Equipment',
    'Safety & Security Equipment', 'Garden & Agricultural Supplies', 'Furniture & Fittings',
    'Tiles & Flooring Materials', 'Sanitary Ware', 'HVAC Parts', 'Power Tools & Accessories',
    'General Hardware Store', 'EV & Battery Parts'
]
SERVICES = [
 ('home-clean', 'cleaning', 'Home deep cleaning', 'A top-to-bottom reset for your space.', 299900, 240, 'DEEP CLEAN', ['Floors, surfaces and windows', 'Kitchen and bathroom cleaning', 'Equipment and supplies included'], ['Interior walls and exterior windows', 'Moving heavy furniture']),
 ('bathroom', 'cleaning', 'Bathroom deep cleaning', 'A brighter, fresher bathroom.', 49900, 60, 'EVERYDAY ESSENTIAL', ['Tiles and grout cleaning', 'Fixtures and fittings', 'Floor cleaning and sanitising'], ['Ceiling and painted walls']),
 ('sofa', 'cleaning', 'Sofa cleaning', 'A little refresh for your favourite spot.', 79900, 90, '', ['Fabric sofa, up to 3 seats', 'Vacuum and shampoo wash', 'Drying guidance'], ['Leather or suede upholstery']),
 ('ac-service', 'ac', 'AC service', 'Better cooling starts with better care.', 59900, 60, 'SEASONAL PICK', ['One split AC unit', 'Filter and coil cleaning', 'Cooling and drainage check'], ['Gas refill and spare parts']),
 ('washing-machine', 'ac', 'Washing machine check-up', 'Find the cause. Get a clear repair quote.', 24900, 45, '', ['Fault diagnosis', 'Safety inspection', 'Repair estimate before any work'], ['Spare parts and repair labour']),
 ('salon-care', 'salon', 'At-home salon essentials', 'Your regular routine, in your own space.', 99900, 90, '', ['Clean-up facial', 'Manicure', 'Single-use hygiene supplies'], ['Hair colouring and waxing']),
 ('massage', 'salon', 'Relaxing head massage', 'A peaceful pause in your day.', 49900, 45, '', ['30-minute head and shoulder massage', 'Setup and clean-up included'], ['Medical or therapeutic treatment']),
 ('electrical', 'electrician', 'Electrical safety visit', 'Help with switches, sockets and small fixes.', 19900, 45, '', ['Inspection of up to 3 fittings', 'Problem diagnosis', 'Upfront repair estimate'], ['Parts and additional repair labour']),
 ('plumbing', 'plumber', 'Plumbing visit', 'Get to the bottom of leaks and blockages.', 19900, 45, '', ['Inspection of one issue', 'Leak or blockage diagnosis', 'Upfront repair estimate'], ['Parts and additional repair labour']),
 ('carpentry', 'carpenter', 'Furniture repair visit', 'Make your everyday pieces work again.', 24900, 45, '', ['Inspection of one furniture item', 'Repair advice and estimate'], ['Materials and repair labour']),
 ('painting', 'painting', 'Wall painting consultation', 'Plan the right finish for your home.', 19900, 60, '', ['Room measurement', 'Colour and finish consultation', 'Written painting estimate'], ['Paint, supplies and painting work']),
 ('pest-control', 'pest', 'Cockroach control', 'Targeted care for a more comfortable home.', 89900, 60, '', ['Treatment for a 1-bedroom home', 'Kitchen and bathroom treatment', 'Aftercare instructions'], ['Termites, rodents and bedbugs']),
]

@contextmanager
def db():
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = ON')
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def fs_collection(name: str):
    if not fb_db:
        raise RuntimeError('Firestore is not configured.')
    return fb_db.collection(name)

def fs_doc(name: str, document_id: str):
    return fs_collection(name).document(document_id)

def fs_now():
    return int(time.time())

def fs_user(user_id: str):
    snap = fs_doc('users', user_id).get()
    return snap.to_dict() if snap.exists else None

def fs_booking_dict(data: dict):
    output = dict(data)
    output.setdefault('id', data.get('id'))
    return output

def init_firestore_seed():
    if not USE_FIRESTORE:
        return
    batch = fb_db.batch()
    for service in SERVICES:
        ref = fs_doc('services', service[0])
        if not ref.get().exists:
            batch.set(ref, {
                'id': service[0], 'category': service[1], 'name': service[2], 'description': service[3],
                'price_paise': service[4], 'duration_minutes': service[5], 'badge': service[6],
                'included': service[7], 'excluded': service[8]
            })
    spare_catalog = [
        ('pr-ac-cap-01', 'Dual Run Motor Capacitor 45+5 uF 440V AC', 45000, 14),
        ('pr-ac-blw-02', 'Split AC Indoor Blower Fan Motor 28W Pure Copper', 135000, 7),
        ('pr-ac-gas-03', 'R32 Low-GWP Eco Refrigerant Gas Can (650g)', 89000, 18),
        ('pr-plumb-val-01', 'Heavy Brass Concealed Flush Valve 32mm Dual Action', 125000, 9),
        ('pr-plumb-ang-02', 'Quarter Turn Brass Angle Cock with Wall Flange 1/2 inch', 38000, 25),
        ('pr-plumb-disc-03', 'Ceramic Disc Cartridge 35mm for Single Lever Basin Mixer', 24000, 16),
        ('pr-elec-mcb-01', 'Double Pole 32A C-Curve Modular MCB 10kA', 49000, 20),
        ('pr-elec-cbl-02', 'FR-LSH Pure Copper Multi-strand Wire 2.5 sq mm (30m)', 115000, 12),
        ('pr-app-pmp-01', 'Universal Washing Machine Drain Pump Motor 30W', 68000, 11),
        ('pr-app-tmr-02', 'Frost-Free Refrigerator Defrost Timer & Bi-Metal Sensor Kit', 52000, 15),
        ('pr-tool-clm-01', 'True-RMS Digital AC/DC Clamp Meter 600A with Temperature', 185000, 5),
        ('pr-tool-wrn-02', 'Heavy Duty 14-inch Drop Forged Cast Iron Pipe Wrench', 65000, 8)
    ]
    for product_id, name, price_paise, stock in spare_catalog:
        ref = fs_doc('spare_catalog', product_id)
        if not ref.get().exists:
            batch.set(ref, {'id': product_id, 'name': name, 'price_paise': price_paise, 'stock': stock, 'status': 'approved'})
    batch.commit()


def init_db():
    import json
    with db() as c:
        c.execute('PRAGMA journal_mode=WAL')
        c.executescript('''
        CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, created_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS services(id TEXT PRIMARY KEY, category TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL, price_paise INTEGER NOT NULL, duration_minutes INTEGER NOT NULL, badge TEXT NOT NULL, included TEXT NOT NULL, excluded TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS technicians(id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, category TEXT NOT NULL, city TEXT NOT NULL, phone TEXT NOT NULL, rating REAL NOT NULL, completed_tasks INTEGER NOT NULL, skills TEXT NOT NULL, tools_list TEXT NOT NULL, status TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS bookings(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), service_id TEXT NOT NULL REFERENCES services(id), city TEXT NOT NULL, address TEXT NOT NULL, phone TEXT NOT NULL, notes TEXT NOT NULL, starts_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('requested','confirmed','in_progress','completed','cancelled')), price_paise INTEGER NOT NULL, created_at INTEGER NOT NULL, idempotency_key TEXT NOT NULL, professional_name TEXT, UNIQUE(user_id,idempotency_key));
        CREATE TABLE IF NOT EXISTS payment_orders(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), purpose TEXT NOT NULL CHECK(purpose IN ('booking','spare_order')), amount_paise INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'INR', razorpay_order_id TEXT UNIQUE NOT NULL, status TEXT NOT NULL, metadata TEXT NOT NULL, razorpay_payment_id TEXT, razorpay_signature TEXT, created_at INTEGER NOT NULL, paid_at INTEGER);
        CREATE TABLE IF NOT EXISTS spare_orders(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), status TEXT NOT NULL, payment_status TEXT NOT NULL, payment_order_id TEXT, total_paise INTEGER NOT NULL, recipient_name TEXT NOT NULL, recipient_phone TEXT NOT NULL, delivery_address TEXT NOT NULL, tracking_status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS spare_order_items(id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL REFERENCES spare_orders(id), product_id TEXT NOT NULL, product_name TEXT NOT NULL, quantity INTEGER NOT NULL, unit_price_paise INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS spare_catalog(id TEXT PRIMARY KEY, name TEXT NOT NULL, price_paise INTEGER NOT NULL, stock INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'approved');
        CREATE TABLE IF NOT EXISTS partner_applications(id TEXT PRIMARY KEY, role TEXT NOT NULL, name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT, dob TEXT, gender TEXT, home_address TEXT, service_city TEXT, trade_category TEXT, experience_years INTEGER, tools_list TEXT, aadhaar_number TEXT, pan_number TEXT, status TEXT NOT NULL, created_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS shop_applications(id TEXT PRIMARY KEY, owner_name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT, shop_name TEXT NOT NULL, shop_tagline TEXT, gstin TEXT, trade_license TEXT NOT NULL, address TEXT NOT NULL, city TEXT NOT NULL, pincode TEXT, categories TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL, bank_holder TEXT NOT NULL, bank_name TEXT NOT NULL, account_number TEXT NOT NULL, ifsc_code TEXT NOT NULL, upi_id TEXT, aadhaar_number TEXT NOT NULL, pan_number TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS specialist_payments(id TEXT PRIMARY KEY, application_id TEXT, plan TEXT NOT NULL, amount_paise INTEGER NOT NULL, razorpay_order_id TEXT UNIQUE, razorpay_payment_id TEXT, razorpay_signature TEXT, status TEXT NOT NULL, created_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS support_tickets(id TEXT PRIMARY KEY, user_id TEXT, name TEXT NOT NULL, phone TEXT NOT NULL, subject TEXT NOT NULL, message TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS booking_capacity ON bookings(city,service_id,starts_at,status);
        CREATE INDEX IF NOT EXISTS booking_owner ON bookings(user_id,created_at);
        CREATE INDEX IF NOT EXISTS payment_owner ON payment_orders(user_id,created_at);
        CREATE INDEX IF NOT EXISTS spare_order_owner ON spare_orders(user_id,created_at);
        CREATE TABLE IF NOT EXISTS rate_limits(key TEXT NOT NULL, happened_at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS rate_limit_key ON rate_limits(key,happened_at);
        ''')
        # Prices are owned by this catalogue; the browser may submit IDs and quantities only.
        c.executemany('INSERT OR IGNORE INTO spare_catalog (id,name,price_paise,stock,status) VALUES (?,?,?,?,?)', [
            ('pr-ac-cap-01', 'Dual Run Motor Capacitor 45+5 uF 440V AC', 45000, 14, 'approved'),
            ('pr-ac-blw-02', 'Split AC Indoor Blower Fan Motor 28W Pure Copper', 135000, 7, 'approved'),
            ('pr-ac-gas-03', 'R32 Low-GWP Eco Refrigerant Gas Can (650g)', 89000, 18, 'approved'),
            ('pr-plumb-val-01', 'Heavy Brass Concealed Flush Valve 32mm Dual Action', 125000, 9, 'approved'),
            ('pr-plumb-ang-02', 'Quarter Turn Brass Angle Cock with Wall Flange 1/2 inch', 38000, 25, 'approved'),
            ('pr-plumb-disc-03', 'Ceramic Disc Cartridge 35mm for Single Lever Basin Mixer', 24000, 16, 'approved'),
            ('pr-elec-mcb-01', 'Double Pole 32A C-Curve Modular MCB 10kA', 49000, 20, 'approved'),
            ('pr-elec-cbl-02', 'FR-LSH Pure Copper Multi-strand Wire 2.5 sq mm (30m)', 115000, 12, 'approved'),
            ('pr-app-pmp-01', 'Universal Washing Machine Drain Pump Motor 30W', 68000, 11, 'approved'),
            ('pr-app-tmr-02', 'Frost-Free Refrigerator Defrost Timer & Bi-Metal Sensor Kit', 52000, 15, 'approved'),
            ('pr-tool-clm-01', 'True-RMS Digital AC/DC Clamp Meter 600A with Temperature', 185000, 5, 'approved'),
            ('pr-tool-wrn-02', 'Heavy Duty 14-inch Drop Forged Cast Iron Pipe Wrench', 65000, 8, 'approved')
        ])
        for column, definition in (
            ('payment_order_id', 'TEXT'), ('payment_id', 'TEXT'),
            ('cancellation_reason', 'TEXT'), ('reschedule_reason', 'TEXT'),
            ('tracking_status', "TEXT NOT NULL DEFAULT 'requested'"),
            ('updated_at', 'INTEGER')
        ):
            try: c.execute(f'ALTER TABLE bookings ADD COLUMN {column} {definition}')
            except sqlite3.OperationalError: pass
        for column, definition in (
            ('service_categories', "TEXT NOT NULL DEFAULT '[]'"),
            ('availability_confirmed', 'INTEGER NOT NULL DEFAULT 1'),
            ('lat', 'REAL'), ('lng', 'REAL'), ('verified_specialist', 'INTEGER NOT NULL DEFAULT 0')
        ):
            try: c.execute(f'ALTER TABLE technicians ADD COLUMN {column} {definition}')
            except sqlite3.OperationalError: pass
        for column, definition in (
            ('service_categories', "TEXT NOT NULL DEFAULT '[]'"),
            ('lat', 'REAL'), ('lng', 'REAL'), ('specialist_plan', 'TEXT'), ('razorpay_payment_id', 'TEXT')
        ):
            try: c.execute(f'ALTER TABLE partner_applications ADD COLUMN {column} {definition}')
            except sqlite3.OperationalError: pass
        for s in SERVICES:
            c.execute('INSERT OR IGNORE INTO services VALUES(?,?,?,?,?,?,?,?,?)', (*s[:7], json.dumps(s[7]), json.dumps(s[8])))

@asynccontextmanager
async def lifespan(app):
    if os.getenv('REPAIDO_STORAGE', 'sqlite').lower() == 'firestore' and not USE_FIRESTORE:
        raise RuntimeError('Firestore storage was requested but is unavailable. Refusing ephemeral storage fallback.')
    init_db()
    if not os.getenv("K_SERVICE") or os.getenv("REPAIDO_SEED_CATALOG") == "true":
        init_firestore_seed()
    operations_store.init()
    contract_work.initialize(sys.modules[__name__])
    repaidians.initialize(sys.modules[__name__])
    repaidians_opportunities.initialize(sys.modules[__name__])
    repaidians_work.initialize(sys.modules[__name__])
    async def run_scheduler():
        while True:
            try:
                await asyncio.to_thread(operations_tick)
            except Exception:
                logging.getLogger('repaido.operations').exception('Operational scheduler failed; retrying in 30 seconds')
            await asyncio.sleep(30)
    scheduler = asyncio.create_task(run_scheduler())
    try:
        yield
    finally:
        scheduler.cancel()
        try:
            await scheduler
        except asyncio.CancelledError:
            pass

app = FastAPI(title='Repaido API', version='1.0.0', description='Android-first home services. Prices in integer paise. Bookings begin as requests until an operator assigns a professional.', lifespan=lifespan)

# Exact frontend origins only. Authorization remains enforced by each API route.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://repaido.com", "https://www.repaido.com", "https://repaido.web.app", "https://repaido.firebaseapp.com", "http://127.0.0.1:5186", "http://localhost:5186"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware('http')
async def security_headers(request: Request, call_next):
    # Firebase Hosting forwards /api paths to Cloud Run unchanged.
    if request.scope['path'].startswith('/api/'):
        request.scope['path'] = request.scope['path'][4:]
        request.scope['raw_path'] = request.scope['raw_path'][4:]
    response = await call_next(request)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Cache-Control'] = 'no-store'
    return response


def hash_password(password, salt=None):
    salt = salt or secrets.token_hex(16)
    result = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()
    return f'{salt}:{result}'


def rate_limit(request):
    key = request.client.host if request.client else 'unknown'
    now = int(time.time())
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        c.execute('DELETE FROM rate_limits WHERE happened_at < ?', (now - 900,))
        count = c.execute('SELECT count(*) FROM rate_limits WHERE key=?', (key,)).fetchone()[0]
        if count >= 30:
            raise HTTPException(429, 'Too many sign-in attempts. Try again in 15 minutes.')
        c.execute('INSERT INTO rate_limits VALUES(?,?)', (key, now))


def current_user(authorization: str = Header(default='')):
    if not authorization.startswith('Bearer '):
        raise HTTPException(401, 'Please sign in to continue.')
    raw_token = authorization[7:].strip()

    # 1. Try Firebase Auth verification if Firebase Admin is available
    if fb_auth_module:
        try:
            decoded = fb_auth_module.verify_id_token(raw_token, check_revoked=True)
            uid = decoded['uid']
            name = decoded.get('name', 'Repaido Member')
            email = decoded.get('email', f"{uid}@repaido.user")
            if USE_FIRESTORE:
                ref = fs_doc('users', uid)
                if not ref.get().exists:
                    ref.set({'id': uid, 'name': name, 'email': email, 'created_at': fs_now()})
            else:
                with db() as c:
                    c.execute('INSERT OR IGNORE INTO users VALUES(?,?,?,?,?)', (uid, name, email, 'firebase_auth_token', int(time.time())))
            return {'id': uid, 'name': name, 'email': email,
                    'phone': decoded.get('phone_number'),
                    'phone_verified': bool(decoded.get('phone_number')),
                    'phone_authenticated': bool(decoded.get('phone_number')) and decoded.get('firebase', {}).get('sign_in_provider') == 'phone'}
        except Exception:
            pass

    # 2. Fall back to local SQLite session tokens
    if USE_FIRESTORE:
        raise HTTPException(401, 'Please sign in with Firebase Auth.')
    digest = hashlib.sha256(raw_token.encode()).hexdigest()
    with db() as c:
        user = c.execute('SELECT u.id,u.name,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?', (digest, int(time.time()))).fetchone()
    if not user:
        raise HTTPException(401, 'Your session has expired. Please sign in again.')
    return dict(user)


def issue_session(user):
    token = secrets.token_urlsafe(32)
    with db() as c:
        c.execute('DELETE FROM sessions WHERE expires_at <= ?', (int(time.time()),))
        c.execute('INSERT INTO sessions VALUES(?,?,?)', (hashlib.sha256(token.encode()).hexdigest(), user['id'], int(time.time()) + 7*86400))
    return {'token': token, 'user': {k:user[k] for k in ('id','name','email')}}

class Credentials(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=10, max_length=128)

class Registration(Credentials):
    name: str = Field(min_length=2, max_length=80)


def valid_email(email):
    email = email.strip().lower()
    if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email):
        raise HTTPException(422, 'Enter a valid email address.')
    return email

@app.get('/health')
def health():
    with db() as c: c.execute('SELECT 1')
    return {'status': 'ok', 'service': 'repaido-api', 'build_id': os.getenv('REPAIDO_BUILD_ID', 'local')}

@app.post('/auth/register', status_code=201)
def register(body: Registration, request: Request):
    rate_limit(request)
    email = valid_email(body.email)
    if len(body.name.strip()) < 2: raise HTTPException(422, 'Enter your name.')
    user = {'id': str(uuid.uuid4()), 'name': body.name.strip(), 'email': email}
    try:
        with db() as c:
            c.execute('INSERT INTO users VALUES(?,?,?,?,?)', (user['id'], user['name'], email, hash_password(body.password), int(time.time())))
    except sqlite3.IntegrityError:
        raise HTTPException(409, 'An account with this email already exists. Please sign in.')
    return issue_session(user)

@app.post('/auth/login')
def login(body: Credentials, request: Request):
    rate_limit(request)
    with db() as c: user = c.execute('SELECT * FROM users WHERE email=?', (valid_email(body.email),)).fetchone()
    stored = user['password'] if user else hash_password('constant-placeholder')
    if not hmac.compare_digest(hash_password(body.password, stored.split(':')[0]), stored) or not user:
        raise HTTPException(401, 'Email or password is incorrect.')
    return issue_session(user)

@app.get('/auth/me')
def me(user=Depends(current_user)):
    return user

@app.post('/auth/logout', status_code=204)
def logout(authorization: str = Header(default=''), user=Depends(current_user)):
    with db() as c: c.execute('DELETE FROM sessions WHERE token_hash=?', (hashlib.sha256(authorization[7:].encode()).hexdigest(),))

@app.get('/catalog')
def catalog(include_ratings: bool = True):
    if USE_FIRESTORE:
        services = [doc.to_dict() for doc in fs_collection('services').stream()]
        services.sort(key=lambda service: service.get('id', ''))
    else:
        with db() as c: services = [dict(row) for row in c.execute('SELECT * FROM services ORDER BY rowid')]
        for s in services:
            s['included'] = json.loads(s['included']); s['excluded'] = json.loads(s['excluded'])
    # Only customer reviews tied to completed work contribute to public ratings.
    def aggregates(u):
        values = {}
        for job in u.all('jobs'):
            review = job.get('review') or {}
            rating = review.get('rating')
            if job.get('state') != 'completed' or not review.get('verified_booking') or review.get('customer_id') != job.get('customer_id') or type(rating) is not int or not 1 <= rating <= 5: continue
            total, count = values.get(job['service_id'], (0, 0))
            values[job['service_id']] = (total + rating, count + 1)
        return values
    ratings = operations_store.run(aggregates) if include_ratings else {}
    for service in services:
        total, count = ratings.get(service['id'], (0, 0))
        service['rating'] = round(total/count, 2) if count else None
        service['review_count'] = count
    return {'cities': CITIES, 'categories': [{'id':x[0], 'name':x[1], 'description':x[2]} for x in CATEGORIES], 'services':services, 'currency':'INR', 'booking_horizon_days':7}


def service_by_id(c, service_id):
    s = c.execute('SELECT * FROM services WHERE id=?', (service_id,)).fetchone()
    if not s: raise HTTPException(404, 'Service not found.')
    return s

def firestore_service_by_id(service_id: str):
    service = fs_doc('services', service_id).get()
    if not service.exists:
        raise HTTPException(404, 'Service not found.')
    return service.to_dict()


def candidates(now=None):
    now = now or datetime.now(IST)
    return [datetime.combine((now + timedelta(days=d)).date(), datetime.min.time(), tzinfo=IST).replace(hour=h) for d in range(7) for h in (9,12,15,18) if datetime.combine((now + timedelta(days=d)).date(), datetime.min.time(), tzinfo=IST).replace(hour=h) > now + timedelta(hours=2)]

@app.get('/slots')
def slots(service_id: str, city: str):
    if city not in CITIES: raise HTTPException(422, 'Choose a supported city.')
    if USE_FIRESTORE:
        firestore_service_by_id(service_id)
        result = []
        for dt in candidates():
            query = fs_collection('bookings').where('service_id', '==', service_id).where('city', '==', city).where('starts_at', '==', dt.isoformat()).stream()
            used = sum(1 for item in query if item.to_dict().get('status') != 'cancelled')
            if used < 3: result.append({'starts_at': dt.isoformat(), 'available': 3 - used})
        return {'slots': result, 'timezone': 'Asia/Kolkata'}
    with db() as c:
        service_by_id(c, service_id)
        result = []
        for dt in candidates():
            used = c.execute("SELECT count(*) FROM bookings WHERE service_id=? AND city=? AND starts_at=? AND status!='cancelled'", (service_id, city, dt.isoformat())).fetchone()[0]
            if used < 3: result.append({'starts_at': dt.isoformat(), 'available':3-used})
    return {'slots':result, 'timezone':'Asia/Kolkata'}

class BookingInput(BaseModel):
    service_id: str
    city: str
    address: str = Field(min_length=10, max_length=500)
    phone: str = Field(pattern=r'^[6-9][0-9]{9}$')
    notes: str = Field(default='', max_length=500)
    starts_at: str
    idempotency_key: str = Field(min_length=16, max_length=80)


def booking_output(c, booking_id):
    row = c.execute('SELECT b.*,s.name AS service_name,s.duration_minutes FROM bookings b JOIN services s ON s.id=b.service_id WHERE b.id=?', (booking_id,)).fetchone()
    return dict(row)

def firestore_booking_output(booking_id: str):
    snap = fs_doc('bookings', booking_id).get()
    if not snap.exists: raise HTTPException(404, 'Booking not found.')
    data = snap.to_dict()
    service = firestore_service_by_id(data['service_id'])
    return {**data, 'id': booking_id, 'service_name': service['name'], 'duration_minutes': service['duration_minutes'], 'price_paise': data.get('price_paise', 0)}

def razorpay_order(amount_paise: int, receipt: str, notes: dict):
    key_id = os.getenv('RAZORPAY_KEY_ID', '')
    key_secret = os.getenv('RAZORPAY_KEY_SECRET', '')
    if not key_id or not key_secret:
        raise HTTPException(503, 'Razorpay is not configured yet. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.')
    payload = json.dumps({'amount': amount_paise, 'currency': 'INR', 'receipt': receipt, 'notes': notes}).encode()
    auth = base64.b64encode(f'{key_id}:{key_secret}'.encode()).decode()
    request = urllib.request.Request('https://api.razorpay.com/v1/orders', data=payload, headers={'Authorization': f'Basic {auth}', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return key_id, json.loads(response.read().decode())
    except Exception as exc:
        raise HTTPException(502, f'Razorpay order creation failed: {exc}')

class BookingPaymentOrderInput(BaseModel):
    service_id: str
    city: str
    address: str = Field(min_length=10, max_length=500)
    phone: str = Field(pattern=r'^[6-9][0-9]{9}$')
    notes: str = Field(default='', max_length=500)
    starts_at: str
    idempotency_key: str = Field(min_length=16, max_length=80)
    specialist_id: str | None = None

@app.post('/checkout/booking/order', status_code=201)
def create_booking_payment_order(body: BookingPaymentOrderInput, user=Depends(current_user)):
    if body.city not in CITIES: raise HTTPException(422, 'Choose a supported city.')
    if USE_FIRESTORE:
        service = firestore_service_by_id(body.service_id)
        amount = CITY_BASE_FARES_PAISE[body.city]
        metadata = {'service_id': body.service_id, 'city': body.city, 'address': body.address.strip(), 'phone': body.phone, 'notes': body.notes.strip(), 'starts_at': body.starts_at, 'idempotency_key': body.idempotency_key, 'specialist_id': body.specialist_id}
        key_id, order = razorpay_order(amount, f'booking_{secrets.token_hex(8)}', {'purpose': 'booking', 'user_id': user['id'], 'service_id': service['id']})
        payment_id = str(uuid.uuid4())
        fs_doc('payment_orders', payment_id).set({'id': payment_id, 'user_id': user['id'], 'purpose': 'booking', 'amount_paise': amount, 'currency': 'INR', 'razorpay_order_id': order['id'], 'status': 'created', 'metadata': metadata, 'created_at': fs_now()})
        return {'payment_order_id': payment_id, 'razorpay_order_id': order['id'], 'key_id': key_id, 'amount_paise': amount, 'currency': 'INR'}
    with db() as c:
        service = service_by_id(c, body.service_id)
        amount = CITY_BASE_FARES_PAISE[body.city]
        metadata = {'service_id': body.service_id, 'city': body.city, 'address': body.address.strip(), 'phone': body.phone, 'notes': body.notes.strip(), 'starts_at': body.starts_at, 'idempotency_key': body.idempotency_key, 'specialist_id': body.specialist_id}
    key_id, order = razorpay_order(amount, f'booking_{secrets.token_hex(8)}', {'purpose': 'booking', 'user_id': user['id'], 'service_id': service['id']})
    payment_id = str(uuid.uuid4())
    with db() as c:
        c.execute('INSERT INTO payment_orders (id,user_id,purpose,amount_paise,currency,razorpay_order_id,status,metadata,created_at) VALUES (?,?,?,?,?,?,?,?,?)', (payment_id, user['id'], 'booking', amount, 'INR', order['id'], 'created', json.dumps(metadata), int(time.time())))
    return {'payment_order_id': payment_id, 'razorpay_order_id': order['id'], 'key_id': key_id, 'amount_paise': amount, 'currency': 'INR'}

class PaymentVerificationInput(BaseModel):
    payment_order_id: str
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str

def verify_payment(c, body: PaymentVerificationInput, user_id: str, purpose: str):
    secret = os.getenv('RAZORPAY_KEY_SECRET', '')
    if not secret: raise HTTPException(503, 'Razorpay is not configured yet.')
    expected = hmac.new(secret.encode(), f'{body.razorpay_order_id}|{body.razorpay_payment_id}'.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, body.razorpay_signature): raise HTTPException(400, 'Invalid Razorpay payment signature.')
    payment = c.execute('SELECT * FROM payment_orders WHERE id=? AND user_id=? AND purpose=?', (body.payment_order_id, user_id, purpose)).fetchone()
    if not payment or payment['razorpay_order_id'] != body.razorpay_order_id: raise HTTPException(404, 'Payment order not found.')
    if payment['status'] == 'paid': return payment
    c.execute('UPDATE payment_orders SET status=?,razorpay_payment_id=?,razorpay_signature=?,paid_at=? WHERE id=?', ('paid', body.razorpay_payment_id, body.razorpay_signature, int(time.time()), payment['id']))
    return c.execute('SELECT * FROM payment_orders WHERE id=?', (payment['id'],)).fetchone()

@app.post('/checkout/booking/verify', status_code=201)
def verify_booking_payment(body: PaymentVerificationInput, user=Depends(current_user)):
    if USE_FIRESTORE:
        secret = os.getenv('RAZORPAY_KEY_SECRET', '')
        if not secret: raise HTTPException(503, 'Razorpay is not configured yet.')
        expected = hmac.new(secret.encode(), f'{body.razorpay_order_id}|{body.razorpay_payment_id}'.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, body.razorpay_signature): raise HTTPException(400, 'Invalid Razorpay payment signature.')
        payment_ref = fs_doc('payment_orders', body.payment_order_id)
        payment_snap = payment_ref.get()
        if not payment_snap.exists or payment_snap.to_dict().get('user_id') != user['id']: raise HTTPException(404, 'Payment order not found.')
        payment = payment_snap.to_dict()
        metadata = payment['metadata']
        existing = list(fs_collection('bookings').where('user_id', '==', user['id']).where('idempotency_key', '==', metadata['idempotency_key']).limit(1).stream())
        if existing: return firestore_booking_output(existing[0].id)
        booking_id = str(uuid.uuid4())
        service = firestore_service_by_id(metadata['service_id'])
        worker_docs = fs_collection('technicians').where('city', '==', metadata['city']).where('category', '==', service['category']).where('availability_confirmed', '==', True).stream()
        workers = [dict(doc.to_dict(), id=doc.id) for doc in worker_docs]
        workers.sort(key=lambda item: (not item.get('verified_specialist', False), not item.get('role') == 'specialist', -(item.get('rating', 0) or 0)))
        worker = workers[0] if workers else None
        now = fs_now()
        payment_ref.update({'status': 'paid', 'razorpay_payment_id': body.razorpay_payment_id, 'razorpay_signature': body.razorpay_signature, 'paid_at': now})
        fs_doc('bookings', booking_id).set({'id': booking_id, 'user_id': user['id'], **metadata, 'status': 'requested', 'price_paise': payment['amount_paise'], 'payment_status': 'paid', 'payment_order_id': body.payment_order_id, 'payment_id': body.razorpay_payment_id, 'professional_name': worker.get('name') if worker else None, 'tracking_status': 'requested', 'created_at': now, 'updated_at': now})
        return firestore_booking_output(booking_id)
    with db() as c:
        payment = verify_payment(c, body, user['id'], 'booking')
        metadata = json.loads(payment['metadata'])
        booking = c.execute('SELECT id FROM bookings WHERE user_id=? AND idempotency_key=?', (user['id'], metadata['idempotency_key'])).fetchone()
        if booking: return booking_output(c, booking['id'])
        start = datetime.fromisoformat(metadata['starts_at'])
        canonical_start = start.astimezone(IST).isoformat()
        service = service_by_id(c, metadata['service_id'])
        worker = c.execute("SELECT * FROM technicians WHERE category=? AND city=? AND availability_confirmed=1 ORDER BY verified_specialist DESC, CASE WHEN lower(role)='specialist' THEN 1 ELSE 0 END DESC, rating DESC LIMIT 1", (service['category'], metadata['city'])).fetchone()
        booking_id = str(uuid.uuid4())
        c.execute('INSERT INTO bookings (id,user_id,service_id,city,address,phone,notes,starts_at,status,price_paise,created_at,idempotency_key,professional_name,payment_status,payment_order_id,payment_id,tracking_status,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', (booking_id,user['id'],metadata['service_id'],metadata['city'],metadata['address'],metadata['phone'],metadata['notes'],canonical_start,'requested',payment['amount_paise'],int(time.time()),metadata['idempotency_key'],worker['name'] if worker else None,'paid',payment['id'],payment['razorpay_payment_id'],'requested',int(time.time())))
        return booking_output(c, booking_id)

@app.post('/bookings', status_code=201)
def create_booking(body: BookingInput, user=Depends(current_user)):
    if body.city not in CITIES: raise HTTPException(422, 'Choose a supported city.')
    if len(body.address.strip()) < 10: raise HTTPException(422, 'Enter your complete service address.')
    try:
        start = datetime.fromisoformat(body.starts_at)
        if start.tzinfo is None: raise ValueError()
        canonical_start = start.astimezone(IST).isoformat()
    except ValueError: raise HTTPException(422, 'Choose a valid appointment time.')
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        existing = c.execute('SELECT id,service_id,city,address,phone,notes,starts_at FROM bookings WHERE user_id=? AND idempotency_key=?', (user['id'], body.idempotency_key)).fetchone()
        if existing:
            expected = (body.service_id, body.city, body.address.strip(), body.phone, body.notes.strip(), canonical_start)
            if tuple(existing)[1:] != expected: raise HTTPException(409, 'This request key was already used for a different booking.')
            return booking_output(c, existing['id'])
        service = service_by_id(c, body.service_id)
        if canonical_start not in {d.isoformat() for d in candidates()}: raise HTTPException(409, 'This time is no longer available. Choose another slot.')
        used = c.execute("SELECT count(*) FROM bookings WHERE service_id=? AND city=? AND starts_at=? AND status!='cancelled'", (body.service_id, body.city, canonical_start)).fetchone()[0]
        if used >= 3: raise HTTPException(409, 'This time just filled up. Please choose another slot.')

        # 50% Discount on Labor Charge for First-Time Bookings
        past_bookings = c.execute("SELECT count(*) FROM bookings WHERE user_id=? AND status!='cancelled'", (user['id'],)).fetchone()[0]
        is_new_user = (past_bookings == 0)
        base_price_paise = service['price_paise']
        labor_charge_paise = int(base_price_paise * 0.70)
        discount_paise = int(labor_charge_paise * 0.50) if is_new_user else 0
        final_price_paise = base_price_paise - discount_paise

        # Candidate Technician Assignment & 3% Platform Commission Model
        tech = c.execute("SELECT * FROM technicians WHERE category=? AND availability_confirmed=1 ORDER BY verified_specialist DESC, CASE WHEN lower(role)='specialist' THEN 1 ELSE 0 END DESC, rating DESC LIMIT 1", (service['category'],)).fetchone()
        tech_name = tech['name'] if tech else None
        tech_role = tech['role'] if tech else None
        tech_rate = (499 if tech_role == 'specialist' else 349) if tech else 0
        duration_hrs = max(1.0, service['duration_minutes'] / 60.0)
        labor_total_paise = int(tech_rate * duration_hrs * 100)
        platform_commission_paise = int(labor_total_paise * 0.03)
        worker_net_payout_paise = labor_total_paise - platform_commission_paise

        booking_id = str(uuid.uuid4())
        c.execute('''INSERT INTO bookings
            (id,user_id,service_id,city,address,phone,notes,starts_at,status,price_paise,created_at,idempotency_key,professional_name)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)''', (
            booking_id, user['id'], body.service_id, body.city, body.address.strip(),
            body.phone, body.notes.strip(), canonical_start, 'requested',
            service['price_paise'], int(time.time()), body.idempotency_key, None
        ))
        result = booking_output(c, booking_id)

        # Dual-engine sync to Cloud Firestore
        if fb_db:
            try:
                fb_db.collection('bookings').document(booking_id).set({
                    'id': booking_id,
                    'user_id': user['id'],
                    'customer_name': user.get('name', 'Customer'),
                    'customer_phone': body.phone,
                    'service_id': body.service_id,
                    'service_name': service['name'],
                    'city': body.city,
                    'address': body.address.strip(),
                    'phone': body.phone,
                    'notes': body.notes.strip(),
                    'starts_at': canonical_start,
                    'status': 'requested',
                    'price_paise': service['price_paise'],
                    'final_price_paise': final_price_paise,
                    'labor_charge_paise': labor_charge_paise,
                    'discount_paise': discount_paise,
                    'is_new_user_discount': is_new_user,
                    'assigned_worker_name': tech_name,
                    'assigned_worker_role': tech_role,
                    'worker_hourly_rate': tech_rate,
                    'estimated_duration_hours': duration_hrs,
                    'worker_labor_total_paise': labor_total_paise,
                    'platform_commission_paise': platform_commission_paise,
                    'worker_net_payout_paise': worker_net_payout_paise,
                    'idempotency_key': body.idempotency_key,
                    'created_at': firestore.SERVER_TIMESTAMP
                })
            except Exception as err:
                print(f"Firestore booking sync notice: {err}")

        return result

@app.get('/bookings')
def bookings(user=Depends(current_user)):
    if USE_FIRESTORE:
        rows = fs_collection('bookings').where('user_id', '==', user['id']).stream()
        values = [firestore_booking_output(row.id) for row in rows]
        values.sort(key=lambda item: item.get('created_at', 0), reverse=True)
        return {'bookings': values}
    with db() as c:
        ids = c.execute('SELECT id FROM bookings WHERE user_id=? ORDER BY created_at DESC,rowid DESC', (user['id'],)).fetchall()
        return {'bookings':[booking_output(c, x['id']) for x in ids]}

class BookingCancellationInput(BaseModel):
    reason: str = Field(default='Customer requested cancellation', min_length=5, max_length=500)

@app.post('/bookings/{booking_id}/cancel')
def cancel(booking_id: str, body: BookingCancellationInput | None = None, user=Depends(current_user)):
    if USE_FIRESTORE:
        ref = fs_doc('bookings', booking_id)
        snap = ref.get()
        if not snap.exists or snap.to_dict().get('user_id') != user['id']: raise HTTPException(404, 'Booking not found.')
        data = snap.to_dict()
        if data.get('status') not in ('requested', 'confirmed'): raise HTTPException(409, 'This booking can no longer be cancelled.')
        reason = body.reason.strip() if body else 'Customer requested cancellation'
        ref.update({'status': 'cancelled', 'cancellation_reason': reason, 'tracking_status': 'cancelled', 'updated_at': fs_now()})
        return firestore_booking_output(booking_id)
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        b = c.execute('SELECT * FROM bookings WHERE id=? AND user_id=?', (booking_id,user['id'])).fetchone()
        if not b: raise HTTPException(404, 'Booking not found.')
        if b['status'] == 'cancelled': return booking_output(c, booking_id)
        if b['status'] not in ('requested','confirmed') or datetime.fromisoformat(b['starts_at']) <= datetime.now(IST): raise HTTPException(409, 'This booking can no longer be cancelled in the app. Contact support.')
        reason = body.reason.strip() if body else 'Customer requested cancellation'
        c.execute("UPDATE bookings SET status='cancelled',cancellation_reason=?,tracking_status='cancelled',updated_at=? WHERE id=?", (reason, int(time.time()), booking_id))
        if fb_db:
            try:
                fb_db.collection('bookings').document(booking_id).update({
                    'status': 'cancelled',
                    'cancelled_at': firestore.SERVER_TIMESTAMP
                })
            except Exception:
                pass
        return booking_output(c, booking_id)

class BookingRescheduleInput(BaseModel):
    starts_at: str
    reason: str = Field(min_length=5, max_length=500)

@app.post('/bookings/{booking_id}/reschedule')
def reschedule(booking_id: str, body: BookingRescheduleInput, user=Depends(current_user)):
    try:
        start = datetime.fromisoformat(body.starts_at)
        if start.tzinfo is None: raise ValueError()
        canonical_start = start.astimezone(IST).isoformat()
    except ValueError: raise HTTPException(422, 'Choose a valid appointment time.')
    if canonical_start not in {d.isoformat() for d in candidates()}: raise HTTPException(409, 'Choose an available future time.')
    if USE_FIRESTORE:
        ref = fs_doc('bookings', booking_id)
        snap = ref.get()
        if not snap.exists or snap.to_dict().get('user_id') != user['id']: raise HTTPException(404, 'Booking not found.')
        data = snap.to_dict()
        if data.get('status') not in ('requested', 'confirmed'): raise HTTPException(409, 'This booking cannot be rescheduled now.')
        used = sum(1 for item in fs_collection('bookings').where('service_id', '==', data['service_id']).where('city', '==', data['city']).where('starts_at', '==', canonical_start).stream() if item.to_dict().get('status') != 'cancelled' and item.id != booking_id)
        if used >= 3: raise HTTPException(409, 'This time just filled up. Choose another slot.')
        ref.update({'starts_at': canonical_start, 'reschedule_reason': body.reason.strip(), 'tracking_status': 'requested', 'updated_at': fs_now()})
        return firestore_booking_output(booking_id)
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        booking = c.execute("SELECT * FROM bookings WHERE id=? AND user_id=?", (booking_id, user['id'])).fetchone()
        if not booking: raise HTTPException(404, 'Booking not found.')
        if booking['status'] not in ('requested', 'confirmed'): raise HTTPException(409, 'This booking cannot be rescheduled now.')
        used = c.execute("SELECT count(*) FROM bookings WHERE service_id=? AND city=? AND starts_at=? AND status!='cancelled' AND id!=?", (booking['service_id'], booking['city'], canonical_start, booking_id)).fetchone()[0]
        if used >= 3: raise HTTPException(409, 'This time just filled up. Choose another slot.')
        now = int(time.time())
        c.execute("UPDATE bookings SET starts_at=?,reschedule_reason=?,tracking_status='requested',updated_at=? WHERE id=?", (canonical_start, body.reason.strip(), now, booking_id))
        return booking_output(c, booking_id)

@app.get('/bookings/{booking_id}/tracking')
def booking_tracking(booking_id: str, user=Depends(current_user)):
    if USE_FIRESTORE:
        snap = fs_doc('bookings', booking_id).get()
        if not snap.exists or snap.to_dict().get('user_id') != user['id']: raise HTTPException(404, 'Booking not found.')
        data = snap.to_dict()
        return {key: data.get(key) for key in ('id', 'status', 'tracking_status', 'professional_name', 'starts_at', 'updated_at')}
    with db() as c:
        row = c.execute('SELECT id,status,tracking_status,professional_name,starts_at,updated_at FROM bookings WHERE id=? AND user_id=?', (booking_id, user['id'])).fetchone()
        if not row: raise HTTPException(404, 'Booking not found.')
        return dict(row)


def operator(x_admin_key: str = Header(default=''), authorization: str = Header(default='')):
    expected = os.getenv('REPAIDO_ADMIN_KEY', '')
    if expected and x_admin_key and hmac.compare_digest(x_admin_key, expected):
        return {'id': 'server-operator'}
    if fb_auth_module and authorization.startswith('Bearer '):
        try:
            claims = fb_auth_module.verify_id_token(authorization[7:].strip(), check_revoked=True)
            if claims.get('role') == 'admin' or claims.get('admin') is True:
                return {'id': claims['uid']}
        except Exception:
            pass
    raise HTTPException(403, 'A server-authorized administrator account is required.')

class BookingUpdate(BaseModel):
    status: Literal['confirmed','in_progress','completed','cancelled']
    professional_name: str | None = Field(default=None, min_length=2, max_length=80)

@app.get('/admin/bookings', dependencies=[Depends(operator)])
def admin_bookings():
    with db() as c:
        ids = c.execute('SELECT id FROM bookings ORDER BY created_at DESC').fetchall()
        return {'bookings':[booking_output(c, x['id']) for x in ids]}

@app.patch('/admin/bookings/{booking_id}', dependencies=[Depends(operator)])
def update_booking(booking_id: str, body: BookingUpdate):
    allowed = {'requested': {'confirmed','cancelled'}, 'confirmed': {'in_progress','cancelled'}, 'in_progress': {'completed'}, 'completed':set(), 'cancelled':set()}
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        b = c.execute('SELECT * FROM bookings WHERE id=?', (booking_id,)).fetchone()
        if not b: raise HTTPException(404, 'Booking not found.')
        if body.status not in allowed[b['status']]: raise HTTPException(409, 'Invalid booking status transition.')
        professional = body.professional_name.strip() if body.professional_name else b['professional_name']
        if body.status == 'confirmed' and (not professional or len(professional)<2): raise HTTPException(422, 'Assign a professional before confirming.')
        c.execute('UPDATE bookings SET status=?,professional_name=? WHERE id=?', (body.status, professional, booking_id))
        if fb_db:
            try:
                fb_db.collection('bookings').document(booking_id).update({
                    'status': body.status,
                    'professional_name': professional,
                    'updated_at': firestore.SERVER_TIMESTAMP
                })
            except Exception:
                pass
        return booking_output(c, booking_id)


# =========================================================
# REPAIDO TECHNICIANS, APPLICATIONS & SUPPORT INFRASTRUCTURE
# =========================================================

@app.get('/technicians')
def get_technicians(city: str = 'Balasore', category: str | None = None):
    def read(u):
        rows = []
        for w in u.all('workers'):
            if w['status'] != 'approved' or w['city'].casefold() != city.casefold(): continue
            if category and category != 'all' and category not in w['categories']: continue
            rows.append({k: w[k] for k in ('id','name','role','city','categories','skills','tools','experience_years','completed_tasks','rating_count','rating_sum')})
        return {'technicians': rows}
    return operations_store.run(read)

@app.get('/specialists')
def get_specialists(city: str = 'Balasore', category: str | None = None):
    return {'specialists': [w for w in get_technicians(city, category)['technicians'] if w['role'] == 'specialist']}

class PartnerApplicationInput(BaseModel):
    role: str = 'Technician'
    name: str = Field(min_length=2, max_length=80)
    phone: str = Field(pattern=r'^[0-9+ ]{10,15}$')
    email: str = ''
    dob: str = ''
    gender: str = 'Male'
    home_address: str = ''
    service_city: str = 'Balasore'
    trade_category: str = 'AC & Appliance Repair'
    experience_years: int = 3
    tools_list: str = ''
    aadhaar_number: str = ''
    pan_number: str = ''
    hourly_rate: int = 349
    service_categories: list[str] = []
    lat: float | None = None
    lng: float | None = None
    specialist_plan: Literal['monthly', 'yearly'] | None = None
    razorpay_payment_id: str | None = None

@app.post('/partner-applications', status_code=201)
def submit_partner_application(body: PartnerApplicationInput, user=Depends(current_user)):
    raise HTTPException(409, 'Use phone-verified worker onboarding at /operations/worker/onboarding. Private document verification is not yet connected.')

class ShopApplicationInput(BaseModel):
    owner_name: str = Field(min_length=2, max_length=80)
    phone: str = Field(pattern=r'^[0-9+ ]{10,15}$')
    email: str = ''
    shop_name: str = Field(min_length=2, max_length=120)
    shop_tagline: str = ''
    gstin: str = ''
    trade_license: str = Field(min_length=2, max_length=80)
    address: str = Field(min_length=8, max_length=240)
    city: str = 'Balasore'
    pincode: str = ''
    categories: list[str] = Field(min_length=1)
    lat: float
    lng: float
    bank_holder: str = Field(min_length=2, max_length=80)
    bank_name: str = Field(min_length=2, max_length=80)
    account_number: str = Field(min_length=9, max_length=18)
    ifsc_code: str = Field(min_length=11, max_length=11)
    upi_id: str = ''
    aadhaar_number: str = Field(min_length=12, max_length=14)
    pan_number: str = Field(min_length=10, max_length=10)

@app.post('/shop-applications', status_code=201)
def submit_shop_application(body: ShopApplicationInput, user=Depends(current_user)):
    raise HTTPException(503, 'Private shop document and bank verification is not connected. No application or bank details have been saved.')

class SpecialistPaymentOrder(BaseModel):
    plan: Literal['monthly', 'yearly']
    application_id: str | None = None

@app.post('/specialist-payments/order')
def create_specialist_payment_order(body: SpecialistPaymentOrder):
    """Create a Razorpay order; credentials are supplied only through server environment variables."""
    key_id = os.getenv('RAZORPAY_KEY_ID', '')
    key_secret = os.getenv('RAZORPAY_KEY_SECRET', '')
    if not key_id or not key_secret:
        raise HTTPException(503, 'Razorpay is not configured yet. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.')
    amount = 999900 if body.plan == 'yearly' else 149900
    payload = json.dumps({'amount': amount, 'currency': 'INR', 'receipt': f'repaido_{secrets.token_hex(8)}', 'notes': {'plan': body.plan}}).encode()
    auth = base64.b64encode(f'{key_id}:{key_secret}'.encode()).decode()
    request = urllib.request.Request('https://api.razorpay.com/v1/orders', data=payload, headers={'Authorization': f'Basic {auth}', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            order = json.loads(response.read().decode())
    except Exception as exc:
        raise HTTPException(502, f'Razorpay order creation failed: {exc}')
    payment_id = str(uuid.uuid4())
    if USE_FIRESTORE:
        fs_doc('specialist_payments', payment_id).set({'id': payment_id, 'application_id': body.application_id, 'plan': body.plan, 'amount_paise': amount, 'razorpay_order_id': order['id'], 'status': 'created', 'created_at': fs_now()})
        return {'order_id': order['id'], 'payment_record_id': payment_id, 'key_id': key_id, 'amount_paise': amount, 'currency': 'INR'}
    with db() as c:
        c.execute('INSERT INTO specialist_payments (id,application_id,plan,amount_paise,razorpay_order_id,status,created_at) VALUES (?,?,?,?,?,?,?)', (payment_id, body.application_id, body.plan, amount, order['id'], 'created', int(time.time())))
    return {'order_id': order['id'], 'payment_record_id': payment_id, 'key_id': key_id, 'amount_paise': amount, 'currency': 'INR'}

class SpecialistPaymentVerification(BaseModel):
    order_id: str
    payment_id: str
    signature: str
    application_id: str | None = None

@app.post('/specialist-payments/verify')
def verify_specialist_payment(body: SpecialistPaymentVerification):
    secret = os.getenv('RAZORPAY_KEY_SECRET', '')
    if not secret: raise HTTPException(503, 'Razorpay is not configured yet.')
    expected = hmac.new(secret.encode(), f'{body.order_id}|{body.payment_id}'.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, body.signature): raise HTTPException(400, 'Invalid Razorpay payment signature.')
    with db() as c:
        payment = c.execute('SELECT * FROM specialist_payments WHERE razorpay_order_id=?', (body.order_id,)).fetchone()
        if not payment: raise HTTPException(404, 'Payment order not found.')
        c.execute('UPDATE specialist_payments SET razorpay_payment_id=?, razorpay_signature=?, status=? WHERE razorpay_order_id=?', (body.payment_id, body.signature, 'paid', body.order_id))
        if body.application_id:
            c.execute('UPDATE partner_applications SET specialist_plan=?, razorpay_payment_id=? WHERE id=?', (payment['plan'], body.payment_id, body.application_id))
    return {'status': 'paid', 'payment_id': body.payment_id, 'verified_specialist': True}

class SpareOrderLine(BaseModel):
    product_id: str = Field(min_length=1, max_length=100)
    quantity: int = Field(ge=1, le=50)

class SparePaymentOrderInput(BaseModel):
    items: list[SpareOrderLine] = Field(min_length=1, max_length=100)
    recipient_name: str = Field(min_length=2, max_length=80)
    recipient_phone: str = Field(pattern=r'^[6-9][0-9]{9}$')
    delivery_address: str = Field(min_length=10, max_length=500)
    preferred_method: Literal['upi', 'card'] = 'upi'

@app.post('/checkout/spare/order', status_code=201)
def create_spare_payment_order(body: SparePaymentOrderInput, user=Depends(current_user)):
    if USE_FIRESTORE:
        catalog_items = []
        for item in body.items:
            snap = fs_doc('spare_catalog', item.product_id).get()
            if not snap.exists or snap.to_dict().get('status') != 'approved': raise HTTPException(422, f'Product {item.product_id} is unavailable.')
            product = snap.to_dict()
            if item.quantity > product['stock']: raise HTTPException(409, f"{product['name']} has only {product['stock']} left.")
            catalog_items.append({'product_id': product['id'], 'product_name': product['name'], 'quantity': item.quantity, 'unit_price_paise': product['price_paise']})
        total = sum(item['unit_price_paise'] * item['quantity'] for item in catalog_items)
        metadata = {'items': catalog_items, 'recipient_name': body.recipient_name.strip(), 'recipient_phone': body.recipient_phone, 'delivery_address': body.delivery_address.strip(), 'preferred_method': body.preferred_method}
        key_id, order = razorpay_order(total, f'spare_{secrets.token_hex(8)}', {'purpose': 'spare_order', 'user_id': user['id']})
        payment_id = str(uuid.uuid4())
        fs_doc('payment_orders', payment_id).set({'id': payment_id, 'user_id': user['id'], 'purpose': 'spare_order', 'amount_paise': total, 'currency': 'INR', 'razorpay_order_id': order['id'], 'status': 'created', 'metadata': metadata, 'created_at': fs_now()})
        return {'payment_order_id': payment_id, 'razorpay_order_id': order['id'], 'key_id': key_id, 'amount_paise': total, 'currency': 'INR', 'preferred_method': body.preferred_method}
    with db() as c:
        catalog_items = []
        for item in body.items:
            product = c.execute("SELECT id,name,price_paise,stock FROM spare_catalog WHERE id=? AND status='approved'", (item.product_id,)).fetchone()
            if not product: raise HTTPException(422, f'Product {item.product_id} is unavailable.')
            if item.quantity > product['stock']: raise HTTPException(409, f'{product["name"]} has only {product["stock"]} left.')
            catalog_items.append({'product_id': product['id'], 'product_name': product['name'], 'quantity': item.quantity, 'unit_price_paise': product['price_paise']})
    total = sum(item['unit_price_paise'] * item['quantity'] for item in catalog_items)
    metadata = {'items': catalog_items, 'recipient_name': body.recipient_name.strip(), 'recipient_phone': body.recipient_phone, 'delivery_address': body.delivery_address.strip(), 'preferred_method': body.preferred_method}
    key_id, order = razorpay_order(total, f'spare_{secrets.token_hex(8)}', {'purpose': 'spare_order', 'user_id': user['id']})
    payment_id = str(uuid.uuid4())
    with db() as c:
        c.execute('INSERT INTO payment_orders (id,user_id,purpose,amount_paise,currency,razorpay_order_id,status,metadata,created_at) VALUES (?,?,?,?,?,?,?,?,?)', (payment_id, user['id'], 'spare_order', total, 'INR', order['id'], 'created', json.dumps(metadata), int(time.time())))
    return {'payment_order_id': payment_id, 'razorpay_order_id': order['id'], 'key_id': key_id, 'amount_paise': total, 'currency': 'INR', 'preferred_method': body.preferred_method}

@app.post('/checkout/spare/verify', status_code=201)
def verify_spare_payment(body: PaymentVerificationInput, user=Depends(current_user)):
    if USE_FIRESTORE:
        secret = os.getenv('RAZORPAY_KEY_SECRET', '')
        if not secret: raise HTTPException(503, 'Razorpay is not configured yet.')
        expected = hmac.new(secret.encode(), f'{body.razorpay_order_id}|{body.razorpay_payment_id}'.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, body.razorpay_signature): raise HTTPException(400, 'Invalid Razorpay payment signature.')
        payment_ref = fs_doc('payment_orders', body.payment_order_id)
        payment_snap = payment_ref.get()
        if not payment_snap.exists or payment_snap.to_dict().get('user_id') != user['id']: raise HTTPException(404, 'Payment order not found.')
        payment = payment_snap.to_dict()
        existing = list(fs_collection('spare_orders').where('payment_order_id', '==', payment['id']).limit(1).stream())
        if existing: return {'order_id': existing[0].id, 'status': 'paid', 'tracking_status': existing[0].to_dict().get('tracking_status')}
        metadata = payment['metadata']
        order_id = f'RP-SPARE-{secrets.token_hex(5).upper()}'
        now = fs_now()
        payment_ref.update({'status': 'paid', 'razorpay_payment_id': body.razorpay_payment_id, 'razorpay_signature': body.razorpay_signature, 'paid_at': now})
        order_ref = fs_doc('spare_orders', order_id)
        order_ref.set({'id': order_id, 'user_id': user['id'], 'status': 'confirmed', 'payment_status': 'paid', 'payment_order_id': payment['id'], 'total_paise': payment['amount_paise'], 'recipient_name': metadata['recipient_name'], 'recipient_phone': metadata['recipient_phone'], 'delivery_address': metadata['delivery_address'], 'tracking_status': 'order_received', 'created_at': now, 'updated_at': now})
        for item in metadata['items']:
            order_ref.collection('items').document(item['product_id']).set(item)
        return {'order_id': order_id, 'status': 'paid', 'tracking_status': 'order_received'}
    with db() as c:
        payment = verify_payment(c, body, user['id'], 'spare_order')
        existing = c.execute('SELECT id FROM spare_orders WHERE payment_order_id=?', (payment['id'],)).fetchone()
        if existing: return {'order_id': existing['id'], 'status': 'paid'}
        metadata = json.loads(payment['metadata'])
        order_id = f'RP-SPARE-{secrets.token_hex(5).upper()}'
        now = int(time.time())
        c.execute('INSERT INTO spare_orders (id,user_id,status,payment_status,payment_order_id,total_paise,recipient_name,recipient_phone,delivery_address,tracking_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', (order_id,user['id'],'confirmed','paid',payment['id'],payment['amount_paise'],metadata['recipient_name'],metadata['recipient_phone'],metadata['delivery_address'],'order_received',now,now))
        for item in metadata['items']:
            c.execute('INSERT INTO spare_order_items (order_id,product_id,product_name,quantity,unit_price_paise) VALUES (?,?,?,?,?)', (order_id,item['product_id'],item['product_name'],item['quantity'],item['unit_price_paise']))
        return {'order_id': order_id, 'status': 'paid', 'tracking_status': 'order_received'}

@app.get('/spare-orders')
def spare_orders(user=Depends(current_user)):
    if USE_FIRESTORE:
        orders = []
        for snap in fs_collection('spare_orders').where('user_id', '==', user['id']).stream():
            order = snap.to_dict()
            order['items'] = [item.to_dict() for item in snap.reference.collection('items').stream()]
            orders.append(order)
        orders.sort(key=lambda item: item.get('created_at', 0), reverse=True)
        return {'orders': orders}
    with db() as c:
        orders = [dict(row) for row in c.execute('SELECT * FROM spare_orders WHERE user_id=? ORDER BY created_at DESC', (user['id'],)).fetchall()]
        for order in orders:
            order['items'] = [dict(row) for row in c.execute('SELECT * FROM spare_order_items WHERE order_id=?', (order['id'],)).fetchall()]
        return {'orders': orders}

@app.get('/admin/partner-applications', dependencies=[Depends(operator)])
def get_partner_applications():
    """Operator endpoint to review technician applications"""
    with db() as c:
        rows = c.execute("SELECT * FROM partner_applications ORDER BY created_at DESC").fetchall()
        return {'applications': [dict(r) for r in rows]}

class SupportTicketInput(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    phone: str = Field(pattern=r'^[0-9+ ]{10,15}$')
    subject: str = 'Service Query'
    message: str = Field(min_length=5, max_length=1000)

@app.post('/support-tickets', status_code=201)
def create_support_ticket(body: SupportTicketInput, user=Depends(current_user)):
    """Create customer care support ticket"""
    ticket_id = f"REP-TICKET-{secrets.token_hex(4).upper()}"
    now = int(time.time())
    if USE_FIRESTORE:
        fs_doc('support_tickets', ticket_id).set({'id': ticket_id, 'user_id': user['id'], **body.model_dump(), 'status': 'open', 'created_at': now})
        return {'ticket_id': ticket_id, 'status': 'open'}
    with db() as c:
        c.execute('''
        INSERT INTO support_tickets VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            ticket_id, user['id'], body.name.strip(), body.phone.strip(),
            body.subject.strip(), body.message.strip(), 'open', now
        ))
    if fb_db:
        try:
            fb_db.collection('support_tickets').document(ticket_id).set({
                'id': ticket_id,
                'user_id': user['id'],
                **body.model_dump(),
                'status': 'open',
                'created_at': firestore.SERVER_TIMESTAMP
            })
        except Exception as e:
            print(f"Firestore support ticket sync notice: {e}")
    return {'ticket_id': ticket_id, 'status': 'open'}

@app.get('/support-tickets')
def get_support_tickets(user=Depends(current_user)):
    """Retrieve customer's support tickets"""
    if USE_FIRESTORE:
        rows = [doc.to_dict() for doc in fs_collection('support_tickets').where('user_id', '==', user['id']).stream()]
        rows.sort(key=lambda item: item.get('created_at', 0), reverse=True)
        return {'tickets': rows}
    with db() as c:
        rows = c.execute("SELECT * FROM support_tickets WHERE user_id=? ORDER BY created_at DESC", (user['id'],)).fetchall()
        return {'tickets': [dict(r) for r in rows]}

# Install after authentication/operator dependencies have been declared.
from operations import install as install_operations
install_operations(sys.modules[__name__])

from integrations import install as install_integrations
install_integrations(sys.modules[__name__])

from rewards import install as install_rewards
install_rewards(sys.modules[__name__])

from lifecycle import install as install_lifecycle
install_lifecycle(sys.modules[__name__])

from refunds import install as install_refunds
install_refunds(sys.modules[__name__])

from evidence import install as install_evidence
install_evidence(sys.modules[__name__])

from shops import install as install_shops
install_shops(sys.modules[__name__])

from procurement import install as install_procurement
install_procurement(sys.modules[__name__])

from shop_payouts import install as install_shop_payouts
install_shop_payouts(sys.modules[__name__])

from discovery import install as install_discovery
install_discovery(sys.modules[__name__])

from rentals import install as install_rentals
install_rentals(sys.modules[__name__])

import workspace
workspace.install(__import__(__name__))

import marketplace
marketplace.install(__import__(__name__))

import parts_payments
parts_payments.install(__import__(__name__))

import worker_records
worker_records.install(sys.modules[__name__])

import hiring
hiring.install(sys.modules[__name__])

import promotions
promotions.install(sys.modules[__name__])

import home_plans
home_plans.install(sys.modules[__name__])

import hire_discovery
hire_discovery.install(sys.modules[__name__])

import partner_program
partner_program.install(sys.modules[__name__])

import tenders
import contract_work
tenders.install(sys.modules[__name__])


import coupons
coupons.install(sys.modules[__name__])
import retail_checkout
retail_checkout.install(sys.modules[__name__])

import opportunities
opportunities.install(__import__(__name__))

import worker_network
worker_network.install(sys.modules[__name__])

import b2b
b2b.install(sys.modules[__name__])

import professional_offers
professional_offers.install(sys.modules[__name__])

import shop_prime
shop_prime.install(sys.modules[__name__])

import repaidians_billing
repaidians_billing.install(sys.modules[__name__])
import repaidians
repaidians.install(sys.modules[__name__])
import repaidians_opportunities
repaidians_opportunities.install(sys.modules[__name__])
import repaidians_work
repaidians_work.install(sys.modules[__name__])
