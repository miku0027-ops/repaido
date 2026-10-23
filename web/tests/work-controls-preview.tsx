import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {WorkAndMarket,type WorkMarketView} from '../src/components/repaidians/WorkAndMarket';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/components/repaidians/repaidians.css';
function Preview(){
  const [view,setView]=useState<WorkMarketView>('preferences'),[professional,setProfessional]=useState(true);
  return <main className="rp-shell"><h1 className="sr-only">Work controls preview</h1><WorkAndMarket accountKey="preview-professional" member={{id:'preview-professional',name:'Preview Electrician',handle:'preview.electrician',trade:'electrician',role:'technician',avatarUrl:'',bio:'',city:'Balasore',skills:['Wiring']}} authenticated={professional} professional={professional} role={professional?'agent':'customer'} city="Balasore" revision={0} view={view} onView={setView} onOpenMember={()=>{}} onDestination={()=>{}} onManage={()=>{}} onShare={()=>{}} onDiscoverPeople={()=>{}}/><button onClick={()=>setProfessional(false)}>View as guest</button></main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
