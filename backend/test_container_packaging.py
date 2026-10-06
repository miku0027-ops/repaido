"""The deploy image must contain every local module its packaged code imports."""
import ast
import shlex
from pathlib import Path


def test_backend_container_packages_its_local_import_dependencies():
    root=Path(__file__).parent
    packaged=set()
    for line in (root/'Dockerfile').read_text().splitlines():
        tokens=shlex.split(line)
        if tokens and tokens[0]=='COPY':
            packaged.update(name for name in tokens[1:-1] if name.endswith('.py'))
    assert 'main.py' in packaged
    missing=[]
    for name in sorted(packaged):
        for node in ast.walk(ast.parse((root/name).read_text(),filename=name)):
            if isinstance(node,ast.Import):modules=[alias.name for alias in node.names]
            elif isinstance(node,ast.ImportFrom) and node.module:modules=[node.module]
            else:continue
            for module in modules:
                local=module.split('.')[0]+'.py'
                if (root/local).is_file() and local not in packaged:missing.append((name,local))
    assert not missing,f'Container COPY omits local runtime dependencies: {missing}'
