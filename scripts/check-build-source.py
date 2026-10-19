"""Validate gcloud's source inventory before paying for a remote build."""
import argparse
from pathlib import Path, PurePosixPath

REQUIRED = {
    'cloudbuild.yaml', 'cloudbuild-web.yaml', 'cloudbuild-api.yaml',
    'cloudbuild-rules.yaml', 'firebase.json', 'firebase.security-tests.json', '.firebaserc',
    'firestore.rules', 'backend/Dockerfile', 'backend/.dockerignore',
    'backend/requirements.txt', 'backend/requirements-dev.txt',
    'backend/main.py', 'backend/cleanup.py', 'backend/captain_rewards.py', 'backend/captain_policy.py',
    'backend/bike_rides.py', 'backend/bike_dispatch.py', 'backend/bike_dispatch_worker.py',
    'backend/bike_payroll.py', 'backend/bike_earnings.py', 'backend/bike_runtime.py',
    'backend/bike_worker_health.py', 'backend/routing_cache.py', 'backend/catalog_ratings.py',
    'backend/scrap_experience.py', 'backend/fonts/Poppins-SemiBold.ttf', 'backend/fonts/OFL.txt',
    'scripts/check-release-authorization.py', 'scripts/check-build-source.py',
    'scripts/generate-selective-builds.py', 'scripts/plan-release.py',
    'scripts/verify-release.py',
    'scripts/release-cpanel-backend.sh', 'scripts/package-cpanel-release.py',
    'scripts/check-cpanel-access.py', 'scripts/verify-cpanel-release.py',
    'deployment/cpanel/.htaccess',
    'scripts/deploy-work-services.py', 'scripts/deploy-firestore-rules.py',
    'scripts/cloud-cost-controls.py', 'scripts/configure-cloudflare-stream.py',
    'scripts/configure-transactional-email.sh', 'scripts/test-firestore-security.mjs',
    'web/package.json', 'web/pnpm-lock.yaml', 'web/src/services/cameraMetadata.mjs',
}


def validate(names):
    files = {name.strip().removeprefix('./') for name in names if name.strip()}
    missing = sorted(REQUIRED - files)
    if missing:
        raise ValueError('Cloud Build source is missing required files: ' + ', '.join(missing))
    for name in files:
        path = PurePosixPath(name)
        if any(part in ('node_modules', '.venv', '.git') for part in path.parts) or path.name.startswith('.env'):
            raise ValueError('Do not upload local dependencies or environment files: ' + name)
    return len(files)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inventory', required=True, type=Path)
    args = parser.parse_args()
    try:
        count = validate(args.inventory.read_text().splitlines())
    except ValueError as error:
        parser.exit(1, str(error) + '\n')
    print(f'Cloud Build source inventory passed ({count} files).')
