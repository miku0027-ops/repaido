import {useLayoutEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import ServiceLeaders from '../src/components/ServiceLeaders';
import {categoryLeaders} from '../src/services/hireProfileCache';
import '../src/styles.css';
import '../src/design-system.css';
// The intent prefetch and mounted consumer must coalesce into one request.
void categoryLeaders({city:'Balasore',role:'all',radius_km:6,location:null}).catch(()=>{});
function Preview(){
 const [revision,setRevision]=useState(0),[city,setCity]=useState('Balasore'),[category,setCategory]=useState('all');
 const panel=useRef<HTMLDivElement>(null),paint=useRef<HTMLOutputElement>(null);
 useLayoutEffect(()=>{
  if(paint.current)paint.current.value=JSON.stringify({revision,city,leaders:panel.current?.querySelectorAll('.catalog-leader-preview').length||0,status:panel.current?.querySelector('[role="status"]')?.textContent||''});
 },[revision,city]);
 return <main className="repaido-customer-shell" style={{padding:16}}><button onClick={()=>setRevision(v=>v+1)}>Remount leaders</button><button onClick={()=>setCity(v=>v==='Balasore'?'Bhadrak':'Balasore')}>Change city</button><button onClick={()=>setCategory('home:maid')}>Maid leaderboard</button><div ref={panel}><ServiceLeaders key={revision+city+category} city={city} category={category} initiallyExpanded/></div><output ref={paint} aria-label="First commit snapshot"/></main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
