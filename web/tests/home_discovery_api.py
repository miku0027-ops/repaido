"""Disposable API fixture. No production credentials, users or campaign writes."""
import os,sys,time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'backend'))
os.environ.update(REPAIDO_STORAGE='sqlite',REPAIDO_DB=sys.argv[1],REPAIDO_ADMIN_KEY='test-operator-key')
import main,uvicorn
from fastapi import Header,HTTPException
from fastapi.testclient import TestClient
from test_promotions import campaign,POLICY,prefs
from test_operations import ADMIN

def actor(authorization:str=Header(default='')):
    uid=authorization.removeprefix('Bearer ')
    if uid not in ('customer','stranger'):raise HTTPException(401)
    return dict(id=uid,name=uid,email=uid+'@example.test',phone='+919876543210',phone_verified=True,phone_authenticated=True)
main.app.dependency_overrides[main.current_user]=actor
with TestClient(main.app) as api:
    ac=campaign(api,event_name='Everyday care',title='A little care for your AC')
    main.operations_store.run(lambda u:u.put('policies','current',{**POLICY,'worker_share_bps':5000}))
    ac.update(discount_paise=10000,budget_paise=100000)
    main.operations_store.run(lambda u:u.put('campaigns',ac['id'],ac))
    prefs(api)
    for category in ('cleaning','plumber'):
        s=next(s for s in main.catalog()['services'] if s['category']==category)
        c={**ac,'id':category+'-offer','service_id':s['id'],'discount_paise':s['price_paise']//5,'title':'Care for your home','event_name':'Everyday care','audience':'returning'}
        main.operations_store.run(lambda u:u.put('campaigns',c['id'],c))
    main.operations_store.run(lambda u:u.put('jobs','past',dict(id='past',customer_id='customer',state='completed',payment_status='verified',category='ac',completed_at=time.time()-40*86400,total_paise=70000)))
uvicorn.run(main.app,host='127.0.0.1',port=int(sys.argv[2]))
