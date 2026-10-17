"""Verify the exact reviewed content, independent of local gzip versions."""
import hashlib
import json
from pathlib import Path
import tarfile

COMMIT = '36bb5d925305ab4046e08d4dae7372058b1c0a41'
MANIFEST_HASH = '00aa3ae5108dd029db47a5a7721e0487311cd562a02edaa3bc5c56e8fe5cc267'
CONFIG_HASH = '9184cb52efa34afa4d6a6427b363f327b59432d250fedcfbc2ca27a517cefeff'
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
