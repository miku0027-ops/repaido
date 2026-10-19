#!/usr/bin/env python3
"""Read-only capacity plan by default; explicit release stages a no-traffic revision.

No IAM, ingress, secrets, image, traffic percentages or scheduled work are changed.
Service-level caps are shared across revisions; a reviewed ceiling is not a
production capacity claim. Run from authenticated Cloud Shell for live inventory.
"""
import argparse
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def command_json(args):
    result = subprocess.run(['gcloud', *args, '--format=json'], text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError('GCP command failed. Check the reviewed project, identity and permissions; configuration output is withheld.')
    return json.loads(result.stdout)


def capacity(value):
    if set(value) != {'min_instances','max_instances','concurrency','cpu','memory','max_inflight','max_waiting'}:
        raise ValueError('Unexpected capacity fields')
    for key in ('min_instances','max_instances','concurrency','cpu','max_inflight','max_waiting'):
        if type(value[key]) is not int:
            raise ValueError('Capacity values must be whole numbers')
    if not 0 <= value['min_instances'] <= value['max_instances'] <= 100 or value['max_instances'] < 1:
        raise ValueError('Review an instance ceiling of 1-100 and a matching minimum')
    if not 1 <= value['concurrency'] <= value['max_inflight'] <= 64 or not 1 <= value['max_waiting'] <= 64:
        raise ValueError('Align Cloud Run concurrency with the bounded application gate')
    if value['cpu'] not in (1,2) or value['memory'] not in ('1Gi','2Gi'):
        raise ValueError('Use reviewed CPU and memory profiles')
    return value


def summary(service):
    template=service.get('spec',{}).get('template',{})
    metadata=service.get('metadata',{})
    return {'service':metadata.get('name'),'latest_ready_revision':service.get('status',{}).get('latestReadyRevisionName'),
            'latest_created_revision':service.get('status',{}).get('latestCreatedRevisionName'),
            'images':[item.get('image') for item in template.get('spec',{}).get('containers',[])],
            'service_min':metadata.get('annotations',{}).get('run.googleapis.com/minScale','0'),
            'service_max':metadata.get('annotations',{}).get('run.googleapis.com/maxScale'),
            'concurrency':template.get('spec',{}).get('containerConcurrency'),
            'revision_scaling':{key:value for key,value in template.get('metadata',{}).get('annotations',{}).items() if key in ('autoscaling.knative.dev/minScale','autoscaling.knative.dev/maxScale')},
            'resources':[item.get('resources',{}).get('limits',{}) for item in template.get('spec',{}).get('containers',[])],
            'traffic':[{'revision':item.get('revisionName'),'percent':item.get('percent',0),'tag':item.get('tag')} for item in service.get('status',{}).get('traffic',[])]}


def update_arguments(service, project, region, desired, commit, image):
    p=capacity(desired)
    prefix = 'REPAIDO_WORK' if service == 'repaido-work-api' else 'REPAIDO_API'
    return ['run','services','update',service,'--project='+project,'--region='+region,
            '--min='+str(p['min_instances']),'--max='+str(p['max_instances']),
            '--min-instances=0','--max-instances='+str(p['max_instances']),
            '--concurrency='+str(p['concurrency']),'--cpu='+str(p['cpu']),'--memory='+p['memory'],
            '--image='+image, '--cpu-boost','--update-env-vars='+prefix+'_MAX_INFLIGHT='+str(p['max_inflight'])+','+prefix+'_MAX_WAITING='+str(p['max_waiting']),
            '--no-traffic','--tag=scale-'+commit[:6],'--quiet']


def validate_release(commit, approved, expected, expected_image, current):
    if not approved or not re.fullmatch(r'[a-f0-9]{40}',commit or ''):
        raise ValueError('Applying capacity requires explicit release approval and the reviewed full source SHA')
    if not expected or expected != current['latest_ready_revision'] or expected != current['latest_created_revision']:
        raise ValueError('The serving revision changed; create and review a new capacity plan')
    if not expected_image or not re.fullmatch(r'[^\s]+@sha256:[a-f0-9]{64}', expected_image) or current['images'] != [expected_image]:
        raise ValueError('Review the single current image by digest; capacity updates must retain it')
    serving = [item for item in current['traffic'] if item['percent'] > 0]
    if len(serving) != 1 or serving[0]['revision'] != expected or serving[0]['percent'] != 100:
        raise ValueError('Finish or review the active canary before changing capacity')
    actual=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    dirty=subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip()
    if actual != commit or dirty:
        raise ValueError('Use a clean checkout of the reviewed source commit')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project',default='repaido')
    parser.add_argument('--service',choices=['repaido-api','repaido-work-api'],required=True)
    parser.add_argument('--policy',type=Path,default=ROOT/'infra/api-capacity/policy.json')
    parser.add_argument('--snapshot',type=Path,help='Local non-secret service fixture; never accepted for apply')
    parser.add_argument('--apply',action='store_true')
    parser.add_argument('--release-approved',action='store_true')
    parser.add_argument('--commit',default='')
    parser.add_argument('--expected-ready-revision',default='')
    parser.add_argument('--expected-image',default='')
    args=parser.parse_args()
    if not re.fullmatch(r'[a-z][a-z0-9-]{4,28}[a-z0-9]',args.project): parser.error('Use a valid GCP project ID')
    policy=json.loads(args.policy.read_text())
    desired=capacity(policy['services'][args.service]);region=policy['region']
    if not re.fullmatch(r'[a-z]+-[a-z]+[0-9]',region): parser.error('Use a valid region')
    if args.apply and args.snapshot: parser.error('Apply requires a fresh authenticated live inventory')
    service=json.loads(args.snapshot.read_text()) if args.snapshot else command_json(['run','services','describe',args.service,'--project='+args.project,'--region='+region])
    current=summary(service)
    if current['service'] != args.service: parser.error('Service inventory does not match the selected target')
    if not args.apply:
        print(json.dumps({'read_only':True,'project':args.project,'region':region,'current':current,'proposed':desired,
              'note':'Minima incur baseline costs. Maxima are budget/capacity bounds. Applying stages a new revision and updates service caps; traffic promotion is separate.'},indent=2))
        return 0
    validate_release(args.commit,args.release_approved,args.expected_ready_revision,args.expected_image,current)
    result=command_json(update_arguments(args.service,args.project,region,desired,args.commit,args.expected_image))
    print(json.dumps({'applied':True,'traffic_promoted':False,'service':args.service,'latest_created_revision':result.get('status',{}).get('latestCreatedRevisionName'),'capacity':summary(result)},indent=2))
    return 0


if __name__=='__main__':
    raise SystemExit(main())
