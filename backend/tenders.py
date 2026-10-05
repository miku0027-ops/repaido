"""Legacy cart routes; contract workflows live in contract_work."""
import time,uuid
from typing import Literal,Optional
from fastapi import APIRouter,Depends,Header
from pydantic import Field
from operations import Input
from integrations import audit
import contract_work

class CartItemInput(Input):
    id: str
    title: str
    price_paise: int
    quantity: int = Field(ge=1, le=99)
    shop_id: Optional[str] = None
    shop_name: Optional[str] = None
    category: Optional[str] = None

class CreateCartOrderInput(Input):
    customer_name: str = Field(min_length=2, max_length=80)
    customer_phone: str = Field(min_length=10, max_length=15)
    delivery_address: str = Field(min_length=5, max_length=300)
    city: str = Field(min_length=2, max_length=60)
    pincode: str = Field(min_length=6, max_length=6)
    payment_method: Literal['upi', 'card', 'cod']
    items: list[CartItemInput]
    order_notes: Optional[str] = None

def install(core):
    contract_work.install(core)
    r=APIRouter(prefix='/operations');store=core.operations_store
    def current_user(user=Depends(core.current_user)):return user
    def optional_user(authorization:str=Header(default='')):
        if not authorization.startswith('Bearer '):return None
        return core.current_user(authorization)
    # --- CUSTOMER SHOPPING CART & ORDERS ---
    @r.post('/cart/orders')
    def create_cart_order(body: CreateCartOrderInput, user=Depends(optional_user)):
        def execute(u):
            user_id = user['id'] if user else f"guest-{uuid.uuid4().hex[:6]}"
            order_id = f"ord-{uuid.uuid4().hex[:8]}"
            subtotal = sum(item.price_paise * item.quantity for item in body.items)
            delivery_fee = 0 if subtotal >= 99900 else 9900  # Free delivery over ₹999
            gst = int(subtotal * 0.18)
            total = subtotal + delivery_fee + gst

            order = dict(
                id=order_id,
                customer_id=user_id,
                customer_name=body.customer_name,
                customer_phone=body.customer_phone,
                delivery_address=body.delivery_address,
                city=body.city,
                pincode=body.pincode,
                payment_method=body.payment_method,
                items=[item.model_dump() for item in body.items],
                subtotal_paise=subtotal,
                delivery_fee_paise=delivery_fee,
                gst_paise=gst,
                total_paise=total,
                status='confirmed',
                estimated_delivery='2–4 hours (Odisha) / 24–48h express',
                created_at=time.time(),
                order_notes=body.order_notes
            )
            u.put('cart_orders', order_id, order)
            audit(u, 'CartOrderCreated', user_id, order_id=order_id, total=total)
            return order
        return store.run(execute)

    @r.get('/cart/orders')
    def list_cart_orders(user=Depends(current_user)):
        def execute(u):
            orders = [o for o in u.all('cart_orders') if o.get('customer_id') == user['id']]
            orders.sort(key=lambda o: -o.get('created_at', 0))
            return {'orders': orders}
        return store.run(execute)

    core.app.include_router(r)
