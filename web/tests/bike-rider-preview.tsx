// Development-only layout fixture. No requests, real rider records or bookings.
import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import {BikeRiderDashboard,type BikeRiderRide,type BikeDriverPayroll} from '../src/components/BikeRiderWorkspace';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/material-surfaces.css';
const params=new URLSearchParams(location.search),now=1792400000;
document.documentElement.dataset.theme=params.get('theme')==='dark'?'dark':'light';
if(params.get('text')==='200')document.documentElement.style.fontSize='200%';
const available={vehicles:[{id:'qa-bike',name:'LOCAL QA · Honda Activa',status:'approved',active:true,vehicle_kind:'bike'}],availability:{vehicle_id:'qa-bike',online:true,updated_at:now,position:{lat:21.49,lng:86.91,accuracy:10,captured_at:now,received_at:now}},server_time:now,dispatch_ready:true,service_ready:true};
const ride:BikeRiderRide={id:'local-qa-bike-current',state:'in_progress',version:1,vehicle_name:'LOCAL QA · Honda Activa',passenger_name:'Sample passenger',passenger_phone:'+919999999999',pickup:{lat:21.49,lng:86.91},dropoff:{lat:21.50,lng:86.92},pickup_address:'LOCAL QA · College Road, Balasore',dropoff_address:'LOCAL QA · Hospital Road, Balasore',pricing:{free:true,customer_total_paise:0},created_at:now-600,allowed_actions:['complete','dispute'],stop_status:{destination:{status:'inside',distance_metres:90,radius_metres:300,valid_until:now+75}}};
const payroll:BikeDriverPayroll={driver_id:'qa-rider',period:'2026-10',compensation_model:'monthly_salary',monthly_salary_paise:700000,rostered:true,approved:true,obligations:[],server_time:now};
function Preview(){
 const [notice,setNotice]=useState(''),[online,setOnline]=useState(true),[vehicle,setVehicle]=useState('qa-bike');
 const rows=params.get('state')==='empty'?[]:[ride,{...ride,id:'local-qa-bike-next',state:'queued',queued:true,accepted_by_driver:true,available_at:now+600,passenger_name:'Next sample passenger',allowed_actions:['cancel'],stop_status:undefined,created_at:now-300},{...ride,id:'local-qa-bike-offer',state:'offered',queued:false,accepted_by_driver:false,passenger_name:undefined,passenger_phone:undefined,pickup:undefined,dropoff:undefined,pickup_address:undefined,dropoff_address:undefined,allowed_actions:['accept','decline'],stop_status:undefined,created_at:now,expires_at:params.get('state')==='expired'?now-1:now+90},{...ride,id:'local-qa-bike-history',state:'completed',allowed_actions:[],created_at:now-1800}];
 return <main style={{maxWidth:520,padding:16,margin:'auto'}}><h1 style={{fontSize:14,marginBottom:16}}>Local-only rider preview</h1><BikeRiderDashboard data={{...available,availability:{...available.availability,vehicle_id:vehicle,online,position:params.get('state')==='stale'?{...available.availability.position,captured_at:now-600,received_at:now-600}:available.availability.position}}} rides={rows} payroll={payroll} now={now} busy={false} error="" locationError={params.get('state')==='gps-error'?'Precise GPS is needed. Move to an open area and retry.':''} sharing={true} onVehicle={setVehicle} onOnline={setOnline} onLocation={()=>setNotice('Local fixture: GPS update requested')} onRefresh={()=>setNotice('Local fixture: refresh requested')} onAction={(_row,action)=>setNotice(`Local fixture: ${action} requested`)}/><p role="status">{notice}</p></main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
