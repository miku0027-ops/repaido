"""Prepare the previously reviewed release from a clean pinned Git checkout."""
import gzip
import io
from pathlib import Path
import subprocess
import sys
import tarfile
from verify_payload import ARCHIVE, COMMIT, digest, manifest, verify

def main():
    if len(sys.argv) != 2:
        raise RuntimeError('Usage: python3 prepare.py PATH_TO_CLEAN_REPOSITORY')
    repo = Path(sys.argv[1]).resolve()
    out = Path(__file__).resolve().parent
    def git(*args):
        return subprocess.check_output(['git', '-C', str(repo), *args])
    if git('rev-parse', 'HEAD').decode().strip() != COMMIT or git('status', '--porcelain'):
        raise RuntimeError('Source checkout must be clean at the pinned release.')
    raw, document = manifest(out)
    names = sorted(name for name in document['files'] if not name.startswith('release_support/'))
    snapshot = git('archive', '--format=tar', COMMIT, '--', *names)
    files = {}
    modes = {}
    with tarfile.open(fileobj=io.BytesIO(snapshot), mode='r:') as archive:
        for entry in archive:
            if entry.isdir(): continue
            if not entry.isfile() or entry.name not in names or entry.name in files:
                raise RuntimeError('Unexpected Git archive entry.')
            files[entry.name] = archive.extractfile(entry).read()
            modes[entry.name] = entry.mode
    files['release_support/index_gate.py'] = (out / 'index_gate.py').read_bytes()
    files['release_support/baseline-firestore.indexes.json'] = (out / 'baseline-firestore.indexes.json').read_bytes()
    if set(files) != set(document['files']):
        raise RuntimeError('Prepared inventory differs from reviewed source.')
    for name, data in files.items():
        if digest(data) != document['files'][name]:
            raise RuntimeError('Prepared source differs from reviewed source: ' + name)
    files['release_support/reviewed-source.json'] = raw
    with (out / ARCHIVE).open('wb') as target:
        with gzip.GzipFile(filename='', mode='wb', fileobj=target, mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode='w') as archive:
                for name, data in sorted(files.items()):
                    entry = tarfile.TarInfo(name)
                    entry.size = len(data)
                    entry.mode = modes.get(name, 0o644)
                    entry.mtime = 0
                    archive.addfile(entry, io.BytesIO(data))
    print('Verified exact reviewed release:', COMMIT, 'files:', verify(out))

if __name__ == '__main__': main()
