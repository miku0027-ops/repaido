"""Disposable admin dashboard API. No production data, credentials or cloud calls."""
import os,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'backend'))
os.environ.update(REPAIDO_STORAGE='sqlite',REPAIDO_DB=sys.argv[1],REPAIDO_ADMIN_KEY='test-operator-key')
import main,uvicorn
from fastapi import Header,HTTPException
from fastapi.testclient import TestClient
from test_operations import onboard,book
from test_business_profiles import apply

def actor(authorization:str=Header(default='')):
    uid=authorization.removeprefix('Bearer ')
    if uid not in ('customer','worker','worker2','admin-a','admin-b'):raise HTTPException(401)
    return dict(id=uid,name=uid,email=uid+'@example.test',phone='+919876543210',phone_verified=True,phone_authenticated=True)
main.app.dependency_overrides[main.current_user]=actor
with TestClient(main.app) as api:
    onboard(api);onboard(api,'worker2',approve=False);book(api)
    response=apply(api,'cab_owner');assert response.status_code==200,response.text
class FixtureAuth:
    def verify_id_token(self,token,check_revoked=True):
        assert check_revoked
        return dict(uid=token,admin=token in ('admin-a','admin-b'))
main.fb_auth_module=FixtureAuth()
uvicorn.run(main.app,host='127.0.0.1',port=int(sys.argv[2]))
