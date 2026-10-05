"""Versioned, service-specific customer work briefs; private team PDF export."""
from io import BytesIO
from xml.sax.saxutils import escape
VERSION='home-brief-v1'
def field(id,label,options=None):
    return dict(id=id,label=label,required=True,**({'options':options} if options else {}))
SCHEMAS={
 'maid':[field('home_size','Home size',['Studio','1 bedroom','2 bedrooms','3 bedrooms','4+ bedrooms']),field('tasks','Cleaning and household tasks'),field('supplies','Cleaning supplies',['Customer provides','Professional to quote supplies']),field('access','Pets, access and household precautions')],
 'caretaker':[field('assistance','Everyday assistance required'),field('mobility','Mobility support',['Independent','Walking supervision','Discuss safe assistance with team']),field('language','Preferred communication language'),field('routine','Daily routine and family handover'),field('boundaries','Care scope',['Non-medical companionship and everyday assistance only'])],
 'interior-design':[field('rooms','Rooms and approximate dimensions'),field('style','Preferred style and colours'),field('budget','Design and execution budget'),field('deliverables','Required outputs',['Design consultation','Layout and 3D concepts','Full design and execution estimate']),field('deadline','Target completion and occupancy')],
 'floor-plan':[field('plot','Plot dimensions, units and orientation'),field('floors','Proposed floors and rooms'),field('needs','Parking, accessibility and layout requirements'),field('documents','Available survey and approval documents (describe only)'),field('deliverables','Drawing requirements',['Concept layout','Approval drawing consultation','Detailed planning consultation'])],
 'renovation':[field('areas','Areas and approximate size'),field('condition','Current condition and repair needs'),field('occupancy','During work',['Home occupied','Home vacant','Discuss phased work']),field('budget','Budget and materials preference'),field('deadline','Target dates and access restrictions')],
 'decor':[field('spaces','Spaces and dimensions'),field('style','Decor style, colours and occasion'),field('existing','Furniture and decor to keep'),field('budget','Budget for sourcing and installation'),field('deadline','Required installation date')],
 'civil-engineer':[field('assessment','Purpose',['Site inspection','Structural assessment consultation','Construction supervision','Planning consultation']),field('building','Building age, floors and approximate size'),field('concerns','Specific observations and questions'),field('documents','Available plans and reports (describe only)'),field('deliverables','Expected report, inspection or supervision scope')],
 'contractor':[field('project','Project type',['New construction','Extension','Renovation','Finishing work']),field('size','Built-up area, units and number of floors'),field('scope','Trades, materials and work scope'),field('approvals','Plans and approvals status'),field('budget','Budget and milestone expectations'),field('deadline','Start and completion targets')],
}
def validate(service,version,answers):
    if version!=VERSION or service not in SCHEMAS:raise ValueError('Refresh the service form before submitting.')
    fields=SCHEMAS[service]
    if set(answers)!={f['id'] for f in fields}:raise ValueError('Complete every question for this specific service.')
    for f in fields:
        v=answers[f['id']]
        if not isinstance(v,str) or not 2<=len(v.strip())<=1000:raise ValueError(f"Complete {f['label']} (2–1000 characters).")
        if f.get('options') and v not in f['options']:raise ValueError('Choose a listed option for '+f['label'])
    return {k:v.strip() for k,v in answers.items()}
def rows(p):
    return [{'label':f['label'],'value':p.get('requirements',{}).get(f['id'],'Not supplied in this earlier request')} for f in SCHEMAS.get(p['service_id'],[])]
def pdf(p):
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.pagesizes import A4
    from reportlab.platypus import SimpleDocTemplate,Paragraph,Spacer,Table,TableStyle,KeepTogether
    from datetime import datetime
    from zoneinfo import ZoneInfo
    out=BytesIO(); styles=getSampleStyleSheet(); styles['BodyText'].fontSize=10;styles['BodyText'].leading=15
    para=lambda s:Paragraph(escape(str(s)).replace('\n','<br/>'),styles['BodyText'])
    story=[Paragraph('REPAIDO HOME | Customer work brief',styles['Heading1']),para('Plan '+p['id']),para('Generated '+datetime.now(ZoneInfo('Asia/Kolkata')).strftime('%d %b %Y, %H:%M IST')),Spacer(1,12)]
    facts=[('Service',p['service_id']),('City',p['city']),('Schedule',f"{p['start_date']} / {p['time']} IST / {p['minutes']} minutes"),('Status',p['state'])]+[(x['label'],x['value']) for x in rows(p)]+[('Work instructions',p.get('instructions','Not provided'))]
    if p.get('quote'):facts += [('Agreed checklist','\n'.join(p['quote']['checklist'])),('Exclusions',p['quote']['exclusions']),('Terms',p['quote']['terms'])]
    for title,value in facts:
        t=Table([[para(title)],[para(value)]],colWidths=[475]);t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#eaf0fc')),('BOX',(0,0),(-1,-1),.5,colors.HexColor('#b8c5df')),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7)]));story += [KeepTogether([t,Spacer(1,9)])]
    story += [para('Private work brief. Share only with authorised team members. Customer phone, precise address and recipient identity are excluded. A request is not confirmation of work or a construction contract.')]
    SimpleDocTemplate(out,pagesize=A4,rightMargin=55,leftMargin=55,topMargin=40,bottomMargin=40).build(story)
    return out.getvalue()
