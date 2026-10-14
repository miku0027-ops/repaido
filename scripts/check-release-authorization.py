"""Fail before build work unless this batch has an explicit release override."""
import argparse
import re


def require_release(approved, commit):
    if approved != 'true':
        raise ValueError('Release not requested. Development changes must not deploy automatically.')
    if not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise ValueError('An authorized release must identify its reviewed 40-character Git commit.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--approved', default='false')
    parser.add_argument('--commit', default='')
    args = parser.parse_args()
    try:
        require_release(args.approved, args.commit)
    except ValueError as error:
        parser.exit(1, str(error) + '\n')
    print('Explicit release override and commit supplied; release checks can proceed.')
