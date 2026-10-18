// Synthetic records only. Exercises the shared table without a network or identity.
import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import {AdminTable,AdminStatus} from '../src/components/AdminTable';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/components/operations.css';
import '../src/components/company-crm.css';
const rows=Array.from({length:31},(_,i)=>({id:String(i+1),name:`Record ${String(i+1).padStart(2,'0')}`,amount:(31-i)*12500,status:i%2?'pending_review':'approved'}));
function Fixture(){const [records,setRecords]=useState(rows);return <div className="operations portal-company"><main><h1>Review table</h1><button onClick={()=>setRecords(records.length>1?rows.slice(0,1):rows)}>Change source size</button><AdminTable label="Fixture records" rows={records} rowKey={r=>r.id} rowLabel={r=>r.name} columns={[
 {key:'name',label:'Name',value:r=>r.name},{key:'amount',label:'Amount',value:r=>r.amount,numeric:true,render:r=>'₹'+r.amount/100},{key:'status',label:'Status',value:r=>r.status,render:r=><AdminStatus value={r.status}/>},
 ]} renderDetail={r=><><h2>Review {r.name}</h2><label>Decision note<textarea/></label><p>No action is sent by opening this record.</p></>}/></main></div>};
createRoot(document.getElementById('root')!).render(<Fixture/>);
