import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {InteractionMotion} from '../src/components/InteractionMotion';
import {AppExperience} from '../src/components/AppExperience';
import {notifyFeedback} from '../src/services/actionFeedback';
import '../src/styles.css';
import '../src/design-system.css';
function Preview(){
 const [hidden,setHidden]=useState(false),[key,setKey]=useState(0);
 return <main style={{padding:24}}><AppExperience/><button onClick={()=>setHidden(value=>!value)}>Toggle animations</button><button onClick={()=>setKey(value=>value+1)}>Replay</button><button onClick={()=>notifyFeedback({tone:'success',title:'Request sent',message:'Follow it in Bookings.'})}>Confirm action</button><div hidden={hidden} key={key} aria-label="Motion examples">{(['search','location','success'] as const).map(kind=><div key={kind} style={{padding:16}}><InteractionMotion kind={kind}/><span>{kind}</span></div>)}</div></main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
