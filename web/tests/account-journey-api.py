"""Loopback-only isolated server for the real customer journey browser test."""
import os, sys, tempfile, time
from pathlib import Path
from contextlib import asynccontextmanager
os.environ['GOOGLE_APPLICATION_CREDENTIALS']='/tmp/repaido-isolated-no-cloud.json'
os.environ['REPAIDO_STORAGE']='sqlite'
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'backend'))
import main
import uvicorn
main.DB_PATH=str(Path(tempfile.mkdtemp(prefix='repaido-journey-api-'))/'fixture.db')
main.USE_FIRESTORE=False
main.fb_db=None
class Firebase:
    def verify_id_token(self, token, check_revoked=True):
        if not token.startswith('journey-'):
            raise ValueError('Only isolated fixture identities are allowed')
        uid,verified=token.split(':')
        result=dict(uid=uid,name='Asha',email=uid+'@example.com',email_verified=True,
                    auth_time=int(time.time()),firebase={'sign_in_provider':'google.com'})
        if verified=='verified': result['phone_number']='+919876543210'
        return result
main.fb_auth_module=Firebase()
@asynccontextmanager
async def lifespan(app):
    async with main.lifespan(app):
        with main.db() as db:
            db.execute('INSERT OR IGNORE INTO users VALUES(?,?,?,?,?)',('journey-existing','Asha','journey-existing@example.com','firebase_auth_token',1))
        from test_promotions import POLICY
        main.operations_store.run(lambda u:u.put('policies','current',POLICY))
        main.operations_store.run(lambda u:u.put('campaigns','journey-real-offer',dict(
            id='journey-real-offer',version=1,title='AC care this week',body='Choose your visit.',service_id='ac-service',
            icon='wrench',tone='blue',placements=['home','launch','checkout'],cities=['Balasore'],starts_at=time.time()-60,
            ends_at=time.time()+3600,active=True,audience='all',min_paid_spend_paise=0,discount_paise=2000,
            budget_paise=20000,reserved_paise=0,per_user_limit=1,terms='₹20 off AC service. Parts and extra work excluded. One booking per customer.')))
        yield
main.app.router.lifespan_context=lifespan
uvicorn.run(main.app,host='127.0.0.1',port=8198,log_level='warning')
