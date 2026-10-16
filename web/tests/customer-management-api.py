"""Disposable local API for market, contributions and customer/company support."""
import os,sys,time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'backend'))
os.environ.update(REPAIDO_STORAGE='sqlite',REPAIDO_DB=sys.argv[1],REPAIDO_ADMIN_KEY='test-operator-key')
import main,local_business,cleanup,uvicorn
from fastapi import Header,HTTPException
from fastapi.testclient import TestClient
from test_scrap_rewards_ecosystem import receipt_ready,confirm
from test_cleanup import report
from test_scrap_experience import jpeg

def actor(authorization:str=Header(default='')):
    uid=authorization.removeprefix('Bearer ')
    if uid not in ('customer','worker','worker2','admin-a','admin-b'):raise HTTPException(401)
    return dict(id=uid,name='Fixture customer' if uid=='customer' else uid,email=uid+'@example.test',phone='+919876543210',phone_verified=True,phone_authenticated=True)
main.app.dependency_overrides[main.current_user]=actor
class FixtureAuth:
    def verify_id_token(self,token,check_revoked=True):
        assert check_revoked
        return dict(uid=token,admin=token in ('admin-a','admin-b'))
main.fb_auth_module=FixtureAuth()
local_business.download_object=lambda key:jpeg()
cleanup.download_object=lambda key:jpeg()
with TestClient(main.app) as api:
    row=receipt_ready(api);completed,_=confirm(api,row)
    def seed(u):
        local_business.inbox(u,'scrap',u.get('scrap_collections',completed['id']))
        u.put('cleanup_points','previous-contributions',dict(id='previous-contributions',user_id='customer',points=90,created_at=time.time()-86400))
    main.operations_store.run(seed)
    response,_=report(api);assert response.status_code==201,response.text
uvicorn.run(main.app,host='127.0.0.1',port=int(sys.argv[2]))
