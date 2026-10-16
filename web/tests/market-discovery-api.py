"""Disposable native marketplace/discovery API; images stay in local memory."""
import os,sys,io
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'backend'))
os.environ.update(REPAIDO_STORAGE='sqlite',REPAIDO_DB=sys.argv[1],REPAIDO_ADMIN_KEY='test-operator-key',REPAIDO_KYC_BUCKET='local-memory-only')
import main,marketplace,uvicorn
from PIL import Image
from fastapi import Header,HTTPException
from fastapi.testclient import TestClient
from test_operations import onboard
from test_marketplace import draft
photos={}
sample=io.BytesIO();Image.new('RGB',(40,40),'#31528a').save(sample,format='JPEG');photos['private']=sample.getvalue()
marketplace.upload_object=lambda key,data:photos.__setitem__(key,data)
marketplace.download_object=lambda key:photos[key]
def actor(authorization:str=Header(default='')):
 uid=authorization.removeprefix('Bearer ')
 if uid not in ('customer','stranger','worker','worker2'):raise HTTPException(401)
 return dict(id=uid,name=uid,email=uid+'@example.test',phone='+919876543210',phone_verified=True,phone_authenticated=True)
main.app.dependency_overrides[main.current_user]=actor
with TestClient(main.app) as api:
 onboard(api)
 draft(api,'customer',mode='exchange',name='Private fixture camera')
 draft(api,'worker',trial=True,mode='exchange',name='Public exchange phone')
 draft(api,'worker',trial=True,mode='second_hand',name='Public secondhand phone')
uvicorn.run(main.app,host='127.0.0.1',port=int(sys.argv[2]))
