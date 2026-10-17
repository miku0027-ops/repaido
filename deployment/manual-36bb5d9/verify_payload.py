"""Verify the exact reviewed content, independent of local gzip versions."""
import hashlib
import json
from pathlib import Path
import tarfile

COMMIT = '36bb5d925305ab4046e08d4dae7372058b1c0a41'
MANIFEST_HASH = '3c9e1ecfcd6daa3fd5c7acb2f60169c25790b743700170ed65062052707e77d5'
CONFIG_HASH = '08e1122a02b186082588c5a78e5ce39c6e3e822127936a7ed2dfd08804ce7c5a'
ARCHIVE = 'repaido-36bb5d925305-index-gated-source.tar.gz'

def digest(data):
    return hashlib.sha256(data).hexdigest()

def manifest(root):
    raw = (root / 'reviewed-source.json').read_bytes()
    if digest(raw) != MANIFEST_HASH:
        raise RuntimeError('Reviewed source manifest hash mismatch.')
    if digest((root / 'cloudbuild-api-index-gated.json').read_bytes()) != CONFIG_HASH:
        raise RuntimeError('Reviewed build configuration hash mismatch.')
    document = json.loads(raw)
    if document['commit'] != COMMIT:
        raise RuntimeError('Wrong release identity.')
    return raw, document

def verify(root):
    raw, document = manifest(root)
    expected = dict(document['files'])
    expected['release_support/reviewed-source.json'] = digest(raw)
    seen = set()
    with tarfile.open(root / ARCHIVE, 'r:gz') as archive:
        for entry in archive:
            if not entry.isfile() or entry.name not in expected or entry.name in seen:
                raise RuntimeError('Unexpected or duplicate archive member: ' + entry.name)
            if digest(archive.extractfile(entry).read()) != expected[entry.name]:
                raise RuntimeError('Source hash mismatch: ' + entry.name)
            seen.add(entry.name)
    if seen != set(expected):
        raise RuntimeError('Archive inventory incomplete.')
    return len(seen)
