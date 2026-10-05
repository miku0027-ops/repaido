import ServiceImage from './ServiceImage';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, Check, CheckCircle2, ChevronDown, Home, LockKeyhole, MapPin, Minus, Plus, ReceiptText, ShoppingBag } from 'lucide-react';
import type { Address, BookingDraft, CartItem, ConfirmBooking } from '../types';
import { addressErrors, bookingDays, calculateTotals, hours, slotAvailable } from '../booking.mjs';
import { formatMoney, formatTime } from '../data';
import { Brand, Field } from './ui';

type Errors=Partial<Record<keyof Address|'slot'|'submit',string>>;
const emptyAddress:Address={name:'',phone:'',street:'',area:'',pincode:'',label:'Home'};
export interface CheckoutProps { items:CartItem[];city:string;onChange:(id:string,delta:number)=>void;onBack:()=>void;onConfirm:ConfirmBooking;taxBasisPoints?:number;preview?:boolean; }

export function Invoice({items,taxBasisPoints=1800,onChange,onConfirm,busy,preview,error}:{items:CartItem[];taxBasisPoints?:number;onChange:(id:string,delta:number)=>void;onConfirm:()=>void;busy:boolean;preview:boolean;error?:string}) {
  const totals=calculateTotals(items,taxBasisPoints);
  return (
    <aside className="rounded-2xl border bg-white p-6 md:sticky md:top-6 shadow-xs" aria-labelledby="invoice-title">
      <div className="flex items-center justify-between gap-4 pb-3 mb-4 border-b border-slate-100">
        <img src="/brand/repaido-logo-transparent.png" alt="Repaido" className="h-8 w-auto object-contain" />
        <span className="text-sm font-mono text-muted bg-slate-50 border border-slate-200 px-2 py-0.5 rounded">TAX INVOICE</span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <h2 id="invoice-title" className="text-xl font-semibold tracking-tight">Booking summary</h2>
        <ReceiptText size={20} className="text-muted"/>
      </div>
      <p className="mt-2 text-sm text-muted">Check the services and prices below.</p>
      <div className="my-6 space-y-6">
        {items.map(item=>(
          <div key={item.service.id} className="space-y-4">
            <div className="flex items-start gap-4">
              <ServiceImage service={item.service} decorative className="size-16 shrink-0 rounded-xl"/>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold leading-6">{item.service.name}</h3>
                <p className="mt-2 text-sm text-muted">{formatMoney(item.service.price)} each</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex items-center rounded-xl border">
                <button disabled={busy} onClick={()=>onChange(item.service.id,-1)} aria-label={`Remove one ${item.service.name}`} className="min-h-14 rounded-xl px-6 py-4 text-accent hover:bg-surface"><Minus size={14}/></button>
                <span className="min-w-4 text-center text-sm font-semibold" aria-live="polite">{item.quantity}</span>
                <button disabled={busy||item.quantity>=5} onClick={()=>onChange(item.service.id,1)} aria-label={`Add one ${item.service.name}`} className="min-h-14 rounded-xl px-6 py-4 text-accent hover:bg-surface disabled:text-muted"><Plus size={14}/></button>
              </div>
              <span className="font-semibold">{formatMoney(item.service.price*item.quantity)}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="space-y-4 border-t pt-6 text-sm" aria-live="polite">
        <div className="flex justify-between gap-4">
          <span className="text-muted">Service Base & Labor</span>
          <span>{formatMoney(totals.subtotal)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted">Taxes ({taxBasisPoints/100}%{preview?' estimate':''})</span>
          <span>{formatMoney(totals.tax)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted">Booking & Dispatch Fee</span>
          <span className="text-emerald-700 font-bold">₹0 (Free)</span>
        </div>
        <div className="flex justify-between gap-4 border-t pt-6 text-lg font-semibold">
          <span>Total</span>
          <span data-testid="invoice-total">{formatMoney(totals.total)}</span>
        </div>
      </div>
      {error&&<p className="mt-4 text-sm text-danger" role="alert">{error}</p>}
      <button type="button" onClick={onConfirm} disabled={busy||!items.length} className="button-primary mt-6 min-h-16 w-full">
        {busy?'Please wait…':preview?'Finish sample booking':'Confirm and pay'}
        {!busy&&<ArrowRight size={18}/>}
      </button>
      <div className="mt-4 flex items-start justify-center gap-2 text-center text-xs leading-5 text-muted">
        <LockKeyhole size={14} className="mt-2 shrink-0"/>
        <span>{preview?'This is a sample booking. You will not be charged.':'You’ll continue to our payment provider.'}</span>
      </div>
    </aside>
  );
}

export default function Checkout({items,city,onChange,onBack,onConfirm,taxBasisPoints=1800,preview=true}:CheckoutProps) {
  const [step,setStep]=useState(1);const [address,setAddress]=useState<Address>(emptyAddress);const [errors,setErrors]=useState<Errors>({});const [date,setDate]=useState('');const [time,setTime]=useState('');const [busy,setBusy]=useState(false);const [receipt,setReceipt]=useState<{reference:string;mode:'preview'|'live';draft:BookingDraft}|null>(null);
  const [now,setNow]=useState(()=>new Date());const titleRef=useRef<HTMLHeadingElement>(null);const days=bookingDays(now);
  useEffect(()=>{const id=setInterval(()=>setNow(new Date()),60000);return()=>clearInterval(id);},[]);
  useEffect(()=>{if(time&&!slotAvailable(date,time,now)){setTime('');setErrors(e=>({...e,slot:'This time is no longer available. Choose another time.'}));}},[now,date,time]);
  useEffect(()=>{if(!date||!days.some(d=>d.iso===date))setDate(days.find(d=>hours.some(h=>slotAvailable(d.iso,h,now)))?.iso??days[0].iso);},[now,date]);
  const update=(key:keyof Address,value:string)=>{setAddress(a=>({...a,[key]:value}));setErrors(e=>({...e,[key]:undefined,submit:undefined}));};
  const nextStep=(value:number)=>{setStep(value);window.scrollTo({top:0,behavior:'instant'});requestAnimationFrame(()=>titleRef.current?.focus());};
  const focusError=(error:Errors)=>{const field=Object.keys(error)[0];requestAnimationFrame(()=>{document.getElementById(field==='slot'?'schedule-title':`address-${field}`)?.focus();});};
  const validateAddress=()=>{const e=addressErrors(address) as Errors;setErrors(e);if(Object.keys(e).length){focusError(e);return false;}return true;};
  const submit=async()=>{
    if(busy)return;
    const e=addressErrors(address) as Errors;
    if(!date||!time||!slotAvailable(date,time))e.slot='Choose a time to continue.';
    if(!items.length)e.submit='Add a service before continuing.';
    setErrors(e);
    if(Object.keys(e).length){setStep(e.name||e.phone||e.street||e.area||e.pincode?1:2);focusError(e);return;}
    setBusy(true);
    const draft:BookingDraft={items:items.map(i=>({...i})),address:{...address},city,date,time,...calculateTotals(items,taxBasisPoints),currency:'INR'};
    try {const result=await onConfirm(draft);setReceipt({...result,draft});window.scrollTo({top:0,behavior:'instant'});}
    catch(error){setErrors({submit:error instanceof Error?error.message:'We couldn’t start checkout. Please try again.'});}
    finally{setBusy(false);}
  };
  if(receipt)return <div className="min-h-screen bg-surface"><header className="border-b bg-white"><div className="page-width py-6"><Brand compact/></div></header><main className="mx-auto max-w-xl px-6 py-16"><div className="rounded-2xl border bg-white p-8"><CheckCircle2 size={48} className="mb-6 text-accent"/><p className="text-xs font-semibold uppercase tracking-widest text-accent">{receipt.mode==='preview'?'Sample booking':'Booking received'}</p><h1 className="mt-4 text-3xl font-semibold tracking-tight">{receipt.mode==='preview'?'Sample booking complete':'We’ve received your request.'}</h1><p className="mt-4 leading-7 text-muted">{receipt.mode==='preview'?'No appointment has been booked and no payment has been taken.':'Check your booking confirmation for the appointment and payment details.'}</p><dl className="mt-8 space-y-4 border-t pt-6 text-sm"><div className="flex justify-between gap-4"><dt className="text-muted">Service</dt><dd className="text-right font-medium">{receipt.draft.items.map(i=>`${i.service.name} × ${i.quantity}`).join(', ')}</dd></div><div className="flex justify-between gap-4"><dt className="text-muted">When</dt><dd>{new Date(`${receipt.draft.date}T12:00:00+05:30`).toLocaleDateString('en-IN',{day:'numeric',month:'short',timeZone:'Asia/Kolkata'})} · {formatTime(receipt.draft.time)}</dd></div><div className="flex justify-between gap-4"><dt className="text-muted">Where</dt><dd className="text-right">{receipt.draft.address.street}, {city}</dd></div><div className="flex justify-between gap-4 border-t pt-4 font-semibold"><dt>Estimated total</dt><dd>{formatMoney(receipt.draft.total)}</dd></div></dl><button onClick={onBack} className="button-primary mt-8 w-full">Back to services<ArrowRight size={18}/></button></div></main></div>;
  const addressDone=Object.keys(addressErrors(address)).length===0;
  return <div className="min-h-screen bg-surface">
    <header className="border-b bg-white"><div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-6 md:px-8"><Brand compact/><span className="flex items-center gap-2 text-sm text-muted"><LockKeyhole size={16}/><span>{preview?'Sample booking':'Your booking'}</span></span></div></header>
    <main id="main-content" className="mx-auto max-w-7xl px-6 pb-16 pt-8 md:px-8 md:pt-12">
      <div className="mb-8 flex items-start gap-4"><button disabled={busy} className="button-secondary shrink-0" aria-label={step>1?'Back to previous step':'Back to services'} onClick={()=>step>1?nextStep(step-1):onBack()}><ArrowLeft size={18}/></button><div><p className="mb-2 text-sm font-medium text-muted">Your booking details</p><h1 ref={titleRef} tabIndex={-1} className="text-3xl font-semibold tracking-[-1px] outline-none md:text-4xl">Enter your booking details</h1></div></div>
      <ol aria-label="Booking progress" className="mb-8 flex items-center gap-4 text-sm md:hidden">{['Address','Schedule','Review'].map((label,i)=><li key={label} className={`flex items-center gap-2 ${step===i+1?'font-semibold text-accent':'text-muted'}`} aria-current={step===i+1?'step':undefined}><span className={`step-number ${step===i+1?'bg-accent! text-white!':''}`}>{step>i+1?<Check size={16}/>:i+1}</span>{label}</li>)}</ol>
      <div className="grid items-start gap-8 md:grid-cols-3">
        <div className={`space-y-8 md:col-span-2 ${step===3?'hidden md:block':''}`}>
          <section className={`rounded-2xl border bg-white p-6 md:p-8 ${step!==1?'hidden md:block':''}`} aria-labelledby="address-title"><div className="mb-8 flex items-center gap-4"><span className={`step-number ${addressDone?'bg-accent! text-white!':''}`}>{addressDone?<Check size={16}/>:1}</span><div><h2 id="address-title" className="text-xl font-semibold tracking-tight">What is your address?</h2><p className="mt-2 text-sm text-muted">Enter the address where you need the service.</p></div></div><div className="mb-6 flex items-center justify-between gap-4 rounded-xl bg-surface px-6 py-4"><span className="flex items-center gap-2 text-sm font-medium"><MapPin size={18} className="text-accent"/>{city}</span><span className="text-xs text-muted">Your city</span></div>
          <fieldset disabled={busy} className="grid gap-6 sm:grid-cols-2"><Field id="address-name" label="Full name" autoComplete="name" value={address.name} maxLength={80} onChange={e=>update('name',e.target.value)} error={errors.name} placeholder="Your full name"/><Field id="address-phone" label="Mobile number" type="tel" inputMode="tel" autoComplete="tel-national" value={address.phone} maxLength={10} onChange={e=>update('phone',e.target.value.replace(/\D/g,''))} error={errors.phone} placeholder="10-digit mobile number"/><div className="sm:col-span-2"><Field id="address-street" label="Flat, building & street" autoComplete="street-address" value={address.street} maxLength={250} onChange={e=>update('street',e.target.value)} error={errors.street} placeholder="e.g. 24, Palm Grove, 12th Main"/></div><Field id="address-area" label="Area" autoComplete="address-level3" value={address.area} maxLength={120} onChange={e=>update('area',e.target.value)} error={errors.area} placeholder="e.g. Indiranagar"/><Field id="address-pincode" label="PIN code" inputMode="numeric" autoComplete="postal-code" value={address.pincode} maxLength={6} onChange={e=>update('pincode',e.target.value.replace(/\D/g,''))} error={errors.pincode} placeholder="6-digit PIN code"/></fieldset>
          <fieldset disabled={busy} className="mt-6"><legend className="mb-2 text-sm font-medium">Is this your home or work address?</legend><div className="flex flex-wrap gap-2">{(['Home','Work','Other'] as const).map(label=><label key={label} className={`flex min-h-14 cursor-pointer items-center gap-2 rounded-xl border px-6 py-4 text-sm transition-colors has-focus-visible:outline-2 has-focus-visible:outline-accent ${address.label===label?'border-accent bg-white text-accent':'bg-surface text-muted'}`}><input type="radio" name="address-label" value={label} checked={address.label===label} onChange={()=>update('label',label)} className="sr-only"/>{label==='Home'&&<Home size={16}/>} {label}</label>)}</div></fieldset><button className="button-primary mt-8 w-full md:hidden" onClick={()=>{if(validateAddress())nextStep(2);}}>Next: choose date and time<ArrowRight size={18}/></button></section>
          <section className={`rounded-2xl border bg-white p-6 md:p-8 ${step!==2?'hidden md:block':''}`} aria-labelledby="schedule-title"><div className="mb-8 flex items-center gap-4"><span className={`step-number ${time?'bg-accent! text-white!':''}`}>{time?<Check size={16}/>:2}</span><div><h2 id="schedule-title" tabIndex={-1} className="text-xl font-semibold tracking-tight outline-none">Choose a date and time</h2><p className="mt-2 text-sm text-muted">Choose when you want the visit.</p></div></div><fieldset disabled={busy}><legend className="mb-4 text-sm font-medium">Select a day</legend><div className="category-strip -mx-2 flex gap-2 overflow-x-auto px-2 pb-2">{days.map(day=><label key={day.iso} className={`flex min-w-24 shrink-0 cursor-pointer flex-col items-center rounded-xl border px-6 py-4 text-center transition-colors has-focus-visible:outline-2 has-focus-visible:outline-accent ${date===day.iso?'border-accent bg-accent text-white':'bg-white hover:bg-surface'}`}><input type="radio" className="sr-only" name="booking-day" value={day.iso} checked={date===day.iso} onChange={()=>{setDate(day.iso);setTime('');setErrors(e=>({...e,slot:undefined}));}}/><span className={`text-xs ${date===day.iso?'text-white':'text-muted'}`}>{day.weekday}</span><span className="my-2 text-2xl font-semibold">{day.number}</span><span className="text-xs">{day.month}</span></label>)}</div></fieldset>
          <fieldset disabled={busy} className="mt-8"><legend className="mb-4 text-sm font-medium">Choose a time <span className="font-normal text-muted">· IST</span></legend><div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">{hours.map(hour=>{const available=slotAvailable(date,hour,now);return <label key={hour} className={`flex min-h-14 min-w-0 items-center justify-center rounded-xl border px-2 py-4 text-center text-sm font-medium transition-colors has-focus-visible:outline-2 has-focus-visible:outline-accent ${!available?'cursor-not-allowed bg-surface text-muted line-through':time===hour?'cursor-pointer border-accent bg-accent text-white':'cursor-pointer bg-white hover:border-accent hover:text-accent'}`}><input type="radio" className="sr-only" name="booking-time" aria-label={formatTime(hour)} disabled={!available} checked={time===hour} onChange={()=>{setTime(hour);setErrors(e=>({...e,slot:undefined,submit:undefined}));}}/><span className="whitespace-nowrap">{formatTime(hour)}</span></label>;})}</div>{errors.slot&&<p className="mt-4 text-sm text-danger" role="alert">{errors.slot}</p>}</fieldset><p className="mt-6 flex items-center gap-2 text-xs leading-5 text-muted"><CalendarDays size={16} className="shrink-0"/>{preview?'These times are examples. No visit will be booked.':'Availability will be confirmed before payment.'}</p><button className="button-primary mt-8 w-full md:hidden" disabled={!time} onClick={()=>nextStep(3)}>Review booking<ArrowRight size={18}/></button></section>
        </div>
        <div className={`${step!==3?'hidden md:block':''} md:sticky md:top-6`}>
          <div className="mb-6 space-y-4 rounded-xl border bg-white p-6 md:hidden"><div className="flex items-center justify-between"><h2 className="font-semibold">Your appointment</h2><button className="rounded-xl px-6 py-4 text-sm font-medium text-accent" onClick={()=>nextStep(1)}>Edit</button></div><p className="text-sm leading-6 text-muted">{address.street}, {address.area}<br/>{city} – {address.pincode}</p><p className="text-sm font-medium">{days.find(d=>d.iso===date)?.number} {days.find(d=>d.iso===date)?.month} · {time&&formatTime(time)}</p></div>
          <Invoice items={items} taxBasisPoints={taxBasisPoints} onChange={onChange} onConfirm={submit} busy={busy} preview={preview} error={errors.submit}/>
        </div>
      </div>
    </main>
  </div>;
}
