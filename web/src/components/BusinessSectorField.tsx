import {useEffect,useState,useId} from 'react';
import {apiFetch} from '../services/api';

/** Shared saved sector catalogue. New names are persisted atomically with the submitted business or tender. */
export function BusinessSectorField({name,value='',required=true}:{name:string;value?:string;required?:boolean}){
 const [sectors,setSectors]=useState<string[]>([]),[choice,setChoice]=useState(value),[custom,setCustom]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const id=useId();
 const load=async()=>{try{const r=await apiFetch('/api/operations/contractor/sectors',{}, {background:true});if(!r.ok)throw Error('Could not load sectors. Retry or enter your sector manually.');setSectors((await r.json()).sectors);setError('');}catch(e){setError((e as Error).message);}finally{setLoading(false);}};
 useEffect(()=>{void load();},[]);
 const options=[...new Set([...sectors,...(value?[value]:[])])];
 return <span className="business-sector-field">
 <select aria-label="Business sector" value={choice} onChange={e=>setChoice(e.target.value)} onFocus={()=>void load()} required={required} aria-describedby={id}>
 <option value="">{loading?'Loading sectors…':'Choose a sector'}</option>{options.map(n=><option key={n} value={n}>{n}</option>)}<option value="__custom__">Other · add a new sector</option>
 </select>
 {choice==='__custom__'&&<input aria-label="New business sector" value={custom} onChange={e=>setCustom(e.target.value)} required={required} minLength={2} maxLength={80} placeholder="Enter sector name"/>}
 <input type="hidden" name={name} value={choice==='__custom__'?custom.trim():choice}/>
 <small id={id}>{choice==='__custom__'?'Saved to the shared sector list when you submit this form.':'Choose the sector that best describes the business or tender.'}</small>
 {error&&<span role="alert">{error}<button type="button" onClick={()=>void load()}>Retry sectors</button></span>}
 </span>;
}
