// Isolated development fixture: all API responses must be mocked by the browser test.
import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import {auth} from '../src/firebase';
import {VehicleEditor} from '../src/components/LocalBusiness';
import {CabOwnerSuite} from '../src/components/BusinessSuites';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/components/operations.css';
const params=new URLSearchParams(location.search),bike=params.get('kind')!=='car';
await auth.authStateReady();
(auth as any).currentUser={uid:'local-vehicle-fixture',phoneNumber:'+919999999999',getIdToken:async()=>'local-vehicle-fixture',getIdTokenResult:async()=>({claims:{}})};
localStorage.setItem('repaido.token','local-vehicle-fixture');
const vehicle={id:'local-qa-vehicle',version:4,name:bike?'LOCAL QA · Bike':'LOCAL QA · Car',vehicle_kind:bike?'bike':'car',status:'approved',active:true,valid_until:Date.now()/1000+86400,registration:'OD01AB0011',mode:'both',seats:bike?1:4,transmission:'manual',fuel:'petrol',origin_address:'LOCAL QA · College Road entrance, Balasore',location:{lat:21.49,lng:86.91},base_paise:23300,per_km_paise:8700,daily_paise:150000,included_daily_km:100,gst_bps:1800,document_ids:['local-document'],terms:'LOCAL QA · Vehicle documents are current. Pickup and drop follow the agreed service terms.'};
function Preview(){const [saved,setSaved]=useState(false);return <main className="operations" style={{maxWidth:900,margin:'auto',padding:16}}><h1 style={{fontSize:14}}>Local vehicle services fixture</h1>{params.has('fleet')?<CabOwnerSuite partner={{name:'LOCAL QA owner',city:'Balasore',valid_until:Date.now()/1000+86400}} vehicles={[vehicle]} onRefresh={async()=>{}}/>:<VehicleEditor vehicle={vehicle} onClose={()=>{}} onSaved={()=>setSaved(true)}/>}<p role="status">{saved?'Local fixture saved':''}</p></main>;}
createRoot(document.getElementById('root')!).render(<Preview/>);
