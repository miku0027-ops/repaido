"""Small, consent-controlled banner interests; no raw queries or sensitive inference."""
import math,time
from typing import Literal
from fastapi import APIRouter,Depends
from operations import Input
from promotions import prefs
IDS=['sell','refurbished','rentals','exchange','contracts']
class Open(Input):
    category:Literal['sell','refurbished','rentals','exchange','contracts']
def install(core):
 r=APIRouter(prefix='/operations/opportunities');store=core.operations_store
 @r.get('/order')
 def order(user=Depends(core.current_user)):
  def read(u):
   if not prefs(u,user['id']).get('personalised'):return {'ids':IDS,'personalised':False}
   now=time.time();saved=u.get('opportunity_interests',user['id']) or {};signals=saved.get('signals',{})
   def score(k):
    v=signals.get(k,{})
    return v.get('score',0)*math.exp(-max(0,now-v.get('at',0))/(7*86400))
   return {'ids':sorted(IDS,key=lambda k:-score(k)),'personalised':bool(signals),'reason':'Based on marketplace banners you opened. Change Personalise offers in your profile.'}
  return store.run(read)
 @r.post('/open')
 def opened(body:Open,user=Depends(core.current_user)):
  def save(u):
   if not prefs(u,user['id']).get('personalised'):return {'saved':False}
   now=time.time();row=u.get('opportunity_interests',user['id']) or {'signals':{}};v=row['signals'].get(body.category,{})
   if now-v.get('at',0)<60:return {'saved':False}
   row['signals'][body.category]={'score':min(10,v.get('score',0)*math.exp(-max(0,now-v.get('at',0))/(7*86400))+1),'at':now};u.put('opportunity_interests',user['id'],row);return {'saved':True}
  return store.run(save)
 core.app.include_router(r)
