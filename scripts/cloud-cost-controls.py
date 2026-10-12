"""Audit release costs, or disable one identified build trigger; never deploy."""
import argparse
import json
import subprocess
import urllib.error
import urllib.parse
import urllib.request


def gcloud_json(*args):
    result = subprocess.run(['gcloud', *args, '--format=json'], text=True, capture_output=True, check=False)
    if result.returncode:
        # Do not dump service configuration, credentials, or command output.
        raise RuntimeError('GCP read failed. Check the active Cloud Shell account, project, and read permissions.')
    return json.loads(result.stdout)


def trigger_summary(trigger):
    return {'id': trigger.get('id'), 'name': trigger.get('name'),
            'disabled': trigger.get('disabled', False),
            'config': trigger.get('filename', '(inline or autodetected build)'),
            'release_override': trigger.get('substitutions', {}).get('_RELEASE_APPROVED', 'false')}


def service_summary(service):
    template = service.get('spec', {}).get('template', {})
    annotations = template.get('metadata', {}).get('annotations', {})
    service_annotations = service.get('metadata', {}).get('annotations', {})
    spec = template.get('spec', {})
    containers = spec.get('containers', [])
    return {'name': service.get('metadata', {}).get('name'),
            'service_min_instances': service_annotations.get('run.googleapis.com/minScale', '0'),
            'service_max_instances': service_annotations.get('run.googleapis.com/maxScale', '(unset)'),
            'revision_min_instances': annotations.get('autoscaling.knative.dev/minScale', '0'),
            'revision_max_instances': annotations.get('autoscaling.knative.dev/maxScale', '(unset)'),
            'cpu_throttling': annotations.get('run.googleapis.com/cpu-throttling', 'true'),
            'concurrency': spec.get('containerConcurrency'),
            'resources': [container.get('resources', {}).get('limits', {}) for container in containers],
            'traffic': [{'revision': row.get('revisionName'), 'percent': row.get('percent', 0),
                         'tag': row.get('tag')} for row in service.get('status', {}).get('traffic', [])]}


def audit(project, region, build_locations):
    # Location matters: global and regional triggers are separate collections.
    builds = []
    for location in dict.fromkeys(build_locations):
        triggers = gcloud_json('builds', 'triggers', 'list', '--project=' + project, '--region=' + location)
        recent = gcloud_json('builds', 'list', '--project=' + project, '--region=' + location, '--limit=20')
        builds.append({'location': location, 'triggers': [trigger_summary(row) for row in triggers],
                       'recent_builds': [{'id': row.get('id'), 'status': row.get('status'),
                                          'trigger': row.get('buildTriggerId'),
                                          'created': row.get('createTime'), 'started': row.get('startTime'),
                                          'finished': row.get('finishTime')} for row in recent]})
    services = gcloud_json('run', 'services', 'list', '--project=' + project, '--region=' + region)
    jobs = gcloud_json('scheduler', 'jobs', 'list', '--project=' + project, '--location=' + region)
    return {'project': project, 'run_region': region, 'read_only': True, 'builds': builds,
            'services': [service_summary(row) for row in services],
            'scheduler': [{'name': row.get('name'), 'schedule': row.get('schedule'),
                           'time_zone': row.get('timeZone'), 'state': row.get('state')} for row in jobs],
            'note': 'Configuration inventory only. Actual spend and request volume need Billing and Monitoring.'}


def trigger_request(method, project, location, trigger, body=None):
    result = subprocess.run(['gcloud', 'auth', 'print-access-token'], text=True, capture_output=True, check=False)
    token = result.stdout.strip()
    if result.returncode or not token:
        raise RuntimeError('No usable GCP authentication; run from your authenticated Cloud Shell.')
    parts = [urllib.parse.quote(value, safe='') for value in (project, location, trigger)]
    url = 'https://cloudbuild.googleapis.com/v1/projects/{}/locations/{}/triggers/{}'.format(*parts)
    if body is not None:
        url += '?updateMask=disabled'
    request = urllib.request.Request(url, method=method,
        headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'},
        data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError('Cloud Build trigger request failed (HTTP ' + str(error.code) + '); no automatic retry.') from None


def disable_trigger(project, location, trigger, apply=False):
    current = trigger_request('GET', project, location, trigger)
    report = {'project': project, 'location': location, 'trigger': trigger_summary(current),
              'applied': False, 'will_disable': not current.get('disabled', False)}
    if not apply or current.get('disabled', False):
        return report
    # A field mask preserves repository settings, IAM, substitutions and all
    # other triggers. This neither submits a build nor changes a Run service.
    trigger_request('PATCH', project, location, trigger, {'disabled': True})
    verified = trigger_request('GET', project, location, trigger)
    if not verified.get('disabled', False):
        raise RuntimeError('Trigger disable could not be verified. Inspect the trigger before trying again.')
    report.update({'trigger': trigger_summary(verified), 'applied': True, 'will_disable': False})
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['audit', 'disable-trigger'])
    parser.add_argument('--project', default='repaido')
    parser.add_argument('--region', default='us-central1')
    parser.add_argument('--build-location', action='append', help='Audit this location; repeat for multiple locations.')
    parser.add_argument('--location', default='global', help='Location of the one trigger to disable.')
    parser.add_argument('--trigger', help='The identified production trigger ID or name.')
    parser.add_argument('--apply', action='store_true', help='Disable the specified trigger; default is preview only.')
    args = parser.parse_args()
    if args.action == 'audit' and args.apply:
        parser.error('audit is always read-only; --apply is only for disable-trigger')
    if args.action == 'disable-trigger' and not args.trigger:
        parser.error('disable-trigger requires the exact --trigger')
    try:
        result = (audit(args.project, args.region, args.build_location or ['global', args.region])
                  if args.action == 'audit' else disable_trigger(args.project, args.location, args.trigger, args.apply))
        print(json.dumps(result, indent=2))
    except (RuntimeError, FileNotFoundError, urllib.error.URLError, json.JSONDecodeError) as error:
        parser.exit(1, ('gcloud is required; use authenticated Cloud Shell.' if isinstance(error, FileNotFoundError)
                        else str(error)) + '\n')
