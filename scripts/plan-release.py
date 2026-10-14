"""Select the smallest safe customer release for changes since a deployed commit.

The caller must supply the actual production baseline. This is intentionally
offline; an arbitrary HEAD~1 is not a production deployment record.
"""
import argparse
import re
import subprocess


def git(*args):
    return subprocess.check_output(['git', *args])


def changed_paths(base, head):
    if not re.fullmatch(r'[0-9a-f]{40}', base):
        raise ValueError('The deployed baseline must be a full commit SHA.')
    if not re.fullmatch(r'[0-9a-f]{40}', head):
        raise ValueError('The reviewed release must be a full commit SHA.')
    try:
        git('merge-base', '--is-ancestor', base, head)
        raw = git('diff', '--no-renames', '--name-only', '-z', base, head)
    except subprocess.CalledProcessError as error:
        raise ValueError('The deployed baseline must be an ancestor of the reviewed release.') from error
    return [path.decode() for path in raw.split(b'\0') if path]


def classify(paths):
    changed = set(paths)
    if not changed:
        return 'none'
    engineering = {path for path in changed if path.startswith('engineering/')}
    if changed == engineering:
        return 'engineering'
    if 'firestore.indexes.json' in changed:
        raise ValueError('Firestore indexes are not deployed by the customer release pipeline. Review and publish them separately.')
    targets = set()
    for path in changed - engineering:
        if path.startswith('web/') or path in ('firebase.json', '.firebaserc'):
            targets.add('web')
        elif path.startswith('backend/'):
            targets.add('api')
        elif path in ('firestore.rules', 'firebase.security-tests.json',
                      'scripts/test-firestore-security.mjs'):
            targets.add('rules')
        elif path.startswith(('docs/', 'android/')) or path in ('README.md', 'AGENTS.md', '.gitignore'):
            continue
        else:
            # Build configuration, release helpers, and unfamiliar root paths
            # can affect more than one component. Never guess past them.
            targets.add('full')
    if not targets:
        return 'none'
    if 'full' in targets or len(targets) > 1:
        return 'full'
    return next(iter(targets))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', required=True)
    parser.add_argument('--head', required=True)
    parser.add_argument('--format', choices=('human', 'target'), default='human')
    args = parser.parse_args()
    try:
        paths = changed_paths(args.base, args.head)
        target = classify(paths)
    except ValueError as error:
        parser.exit(1, str(error) + '\n')
    if args.format == 'target':
        print(target)
    else:
        print(f'Release target: {target}')
        print(f'Changed files: {len(paths)}')
        if any(path.startswith('engineering/') for path in paths) and target != 'engineering':
            print('Engineering console changes require a separate reviewed console release.')
        if target == 'engineering':
            print('Use engineering/release.py with engineer access checks; the customer pipeline does not publish the console.')
        if target == 'none':
            print('No web, API, or Rules deployment is required for these files.')


if __name__ == '__main__':
    main()
