"""Pinned, single-submission backend release for authenticated Cloud Shell."""
import hashlib, json, os, subprocess, sys, time, urllib.request, uuid
from verify_payload import verify
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SHA = '36bb5d925305ab4046e08d4dae7372058b1c0a41'
OLD = '0bc8da6a22869d30a6cabd91782d3ac15d04570c'
OLD_BUILD = 'a80e74c4-fafc-4cd3-963f-2c68220abe98'
SOURCE = 'repaido-36bb5d925305-index-gated-source.tar.gz'
CONFIG = 'cloudbuild-api-index-gated.json'
STATE = ROOT / 'submission.json'

def gcloud(*args):
    return subprocess.check_output(['gcloud', *args], text=True).strip()

def read(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'Cache-Control':'no-cache'}), timeout=30) as response:
        return json.load(response)

def health(service):
    return read('https://' + service + '-133610574058.us-central1.run.app/health')

def main():
    os.umask(0o077)
    verify(ROOT)
    print('Package verified: ' + SHA, flush=True)
    if sys.argv[1:] == ['--check-package']: return
    if sys.argv[1:]: raise RuntimeError('Run python3 deploy.py without arguments.')
    if STATE.exists(): raise RuntimeError('Submission record exists. Inspect submission.json; do not submit another build.')
    for region in ('global','us-central1'):
        if gcloud('builds','list','--project=repaido','--region='+region,'--filter=status=(QUEUED WORKING PENDING)','--format=value(id)'):
            raise RuntimeError('Another build is active; wait for it to finish.')
    previous=json.loads(gcloud('builds','describe',OLD_BUILD,'--project=repaido','--region=us-central1','--format=json(status,substitutions)'))
    if previous.get('status')!='SUCCESS' or previous.get('substitutions',{}).get('COMMIT_SHA')!=OLD:
        raise RuntimeError('Recorded API baseline could not be verified.')
    for service in ('repaido-api','repaido-work-api'):
        h=health(service)
        if h.get('status')!='ok' or h.get('build_id')!=OLD_BUILD:
            raise RuntimeError('API baseline changed; ask Codex to review before deploying.')
    if read('https://repaido.com/build-info.json')['commit']!=OLD:
        raise RuntimeError('Website baseline changed; ask Codex to review before deploying.')
    rollback=ROOT/'rollback-metadata'; rollback.mkdir(exist_ok=True)
    traffic=gcloud('run','services','list','--project=repaido','--region=us-central1','--format=json(metadata.name,status.traffic,status.latestReadyRevisionName)')
    (rollback/'traffic.json').write_text(traffic+'\n')
    scheduler=gcloud('scheduler','jobs','describe','repaido-work-updates','--project=repaido','--location=us-central1','--format=json(name,state,schedule,timeZone,lastAttemptTime,status)')
    (rollback/'scheduler.json').write_text(scheduler+'\n')
    obj='source/manual-'+SHA[:12]+'-'+uuid.uuid4().hex+'.tar.gz'
    uri='gs://repaido_cloudbuild/'+obj
    subprocess.run(['gcloud','storage','cp',str(ROOT/SOURCE),uri,'--if-generation-match=0','--project=repaido'],check=True)
    generation=gcloud('storage','objects','describe',uri,'--project=repaido','--format=value(generation)')
    if not generation.isdigit(): raise RuntimeError('Uploaded source generation could not be pinned.')
    config=json.loads((ROOT/CONFIG).read_text())
    # The reviewed Dockerfile uses an optional BuildKit secret mount.
    for step in config['steps']:
        if step['id']=='build-api': step['env']=['DOCKER_BUILDKIT=1']
    config['source']={'storageSource':{'bucket':'repaido_cloudbuild','object':obj,'generation':generation}}
    config['substitutions'].update(COMMIT_SHA=SHA,_RELEASE_APPROVED='true')
    token=gcloud('auth','print-access-token')
    state={'commit':SHA,'phase':'submission_pending','source':config['source']}
    STATE.write_text(json.dumps(state,indent=2)+'\n')
    request=urllib.request.Request('https://cloudbuild.googleapis.com/v1/projects/repaido/locations/us-central1/builds',
        data=json.dumps(config).encode(),headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'},method='POST')
    with urllib.request.urlopen(request,timeout=60) as response: operation=json.load(response)
    del token
    build=operation.get('metadata',{}).get('build',{}).get('id')
    state.update(phase='submitted',build_id=build,operation=operation.get('name'))
    STATE.write_text(json.dumps(state,indent=2)+'\n')
    if not build: raise RuntimeError('Submission response lacks Build ID. Share operation from submission.json; do not resubmit.')
    print('BUILD ID: '+build,flush=True)
    print('Logs: https://console.cloud.google.com/cloud-build/builds;region=us-central1/'+build+'?project=133610574058',flush=True)
    deadline=time.monotonic()+3900
    last=None
    while time.monotonic()<deadline:
        status=gcloud('builds','describe',build,'--project=repaido','--region=us-central1','--format=value(status)')
        if status!=last: print('STATUS: '+status,flush=True);last=status
        if status not in ('QUEUED','WORKING','PENDING','STATUS_UNKNOWN'):
            state.update(phase='finished',status=status);STATE.write_text(json.dumps(state,indent=2)+'\n')
            if status!='SUCCESS': raise RuntimeError('Build failed. Share Build ID/error; do not rerun. Keep rollback-metadata.')
            for service in ('repaido-api','repaido-work-api'):
                h=health(service)
                if h.get('status')!='ok' or h.get('build_id')!=build:
                    raise RuntimeError('Build succeeded but API verification failed. Share Build ID.')
            print('SUCCESS: matching APIs verified. BUILD ID: '+build)
            print('Website has not been published. Send this output to Codex to finish cPanel publication.')
            return
        time.sleep(15)
    raise RuntimeError('Polling timed out; build may still be running. Share Build ID; do not resubmit.')

if __name__=='__main__':
    try: main()
    except Exception as error:
        print('STOPPED: '+(str(error) if isinstance(error,RuntimeError) else type(error).__name__),file=sys.stderr)
        sys.exit(1)
