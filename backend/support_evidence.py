"""Private, case-scoped photos supplied by a support conversation participant."""
import hashlib
import os
import re
import time
import uuid
from fastapi import Depends, Request, Response
from starlette.concurrency import run_in_threadpool
from operations import fail
from workspace import photo_body
from evidence import upload_object, download_object


def describe_attachment(row, admin=False):
    prefix='/api/operations/admin/support' if admin else '/api/operations/support'
    return dict(id=row['id'],content_type='image/jpeg',size=row['size'],url=f"{prefix}/{row['case_id']}/attachments/{row['id']}")


def public_message(message, admin=False):
    return {**{k:v for k,v in message.items() if k!='attachment_ids'},'attachments':[describe_attachment(a,admin) for a in message.get('attachments',[])]}


def bind_attachments(u, case_id, owner_id, attachment_ids, message_id):
    attachments=[]
    for aid in attachment_ids:
        row=u.get('support_attachments',aid)
        if not row or row['case_id']!=case_id or row['owner_id']!=owner_id or row.get('status')!='ready':
            fail('ATTACHMENT_REQUIRED','Use a photo uploaded by you for this support case.',422)
        if row.get('message_id') and row['message_id']!=message_id:
            fail('ATTACHMENT_USED','This photo is already attached to a message.',409)
        if not row.get('message_id') and row['expires_at']<=time.time():
            fail('ATTACHMENT_EXPIRED','Upload the photo again before sending.',409)
        row['message_id']=message_id;u.put('support_attachments',aid,row)
        attachments.append({k:row[k] for k in ('id','case_id','size')})
    return attachments


def install(core, router, case_access):
    store=core.operations_store
    def writable(u,case_id,user,admin):
        case=case_access(u,case_id,user['id'],admin)
        if case['state']=='resolved':fail('CASE_CLOSED','Reopen the case before adding evidence.',409)
        if admin and case.get('assigned_to') not in (None,user['id']):
            fail('CASE_ASSIGNED','This case is assigned to a teammate. Refresh the inbox.',409)
        return case

    async def upload(case_id,request,user,admin=False):
        store.run(lambda u:writable(u,case_id,user,admin))
        if not os.getenv('REPAIDO_KYC_BUCKET'):fail('STORAGE_UNAVAILABLE','Photo storage is unavailable. You can still send your message without a photo.',503)
        try:upload_id=str(uuid.UUID(request.headers.get('X-Upload-ID','')))
        except ValueError:fail('UPLOAD_ID','Use a valid upload ID to retry this photo safely.',422)
        data=await photo_body(request);digest=hashlib.sha256(data).hexdigest();now=time.time()
        aid=hashlib.sha256(f"{case_id}:{user['id']}:{upload_id}".encode()).hexdigest()
        object_key='support-attachments/'+aid
        budget_id=hashlib.sha256(f"{user['id']}:{int(now//86400)}".encode()).hexdigest()
        def reserve(u):
            writable(u,case_id,user,admin);old=u.get('support_attachments',aid)
            if old:
                if old['digest']!=digest:fail('REUSED_KEY','Use a new upload ID for a different photo.',409)
                if not old.get('message_id') and old['expires_at']<=now:fail('ATTACHMENT_EXPIRED','Choose this photo again to start a new upload.',409)
                return old
            budget=u.get('support_attachment_budget',budget_id) or {'count':0}
            if budget['count']>=20:fail('PHOTO_LIMIT','Daily support photo upload limit reached. You can still send a message.',429)
            budget['count']+=1;u.put('support_attachment_budget',budget_id,budget)
            row=dict(id=aid,case_id=case_id,owner_id=user['id'],object=object_key,digest=digest,status='uploading',size=len(data),created_at=now,expires_at=now+7*86400)
            u.put('support_attachments',aid,row);return row
        row=store.run(reserve)
        if row['status']!='ready':
            try:await run_in_threadpool(upload_object,object_key,data)
            except Exception:
                try:stored=await run_in_threadpool(download_object,object_key)
                except Exception:fail('UPLOAD_FAILED','The photo upload could not be confirmed. Retry this photo or remove it and send your message.',503)
                if hashlib.sha256(stored).hexdigest()!=digest:fail('UPLOAD_FAILED','Photo upload failed. Retry this photo.',503)
            def finish(u):
                writable(u,case_id,user,admin);saved=u.get('support_attachments',aid);saved['status']='ready';u.put('support_attachments',aid,saved);return saved
            row=store.run(finish)
        return describe_attachment(row,admin)

    def read(case_id,aid,user,admin=False):
        if not re.fullmatch(r'[a-f0-9]{64}',aid):fail('NOT_FOUND','Photo unavailable.',404)
        def allowed(u):
            case_access(u,case_id,user['id'],admin);row=u.get('support_attachments',aid)
            if not row or row['case_id']!=case_id or row['status']!='ready':fail('NOT_FOUND','Photo unavailable.',404)
            if not row.get('message_id') and (row['owner_id']!=user['id'] or row['expires_at']<=time.time()):fail('NOT_FOUND','Photo unavailable.',404)
            return row
        row=store.run(allowed)
        try:data=download_object(row['object'])
        except Exception:fail('UNAVAILABLE','Photo storage is temporarily unavailable. Retry later.',503)
        return Response(data,media_type='image/jpeg',headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Disposition':'inline; filename="support-evidence.jpg"'})

    @router.post('/support/{case_id}/attachments')
    async def customer_upload(case_id:str,request:Request,user=Depends(core.current_user)):
        return await upload(case_id,request,user)
    @router.post('/admin/support/{case_id}/attachments')
    async def admin_upload(case_id:str,request:Request,user=Depends(core.operator)):
        return await upload(case_id,request,user,True)
    @router.get('/support/{case_id}/attachments/{aid}')
    def customer_read(case_id:str,aid:str,user=Depends(core.current_user)):
        return read(case_id,aid,user)
    @router.get('/admin/support/{case_id}/attachments/{aid}')
    def admin_read(case_id:str,aid:str,user=Depends(core.operator)):
        return read(case_id,aid,user,True)
