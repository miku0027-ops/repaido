"""Build an evidence-labelled catalogue without importing or executing app code.

The catalogue is source evidence, never a claim about deployment or traffic.
Only known source directories are inspected. Secrets, database files, customer
records, environment files and generated dependencies are never read.
"""
import ast
import hashlib
import json
import os
import re
import subprocess
import time
from collections import defaultdict
from pathlib import Path


def identifier(*parts):
    return ':'.join(str(part) for part in parts)


def literal(node):
    return node.value if isinstance(node, ast.Constant) and isinstance(node.value, str) else None


def call_name(node):
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return call_name(node.value) + '.' + node.attr
    return ''


class HideStrings(ast.NodeTransformer):
    def visit_Constant(self, node):
        if isinstance(node.value, (str, bytes)):
            return ast.copy_location(ast.Constant(value='[string redacted]'), node)
        return node


class Catalog:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.nodes = {}
        self.edges = {}
        self.sources = {}
        self.notes = []
        self.analyzed_at = time.time()
        self.revision = 'unknown'
        self.dirty = None
        try:
            self.revision = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=self.root,
                text=True, capture_output=True, timeout=3, check=True).stdout.strip()
            self.dirty = bool(subprocess.run(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=self.root,
                text=True, capture_output=True, timeout=3, check=True).stdout.strip())
        except (OSError, subprocess.SubprocessError):
            pass
        if self.revision == 'unknown' and re.fullmatch(r'[0-9a-f]{40}', os.getenv('ENGINEERING_SOURCE_REVISION', '')):
            self.revision = os.environ['ENGINEERING_SOURCE_REVISION']
        self.scan()

    def node(self, key, label, kind, layer, **kw):
        self.nodes.setdefault(key, dict(id=key, label=label, kind=kind, layer=layer,
            evidence=kw.pop('evidence', 'source'), status='unverified', **kw))
        return key

    def edge(self, source, target, label, file='', line=0, evidence='source'):
        key = hashlib.sha256(f'{source}|{target}|{label}'.encode()).hexdigest()[:20]
        self.edges[key] = dict(id=key, source=source, target=target, label=label,
            evidence=evidence, file=file, line=line)

    def scan(self):
        backend = self.root / 'backend'
        paths = [p for p in sorted(backend.glob('*.py')) if not p.name.startswith('test_') and not p.is_symlink()]
        modules = {p.stem for p in paths}
        functions = {}
        trees = {}
        for path in paths:
            relative = path.relative_to(self.root).as_posix()
            try:
                tree = ast.parse(path.read_text())
            except (SyntaxError, UnicodeError):
                self.notes.append(f'Could not parse {relative}.')
                continue
            trees[path.stem] = tree
            router_prefixes = defaultdict(list)
            for binding in ast.walk(tree):
                if isinstance(binding, ast.Assign) and isinstance(binding.value, ast.Call) and call_name(binding.value.func).endswith('APIRouter'):
                    prefix = next((literal(k.value) for k in binding.value.keywords if k.arg == 'prefix'), '')
                    if prefix is None:
                        self.notes.append(f'Dynamic router prefix in {relative}:{binding.lineno} was not resolved.')
                    for target in binding.targets:
                        if isinstance(target, ast.Name):
                            router_prefixes[target.id].append((binding.lineno, prefix))
            key = self.node('module:' + path.stem, path.stem.replace('_', ' '), 'module', 'application',
                file=relative, line=1, module=path.stem, functions=[], routes=[])
            self.sources[key] = (relative, None)
            for entry in ast.walk(tree):
                if isinstance(entry, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    functions[(path.stem, entry.name)] = entry
                    self.nodes[key]['functions'].append({'name': entry.name, 'line': entry.lineno,
                        'calls': sorted({call_name(c.func) for c in ast.walk(entry) if isinstance(c, ast.Call)})[:100]})
                    function_id = identifier('function', path.stem, entry.lineno, entry.name)
                    self.node(function_id, entry.name + '()', 'code-function', 'application', file=relative,
                        line=entry.lineno, module=path.stem, handler=entry.name)
                    self.sources[function_id] = (relative, entry.lineno)
                    self.edge(key, function_id, 'defines function', relative, entry.lineno)
                if isinstance(entry, (ast.Import, ast.ImportFrom)):
                    targets = [entry.module.split('.')[0]] if isinstance(entry, ast.ImportFrom) and entry.module else [v.name.split('.')[0] for v in getattr(entry, 'names', [])]
                    for target in targets:
                        if target in modules and target != path.stem:
                            self.edge(key, 'module:' + target, 'imports', relative, entry.lineno)
            for entry in ast.walk(tree):
                if not isinstance(entry, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    continue
                for decorator in entry.decorator_list:
                    if not isinstance(decorator, ast.Call) or not isinstance(decorator.func, ast.Attribute):
                        continue
                    verb = decorator.func.attr.upper()
                    route = literal(decorator.args[0]) if decorator.args else None
                    if verb not in {'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'WEBSOCKET'} or not route or not route.startswith('/'):
                        continue
                    prefixes = [item for item in router_prefixes.get(call_name(decorator.func.value), []) if item[0] <= decorator.lineno]
                    if prefixes:
                        prefix = sorted(prefixes)[-1][1]
                        if prefix is None:
                            continue
                        route = prefix + route
                    route_id = identifier('route', path.stem, verb, route)
                    self.node(route_id, f'{verb} {route}', 'endpoint', 'application', file=relative,
                        line=entry.lineno, module=path.stem, method=verb, route=route, handler=entry.name)
                    self.nodes[key]['routes'].append(route_id)
                    self.sources[route_id] = (relative, entry.lineno)
                    self.edge(key, route_id, 'declares handler', relative, entry.lineno)
                    self.edge(route_id, identifier('function', path.stem, entry.lineno, entry.name), 'handler', relative, entry.lineno)
                    for call in ast.walk(entry):
                        if not isinstance(call, ast.Call):
                            continue
                        name = call_name(call.func)
                        target_module = name.split('.')[0]
                        if target_module in modules and target_module != path.stem:
                            self.edge(route_id, 'module:' + target_module, 'calls in handler', relative, call.lineno)
            # Literal collection references only; dynamic collection names remain unknown.
            for entry in ast.walk(tree):
                if not isinstance(entry, ast.Call) or not entry.args:
                    continue
                name = call_name(entry.func)
                value = literal(entry.args[0])
                is_collection = name.rsplit('.', 1)[-1] in {'fs_collection', 'fs_doc', 'collection'}
                # 'u' is the repository's unit-of-work convention. It is an
                # inference, since Python allows a different receiver at runtime.
                is_store = (name.startswith(('u.', 'store.', 'core.store.', 'ops.store.')) and name.rsplit('.', 1)[-1] in {'get', 'put', 'list', 'query', 'find', 'delete', 'create', 'all'})
                if value and (is_collection or is_store) and re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{1,100}', value):
                    collection = 'ops_' + value if is_store else value
                    evidence = 'inferred' if is_store else 'source'
                    target = self.node('collection:' + collection, collection, 'collection', 'data',
                        file=relative, line=entry.lineno, evidence=evidence)
                    self.edge('module:' + path.stem, target, 'store collection (receiver inferred)' if is_store else 'references collection', relative, entry.lineno, evidence)
            # Match well-known provider hosts, never a URL path, key or value.
            providers = {'api.razorpay.com': 'Razorpay', 'api.cloudflare.com': 'Cloudflare Stream',
                'routes.googleapis.com': 'Google Routes', 'fcm.googleapis.com': 'Firebase Cloud Messaging'}
            content = path.read_text()
            for host, title in providers.items():
                if 'https://' + host in content:
                    target = self.node('provider:' + host, title, 'provider', 'infrastructure', file=relative, line=1)
                    self.edge('module:' + path.stem, target, 'provider URL in source', relative, 1)
        self.infrastructure()
        self.frontends()
        self.edges = {k: e for k, e in self.edges.items() if e['source'] in self.nodes and e['target'] in self.nodes}
        self.digest = hashlib.sha256(json.dumps(self.graph(), sort_keys=True).encode()).hexdigest()[:16]

    def infrastructure(self):
        hosting = self.root / 'firebase.json'
        if hosting.exists():
            data = json.loads(hosting.read_text()).get('hosting', {})
            hosts = data if isinstance(data, list) else [data]
            for index, host in enumerate(hosts):
                h = self.node(f'hosting:{index}', 'Firebase Hosting', 'hosting', 'infrastructure', file='firebase.json', line=1)
                for rule in host.get('rewrites', []):
                    run = rule.get('run', {})
                    if not run.get('serviceId'):
                        continue
                    s = self.node('service:' + run['serviceId'], run['serviceId'], 'service', 'infrastructure',
                        region=run.get('region', 'unknown'), file='firebase.json', line=1)
                    self.edge(h, s, 'routes ' + rule['source'], 'firebase.json', 1)
        # Container entrypoint and separately declared work entrypoints.
        for name, module in [('repaido-api', 'main'), ('repaido-work-api', 'work_service'), ('repaido-work-worker', 'work_worker')]:
            if 'module:' + module in self.nodes:
                s = self.node('service:' + name, name, 'service', 'infrastructure', file='backend/' + module + '.py', line=1)
                self.edge(s, 'module:' + module, 'declared entrypoint', 'backend/' + module + '.py', 1)
        for path in sorted((self.root / 'infra').rglob('*.tf')):
            if path.is_symlink() or '.terraform' in path.parts:
                continue
            text = path.read_text()
            relative = path.relative_to(self.root).as_posix()
            matches = list(re.finditer(r'resource\s+"([\w]+)"\s+"([\w]+)"\s*\{', text))
            for i, match in enumerate(matches):
                resource, name = match.groups()
                key = self.node('terraform:' + resource + '.' + name, f'{resource.removeprefix("google_")} · {name}',
                    'network' if 'compute' in resource else 'resource', 'infrastructure', file=relative,
                    line=text[:match.start()].count('\n') + 1)
                section = text[match.end(): matches[i + 1].start() if i + 1 < len(matches) else len(text)]
                for target_type, target_name in re.findall(r'\b(google_\w+)\.(\w+)\.', section):
                    self.edge(key, 'terraform:' + target_type + '.' + target_name, 'declared reference', relative,
                        text[:match.start()].count('\n') + 1)
        for name, probe in [('Cloud Build', 'cloudbuild.yaml'), ('Firebase rules', 'firestore.rules')]:
            if (self.root / probe).is_file():
                self.node('config:' + probe, name, 'config', 'infrastructure', file=probe, line=1)

    def frontends(self):
        for name, folder in [('Customer & business web', 'web/src'), ('Android apps', 'android')]:
            if not (self.root / folder).exists():
                continue
            key = self.node('client:' + folder, name, 'client', 'application', file=folder, line=1)
            if folder == 'web/src' and 'hosting:0' in self.nodes:
                self.edge('hosting:0', key, 'serves web build', 'firebase.json', 1)
        # API literals link only exact matches. Template/dynamic paths are not guessed.
        route_by_path = defaultdict(list)
        for node in self.nodes.values():
            if node['kind'] == 'endpoint':
                route_by_path[node['route']].append(node['id'])
        for path in sorted((self.root / 'web/src').rglob('*')):
            if path.suffix not in {'.ts', '.tsx'} or path.is_symlink():
                continue
            relative = path.relative_to(self.root).as_posix()
            text = path.read_text()
            for match in re.finditer(r'''["'`](/(?:api/)?[^"'`\s${}?#]+)["'`]''', text):
                url = match.group(1).removeprefix('/api')
                for route_id in route_by_path.get(url, []):
                    self.edge('client:web/src', route_id, 'API path literal (method unverified)', relative, text[:match.start()].count('\n') + 1)

    def graph(self):
        return {'nodes': list(self.nodes.values()), 'edges': list(self.edges.values()),
            'revision': self.revision, 'source_dirty': self.dirty, 'analyzed_at': self.analyzed_at, 'notes': self.notes,
            'limitations': ['Source relationships do not prove deployment or runtime execution.',
                'Dynamic imports, generated endpoints and computed collection names require runtime instrumentation.',
                'Source view shows this checkout; compare its revision with deployed revisions before debugging.']}

    def source(self, node_id):
        if node_id not in self.sources:
            return None
        relative, line = self.sources[node_id]
        path = (self.root / relative).resolve()
        if not path.is_relative_to(self.root / 'backend') or path.is_symlink():
            return None
        tree = ast.parse(path.read_text())
        selected = next((n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.lineno == line), tree)
        rendered = ast.unparse(HideStrings().visit(selected)).splitlines()
        return {'file': relative, 'line': line or 1, 'revision': self.revision,
            'code': '\n'.join(rendered[:240]), 'truncated': len(rendered) > 240,
            'redaction': 'All string literals are redacted. Line numbers refer to the original source.'}
