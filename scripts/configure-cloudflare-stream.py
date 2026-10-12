#!/usr/bin/env python3
"""Run in authenticated Cloud Shell. Secret values stay in memory/stdin, never logs."""
import argparse,datetime,getpass,json,re,subprocess,urllib.request


def gcloud(*args,input=None):
    result=subprocess.run(['gcloud',*args,'--quiet'],input=input,text=True,capture_output=True)
    if result.returncode:raise RuntimeError(result.stderr.strip())
    return result.stdout.strip()


def configure(args):
    account=args.account or input('Cloudflare account ID: ').strip()
    if not re.fullmatch('[a-f0-9]{32}',account):raise ValueError('Use the 32-character Cloudflare account ID.')
    token=getpass.getpass('Cloudflare Stream API token (hidden): ').strip()
    if not token:raise ValueError('A token with Account Stream Edit access is required.')
    services=['repaido-api','repaido-work-worker'];identities={}
    for name in services:
        identities[name]=gcloud('run','services','describe',name,'--project='+args.project,'--region='+args.region,'--format=value(spec.template.spec.serviceAccountName)')
        if not identities[name]:raise RuntimeError('The existing service runtime account could not be found.')
    # Prepare storage and permissions before creating a one-time Cloudflare key.
    for secret in ['cloudflare-stream-api-token','cloudflare-stream-signing-pem']:
        found=subprocess.run(['gcloud','secrets','describe',secret,'--project='+args.project,'--format=value(name)'],capture_output=True,text=True)
        if found.returncode:
            if 'NOT_FOUND' not in found.stderr:raise RuntimeError(found.stderr.strip())
            gcloud('secrets','create',secret,'--project='+args.project,'--replication-policy=automatic')
        readers={identities['repaido-api']}|({identities['repaido-work-worker']} if secret.endswith('api-token') else set())
        for reader in readers:gcloud('secrets','add-iam-policy-binding',secret,'--project='+args.project,'--member=serviceAccount:'+reader,'--role=roles/secretmanager.secretAccessor')
    key=None;stored=False
    def request(method,path):
        req=urllib.request.Request('https://api.cloudflare.com/client/v4/accounts/'+account+'/stream/keys'+path,method=method,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
        with urllib.request.urlopen(req,timeout=20) as response:data=json.load(response)
        if not data.get('success'):raise RuntimeError('Cloudflare could not create the signing key. Check Stream access.')
        return data.get('result')
    try:
        key=request('POST','')
        if not key or not key.get('pem') or not re.fullmatch('[a-f0-9]{32}',key.get('id','')):raise RuntimeError('Cloudflare returned an incomplete signing key.')
        gcloud('secrets','versions','add','cloudflare-stream-signing-pem','--project='+args.project,'--data-file=-',input=key['pem']);stored=True
        gcloud('secrets','versions','add','cloudflare-stream-api-token','--project='+args.project,'--data-file=-',input=token)
        revision=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d%H%M%S')
        gcloud('run','services','update','repaido-api','--project='+args.project,'--region='+args.region,'--update-env-vars=CLOUDFLARE_STREAM_ACCOUNT_ID='+account+',CLOUDFLARE_STREAM_KEY_ID='+key['id']+',REPAIDO_STREAM_CONFIG_REV='+revision,'--update-secrets=CLOUDFLARE_STREAM_API_TOKEN=cloudflare-stream-api-token:latest,CLOUDFLARE_STREAM_SIGNING_PEM=cloudflare-stream-signing-pem:latest')
        gcloud('run','services','update','repaido-work-worker','--project='+args.project,'--region='+args.region,'--update-env-vars=CLOUDFLARE_STREAM_ACCOUNT_ID='+account+',REPAIDO_STREAM_CONFIG_REV='+revision,'--update-secrets=CLOUDFLARE_STREAM_API_TOKEN=cloudflare-stream-api-token:latest')
        print('Cloudflare Stream credentials stored securely; API and cleanup worker updated.')
        with urllib.request.urlopen('https://'+args.project+'.web.app/api/repaidians/live/status',timeout=20) as response:status=json.load(response)
        if not status.get('ready'):raise RuntimeError('Live-video readiness is still false. Check the current API release and secret access.')
        print('Live-video connection settings are ready. Test a broadcast from Repaidians → Live.')
    except Exception:
        if key and not stored:
            try:request('DELETE','/'+key['id'])
            except Exception:pass
        raise

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--project',default='repaido');parser.add_argument('--region',default='us-central1');parser.add_argument('--account');args=parser.parse_args()
    try:configure(args)
    except Exception as error:raise SystemExit(str(error))
