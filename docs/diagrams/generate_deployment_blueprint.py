"""Render the checked-in Repaido deployment design as a vector PDF.

This is documentation generation only. It never calls gcloud or deploys code.
The step lists and Hosting routes are read from the repository configuration.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import yaml
from reportlab.lib import colors
from reportlab.lib.pagesizes import A3, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / 'docs' / 'REPAIDO_DEPLOYMENT_BLUEPRINT.pdf'
W, H = landscape(A3)

NAVY = colors.HexColor('#132B5B')
DEEP = colors.HexColor('#0C1938')
BLUE = colors.HexColor('#1755A5')
TEAL = colors.HexColor('#0B6D65')
GOLD = colors.HexColor('#8A5A08')
RED = colors.HexColor('#9A3144')
INK = colors.HexColor('#152642')
MUTED = colors.HexColor('#4C5E79')
LINE = colors.HexColor('#CED9E8')
BG = colors.HexColor('#F5F8FC')
PALE_BLUE = colors.HexColor('#EAF2FC')
PALE_TEAL = colors.HexColor('#E8F6F2')
PALE_GOLD = colors.HexColor('#FFF4E1')
PALE_RED = colors.HexColor('#FBEDEF')
WHITE = colors.white

FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
pdfmetrics.registerFont(TTFont('DejaVu', FONT))
pdfmetrics.registerFont(TTFont('DejaVu-Bold', BOLD))
pdfmetrics.registerFontFamily('DejaVu', normal='DejaVu', bold='DejaVu-Bold')

CONFIGS = {
    target: yaml.safe_load((ROOT / name).read_text())
    for target, name in {
        'full': 'cloudbuild.yaml', 'web': 'cloudbuild-web.yaml',
        'api': 'cloudbuild-api.yaml', 'rules': 'cloudbuild-rules.yaml',
        'console': 'engineering/cloudbuild.yaml',
    }.items()
}
STEPS = {target: [step['id'] for step in config['steps']] for target, config in CONFIGS.items()}
ROUTES = json.loads((ROOT / 'firebase.json').read_text())['hosting']['rewrites']
COMMIT = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
OBSERVED_AT = '14 Oct 2026, 01:02 UTC'
TOTAL_PAGES = 9

assert STEPS['full'] == [
    'require-explicit-release', 'check-build-history-access',
    'check-firestore-rules-access', 'backend-tests', 'web-tests-and-build',
    'build-api', 'push-api', 'deploy-candidate', 'await-release-turn',
    'deploy-firestore-rules', 'deploy-work-services', 'promote-backend',
    'promote-work-services', 'deploy-firebase-hosting', 'verify-hosting-release',
]
assert STEPS['web'] == [
    'require-explicit-release', 'check-build-history-access',
    'web-tests-and-build', 'await-release-turn', 'deploy-firebase-hosting',
    'verify-selective-release',
]
assert STEPS['api'] == [
    'require-explicit-release', 'check-build-history-access', 'backend-tests',
    'build-api', 'push-api', 'deploy-candidate', 'await-release-turn',
    'deploy-work-services', 'promote-backend', 'promote-work-services',
    'verify-selective-release',
]
assert STEPS['rules'] == [
    'require-explicit-release', 'check-build-history-access',
    'check-firestore-rules-access', 'firestore-rules-tests',
    'await-release-turn', 'deploy-firestore-rules',
]
assert STEPS['console'] == ['authorize-and-test', 'build-console', 'push-console']
assert CONFIGS['full']['substitutions']['_RELEASE_APPROVED'] == 'false'
assert all(CONFIGS[t]['substitutions']['_RELEASE_APPROVED'] == 'false' for t in CONFIGS)
assert next(r for r in ROUTES if r['source'] == '/api/**')['run']['serviceId'] == 'repaido-api'
assert next(r for r in ROUTES if r['source'] == '/api/repaidians/work/**')['run']['serviceId'] == 'repaido-work-api'


def rect(c, x, t, w, h, fill, stroke=None, radius=16, lw=1):
    c.setLineWidth(lw)
    c.setFillColor(fill)
    c.setStrokeColor(stroke or fill)
    c.roundRect(x, H - t - h, w, h, radius, fill=1, stroke=bool(stroke))


def text(c, label, x, t, size=12, color=INK, bold=False):
    c.setFont('DejaVu-Bold' if bold else 'DejaVu', size)
    c.setFillColor(color)
    c.drawString(x, H - t - size, label)


def para(c, label, x, t, w, size=11, color=MUTED, bold=False, leading=None):
    style = ParagraphStyle(
        'body', fontName='DejaVu-Bold' if bold else 'DejaVu', fontSize=size,
        leading=leading or size * 1.43, textColor=color, spaceAfter=0,
        allowWidows=0, allowOrphans=0,
    )
    block = Paragraph(label, style)
    _, height = block.wrap(w, 1000)
    block.drawOn(c, x, H - t - height)
    return height


def pill(c, label, x, t, w, fill=PALE_BLUE, fg=NAVY, h=31):
    rect(c, x, t, w, h, fill, radius=h / 2)
    text(c, label, x + 13, t + (h - 11) / 2 - 1, 10.5, fg, True)


def card(c, x, t, w, h, title, body='', accent=BLUE, fill=WHITE,
         title_size=13.5, body_size=10.5, badge=None):
    rect(c, x + 3, t + 4, w, h, LINE, radius=14)
    rect(c, x, t, w, h, fill, LINE, radius=14)
    rect(c, x, t + 11, 4, h - 22, accent, radius=2)
    offset = 17
    if badge:
        text(c, badge, x + offset, t + 10, 9, accent, True)
        offset_y = 28
    else:
        offset_y = 14
    title_h = para(c, title, x + offset, t + offset_y, w - 32,
                   title_size, INK, True, leading=title_size * 1.2)
    if body:
        para(c, body, x + offset, t + offset_y + title_h + 8, w - 33,
             body_size, MUTED)


def arrow(c, x1, t1, x2, t2, color=BLUE, width=2, dashed=False):
    from math import atan2, cos, sin
    c.setStrokeColor(color)
    c.setFillColor(color)
    c.setLineWidth(width)
    c.setDash(5, 4) if dashed else c.setDash()
    c.line(x1, H - t1, x2, H - t2)
    c.setDash()
    a = atan2(-(t2 - t1), x2 - x1)
    p = c.beginPath()
    p.moveTo(x2, H - t2)
    p.lineTo(x2 - 8 * cos(a - .55), H - t2 - 8 * sin(a - .55))
    p.lineTo(x2 - 8 * cos(a + .55), H - t2 - 8 * sin(a + .55))
    p.close()
    c.drawPath(p, fill=1, stroke=0)


def line(c, x1, t1, x2, t2, color=LINE, width=1):
    c.setStrokeColor(color)
    c.setLineWidth(width)
    c.line(x1, H - t1, x2, H - t2)


def header(c, number, title, subtitle, section):
    c.setFillColor(BG)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    rect(c, 0, 0, W, 13, NAVY, radius=0)
    text(c, 'REPAIDO  /  ENGINEERING BLUEPRINT', 48, 31, 11, BLUE, True)
    text(c, section.upper(), W - 284, 31, 10, MUTED, True)
    text(c, title, 48, 55, 28, NAVY, True)
    para(c, subtitle, 49, 97, W - 98, 11.5, MUTED)
    line(c, 48, 129, W - 48, 129)
    footer(c, number)


def footer(c, number):
    line(c, 48, 796, W - 48, 796)
    text(c, f'Source revision {COMMIT[:12]}  •  14 Oct 2026  •  Code-derived design + public health checks',
         48, 806, 8.5, MUTED)
    text(c, f'{number:02d} / {TOTAL_PAGES:02d}', W - 103, 806, 9, BLUE, True)


def page_one(c):
    c.setFillColor(BG)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    rect(c, 0, 0, W, 326, NAVY, radius=0)
    rect(c, 820, 24, 300, 300, DEEP, radius=56)
    pill(c, 'SYSTEM DESIGN  /  RELEASE ENGINEERING', 52, 49, 323,
         colors.HexColor('#263F76'), WHITE)
    text(c, 'Repaido platform', 52, 102, 39, WHITE, True)
    text(c, 'architecture & delivery', 52, 159, 39, WHITE, True)
    para(c, 'A detailed HLD and LLD of apps, APIs, data, events, sensitive flows, '
         'observability, and selective production delivery. Includes the source API route catalog.',
         54, 237, 700, 15, colors.HexColor('#DDE8FF'))
    text(c, 'REVIEWED SOURCE', 845, 69, 10, colors.HexColor('#B9CFFF'), True)
    para(c, COMMIT, 845, 96, 245, 11, WHITE)
    text(c, 'ENVIRONMENT', 845, 164, 10, colors.HexColor('#B9CFFF'), True)
    para(c, 'Google Cloud project: repaido<br/>Region: us-central1',
         845, 188, 245, 12, WHITE)

    labels = [
        ('WEB', 'Firebase Hosting', 'Customer, worker and admin SPA routes', BLUE),
        ('API', 'Cloud Run × 3', 'Main API, public work API, private worker', TEAL),
        ('RULES', 'Firestore Rules', 'Emulator-tested security release', GOLD),
        ('CONSOLE', 'Separate Cloud Run', 'Engineer-only architecture console', NAVY),
    ]
    for i, (tag, name, body, accent) in enumerate(labels):
        x = 48 + i * 279
        card(c, x, 365, 258, 158, name, body, accent, WHITE, 16, 11, badge=tag)

    rect(c, 48, 552, W - 96, 176, WHITE, LINE, radius=18)
    text(c, f'PUBLICLY OBSERVED LIVE STATE  ·  {OBSERVED_AT}', 68, 572, 11, BLUE, True)
    line(c, 68, 605, W - 68, 605)
    live = [
        ('HOSTING', 'b421e09592a7', 'Build 4d2d4a26…', BLUE),
        ('MAIN + WORK API', 'Same build as Hosting', 'Health endpoints: OK', TEAL),
        ('ENGINEERING CONSOLE', 'f7446fcaae38', 'Four collectors: connected', NAVY),
    ]
    for i, (label, first, second, accent) in enumerate(live):
        x = 70 + 355 * i
        if i:
            line(c, x - 18, 620, x - 18, 705)
        text(c, label, x, 625, 9.5, accent, True)
        text(c, first, x, 648, 15, INK, True)
        text(c, second, x, 676, 11, MUTED)
    para(c, 'The selective pipelines are present in this checkout. Compared with the live b421e095… site, '
         'this pending checkout spans multiple components, so its next customer release selects FULL. '
         'This PDF is not a complete cloud inventory export.',
         50, 747, W - 100, 10.5, MUTED)
    footer(c, 1)
    c.showPage()


def page_two(c):
    header(c, 2, 'How a release target is chosen',
           'The planner compares a reviewed commit with an explicitly supplied deployed baseline; it does not infer production from HEAD~1.',
           'Decision plane')
    preflight = [
        ('1', 'Explicit request', 'Manual batch; audit live triggers'),
        ('2', 'Pinned commit', 'HEAD equals 40-character SHA'),
        ('3', 'Config + plan', 'Generated YAML checked; diff classified'),
        ('4', 'Clean checkout', 'No uncommitted source'),
        ('5', 'Source inventory', 'Actual gcloud upload list'),
        ('6', 'No active build', 'global + us-central1'),
    ]
    for i, (num, title, body) in enumerate(preflight):
        x = 48 + i * 185
        card(c, x, 153, 167, 105, title, body, BLUE, WHITE, 11.8, 9.4, badge=num)
        if i < 5:
            arrow(c, x + 170, 205, x + 183, 205, BLUE, 1.5)

    text(c, 'PATH CLASSIFIER', 48, 291, 11, BLUE, True)
    line(c, 48, 319, W - 48, 319)
    rows = [
        ('web/  ·  firebase.json  ·  .firebaserc', 'WEB', 'cloudbuild-web.yaml', BLUE, PALE_BLUE),
        ('backend/', 'API', 'cloudbuild-api.yaml', TEAL, PALE_TEAL),
        ('firestore.rules  ·  rules tests', 'RULES', 'cloudbuild-rules.yaml', GOLD, PALE_GOLD),
        ('Multiple targets  ·  unknown build input', 'FULL', 'cloudbuild.yaml', NAVY, PALE_BLUE),
        ('engineering/ only', 'CONSOLE', 'engineering/release.py', BLUE, PALE_BLUE),
        ('docs/  ·  android/ only', 'NONE', 'No customer pipeline', MUTED, WHITE),
    ]
    for i, (source, target, pipeline, accent, pale) in enumerate(rows):
        t = 330 + i * 64
        rect(c, 48, t, 1095, 55, WHITE, LINE, radius=12)
        text(c, source, 66, t + 17, 11, INK)
        arrow(c, 539, t + 27, 598, t + 27, accent, 2)
        pill(c, target, 614, t + 12, 116, pale, accent)
        text(c, pipeline, 762, t + 17, 11.5, accent, True)
    rect(c, 48, 729, W - 96, 48, PALE_GOLD, radius=11)
    para(c, '<b>Fail closed:</b> firestore.indexes.json is refused because no index publication step exists. '
         'Console and Android changes require separate release workflows; customer releases do not publish either.',
         65, 739, W - 130, 10.2, INK)
    c.showPage()


def page_three(c):
    header(c, 3, 'The full production pipeline',
           'Fifteen Cloud Build steps, in the exact order recorded in cloudbuild.yaml. The full batch is used for overlapping or unfamiliar changes.',
           'Full batch')
    descriptions = [
        ('Manual release gate', 'Requires _RELEASE_APPROVED=true and pinned commit.', BLUE),
        ('Build history access', 'Checks release-order permissions.', BLUE),
        ('Rules access', 'Checks existing Rules release + IAM.', BLUE),
        ('Backend tests', 'Python 3.12, Node, SQLite test mode.', TEAL),
        ('Web tests + build', 'Rules emulator, npm tests, Vite, build-info.', TEAL),
        ('Build API image', 'Docker build from backend/.', TEAL),
        ('Push API image', 'Artifact Registry tag = Cloud Build ID.', TEAL),
        ('Main API candidate', 'No-traffic tag; health, Routes, Firestore/media.', GOLD),
        ('Release ordering', 'Waits for older builds from same trigger.', BLUE),
        ('Publish Rules', 'Compile, activate and verify changed Rules.', GOLD),
        ('Work candidates', 'Deploy work API + worker; configure/pause Scheduler.', GOLD),
        ('Promote main API', 'Traffic = verified main revision, 100%.', RED),
        ('Promote work services', 'Traffic = verified work revisions; resume Scheduler.', RED),
        ('Deploy Hosting', 'Firebase Hosting only; SPA build + rewrites.', RED),
        ('Verify public paths', 'Hosting + main/work API share this build ID.', BLUE),
    ]
    assert len(descriptions) == len(STEPS['full'])
    for row in range(5):
        indices = list(range(row * 3, row * 3 + 3))
        if row % 2:
            indices.reverse()
        for col, index in enumerate(indices):
            x = 48 + col * 372
            t = 147 + row * 113
            title, body, accent = descriptions[index]
            card(c, x, t, 350, 89, title, body, accent, WHITE, 12.3, 9.7,
                 badge=f'{index + 1:02d}  /  {STEPS["full"][index]}')
            if row % 2 == 0 and col < 2:
                arrow(c, x + 350, t + 45, x + 371, t + 45, accent, 1.7)
            elif row % 2 and col > 0:
                arrow(c, x, t + 45, x - 21, t + 45, accent, 1.7)
        if row < 4:
            edge = 48 + 2 * 372 + 175 if row % 2 == 0 else 48 + 175
            arrow(c, edge, 147 + row * 113 + 91, edge, 147 + (row + 1) * 113 - 2,
                  BLUE, 1.7)
    rect(c, 48, 726, W - 96, 54, PALE_GOLD, radius=12)
    para(c, '<b>Production change order:</b> Rules → work candidate setup/Scheduler pause → main traffic → '
         'work traffic/Scheduler resume → Hosting. These are separate operations, not one atomic transaction.',
         66, 738, W - 132, 10.5, INK)
    c.showPage()


def lane(c, t, name, accent, pale, columns, subtitle):
    rect(c, 48, t, 1095, 178, WHITE, LINE, radius=17)
    rect(c, 48, t, 150, 178, pale, radius=17)
    text(c, name, 65, t + 22, 17, accent, True)
    para(c, subtitle, 65, t + 54, 116, 10, MUTED)
    count = len(columns)
    left, right = 218, 1128
    gap = 12
    width = (right - left - (count - 1) * gap) / count
    for i, (label, body) in enumerate(columns):
        x = left + i * (width + gap)
        card(c, x, t + 27, width, 122, label, body, accent, WHITE, 10.7, 9.2)
        if i < count - 1:
            arrow(c, x + width + 2, t + 89, x + width + gap - 2, t + 89,
                  accent, 1.5)


def page_four(c):
    header(c, 4, 'Selective pipelines: deploy only what changed',
           'Each lane retains the release gate and ordering check, while skipping unrelated production surfaces.',
           'Scoped builds')
    lane(c, 151, 'WEB', BLUE, PALE_BLUE, [
        ('Gate + history', 'Manual override and build access.'),
        ('Test + build', 'pnpm; npm test; Vite. No Rules emulator.'),
        ('Release turn', 'Same-trigger ordering check.'),
        ('Publish Hosting', 'firebase deploy --only hosting.'),
        ('Verify', 'build-info commit + build ID.'),
    ], '6 Cloud Build steps<br/>No Cloud Run revision')
    lane(c, 348, 'API', TEAL, PALE_TEAL, [
        ('Gate + history', 'Manual override and access.'),
        ('Backend tests', 'Pytest in SQLite test mode.'),
        ('Image', 'Docker build + explicit push.'),
        ('Main candidate', 'No-traffic health + config checks.'),
        ('Work + traffic', 'Work candidates, then main/work promotion.'),
        ('Verify', 'Main and work API build IDs.'),
    ], '11 Cloud Build steps<br/>Three Run services')
    lane(c, 545, 'RULES', GOLD, PALE_GOLD, [
        ('Gate + access', 'Build history and Rules IAM.'),
        ('Emulator', 'Demo project; local Rules tests.'),
        ('Release turn', 'Same-trigger ordering check.'),
        ('Publish', 'Compile, activate and verify Rules.'),
    ], '6 Cloud Build steps<br/>No image or Hosting')
    para(c, '<b>Build IDs after a partial release:</b> Hosting and API IDs can differ. '
         'The web verifier checks Hosting; the API verifier checks main and work API; the Rules publisher verifies the active ruleset.',
         53, 746, W - 105, 10.3, MUTED)
    c.showPage()


def page_five(c):
    header(c, 5, 'Engineering console: independent release',
           'The console has its own source archive, three-step Cloud Build, Cloud Run runtime identity, sign-in checks and promotion.',
           'Console pipeline')
    sequence = [
        ('Resolve engineer accounts', 'Clean commit and no active builds; active Firebase accounts. Unavailable accounts may be deferred.', BLUE),
        ('Preflight cloud access', 'Check Firebase config and Artifact Registry before a paid build.', BLUE),
        ('Stage reviewed source', 'Filtered git archive; per-file SHA-256 manifest; no credentials.', BLUE),
        ('IAM + engineer claims', 'Dedicated read-only runtime role; grant engineer claim.', GOLD),
        ('Build console image', 'Manifest check, console tests, Docker build and push.', TEAL),
        ('Deploy candidate', 'Dedicated Run service; prior service uses no-traffic tag.', GOLD),
        ('Verify candidate', 'Health, live collectors, private API rejection, sign-in UI.', BLUE),
        ('Authorize origins', 'Add returned Run origins to Firebase Auth allowlist.', GOLD),
        ('Promote + reverify', '100% verified revision; check each public origin.', RED),
    ]
    for i, (title, body, accent) in enumerate(sequence):
        row, col = divmod(i, 5)
        if row == 1:
            col = 4 - col
        x = 48 + col * 223
        t = 180 + row * 253
        card(c, x, t, 204, 156, title, body, accent, WHITE, 12.1, 10,
             badge=f'{i + 1:02d}')
        if i < 8:
            if i == 4:
                arrow(c, x + 102, t + 160, x + 102, t + 249, BLUE, 1.8)
            elif i < 4:
                arrow(c, x + 206, t + 78, x + 222, t + 78, BLUE, 1.8)
            else:
                arrow(c, x - 2, t + 78, x - 20, t + 78, BLUE, 1.8)
    rect(c, 48, 696, W - 96, 79, PALE_BLUE, radius=14)
    text(c, 'OBSERVED CONSOLE', 66, 710, 10, BLUE, True)
    para(c, f'Public /health at {OBSERVED_AT} reports revision <b>f7446fcaae38</b>, build <b>5765c997…</b>, '
         'four collectors connected, and engineer account checks passing. '
         'The current selective-release checkout is separate and has not been published to the customer site.',
         66, 733, W - 132, 10.2, INK)
    c.showPage()


def page_six(c):
    header(c, 6, 'Production topology: build plane and serving plane',
           'Solid arrows are serving or delivery paths; dashed arrows represent build/deployment supply.',
           'HLD connectivity')
    rect(c, 48, 151, 1095, 132, PALE_BLUE, radius=16)
    text(c, 'BUILD / DEPLOYMENT PLANE', 68, 164, 10, BLUE, True)
    build_nodes = [
        (68, 'Reviewed Git commit', 'Clean checkout + manual release'),
        (295, 'Cloud Shell operator', 'Planner, inventory, active-build check'),
        (522, 'Cloud Build', 'Target YAML + tests + build ID'),
        (749, 'Artifact Registry', 'API / console images'),
        (976, 'Cloud Run', 'Image revision, candidate, traffic'),
    ]
    for i, (x, title, body) in enumerate(build_nodes):
        card(c, x, 191, 203, 72, title, body, BLUE, WHITE, 10.9, 8.8)
        if i < 4:
            arrow(c, x + 207, 226, x + 224, 226, BLUE, 1.5, dashed=True)
    arrow(c, 625, 265, 408, 341, BLUE, 1.4, dashed=True)

    text(c, 'SERVING / EVENT PLANE', 48, 308, 10, BLUE, True)
    card(c, 48, 343, 198, 110, 'Customer web client', 'Reads SPA; calls /api/* through Hosting.', BLUE, WHITE, 12, 9.8)
    card(c, 305, 343, 200, 110, 'Firebase Hosting', 'repaido.web.app; SPA routes + API rewrites.', BLUE, WHITE, 12, 9.8)
    card(c, 568, 327, 220, 95, 'Main API', 'repaido-api · /api/**', TEAL, WHITE, 12, 9.8)
    card(c, 568, 438, 220, 95, 'Work API', 'repaido-work-api · work/companies/placements', TEAL, WHITE, 12, 9.4)
    card(c, 851, 327, 286, 95, 'Routes + Secret Manager', 'Main candidate requires Routes key readiness.', GOLD, WHITE, 12, 9.8)
    card(c, 851, 438, 286, 95, 'Firestore', 'Operational records for main and work services.', GOLD, WHITE, 12, 9.8)
    arrow(c, 248, 398, 301, 398)
    arrow(c, 508, 388, 563, 375)
    arrow(c, 508, 411, 563, 483)
    arrow(c, 791, 374, 846, 374, TEAL)
    arrow(c, 791, 483, 846, 483, TEAL)
    card(c, 48, 566, 198, 105, 'Cloud Scheduler', 'repaido-work-updates · every minute.', BLUE, WHITE, 12, 9.8)
    card(c, 305, 566, 200, 105, 'Private work worker', 'OIDC caller; POST /internal/work/dispatch.', TEAL, WHITE, 12, 9.4)
    card(c, 568, 566, 220, 105, 'Notifications', 'Worker sends opted-in work updates via FCM.', GOLD, WHITE, 12, 9.8)
    arrow(c, 248, 619, 300, 619)
    arrow(c, 508, 619, 563, 619)
    card(c, 851, 565, 286, 108, 'Engineering console', 'Separate Run service; engineer sign-in; read-only cloud observations.', NAVY, WHITE, 12, 9.5)
    rect(c, 48, 701, 770, 76, WHITE, LINE, radius=12)
    para(c, '<b>Hosting routing:</b> /api/repaidians/work/**, /companies/** and /placements/** → work API; '
         '/api/** → main API; other paths → index.html. Hosting publishes directly from Cloud Build, without an image. '
         'Main API also uses private community media storage.',
         65, 714, 738, 9.7, INK)
    arrow(c, 994, 676, 994, 698, NAVY, 1.5)
    card(c, 851, 701, 286, 76, 'Cloud observations',
         'Asset, Monitoring, Logging, Trace.', NAVY, WHITE, 11.6, 9.1)
    c.showPage()


def page_seven(c):
    header(c, 7, 'Service contracts and trust boundaries',
           'These limits and identities come from the deployment commands; the main API retains other existing runtime settings.',
           'LLD service detail')
    top = [
        ('MAIN API  ·  repaido-api',
         'Existing service required. Same backend image. New candidate uses --no-traffic and a build tag. '
         'Sets REPAIDO_BUILD_ID, Firestore storage mode and the Google Routes secret. '
         'Checks health, routing readiness and durable community media before traffic promotion.', BLUE, PALE_BLUE),
        ('WORK API  ·  repaido-work-api',
         'work_service:app from the same image. Public service; inherits the main runtime identity. '
         '1 CPU · 512 MiB · concurrency 64 · timeout 60 s · min 0 / max 20. '
         'Mail ownership and Cloudflare Stream secrets are removed.', TEAL, PALE_TEAL),
        ('PRIVATE WORKER  ·  repaido-work-worker',
         'work_worker:app from the same image. IAM-protected; the Scheduler caller is granted invoker. '
         '1 CPU · 512 MiB · concurrency 1 · timeout 240 s · min 0 / max 2. '
         'Push enabled; signing-key secrets filtered.', GOLD, PALE_GOLD),
    ]
    for i, (title, body, accent, pale) in enumerate(top):
        card(c, 48 + i * 372, 156, 350, 205, title, body, accent, pale, 13.1, 10.2)
    bottom = [
        ('ENGINEERING CONSOLE',
         'repaido-engineering uses a dedicated read-only identity. Public ingress, but engineering APIs require an engineer account. '
         '1 CPU · 512 MiB · concurrency 40 · timeout 180 s · min 0 / max 1; CPU throttled.', NAVY, PALE_BLUE),
        ('FIREBASE HOSTING',
         'Deploys web/dist with build-info.json. SPA routes serve index.html. '
         'Specific work/companies/placements API paths rewrite to the work API; other /api/** paths to the main API. '
         'No Docker image is needed for a web-only release.', BLUE, PALE_BLUE),
        ('FIRESTORE RULES',
         'The Rules API publisher checks the existing release, compares source, compiles changed Rules, '
         'activates the ruleset and reads back its identity. Firestore indexes have no automated step and '
         'cause the selective planner to stop.', GOLD, PALE_GOLD),
    ]
    for i, (title, body, accent, pale) in enumerate(bottom):
        card(c, 48 + i * 372, 385, 350, 205, title, body, accent, pale, 13.1, 10.2)
    rect(c, 48, 619, 1095, 153, WHITE, LINE, radius=15)
    text(c, 'PRIVATE DISPATCH PATH', 67, 636, 10, BLUE, True)
    pill(c, 'Cloud Scheduler', 68, 668, 172, PALE_BLUE, BLUE)
    arrow(c, 249, 683, 304, 683)
    pill(c, 'OIDC scheduler identity', 313, 668, 231, PALE_BLUE, BLUE)
    arrow(c, 552, 683, 607, 683)
    pill(c, 'Private worker POST', 617, 668, 222, PALE_TEAL, TEAL)
    arrow(c, 848, 683, 901, 683)
    pill(c, 'FCM delivery', 910, 668, 165, PALE_GOLD, GOLD)
    para(c, 'Job <b>repaido-work-updates</b> runs every minute in Asia/Kolkata with a 240-second deadline, '
         'up to three retries and 30–300-second backoff. The work deployment pauses it during candidate setup; '
         'promotion resumes it. New work services may serve on first creation because --no-traffic is conditional on a prior service.',
         69, 716, 1054, 10, INK)
    c.showPage()


def page_eight(c):
    header(c, 8, 'Failure boundaries and operational controls',
           'The pipeline verifies candidates before promotion, but production updates are sequential and are not automatically rolled back.',
           'Release safety')
    columns = [
        ('Before candidate', 'Tests or image build fail', 'No new production traffic. Existing site stays live.', PALE_BLUE, BLUE),
        ('Candidate checks', 'Main/work candidate fails', 'Main traffic stays; first-time work service creation can serve immediately.', PALE_TEAL, TEAL),
        ('Rules published', 'Later step fails', 'New Firestore Rules can already be active.', PALE_GOLD, GOLD),
        ('Work setup', 'Failure before work promotion', 'Scheduler may remain paused; inspect and restore delivery.', PALE_GOLD, GOLD),
        ('Traffic / Hosting', 'Failure during promotion', 'Main, work and Hosting may serve different builds.', PALE_RED, RED),
    ]
    for i, (phase, trigger, effect, pale, accent) in enumerate(columns):
        x = 48 + i * 223
        card(c, x, 162, 204, 186, phase, f'<b>{trigger}</b><br/>{effect}', accent, pale, 12.5, 10.1,
             badge=f'WINDOW {i + 1}')
        if i < 4:
            arrow(c, x + 207, 256, x + 222, 256, accent, 1.4)
    text(c, 'RESPONSE MAP', 48, 383, 11, BLUE, True)
    entries = [
        ('Cloud Run', 'Inspect tagged/serving revisions and restore a previously verified revision if needed.'),
        ('Hosting', 'Restore a prior Hosting release if web publication or rewrites are wrong.'),
        ('Rules', 'Restore a previously reviewed Rules release if access changes are wrong.'),
        ('Scheduler', 'Check the private work-updates job is active after a work deployment failure.'),
    ]
    for i, (name, detail) in enumerate(entries):
        t = 410 + i * 62
        rect(c, 48, t, 1095, 51, WHITE, LINE, radius=10)
        pill(c, name, 63, t + 10, 150, PALE_BLUE, BLUE)
        para(c, detail, 229, t + 15, 885, 10.7, INK)
    rect(c, 48, 681, 1095, 93, PALE_BLUE, radius=13)
    text(c, 'COST CONTROL THAT THE REPO ACTUALLY IMPLEMENTS', 65, 695, 10, BLUE, True)
    para(c, 'The repo provides a manual release gate (false by default) and component-scoped builds. '
         'Disabling the live production push trigger is recommended but was not verified here. '
         'The root source archive is still uploaded for selective releases; runtime, storage and network costs continue. '
         'Measure savings in Billing Reports.',
         65, 720, 1061, 10.5, INK)
    c.showPage()


def page_nine(c):
    header(c, 9, 'Operator path, source trace and evidence limits',
           'Use the plan before any approved release. This document describes checked-in behavior and the limited public endpoints read for verification.',
           'Runbook')
    card(c, 48, 159, 526, 198, '1  Review the exact change set',
         'Identify the real deployed baseline. The plan compares two full Git SHAs, classifies changed paths and reports the selected config. '
         'A docs-only change does not publish the customer app.', BLUE, WHITE, 16, 11)
    card(c, 596, 159, 547, 198, '2  Submit only an authorized batch',
         'Use the same reviewed SHA and baseline with --release in authenticated Cloud Shell. '
         'The helper checks clean source, upload inventory and active builds before submitting Cloud Build.', TEAL, WHITE, 16, 11)
    rect(c, 48, 380, 1095, 102, DEEP, radius=15)
    text(c, 'OFFLINE PLAN', 66, 394, 9.5, colors.HexColor('#AFC6FF'), True)
    text(c, 'bash scripts/release-batch.sh --plan <reviewed-40-char-sha> --changed-from <deployed-40-char-sha>',
         66, 418, 11, WHITE)
    text(c, 'MANUAL RELEASE  ·  only after a release request', 66, 445, 9.5,
         colors.HexColor('#AFC6FF'), True)
    text(c, 'bash scripts/release-batch.sh --release <reviewed-40-char-sha> --changed-from <deployed-40-char-sha>',
         66, 462, 11, WHITE)
    text(c, 'CHECKED SOURCE', 48, 510, 11, BLUE, True)
    sources = [
        'scripts/release-batch.sh + scripts/plan-release.py',
        'cloudbuild.yaml + cloudbuild-{web,api,rules}.yaml',
        'scripts/deploy-work-services.py + scripts/deploy-firestore-rules.py',
        'firebase.json + backend/Dockerfile',
        'engineering/release.py + engineering/cloudbuild.yaml',
    ]
    for i, item in enumerate(sources):
        x = 48 + (i % 2) * 548
        t = 539 + (i // 2) * 57
        rect(c, x, t, 526, 44, WHITE, LINE, radius=9)
        text(c, item, x + 15, t + 12, 10.3, INK)
    rect(c, 48, 718, 1095, 60, PALE_GOLD, radius=12)
    para(c, '<b>Evidence limit:</b> public health checks confirmed the build IDs shown on page 1, but this document '
         'does not claim a complete live IAM, network, billing, secret, or capacity audit. Source files define the intended pipeline; '
         'a Cloud Shell audit is required to compare every live resource with it.',
         65, 730, 1062, 9.8, INK)
    c.showPage()


def main():
    global TOTAL_PAGES
    from platform_pages import page_count, render
    TOTAL_PAGES = 9 + page_count()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    pdf = canvas.Canvas(str(OUTPUT), pagesize=(W, H), pageCompression=1,
                        invariant=1)
    pdf.setTitle('Repaido platform architecture, API flowmaps and deployment pipelines')
    pdf.setAuthor('Repaido engineering documentation')
    pdf.setSubject('Code-derived HLD and LLD, API inventory, data and event flows, observability, controls, and release architecture')
    release_pages = (
        (page_one, 'Overview'),
        (page_two, 'Release target selection'),
        (page_three, 'Full production pipeline'),
        (page_four, 'Selective pipelines'),
        (page_five, 'Independent engineering console'),
        (page_six, 'Build and serving topology'),
        (page_seven, 'Service contracts and trust'),
        (page_eight, 'Failure boundaries'),
        (page_nine, 'Operator path and evidence'),
    )
    for number, (page, label) in enumerate(release_pages, start=1):
        pdf.bookmarkPage(f'deployment-{number}')
        pdf.addOutlineEntry(f'{number:02d}  {label}', f'deployment-{number}', level=0)
        page(pdf)
    render(pdf, sys.modules[__name__])
    pdf.save()
    print(f'Wrote {OUTPUT} ({OUTPUT.stat().st_size:,} bytes, {TOTAL_PAGES} A3 landscape vector pages)')


if __name__ == '__main__':
    main()
