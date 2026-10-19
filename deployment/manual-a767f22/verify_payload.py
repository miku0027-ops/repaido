"""Verify the exact reviewed content, independent of local gzip versions."""
import hashlib
import json
from pathlib import Path
import tarfile

COMMIT = 'a767f224cba32b60f47b0cd00ae86300c06e354a'
MANIFEST_HASH = 'ce969dbc9d9c9c70e89180490945c0e2fa35f20fb700687c9b295dcceec70dea'
CONFIG_HASH = '54bc9bb8e64c1d2f5406f3bdc6fd276833238b6b9a200b64b2c5534ce4f21e35'
ARCHIVE = 'repaido-a767f224cba3-index-gated-source.tar.gz'

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
