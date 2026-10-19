// Development-only in-memory transport. Never calls real APIs or creates bookings.
import {createRoot} from 'react-dom/client';
import {BikeRiderWorkspace,type BikeRiderRide,type BikeDriverPayroll,type BikeCompanyCashSummary} from '../src/components/BikeRiderWorkspace';
import type {operation,currentPosition} from '../src/services/operations';
import '../src/styles.css';
import '../src/design-system.css';
const params=new URLSearchParams(location.search);
let availability={vehicle_id:'qa-bike',online:params.has('stale')||params.has('resume'),updated_at:Date.now()/1000-600,position:{lat:21.49,lng:86.91,accuracy:10,captured_at:Date.now()/1000-600,received_at:Date.now()/1000-600}};
const records:BikeRiderRide[]=[{id:'local-qa-lifecycle',state:'offered',version:1,vehicle_name:'LOCAL QA · Test bike',pickup:{lat:21.49,lng:86.91},dropoff:{lat:21.50,lng:86.92},pickup_address:'LOCAL QA · College Road pickup',dropoff_address:'LOCAL QA · Hospital Road drop',pricing:{customer_total_paise:0,free:true},created_at:Date.now()/1000,allowed_actions:['accept','decline']}];
const commands:Record<string,unknown>[]=[];
const reads={payroll:0,olderDetails:0,presenceWrites:0};
const companyCash:BikeCompanyCashSummary={driver_id:'qa-rider',version:1,collected_paise:1000,reported_remittance_paise:0,confirmed_remittance_paise:0,outstanding_held_paise:1000,available_to_report_paise:1000,currency:'INR'};
const payroll:BikeDriverPayroll={driver_id:'qa-rider',period:'2026-10',compensation_model:'monthly_salary',monthly_salary_paise:700000,rostered:true,approved:true,obligations:[{id:'qa-salary',period:'2026-10',amount_paise:700000,status:'transfer_reported',version:2,transfer:{reference:'LOCAL-QA-TRANSFER',amount_paise:700000}}],server_time:Date.now()/1000,company_cash:companyCash};
const deposits:object[]=[];
let failReads=params.has('offline')?1:0,failDeparture=params.has('retry')?1:0;
const response=<T,>(value:unknown)=>structuredClone(value) as T;
const request:typeof operation=async<T,>(path:string,init:RequestInit={})=>{
 await new Promise(resolve=>setTimeout(resolve,35));
 if(path==='/bike-rides/driver/availability'){
  if(init.method==='PUT'){const body=JSON.parse(String(init.body));if(body.position)reads.presenceWrites++;availability={...availability,...body,updated_at:Date.now()/1000};if(body.position)availability.position.received_at=Date.now()/1000;}
  return response<T>({vehicles:[{id:'qa-bike',name:'LOCAL QA · Test bike',active:true,status:'approved',vehicle_kind:'bike'}],availability,server_time:Date.now()/1000,dispatch_ready:!params.has('paused'),service_ready:!params.has('paused'),availability_reason:params.has('paused')?'Bike requests are currently paused.':null});
 }
 if(path==='/bike-rides/driver/rides?after=qa-older')return response<T>({rides:[{...records[0],id:'qa-older-complete',state:'completed',allowed_actions:[],dropoff_address:'LOCAL QA · Older completed ride',created_at:Date.now()/1000-3600},{...records[0],id:'qa-older-obligation',state:'payment_reported',version:1,allowed_actions:['cash_received','dispute'],dropoff_address:'LOCAL QA · Older payment record',created_at:Date.now()/1000-7200}],next_cursor:null,server_time:Date.now()/1000});
 if(path==='/bike-rides/bookings/qa-older-obligation'){reads.olderDetails++;return response<T>({...records[0],id:'qa-older-obligation',state:'completed',version:2,allowed_actions:[],dropoff_address:'LOCAL QA · Older payment record',created_at:Date.now()/1000-7200});}
 if(path==='/bike-rides/driver/rides'){
  if(failReads-->0)throw Error('LOCAL QA · connection lost');
  return response<T>({rides:records,next_cursor:params.has('pages')?'qa-older':null,server_time:Date.now()/1000});
 }
 if(path==='/bike-rides/driver/payroll'){reads.payroll++;return response<T>(payroll);}
 if(path==='/bike-rides/driver/payroll/2026-10/confirm'){
  const body=JSON.parse(String(init.body));if(body.expected_version!==payroll.obligations[0].version||body.received!==true)throw Error('Invalid salary confirmation');
  payroll.obligations[0].status='driver_received';payroll.obligations[0].version++;return response<T>(payroll.obligations[0]);
 }
 if(path.startsWith('/bike-rides/driver/remittances')){
  if(init.method==='POST'){
   const body=JSON.parse(String(init.body));if(body.expected_version!==companyCash.version||body.amount_paise!==1000||body.ride_ids[0]!=='qa-paid-collection')throw Error('Invalid company cash report');
   companyCash.version++;companyCash.reported_remittance_paise=1000;companyCash.available_to_report_paise=0;
   const deposit={id:'qa-deposit',version:1,status:'deposit_reported',amount_paise:1000,deposit_reference:body.deposit_reference,reported_at:Date.now()/1000};deposits.push(deposit);return response<T>(deposit);
  }
  return response<T>({company_cash:companyCash,items:deposits,next_cursor:null,available_collections:deposits.length?[]:[{ride_id:'qa-paid-collection',amount_paise:1000,collected_at:Date.now()/1000,period:'2026-10'}],collections_next_cursor:null});
 }
 if(path.endsWith('/position'))return response<T>(records[0]);
 if(path.endsWith('/commands')){
  const command=JSON.parse(String(init.body));commands.push(command);
  if(command.expected_version!==records[0].version)throw Error('LOCAL QA · ride changed, refresh');
  if(command.action==='depart'&&failDeparture-->0)throw Error('LOCAL QA · temporary network failure');
  if(command.action==='start'&&command.otp!=='123456'){records[0].version++;throw Error('LOCAL QA · OTP does not match');}
  const next={accept:'accepted',depart:'on_the_way',arrive:'arrived',start:'in_progress',complete:'completed'}[command.action as 'accept'|'depart'|'arrive'|'start'|'complete'];
  const actions={accepted:['depart','cancel'],on_the_way:['arrive','cancel'],arrived:['start','cancel'],in_progress:['complete','dispute'],completed:[]};
  Object.assign(records[0],{state:next,version:records[0].version+1,passenger_name:'LOCAL QA · Test passenger',passenger_phone:'+919999999999',allowed_actions:actions[next],stop_status:{pickup:{status:'inside',distance_metres:30,valid_until:Date.now()/1000+75},destination:{status:'inside',distance_metres:50,valid_until:Date.now()/1000+75}}});
  return response<T>(records[0]);
 }
 throw Error('Unexpected fixture path '+path);
};
const readPosition:typeof currentPosition=async()=>({lat:21.49,lng:86.91,accuracy:params.has('imprecise')?500:8,captured_at:Date.now()/1000});
Object.assign(window,{bikeRiderFixture:{commands,records,availability,reads}});
createRoot(document.getElementById('root')!).render(<main style={{maxWidth:520,padding:16,margin:'auto'}}><h1 style={{fontSize:14}}>Local-only rider lifecycle</h1><BikeRiderWorkspace request={request} readPosition={readPosition}/></main>);
