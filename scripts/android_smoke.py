"""Run against the emulator and local API. Creates a synthetic QA account/booking."""
import subprocess
import time
import re
import sys
import uuid
import xml.etree.ElementTree as ET
from pathlib import Path
ADB = '/Users/miku0027/Library/Android/sdk/platform-tools/adb'
ROOT=Path(__file__).resolve().parents[1]

def adb(*args):
    return subprocess.check_output([ADB,*args],text=True).strip()

def nodes():
    adb('shell','uiautomator','dump','/sdcard/repaido-qa.xml')
    return ET.fromstring(adb('shell','cat','/sdcard/repaido-qa.xml'))

def bounds(node):
    x1,y1,x2,y2=map(int,re.findall(r'\d+',node.get('bounds','')))
    return (x1+x2)//2,(y1+y2)//2

def tap(text, field=False):
    root=nodes()
    for n in root.iter('node'):
        matches = n.get('text')==text or n.get('content-desc')==text
        if field:
            matches = n.get('class')=='android.widget.EditText' and any(c.get('text')==text for c in n.iter('node'))
        if matches:
            x,y=bounds(n); adb('shell','input','tap',str(x),str(y));time.sleep(.5);return
    raise AssertionError(f'Control not found: {text}; visible='+str([n.get('text') for n in root.iter('node') if n.get('text')]))

def enter(label,value):
    tap(label,field=True);adb('shell','input','text',value.replace(' ','%s'));adb('shell','input','keyevent','4');time.sleep(.4)

def snap(name):
    adb('shell','screencap','-p','/sdcard/repaido-qa.png');adb('pull','/sdcard/repaido-qa.png',str(ROOT/'docs'/'screenshots'/f'{name}.png'))

def has(text):
    return any(text in n.get('text','') for n in nodes().iter('node'))

if __name__=='__main__':
    stage=sys.argv[1]
    if stage=='book':
        enter('What needs a little care?','AC service')
        tap('View');tap('Choose a time')
        assert has('Choose an arrival time')
        snap('schedule')
        root=nodes()
        times=[n.get('text') for n in root.iter('node') if re.fullmatch(r'\d{1,2}:\d{2} [AP]M',n.get('text',''))]
        tap(times[0]);tap('Continue')
        enter('Flat, building & street','QA Flat 12 Lake Road Indiranagar')
        enter('Mobile number','9876543210')
        tap('Review booking');snap('review');tap('Sign in to continue')
        email=f'qa-{uuid.uuid4().hex[:8]}@example.com'
        (ROOT/'backend'/'.qa-email').write_text(email)
        enter('Your name','QA Customer');enter('Email address',email);enter('Password','QATestPassword123')
        tap('Create account');time.sleep(1)
        tap('Request booking · ₹599');time.sleep(1)
        assert has('One less thing to do.')
        tap('View my booking');assert has('Request received'.upper());snap('booking')
        print('PASS: Android search → service → slot → address → account → saved booking',flush=True)
    elif stage=='cancel':
        tap('Cancel');assert has('Cancel this booking?');tap('Cancel booking');time.sleep(1)
        assert has('CANCELLED');snap('cancelled')
        tap('You');tap('Sign out');time.sleep(1)
        assert has('Home, handled.')
        print('PASS: Android cancellation → cancelled status → logout',flush=True)
    elif stage=='inspect':
        print([(n.get('text') or n.get('content-desc'),n.get('bounds')) for n in nodes().iter('node') if n.get('text') or n.get('content-desc')])
