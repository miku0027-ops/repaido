"""Loopback browser fixture with synthetic gateway and an isolated database."""
import os,sys
sys.path.insert(0,os.getcwd())
os.environ['REPAIDO_DB']=sys.argv[1]
os.environ['REPAIDO_STORAGE']='sqlite'
os.environ['RAZORPAY_KEY_ID']='synthetic-public-key'
os.environ['RAZORPAY_KEY_SECRET']='synthetic-recovery-secret'
from fastapi import Header,HTTPException
import main,integrations,uvicorn
from test_legacy_checkout_recovery import Provider,details,proof
provider=Provider()
integrations.razorpay=provider
main.operations_tick=lambda:None
def actor(authorization:str=Header(default='')):
    uid=authorization.removeprefix('Bearer ')
    if uid not in ('customer','stranger'):raise HTTPException(401)
    return {'id':uid}
main.app.dependency_overrides[main.current_user]=actor

@main.app.post('/__test/seed')
def seed():
    with main.db() as connection:
        connection.execute('INSERT OR IGNORE INTO users VALUES(?,?,?,?,?)',('customer','Customer','customer@synthetic.test','unused',0))
    result=[]
    for index in (0,1):
        body=details();body['starts_at']=main.candidates()[index].isoformat()
        order=main.create_booking_payment_order(main.BookingPaymentOrderInput(**body),{'id':'customer'})
        for _ in range(3):
            filler=details();filler['starts_at']=body['starts_at']
            main.create_booking(main.BookingInput(**filler),{'id':'customer'})
        payment=provider.capture(order)
        try:main.verify_booking_payment(main.PaymentVerificationInput(**proof(order,payment)),{'id':'customer'})
        except HTTPException as error:
            if error.status_code!=409:raise
        result.append(order['payment_order_id'])
    return {'payments':result}

@main.app.get('/__test/stats')
def stats():
    return {'orders':len(provider.orders),'refunds':len(provider.refunds)}

uvicorn.run(main.app,host='127.0.0.1',port=int(sys.argv[2]))
