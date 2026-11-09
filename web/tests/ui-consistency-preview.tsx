import '../src/ui-system.css';
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Button,Field,SelectField,Modal} from '../src/components/ui';
import {Card} from '../src/components/Card';
import {ServiceAccordion} from '../src/components/ServiceAccordion';
import {seededServices} from '../src/data';
import {HomeServicesGrid} from '../src/components/HomeServicesGrid';
import {HomeEntry} from '../src/components/HomePlans';
import {HomeGreeting} from '../src/components/HomeGreeting';
import {StoryCarousel} from '../src/components/CompactExperience';
import {AppExperience} from '../src/components/AppExperience';
import {InteractionMotion} from '../src/components/InteractionMotion';
import {notifyFeedback} from '../src/services/actionFeedback';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/components/operations.css';
import '../src/components/contract-work.css';
import '../src/components/repaidians/repaidians.css';
function Preview(){
 const [open,setOpen]=useState(false),[saving,setSaving]=useState(false),[saved,setSaved]=useState(false),[picked,setPicked]=useState('');
 return <main style={{maxWidth:960,margin:'auto',padding:16}}><AppExperience/><h1>Shared controls</h1>
  <section aria-label="Primary actions" style={{display:'flex',flexWrap:'wrap',gap:8}}>
   <Button variant="primary">Continue</Button><button className="button-primary">Customer action</button><button className="ops-primary">Agent action</button><button className="contract-primary">Contractor action</button><span className="rp-dialog"><button className="rp-primary">Community action</button></span>
  </section>
  <Card><h2>Contact details</h2><form onSubmit={event=>{event.preventDefault();setSaving(true);window.setTimeout(()=>{setSaving(false);setSaved(true);},500);}} style={{display:'grid',gap:16}}>
   <Field id="name" label="Name" required hint="Use the name on your account."/>
   <SelectField id="city" label="City" defaultValue="" required><option value="">Choose a city</option><option value="Balasore">Balasore</option></SelectField>
   <Field id="phone" label="Phone number" error="Enter 10 to 15 digits." aria-describedby="phone-note"/><p id="phone-note">Include your country code.</p>
   <Button type="submit" variant="primary" loading={saving} loadingLabel="Saving…">Save details</Button>{saved&&<p role="status">Changes saved.</p>}
  </form></Card>
  <Button onClick={()=>setOpen(true)}>Open dialog</Button>{open&&<Modal title="Confirm your choice" onClose={()=>setOpen(false)}><p>Check these details before saving.</p><Button onClick={()=>setOpen(false)}>Cancel</Button><Button variant="primary" onClick={()=>setOpen(false)}>Save changes</Button></Modal>}
  <HomeGreeting greeting="Welcome" location="Balasore" onLocation={()=>{}}/><HomeEntry onOpen={()=>{}}/>
  <HomeServicesGrid city="Balasore" activeCategory="all" onSelectCategory={setPicked}/><p role="status">{picked}</p>
  <ServiceAccordion service={seededServices[0]} city="Balasore" onPreview={()=>{}} onOffer={()=>{}}/>
  <StoryCarousel label="Services" slides={[{id:'one',eyebrow:'Home',title:'Home cleaning',description:'View cleaning services.',image:'/images/icon-cleaning.png'},{id:'two',eyebrow:'Repairs',title:'Appliance repairs',description:'View repair services.',image:'/images/icon-appliance.png'}]}/>
  <div role="group" aria-label="State icons"><InteractionMotion kind="search"/><InteractionMotion kind="success"/></div>
  <Button onClick={()=>notifyFeedback({tone:'pending',title:'Saving…',message:''})}>Show loading</Button>
 </main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
