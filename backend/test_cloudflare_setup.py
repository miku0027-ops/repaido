"""Credential propagation and setup failure recovery without external writes."""
import importlib.util,json
from pathlib import Path
from types import SimpleNamespace
import pytest

spec=importlib.util.spec_from_file_location('stream_setup',Path(__file__).resolve().parents[1]/'scripts/configure-cloudflare-stream.py')
setup=importlib.util.module_from_spec(spec);spec.loader.exec_module(setup)

@pytest.mark.parametrize('storage_fails',[False,True])
def test_credentials_use_secret_stdin_and_failed_key_storage_is_compensated(monkeypatch,capsys,storage_fails):
    commands=[];provider=[]
    def gcloud(*args,input=None):
        commands.append((args,input))
        if args[:3]==('run','services','describe'):return args[3]+'@example.iam.gserviceaccount.com'
        if storage_fails and args[:4]==('secrets','versions','add','cloudflare-stream-signing-pem'):raise RuntimeError('Storage unavailable')
        return ''
    class Response:
        def __init__(self,data):self.data=json.dumps(data).encode()
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def read(self):return self.data
    def request(req,**kwargs):
        if isinstance(req,str):return Response({'ready':True})
        provider.append((req.method,req.full_url))
        return Response({'success':True,'result':{'id':'b'*32,'pem':'fixture-private-pem'}})
    monkeypatch.setattr(setup,'gcloud',gcloud)
    monkeypatch.setattr(setup.getpass,'getpass',lambda *args:'fixture-provider-token')
    monkeypatch.setattr(setup.subprocess,'run',lambda *args,**kwargs:SimpleNamespace(returncode=0,stderr=''))
    monkeypatch.setattr(setup.urllib.request,'urlopen',request)
    args=SimpleNamespace(account='a'*32,project='repaido',region='us-central1')
    if storage_fails:
        with pytest.raises(RuntimeError,match='Storage unavailable'):setup.configure(args)
        assert provider[-1][0]=='DELETE'
        assert not any(cmd[:3]==('run','services','update') for cmd,_ in commands)
    else:
        setup.configure(args)
        inputs={cmd[3]:value for cmd,value in commands if cmd[:3]==('secrets','versions','add')}
        assert inputs=={'cloudflare-stream-signing-pem':'fixture-private-pem','cloudflare-stream-api-token':'fixture-provider-token'}
        updates={cmd[3]:cmd for cmd,_ in commands if cmd[:3]==('run','services','update')}
        assert 'CLOUDFLARE_STREAM_SIGNING_PEM=cloudflare-stream-signing-pem:latest' in ','.join(updates['repaido-api'])
        assert 'SIGNING_PEM' not in ','.join(updates['repaido-work-worker'])
        assert all('fixture-provider-token' not in str(cmd) and 'fixture-private-pem' not in str(cmd) for cmd,_ in commands)
    output=capsys.readouterr()
    assert 'fixture-provider-token' not in output.out+output.err and 'fixture-private-pem' not in output.out+output.err
