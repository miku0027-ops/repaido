import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {GoogleJourneyMap,type RideCameraPhase} from '../src/components/GoogleJourneyMap';
import {MotionPage} from '../src/components/MotionPage';
import '../src/styles.css';
import '../src/design-system.css';

function Preview(){
 const [position,setPosition]=useState<{lat:number;lng:number}|null>({lat:21.4934,lng:86.9135}),[step,setStep]=useState('map'),[phase,setPhase]=useState<RideCameraPhase>('planning');
 return <main style={{padding:20}}><h1>Local confirmed-position motion</h1><button onClick={()=>setPosition({lat:21.4944,lng:86.9145})}>Next confirmed reading</button><button onClick={()=>setPosition({lat:21.4954,lng:86.9155})}>Newer confirmed reading</button><button onClick={()=>setPosition(null)}>GPS became stale</button><button onClick={()=>setStep(value=>value==='map'?'details':'map')}>Change section</button>{(['searching','empty','found','assigned','arrived'] as RideCameraPhase[]).map(value=><button key={value} onClick={()=>setPhase(value)}>{value} camera</button>)}<MotionPage step={step}><div style={{height:350}}><GoogleJourneyMap origin={{lat:21.4934,lng:86.9135}} destination={{lat:21.5014,lng:86.9135}} position={position} cameraPhase={phase}/></div></MotionPage></main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
