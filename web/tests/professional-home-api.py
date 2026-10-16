"""Disposable real API for profile/Home browser checks; never production data."""
import os,sys,time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'backend'))
os.environ.update(REPAIDO_STORAGE='sqlite',REPAIDO_DB=sys.argv[1],REPAIDO_ADMIN_KEY='test-operator-key')
import main,uvicorn
from fastapi import Header,HTTPException
from fastapi.testclient import TestClient
from test_home_plans import setup_worker

def actor(authorization:str=Header(default='')):
    uid=authorization.removeprefix('Bearer ')
    if uid not in ('customer','worker','stranger'):raise HTTPException(401)
    return dict(id=uid,name=uid,email=uid+'@example.test',phone='+919876543210',phone_verified=True,phone_authenticated=True)
main.app.dependency_overrides[main.current_user]=actor
with TestClient(main.app) as api:
    setup_worker(api)
    def seed(u):
        w=u.get('workers','worker');w.update(name='Fixture Electrical Professional',categories=['electrician','cleaning','ac'],skills=['Electrical inspection','Home cleaning','AC service'],tools=['Insulated toolkit'],completed_tasks=7,rating_count=7,rating_sum=33);u.put('workers','worker',w)
        u.put('worker_profiles','worker',dict(bio='A local test profile for electrical and household work.',languages=['Odia','Hindi'],specialties=['Switchboard inspection']))
        for index,rating in enumerate([5,5,5,5,4,5,4]):
            category='electrician' if index<5 else 'home:maid'
            u.put('jobs','fixture-work-'+str(index),dict(id='fixture-work-'+str(index),worker_id='worker',customer_id='stranger',category=category,service_id='fixture-history',service_name='Electrical safety inspection' if index<5 else 'Agreed household cleaning',state='completed',completed_at=time.time()-(index+1)*86400,review=dict(rating=rating,text='The agreed work was completed carefully.',at=time.time()-(index+1)*86400)))
    main.operations_store.run(seed)
uvicorn.run(main.app,host='127.0.0.1',port=int(sys.argv[2]))
