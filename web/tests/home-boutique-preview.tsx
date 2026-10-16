// Local-only fixtures. Never imported by the production application.
import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import {HomeEntry,HomeHub} from '../src/components/HomePlans';
import type {Service} from '../src/types';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/components/operations.css';
const services:Service[]=[{id:'qa-home-clean',name:'Local QA home cleaning',category:'cleaning',description:'Local test only.',price:59900,duration:60,image:'/images/cleaning.jpg',imageAlt:'',included:[],excluded:[]}];
const initial=new URLSearchParams(location.search).get('initial')||undefined;
function Preview(){const [open,setOpen]=useState(false);return <main style={{padding:12,maxWidth:760,margin:'auto'}}><h1 style={{fontSize:14}}>Local-only Home review</h1><HomeEntry city="Balasore" services={services} onOpen={()=>setOpen(true)}/>{open&&<HomeHub initialService={initial} preferredWorker={initial?{id:"local-initial-person",name:"Local initial professional"}:undefined} city="Balasore" services={services} onService={id=>document.body.dataset.service=id} onClose={()=>setOpen(false)} onSignIn={()=>{}} onPlans={()=>{}}/>}</main>};
createRoot(document.getElementById('root')!).render(<Preview/>);
