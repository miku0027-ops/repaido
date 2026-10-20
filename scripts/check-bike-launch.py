#!/usr/bin/env python3
"""Read-only Balasore bike launch diagnostics; never creates or activates resources.

Run in Google Cloud Shell. Output deliberately excludes credentials, raw service
environment, account records, phones, rider identities and stop coordinates.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import math
import re
import subprocess
import urllib.error
import urllib.request

PROJECT = 'repaido'
REGION = 'us-central1'
API = 'https://repaido-api-133610574058.us-central1.run.app'
TOPIC = 'projects/repaido/topics/repaido-bike-dispatch-v1'
SUBSCRIPTION = 'projects/repaido/subscriptions/repaido-bike-dispatch-worker-v1'
PUBLIC_FIELDS = ('version', 'enabled', 'bookings_available', 'dispatch_ready', 'dispatch_mode',
                 'geography_ready', 'paid_ready', 'promo_ready', 'routing_ready',
                 'promo_identity_ready', 'promo_enabled', 'service_radius_metres',
                 'pickup_radius_metres', 'free_distance_metres', 'weekly_free_limit')
GOOGLE_REASONS = frozenset({'SERVICE_DISABLED', 'USER_PROJECT_DENIED', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT',
    'IAM_PERMISSION_DENIED', 'BILLING_DISABLED', 'CONSUMER_INVALID', 'CONSUMER_SUSPENDED',
    'CREDENTIALS_MISSING', 'ACCESS_TOKEN_EXPIRED', 'ACCESS_TOKEN_TYPE_UNSUPPORTED',
    'SECURITY_POLICY_VIOLATED', 'RATE_LIMIT_EXCEEDED', 'RESOURCE_QUOTA_EXCEEDED', 'QUOTA_EXCEEDED'})
PUBLIC_FAILURE_REASONS = frozenset({'http_error', 'http_redirect', 'network_error', 'invalid_json',
                                  'response_too_large', 'invalid_response'})
READ_STATUSES = frozenset({'gcloud_missing', 'timeout', 'permission_denied', 'authentication_failed',
                          'api_disabled', 'not_found', 'read_failed', 'invalid_response'})
OPERATIONS = {
    ('run', 'services', 'describe'): ('run.services.get', 'run.services.get'),
    ('pubsub', 'topics', 'describe'): ('pubsub.topics.get', 'pubsub.topics.get'),
    ('pubsub', 'subscriptions', 'describe'): ('pubsub.subscriptions.get', 'pubsub.subscriptions.get'),
    ('compute', 'instance-groups', 'managed', 'describe'): ('compute.instanceGroupManagers.get', 'compute.instanceGroupManagers.get'),
}


def operation_name(args):
    return next((value[0] for prefix, value in OPERATIONS.items() if tuple(args[:len(prefix)]) == prefix), None)


def failure(status, *, operation=None, reasons=()):
    """Only reviewed constants enter a shareable provider error diagnostic."""
    status = status if isinstance(status, str) and status in READ_STATUSES else 'invalid_response'
    allowed = sorted({reason for reason in reasons if isinstance(reason, str) and reason in GOOGLE_REASONS}) if isinstance(reasons, (list, tuple, set, frozenset)) else []
    diagnostic = {'read_status': status, 'quota_project': PROJECT, 'quota_project_explicit': True,
                  'google_reasons': allowed, 'required_quota_permission': 'serviceusage.services.use'}
    if isinstance(operation, str) and operation in {value[0] for value in OPERATIONS.values()}:
        diagnostic['operation'] = operation
        diagnostic['required_resource_permissions'] = [operation]
    if 'USER_PROJECT_DENIED' in allowed:
        note = 'Verify the current Cloud Shell account can use repaido as its quota project with serviceusage.services.use.'
    elif 'SERVICE_DISABLED' in allowed or status == 'api_disabled':
        note = 'Verify that the API for this read operation is enabled in repaido. This probe does not enable services.'
    elif 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' in allowed:
        note = 'Verify the Cloud Shell OAuth session has cloud-platform scope. Keep access tokens out of chat.'
    elif set(allowed) & {'BILLING_DISABLED', 'CONSUMER_INVALID', 'CONSUMER_SUSPENDED'}:
        note = 'Review the quota project billing/service-consumer status with the project operator. This probe does not change billing.'
    elif status == 'authentication_failed':
        note = 'Verify the active Cloud Shell OAuth account. This probe does not change authentication.'
    elif status == 'permission_denied':
        note = 'Verify the listed read permission and serviceusage.services.use for the active Cloud Shell account; a denied read does not establish resource absence.'
    elif status == 'not_found':
        note = 'The requested metadata resource was not found; preserve any existing differently named runtime.'
    else:
        note = 'The provider did not establish a more specific allowed cause. Check the active account and listed read permissions.'
    diagnostic['next_check'] = note
    return diagnostic


def safe_failure(value):
    return failure(value.get('read_status', 'invalid_response'), operation=value.get('operation'),
                   reasons=value.get('google_reasons') or [])


def gcloud(*args):
    command = ['gcloud', *args, '--billing-project='+PROJECT]
    operation = operation_name(args)
    if not any(value.startswith('--format=') for value in args):
        command.append('--format=json')
    try:
        result = subprocess.run(command, text=True,
                                capture_output=True, stdin=subprocess.DEVNULL, timeout=45)
    except FileNotFoundError:
        return failure('gcloud_missing', operation=operation)
    except subprocess.TimeoutExpired:
        return failure('timeout', operation=operation)
    if result.returncode:
        # Never echo stderr: providers can include request/configuration details.
        message = result.stderr.upper()
        reasons = {reason for reason in GOOGLE_REASONS if re.search(r'(?<![A-Z0-9_])'+re.escape(reason)+r'(?![A-Z0-9_])', message)}
        status = ('authentication_failed' if any(value in message for value in ('UNAUTHENTICATED', 'INVALID_GRANT', '401')) or reasons & {'ACCESS_TOKEN_TYPE_UNSUPPORTED', 'ACCESS_TOKEN_EXPIRED', 'CREDENTIALS_MISSING'} else
                  'api_disabled' if 'SERVICE_DISABLED' in reasons or 'HAS NOT BEEN USED' in message else
                  'permission_denied' if 'PERMISSION_DENIED' in message or 'PERMISSION DENIED' in message or reasons & {'USER_PROJECT_DENIED', 'IAM_PERMISSION_DENIED', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT', 'SECURITY_POLICY_VIOLATED'} else
                  'not_found' if 'NOT_FOUND' in message or 'NOT FOUND' in message else
                  'read_failed')
        return failure(status, operation=operation, reasons=reasons)
    try:
        return json.loads(result.stdout)
    except (ValueError, TypeError):
        return failure('invalid_response', operation=operation)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def policy_summary(value):
    if not isinstance(value, dict):
        return {'read_status': 'invalid_response'}
    if value.get('read_status'):
        result = {'read_status': value['read_status'] if value['read_status'] in ('read_failed', 'invalid_response') else 'read_failed'}
        if type(value.get('http_status')) is int and 100 <= value['http_status'] <= 599:
            result['http_status'] = value['http_status']
        if isinstance(value.get('reason'), str) and value['reason'] in PUBLIC_FAILURE_REASONS:
            result['reason'] = value['reason']
        return result
    result = {key: value[key] for key in PUBLIC_FIELDS if key in value and
              (type(value[key]) is bool or type(value[key]) in (int, float) and math.isfinite(value[key]) or
               key == 'dispatch_mode' and value[key] in ('pubsub', 'kafka', 'direct'))}
    return {'read_status': 'ok', **result} if 'bookings_available' in result else {'read_status': 'invalid_response'}


def public_policy():
    try:
        request = urllib.request.Request(API + '/api/operations/bike-rides/policy',
                                         headers={'Cache-Control': 'no-cache'})
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=20) as response:
            raw = response.read(65537)
        if len(raw) > 65536:
            return {'read_status': 'invalid_response', 'reason': 'response_too_large'}
        value = json.loads(raw)
        # Only numbers, booleans and known enum values can enter shared output.
        return policy_summary(value)
    except urllib.error.HTTPError as error:
        return {'read_status': 'read_failed', 'http_status': error.code,
                'reason': 'http_redirect' if 300 <= error.code < 400 else 'http_error'}
    except OSError:
        return {'read_status': 'read_failed', 'reason': 'network_error'}
    except (ValueError, TypeError):
        return {'read_status': 'invalid_response', 'reason': 'invalid_json'}


def allowed_resource(value, kind):
    return value if isinstance(value, str) and re.fullmatch(
        r'projects/repaido/' + kind + r'/[A-Za-z][A-Za-z0-9._~+%-]{2,254}', value) else None


def service_summary(service):
    if not isinstance(service, dict) or service.get('read_status'):
        return safe_failure(service) if isinstance(service, dict) else {'read_status': 'invalid_response'}
    spec = service.get('spec', {}).get('template', {}).get('spec')
    v2 = not isinstance(spec, dict)
    if v2:
        spec = service.get('template', {})
    containers = spec.get('containers') if isinstance(spec, dict) else None
    # A projection which dropped containers cannot establish that env/secrets
    # are absent. Likewise, avoid guessing which sidecar is the API container.
    if not isinstance(containers, list) or len(containers) != 1 or not isinstance(containers[0], dict):
        return {'read_status': 'incomplete_response', 'name': 'repaido-api'}
    container = containers[0]
    if not isinstance(container.get('image'), str) or not isinstance(container.get('env'), list):
        return {'read_status': 'incomplete_response', 'name': 'repaido-api'}
    environment = {row.get('name'): row for row in container['env'] if isinstance(row, dict)}
    def value(name):
        return environment.get(name, {}).get('value')
    quota = environment.get('REPAIDO_BIKE_PROMO_QUOTA_SECRET', {})
    reference = quota.get('valueSource' if v2 else 'valueFrom', {}).get('secretKeyRef', {})
    key = reference.get('version' if v2 else 'key', '')
    image = container.get('image', '')
    if not isinstance(image, str) or not re.fullmatch(r'[a-z0-9.-]+-docker\.pkg\.dev/repaido/[A-Za-z0-9_./:@-]+', image):
        image = '(not a recognized project Artifact Registry reference)'
    mode = value('REPAIDO_BIKE_DISPATCH_MODE')
    return {'read_status': 'ok', 'name': 'repaido-api',
            'ready_revision': service.get('latestReadyRevision') if v2 else service.get('status', {}).get('latestReadyRevisionName'),
            'image': image,
            'runtime_service_account': spec.get('serviceAccount' if v2 else 'serviceAccountName'),
            'configuration_scope': 'latest_service_template; confirm serving traffic before any update',
            'storage_is_firestore': value('REPAIDO_STORAGE') == 'firestore',
            'dispatch_mode_explicitly_configured': mode is not None,
            'dispatch_mode': mode if mode in ('pubsub', 'kafka', 'direct') else 'pubsub' if mode is None else 'invalid',
            'topic': allowed_resource(value('REPAIDO_BIKE_PUBSUB_TOPIC'), 'topics'),
            'subscription': allowed_resource(value('REPAIDO_BIKE_PUBSUB_SUBSCRIPTION'), 'subscriptions'),
            'regional_endpoint_matches': value('REPAIDO_BIKE_PUBSUB_REGION') in (None, REGION),
            'regional_endpoint_explicitly_configured': value('REPAIDO_BIKE_PUBSUB_REGION') is not None,
            'quota_secret': {'configured': bool(quota), 'secret_manager_binding': bool(reference),
                             'pinned_numeric_version': isinstance(key, str) and bool(re.fullmatch(r'[1-9][0-9]*', key))},
            'dedicated_worker_flag_on_api': value('REPAIDO_BIKE_DISPATCH_WORKER_ENABLED') == 'true'}


def topic_summary(value):
    if not isinstance(value, dict) or value.get('read_status'):
        return safe_failure(value) if isinstance(value, dict) else {'read_status': 'invalid_response'}
    return {'read_status': 'ok', 'name': allowed_resource(value.get('name'), 'topics'),
            'allowed_persistence_regions': value.get('messageStoragePolicy', {}).get('allowedPersistenceRegions', [])}


def subscription_summary(value):
    if not isinstance(value, dict) or value.get('read_status'):
        return safe_failure(value) if isinstance(value, dict) else {'read_status': 'invalid_response'}
    return {'read_status': 'ok', 'name': allowed_resource(value.get('name'), 'subscriptions'),
            'topic': allowed_resource(value.get('topic'), 'topics'),
            'message_ordering': value.get('enableMessageOrdering') is True,
            'ack_deadline_seconds': value.get('ackDeadlineSeconds'),
            'retention': value.get('messageRetentionDuration'),
            'expiration_disabled': value.get('expirationPolicy') == {},
            'dead_letter_policy_present': bool(value.get('deadLetterPolicy')),
            'retry_minimum': value.get('retryPolicy', {}).get('minimumBackoff'),
            'retry_maximum': value.get('retryPolicy', {}).get('maximumBackoff')}


def worker_summary(value):
    if isinstance(value, dict):
        if value.get('read_status'):
            return safe_failure(value)
        if value.get('name') != 'repaido-bike-dispatch':
            return {'read_status': 'invalid_response'}
        value = [value]
    if not isinstance(value, list):
        return {'read_status': 'invalid_response'}
    rows = [row for row in value if row.get('name') == 'repaido-bike-dispatch']
    return {'read_status': 'ok', 'managed_groups': [
        {'name': row.get('name'), 'target_size': row.get('targetSize'),
         'region': row.get('region', '').rsplit('/', 1)[-1] or None}
        for row in rows], 'other_continuous_runtimes_not_inspected': True}


def report(*, service, topic, subscription, workers, policy):
    api = service_summary(service)
    broker_topic, broker_subscription = topic_summary(topic), subscription_summary(subscription)
    worker = worker_summary(workers)
    findings = []
    policy = policy_summary(policy)
    if policy['read_status'] != 'ok':
        findings.append('Public policy readiness could not be verified.')
        if policy.get('http_status'):
            findings.append('The public policy endpoint returned HTTP '+str(policy['http_status'])+'; this does not establish booking availability.')
    for name, value in [('API configuration', api), ('Pub/Sub topic', broker_topic), ('Pub/Sub subscription', broker_subscription)]:
        if value['read_status'] != 'ok':
            findings.append(name + ': ' + value['read_status'] + '; this does not prove the resource is absent.')
    if worker['read_status'] != 'ok':
        reasons = ', '.join(worker.get('google_reasons') or [])
        findings.append('Continuous worker inventory: '+worker['read_status']+(' ('+reasons+')' if reasons else '')+'. '+worker.get('next_check', 'The worker runtime could not be verified.'))
    if api.get('read_status') == 'ok':
        if not api['topic'] or not api['subscription']:
            findings.append('The API has no valid project-local Pub/Sub topic/subscription configuration.')
        if api['dispatch_mode'] != 'pubsub':
            findings.append('The selected runtime mode is not the reviewed Pub/Sub launch mode.')
        if not api['storage_is_firestore']:
            findings.append('The API must use the existing shared Firestore store.')
        if api['dedicated_worker_flag_on_api']:
            findings.append('The continuous worker opt-in belongs only on the dedicated worker runtime.')
        if not api['quota_secret']['secret_manager_binding'] or not api['quota_secret']['pinned_numeric_version']:
            findings.append('Free launch eligibility needs a stable quota key bound through a pinned Secret Manager version on API and worker.')
    if broker_subscription.get('read_status') == 'ok':
        if not broker_subscription['message_ordering']:
            findings.append('The actual subscription does not have message ordering enabled.')
        if broker_subscription['topic'] != api.get('topic', TOPIC):
            findings.append('The subscription topic and API transport configuration do not match.')
        if broker_subscription['dead_letter_policy_present']:
            findings.append('Review the existing dead-letter policy; do not discard ordered reservation events.')
    labels = {'enabled': 'Bike bookings are paused in company policy.',
              'dispatch_ready': 'No matching healthy continuous dispatch worker is reported.',
              'geography_ready': 'The approved Balasore operating circle is not ready.',
              'paid_ready': 'Reviewed fare/tax/collection and company rider funding readiness is incomplete.',
              'routing_ready': 'The server route provider is not ready.',
              'promo_identity_ready': 'The private free-ride quota identity key is not ready.'}
    for key, label in labels.items():
        if policy.get(key) is False:
            findings.append(label)
    return {'read_only': True, 'cloud_mutations': False, 'project': PROJECT, 'region': REGION,
            'api': api, 'topic': broker_topic, 'subscription': broker_subscription,
            'worker_runtime': worker, 'public_policy': policy,
            'findings': findings,
            'bookings_available_reported_by_server': policy.get('bookings_available') if policy['read_status'] == 'ok' else None,
            'admin_review_still_required': ['Current approved rider and bike documents.',
                'Up to three actual salaried riders at INR 7000 each per month, and current-month funding evidence.',
                'Reviewed operating circle, applicable tax, cash collection and cancellation terms.',
                'Fixed promotion start, six-month window and reviewed free-ride terms.'],
            'agreed_launch_contract': {'city': 'Balasore', 'base_paise': 800, 'per_km_paise': 500,
                'maximum_road_metres': 4000, 'free_road_metres': 2000, 'free_weekly_limit': 3,
                'free_cooldown_hours': 36, 'promo_calendar_months': 6,
                'maximum_salary_riders': 3, 'monthly_salary_paise_per_rider': 700000,
                'independent_earnings': 'disabled until real amounts and funding are reviewed'},
            'next_step': 'Review the read-only inventory and docs/BIKE_LAUNCH.md. Do not bypass any server readiness gate.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()  # Deliberately no apply/provision/activation option.
    # Project the complete container list. Projecting children of the repeated
    # containers field can omit env/image in gcloud's formatted response.
    service = gcloud('run', 'services', 'describe', 'repaido-api', '--project='+PROJECT, '--region='+REGION,
        '--format=json(metadata.name,spec.template.spec,status.latestReadyRevisionName,status.traffic,template,latestReadyRevision)')
    api = service_summary(service)
    topic = api.get('topic') or TOPIC
    subscription = api.get('subscription') or SUBSCRIPTION
    with ThreadPoolExecutor(max_workers=4) as pool:
        topic_result = pool.submit(gcloud, 'pubsub', 'topics', 'describe', topic, '--project='+PROJECT,
            '--format=json(name,messageStoragePolicy.allowedPersistenceRegions)')
        subscription_result = pool.submit(gcloud, 'pubsub', 'subscriptions', 'describe', subscription, '--project='+PROJECT,
            '--format=json(name,topic,enableMessageOrdering,ackDeadlineSeconds,messageRetentionDuration,expirationPolicy,deadLetterPolicy,retryPolicy)')
        workers_result = pool.submit(gcloud, 'compute', 'instance-groups', 'managed', 'describe', 'repaido-bike-dispatch',
            '--project='+PROJECT, '--region='+REGION, '--format=json(name,region,targetSize)')
        policy_result = pool.submit(public_policy)
        value = report(service=service, topic=topic_result.result(), subscription=subscription_result.result(),
            workers=workers_result.result(), policy=policy_result.result())
    print(json.dumps(value, indent=2, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
