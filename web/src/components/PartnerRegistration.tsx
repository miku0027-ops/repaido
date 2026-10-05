import React, { useState } from 'react';
import {
  ArrowLeft, ArrowRight, Store, Wrench, Crown, BadgeCheck,
  CheckCircle2, MapPin, CreditCard, Zap, Package, ChevronRight,
  AlertCircle, Check
} from 'lucide-react';
import { LocationPickerModal } from './LocationPickerModal';

type RegistrationType = null | 'shop' | 'technician' | 'specialist';
type SpecialistPlan = 'monthly' | 'yearly';

const TECHNICIAN_CATEGORIES = [
  'AC & Appliance Repair','Plumbing','Electrical Work','Home Cleaning',
  'Carpentry & Woodwork','Painting & Wall Décor','Vehicle Assistance',
  'Gardening & Landscaping','Salon & Beauty at Home','Pest Control',
  'Water Purifier Service','CCTV & Security Installation',
  'Computer & IT Repair','Welding & Fabrication','Glass & Glazing',
  'Tiling & Flooring','Roofing & Waterproofing','Generator & UPS Repair',
];

const SHOP_CATEGORIES = [
  'Electronics & Spare Parts','Plumbing Supplies','Electrical Equipment',
  'Hardware & Construction Tools','Paint & Wall Supplies','Automotive Parts',
  'Home Appliance Parts','Cleaning Supplies & Chemicals',
  'Water Treatment Equipment','Safety & Security Equipment',
  'Garden & Agricultural Supplies','Furniture & Fittings',
  'Tiles & Flooring Materials','Sanitary Ware','HVAC Parts',
  'Power Tools & Accessories','General Hardware Store','EV & Battery Parts',
];

const CITIES = ['Balasore','Bhadrak','Jajpur','Bhubaneswar','Cuttack','Puri','Berhampur','Rourkela','Sambalpur'];

declare global { interface Window { Razorpay: any; } }

async function loadRazorpay(): Promise<boolean> {
  return new Promise(resolve => {
    if (window.Razorpay) { resolve(true); return; }
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

async function openRazorpay(opts: { name:string; email:string; phone:string; plan:SpecialistPlan; onSuccess:(pid:string)=>void; onFail:()=>void; }) {
  const ok = await loadRazorpay();
  if (!ok) { alert('Payment gateway failed to load.'); opts.onFail(); return; }
  const amount = opts.plan === 'yearly' ? 999900 : 149900;
  const rzp = new window.Razorpay({
    key: 'YOUR_RAZORPAY_KEY_ID',
    amount, currency: 'INR',
    name: 'Repaido Specialist Onboarding',
    description: opts.plan === 'yearly' ? 'Verified Specialist — Annual Plan (₹9,999)' : 'Verified Specialist — Monthly Plan (₹1,499)',
    image: '/brand/repaido-logo-transparent.png',
    handler: (r: any) => opts.onSuccess(r.razorpay_payment_id),
    prefill: { name: opts.name, email: opts.email, contact: opts.phone },
    theme: { color: '#7c3aed' },
    modal: { ondismiss: opts.onFail },
  });
  rzp.open();
}

function Toggle({ label, value, onChange }: { label:string; value:boolean; onChange:()=>void }) {
  return (
    <button type="button" onClick={onChange}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-semibold transition-all select-none ${
        value ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:border-blue-400'
      }`}>
      {value && <Check size={12}/>} {label}
    </button>
  );
}

function StepBar({ steps, current }: { steps:string[]; current:number }) {
  return (
    <div className="flex items-center gap-0 mb-8">
      {steps.map((s,i) => (
        <React.Fragment key={i}>
          <div className="flex flex-col items-center">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2 ${
              i<current?'bg-green-500 border-green-500 text-white':i===current?'bg-blue-600 border-blue-600 text-white':'bg-white border-slate-300 text-slate-400'
            }`}>{i<current?<Check size={14}/>:i+1}</div>
            <span className={`text-sm mt-1 font-semibold whitespace-nowrap ${i===current?'text-blue-700':'text-slate-400'}`}>{s}</span>
          </div>
          {i<steps.length-1&&<div className={`flex-1 h-0.5 mb-4 mx-1 ${i<current?'bg-green-500':'bg-slate-200'}`}/>}
        </React.Fragment>
      ))}
    </div>
  );
}

function Field({ label, children, required }: { label:string; children:React.ReactNode; required?:boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-bold text-slate-600 uppercase tracking-wider">
        {label}{required&&<span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

const ic = "w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all";

function readImageFile(file: File, onLoad: (dataUrl: string) => void) {
  if (!file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = () => onLoad(String(reader.result));
  reader.readAsDataURL(file);
}

// ────────────────────────────────────────────────────────────
// SHOP FLOW
// ────────────────────────────────────────────────────────────
function ShopFlow({ onBack, onDone }: { onBack:()=>void; onDone:()=>void }) {
  const [step, setStep] = useState(0);
  const [mapOpen, setMapOpen] = useState(false);
  const [f, setF] = useState({ ownerName:'',phone:'',email:'',dob:'',profileImage:'',shopName:'',shopTagline:'',gstin:'',tradeLicense:'',address:'',city:'Balasore',pincode:'',lat:21.4934,lng:86.9135,locationConfirmed:false,categories:[] as string[],bankHolder:'',bankName:'',accountNumber:'',confirmAccount:'',ifscCode:'',upiId:'',aadhaarNumber:'',panNumber:'',agree:false });
  const s=(k:keyof typeof f,v:any)=>setF(p=>({...p,[k]:v}));
  const tog=(c:string)=>s('categories',f.categories.includes(c)?f.categories.filter((x:string)=>x!==c):[...f.categories,c]);
  const steps=['Owner Details','Shop Info','Bank & KYC','Review'];

  const submit=()=>{
    const arr=JSON.parse(localStorage.getItem('repaido_shop_registrations')||'[]');
    arr.push({...f,id:`shop_${Date.now()}`,status:'pending_verification',createdAt:new Date().toISOString()});
    localStorage.setItem('repaido_shop_registrations',JSON.stringify(arr));
    onDone();
  };

  return (
    <div className="partner-reg-flow shop-theme">
      <button className="partner-back-btn" onClick={step===0?onBack:()=>setStep(p=>p-1)}>
        <ArrowLeft size={16}/> {step===0?'Back to Options':'Previous Step'}
      </button>
      <div className="partner-flow-header shop">
        <div className="partner-flow-icon"><Store size={28}/></div>
        <div><h2>Register Your Shop</h2><p>Join Repaido's verified spare parts & supplies network</p></div>
      </div>
      <StepBar steps={steps} current={step}/>

      {step===0&&<div className="partner-form-grid">
        <Field label="Full Name (Owner)" required><input className={ic} placeholder="Your legal name" value={f.ownerName} onChange={e=>s('ownerName',e.target.value)}/></Field>
        <Field label="Mobile Number" required><input className={ic} placeholder="+91 XXXXX XXXXX" value={f.phone} onChange={e=>s('phone',e.target.value)}/></Field>
        <Field label="Email Address"><input className={ic} type="email" placeholder="owner@email.com" value={f.email} onChange={e=>s('email',e.target.value)}/></Field>
        <Field label="Date of Birth"><input className={ic} type="date" value={f.dob} onChange={e=>s('dob',e.target.value)}/></Field>
        <Field label="Aadhaar Number" required><input className={ic} placeholder="XXXX XXXX XXXX" maxLength={14} value={f.aadhaarNumber} onChange={e=>s('aadhaarNumber',e.target.value)}/></Field>
        <Field label="PAN Number" required><input className={ic} placeholder="ABCDE1234F" maxLength={10} value={f.panNumber} onChange={e=>s('panNumber',e.target.value)}/></Field>
        <Field label="Shop Owner Profile Picture" required>
          <div className="flex items-center gap-3">
            {f.profileImage && <img src={f.profileImage} alt="Shop owner preview" className="w-14 h-14 rounded-full object-cover border border-slate-200" />}
            <input className={ic} type="file" accept="image/png,image/jpeg,image/webp" required={!f.profileImage} onChange={e=>e.target.files?.[0]&&readImageFile(e.target.files[0],v=>s('profileImage',v))}/>
          </div>
        </Field>
      </div>}

      {step===1&&<div className="partner-form-grid">
        <Field label="Shop Name" required><input className={ic} placeholder="e.g. Sharma Electronics & Spares" value={f.shopName} onChange={e=>s('shopName',e.target.value)}/></Field>
        <Field label="Shop Tagline"><input className={ic} placeholder="e.g. Quality parts, fair prices" value={f.shopTagline} onChange={e=>s('shopTagline',e.target.value)}/></Field>
        <Field label="GSTIN"><input className={ic} placeholder="22AAAAA0000A1Z5" value={f.gstin} onChange={e=>s('gstin',e.target.value)}/></Field>
        <Field label="Trade License" required><input className={ic} placeholder="TL-XXXX-XXXX" value={f.tradeLicense} onChange={e=>s('tradeLicense',e.target.value)}/></Field>
        <Field label="Shop Address" required><input className={ic} placeholder="Street, Area, Landmark" value={f.address} onChange={e=>s('address',e.target.value)}/></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="City" required><select className={ic+" cursor-pointer"} value={f.city} onChange={e=>s('city',e.target.value)}>{CITIES.map(c=><option key={c}>{c}</option>)}</select></Field>
          <Field label="PIN Code"><input className={ic} placeholder="756001" maxLength={6} value={f.pincode} onChange={e=>s('pincode',e.target.value)}/></Field>
        </div>
        <Field label="Shop Location on Map" required>
          <button type="button" onClick={()=>setMapOpen(true)} className="flex items-center gap-3 w-full px-4 py-3 rounded-xl border-2 border-dashed border-blue-300 bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold text-sm transition-all">
            <MapPin size={18}/> {f.locationConfirmed?`📍 ${f.lat.toFixed(4)}, ${f.lng.toFixed(4)}`:'Set exact shop pin on map'}
          </button>
        </Field>
        <div className="partner-section-title"><Package size={16}/> Shop Categories <span className="text-slate-400 text-sm">(select all that apply)</span></div>
        <div className="partner-cat-grid">{SHOP_CATEGORIES.map(c=><Toggle key={c} label={c} value={f.categories.includes(c)} onChange={()=>tog(c)}/>)}</div>
      </div>}

      {step===2&&<div className="partner-form-grid">
        <div className="partner-section-title"><CreditCard size={16}/> Bank Account for Payouts</div>
        <Field label="Account Holder Name" required><input className={ic} value={f.bankHolder} onChange={e=>s('bankHolder',e.target.value)}/></Field>
        <Field label="Bank Name" required><input className={ic} placeholder="e.g. SBI" value={f.bankName} onChange={e=>s('bankName',e.target.value)}/></Field>
        <Field label="Account Number" required><input className={ic} value={f.accountNumber} onChange={e=>s('accountNumber',e.target.value)}/></Field>
        <Field label="Confirm Account Number" required><input className={ic} value={f.confirmAccount} onChange={e=>s('confirmAccount',e.target.value)}/></Field>
        <Field label="IFSC Code" required><input className={ic} placeholder="SBIN0001234" value={f.ifscCode} onChange={e=>s('ifscCode',e.target.value)}/></Field>
        <Field label="UPI ID"><input className={ic} placeholder="yourname@upi" value={f.upiId} onChange={e=>s('upiId',e.target.value)}/></Field>
        <div className="partner-kyc-notice"><AlertCircle size={16} className="text-amber-600 shrink-0"/><p>Your KYC documents will be verified by the Repaido compliance team within 24–48 hours.</p></div>
      </div>}

      {step===3&&<div className="partner-review-card">
        <h3>Review Your Application</h3>
        <div className="partner-review-row"><span>Shop Name</span><strong>{f.shopName||'—'}</strong></div>
        <div className="partner-review-row"><span>Owner</span><strong>{f.ownerName||'—'}</strong></div>
        <div className="partner-review-row"><span>City</span><strong>{f.city}</strong></div>
        <div className="partner-review-row"><span>Categories</span><strong>{f.categories.length>0?f.categories.slice(0,3).join(', ')+(f.categories.length>3?` +${f.categories.length-3} more`:''):'—'}</strong></div>
        <div className="partner-review-row"><span>GSTIN</span><strong>{f.gstin||'Not provided'}</strong></div>
        <div className="partner-review-row"><span>Bank</span><strong>{f.bankName||'—'}</strong></div>
        <div className="partner-review-row"><span>Location</span><strong>{f.lat.toFixed(4)}, {f.lng.toFixed(4)}</strong></div>
        <label className="flex items-start gap-3 mt-4 cursor-pointer">
          <input type="checkbox" checked={f.agree} onChange={e=>s('agree',e.target.checked)} className="mt-1"/>
          <span className="text-sm text-slate-600">I agree to Repaido's Partner Terms & Conditions and confirm all information provided is accurate.</span>
        </label>
      </div>}

      <div className="partner-form-actions">
        {step<3?<button className="partner-cta-btn shop-btn" onClick={()=>setStep(p=>p+1)} disabled={(step===0&&!f.profileImage)||(step===1&&(!f.locationConfirmed||f.categories.length===0))}>Continue <ArrowRight size={16}/></button>
          :<button className="partner-cta-btn shop-btn" onClick={submit} disabled={!f.agree}><Store size={16}/> Send shop application</button>}
      </div>
          {mapOpen&&<LocationPickerModal isOpen={mapOpen} initialLat={f.lat} initialLng={f.lng} onConfirmLocation={({lat,lng})=>{s('lat',lat);s('lng',lng);s('locationConfirmed',true);setMapOpen(false);}} onClose={()=>setMapOpen(false)}/>} 
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// WORKER FLOW (technician or specialist)
// ────────────────────────────────────────────────────────────
function WorkerFlow({ mode, onBack, onDone }: { mode:'technician'|'specialist'; onBack:()=>void; onDone:()=>void }) {
  const isSp=mode==='specialist';
  const [step,setStep]=useState(0);
  const [mapOpen,setMapOpen]=useState(false);
  const [plan,setPlan]=useState<SpecialistPlan>('monthly');
  const [paid,setPaid]=useState(false);
  const [payId,setPayId]=useState('');
  const [paying,setPaying]=useState(false);
  const [f,setF]=useState({ name:'',phone:'',email:'',dob:'',gender:'Male',profileImage:'',homeAddress:'',city:'Balasore',pincode:'',categories:[] as string[],experienceYears:'1',toolsList:'',pricingModel:'hourly' as 'hourly'|'fixed',baseFare:'150',hourlyRate:'299',fixedPrice:'499',aadhaarNumber:'',panNumber:'',bankHolder:'',bankName:'',accountNumber:'',confirmAccount:'',ifscCode:'',upiId:'',lat:21.4934,lng:86.9135,locationConfirmed:false,agree:false });
  const s=(k:keyof typeof f,v:any)=>setF(p=>({...p,[k]:v}));
  const tog=(c:string)=>s('categories',f.categories.includes(c)?f.categories.filter((x:string)=>x!==c):[...f.categories,c]);

  const steps=isSp?['Personal Info','Skills & Location','Pricing','Payment','Bank & KYC']:['Personal Info','Skills & Location','Pricing','Bank & KYC'];
  const payIdx=isSp?3:-1;
  const bankIdx=isSp?4:3;

  const handlePayment=async()=>{
    setPaying(true);
    await openRazorpay({ name:f.name,email:f.email,phone:f.phone,plan, onSuccess:(pid)=>{setPayId(pid);setPaid(true);setStep(p=>p+1);setPaying(false);}, onFail:()=>setPaying(false) });
  };

  const submit=()=>{
    const arr=JSON.parse(localStorage.getItem('repaido_worker_registrations')||'[]');
    arr.push({...f,id:`worker_${Date.now()}`,role:mode,isVerifiedSpecialist:isSp&&paid,specialistBadge:isSp&&paid,specialistPlan:isSp?plan:null,razorpayPaymentId:payId||null,status:'pending_kyc',createdAt:new Date().toISOString()});
    localStorage.setItem('repaido_worker_registrations',JSON.stringify(arr));
    onDone();
  };

  const ac=isSp?'specialist':'technician';

  return (
    <div className={`partner-reg-flow ${ac}-theme`}>
      <button className="partner-back-btn" onClick={step===0?onBack:()=>setStep(p=>p-1)}>
        <ArrowLeft size={16}/> {step===0?'Back to Options':'Previous Step'}
      </button>
      <div className={`partner-flow-header ${ac}`}>
        <div className="partner-flow-icon">{isSp?<Crown size={28}/>:<Wrench size={28}/>}</div>
        <div>
          <h2>{isSp?'Verified Specialist Registration':'Technician Registration'}</h2>
          <p>{isSp?'Premium badge · Priority discovery · Higher payouts':'Join Repaido and earn on your schedule'}</p>
        </div>
      </div>

      {isSp&&<div className="specialist-plan-banner">
        <div className="plan-banner-inner"><Crown size={16} className="text-yellow-400"/> Choose your Specialist Plan</div>
        <div className="plan-options">
          {(['monthly','yearly'] as SpecialistPlan[]).map(pl=>(
            <button key={pl} onClick={()=>setPlan(pl)} className={`plan-option${plan===pl?' active':''}`}>
              {pl==='yearly'&&<div className="plan-badge">SAVE 44%</div>}
              <span className="plan-label">{pl==='monthly'?'Monthly':'Yearly'}</span>
              <span className="plan-price">{pl==='monthly'?'₹1,499':'₹9,999'}<span>{pl==='monthly'?'/mo':'/yr'}</span></span>
            </button>
          ))}
        </div>
      </div>}

      <StepBar steps={steps} current={step}/>

      {step===0&&<div className="partner-form-grid">
        <Field label="Full Name" required><input className={ic} placeholder="Your legal name" value={f.name} onChange={e=>s('name',e.target.value)}/></Field>
        <Field label="Mobile Number" required><input className={ic} placeholder="+91 XXXXX XXXXX" value={f.phone} onChange={e=>s('phone',e.target.value)}/></Field>
        <Field label="Email Address"><input className={ic} type="email" value={f.email} onChange={e=>s('email',e.target.value)}/></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Date of Birth"><input className={ic} type="date" value={f.dob} onChange={e=>s('dob',e.target.value)}/></Field>
          <Field label="Gender"><select className={ic+" cursor-pointer"} value={f.gender} onChange={e=>s('gender',e.target.value)}>{['Male','Female','Non-binary','Prefer not to say'].map(g=><option key={g}>{g}</option>)}</select></Field>
        </div>
        <Field label="Home Address" required><input className={ic} placeholder="Street, area, landmark" value={f.homeAddress} onChange={e=>s('homeAddress',e.target.value)}/></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="City" required><select className={ic+" cursor-pointer"} value={f.city} onChange={e=>s('city',e.target.value)}>{CITIES.map(c=><option key={c}>{c}</option>)}</select></Field>
          <Field label="PIN Code"><input className={ic} placeholder="756001" maxLength={6} value={f.pincode} onChange={e=>s('pincode',e.target.value)}/></Field>
        </div>
        <Field label="Aadhaar Number" required><input className={ic} placeholder="XXXX XXXX XXXX" maxLength={14} value={f.aadhaarNumber} onChange={e=>s('aadhaarNumber',e.target.value)}/></Field>
        <Field label="PAN Number" required><input className={ic} placeholder="ABCDE1234F" maxLength={10} value={f.panNumber} onChange={e=>s('panNumber',e.target.value)}/></Field>
        <Field label="Profile Picture" required>
          <div className="flex items-center gap-3">
            {f.profileImage && <img src={f.profileImage} alt="Profile preview" className="w-14 h-14 rounded-full object-cover border border-slate-200" />}
            <input className={ic} type="file" accept="image/png,image/jpeg,image/webp" required={!f.profileImage} onChange={e=>e.target.files?.[0]&&readImageFile(e.target.files[0],v=>s('profileImage',v))}/>
          </div>
        </Field>
      </div>}

      {step===1&&<div className="partner-form-grid">
        <Field label="Years of Experience" required><select className={ic+" cursor-pointer"} value={f.experienceYears} onChange={e=>s('experienceYears',e.target.value)}>{['0–1','1','2','3','4','5','6','7','8','10+'].map(y=><option key={y} value={y}>{y} yr{y==='1'?'':'s'}</option>)}</select></Field>
        <Field label="Tools & Equipment (comma separated)"><input className={ic} placeholder="e.g. Multimeter, AC vacuum pump, drill" value={f.toolsList} onChange={e=>s('toolsList',e.target.value)}/></Field>
        <Field label="Service Location on Map" required>
          <button type="button" onClick={()=>setMapOpen(true)} className="flex items-center gap-3 w-full px-4 py-3 rounded-xl border-2 border-dashed border-blue-300 bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold text-sm transition-all">
            <MapPin size={18}/> {f.locationConfirmed?`📍 ${f.lat.toFixed(4)}, ${f.lng.toFixed(4)}`:'Set exact service pin on map'}
          </button>
        </Field>
        <div className="partner-section-title"><Zap size={16}/> Service Categories <span className="text-slate-400 text-sm">(select all you can offer)</span></div>
        <div className="partner-cat-grid">{TECHNICIAN_CATEGORIES.map(c=><Toggle key={c} label={c} value={f.categories.includes(c)} onChange={()=>tog(c)}/>)}</div>
      </div>}

      {step===2&&<div className="partner-form-grid">
        <div className="partner-section-title"><CreditCard size={16}/> Your Pricing Model</div>
        <div className="grid grid-cols-2 gap-4">
          {(['hourly','fixed'] as const).map(m=>(
            <button key={m} type="button" onClick={()=>s('pricingModel',m)} className={`p-4 rounded-2xl border-2 text-left transition-all ${f.pricingModel===m?(isSp?'border-violet-600 bg-violet-50':'border-blue-600 bg-blue-50'):'border-slate-200 bg-white hover:border-slate-300'}`}>
              <div className="font-bold text-sm mb-1">{m==='hourly'?'⏱ Hourly Rate':'📋 Fixed Price'}</div>
              <div className="text-sm text-slate-500">{m==='hourly'?'Base fare + per-hour billing.':'Flat charge per job.'}</div>
            </button>
          ))}
        </div>
        {f.pricingModel==='hourly'?<div className="grid grid-cols-2 gap-4">
          <Field label="Base Fare (₹)" required><input className={ic} type="number" min="150" value={f.baseFare} onChange={e=>s('baseFare',e.target.value)}/></Field>
          <Field label="Hourly Rate (₹/hr)" required><input className={ic} type="number" value={f.hourlyRate} onChange={e=>s('hourlyRate',e.target.value)}/></Field>
        </div>:<Field label="Fixed Rate per Job (₹)" required><input className={ic} type="number" value={f.fixedPrice} onChange={e=>s('fixedPrice',e.target.value)}/></Field>}
        <div className="partner-kyc-notice"><AlertCircle size={16} className="text-blue-600 shrink-0"/><p>Repaido retains 3% platform fee. You receive 97% of billable amount directly to your bank.</p></div>
      </div>}

      {isSp&&step===payIdx&&<div className="specialist-payment-screen">
        <div className="specialist-badge-preview"><Crown size={40} className="text-yellow-400"/><BadgeCheck size={22} className="text-violet-500 absolute -bottom-1 -right-1 bg-white rounded-full"/></div>
        <h3>Activate Your Verified Specialist Badge</h3>
        <p className="text-slate-500 text-sm text-center max-w-sm mx-auto mt-2">Priority placement in customer searches, official Specialist badge, and the Repaido Pro Kit.</p>
        <div className="specialist-perks">
          {['🏅 Verified badge on profile & bookings','🚀 Priority over regular technicians','💼 Repaido Specialist Pro Kit','📊 Advanced earnings dashboard','🎓 Repaido skill certification','📞 Priority support'].map(p=>(
            <div key={p} className="specialist-perk-item"><CheckCircle2 size={14} className="text-violet-500 shrink-0"/><span>{p}</span></div>
          ))}
        </div>
        <div className="specialist-plan-summary">
          <div className="plan-selected-row"><Crown size={15} className="text-yellow-500"/> Selected: <strong>{plan==='yearly'?'Yearly — ₹9,999':'Monthly — ₹1,499'}</strong></div>
        </div>
        {paid?<div className="payment-success-badge"><CheckCircle2 size={18} className="text-green-500"/> Payment successful! ID: {payId}</div>
          :<button className="partner-cta-btn specialist-btn w-full mt-4" onClick={handlePayment} disabled={paying}>
            {paying?'Processing…':<><Crown size={16}/> Pay {plan==='yearly'?'₹9,999':'₹1,499'} &amp; Activate Specialist</>}
          </button>}
        {paid&&<div className="partner-form-actions"><button className="partner-cta-btn specialist-btn" onClick={()=>setStep(p=>p+1)}>Continue to Bank Details <ArrowRight size={16}/></button></div>}
      </div>}

      {step===bankIdx&&<div className="partner-form-grid">
        <div className="partner-section-title"><CreditCard size={16}/> Bank Account for Payouts</div>
        <Field label="Account Holder Name" required><input className={ic} value={f.bankHolder} onChange={e=>s('bankHolder',e.target.value)}/></Field>
        <Field label="Bank Name" required><input className={ic} placeholder="e.g. SBI" value={f.bankName} onChange={e=>s('bankName',e.target.value)}/></Field>
        <Field label="Account Number" required><input className={ic} value={f.accountNumber} onChange={e=>s('accountNumber',e.target.value)}/></Field>
        <Field label="Confirm Account Number" required><input className={ic} value={f.confirmAccount} onChange={e=>s('confirmAccount',e.target.value)}/></Field>
        <Field label="IFSC Code" required><input className={ic} placeholder="SBIN0001234" value={f.ifscCode} onChange={e=>s('ifscCode',e.target.value)}/></Field>
        <Field label="UPI ID"><input className={ic} placeholder="yourname@upi" value={f.upiId} onChange={e=>s('upiId',e.target.value)}/></Field>
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={f.agree} onChange={e=>s('agree',e.target.checked)} className="mt-1"/>
          <span className="text-sm text-slate-600">I agree to Repaido's Partner Terms & Conditions and certify all details are accurate.</span>
        </label>
        <button className={`partner-cta-btn ${isSp?'specialist-btn':'technician-btn'} w-full`} onClick={submit} disabled={!f.agree}>
          {isSp?<Crown size={16}/>:<Wrench size={16}/>} Submit {isSp?'Specialist':'Technician'} Application
        </button>
      </div>}

      {step!==payIdx&&step!==bankIdx&&<div className="partner-form-actions">
        <button className={`partner-cta-btn ${isSp?'specialist-btn':'technician-btn'}`} onClick={()=>setStep(p=>p+1)} disabled={(step===0&&!f.profileImage)||(step===1&&(!f.locationConfirmed||f.categories.length===0))}>
          Continue <ArrowRight size={16}/>
        </button>
        {step===1&&(!f.locationConfirmed||f.categories.length===0)&&<p className="text-sm text-red-500 text-center">Please set your exact map pin and select at least one service category</p>}
      </div>}

      {mapOpen&&<LocationPickerModal isOpen={mapOpen} initialLat={f.lat} initialLng={f.lng} onConfirmLocation={({lat,lng})=>{s('lat',lat);s('lng',lng);s('locationConfirmed',true);setMapOpen(false);}} onClose={()=>setMapOpen(false)} />}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// SUCCESS SCREEN
// ────────────────────────────────────────────────────────────
function SuccessScreen({ type, onClose }: { type:RegistrationType; onClose:()=>void }) {
  const cfg:Record<string,{icon:string;title:string;sub:string;grad:string}> = {
    shop:{icon:'🏪',title:'Shop application received',sub:"The Repaido team must review your shop and documents before activation.",grad:'from-blue-600 to-cyan-500'},
    technician:{icon:'🔧',title:'Technician application received',sub:'Your profile is pending KYC verification. Once approved you\'ll appear in customer searches and start receiving bookings.',grad:'from-orange-500 to-amber-400'},
    specialist:{icon:'⭐',title:'Specialist application received',sub:'The Repaido team must review your experience and documents before granting specialist status.',grad:'from-violet-700 to-purple-500'},
  };
  const c=cfg[type as string]||cfg.technician;
  return (
    <div className="partner-success-screen">
      <div className={`partner-success-icon bg-gradient-to-br ${c.grad}`}>{c.icon}</div>
      <h2 className="partner-success-title">{c.title}</h2>
      <p className="partner-success-sub">{c.sub}</p>
      <div className="partner-success-steps">
        <div className="success-step"><CheckCircle2 size={16} className="text-green-500"/> Application received</div>
        <div className="success-step"><CheckCircle2 size={16} className="text-green-500"/> Documents under review</div>
        <div className="success-step text-slate-400"><div className="w-4 h-4 rounded-full border-2 border-slate-300"/> Activation after approval</div>
      </div>
      <button className="partner-cta-btn shop-btn mt-8" onClick={onClose}>Back to app <ArrowRight size={16}/></button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// MAIN EXPORT
// ────────────────────────────────────────────────────────────
export default function PartnerRegistration({ onClose }: { onClose:()=>void }) {
  const [type,setType]=useState<RegistrationType>(null);
  const [done,setDone]=useState(false);

  if(done)return<div className="partner-reg-overlay"><SuccessScreen type={type} onClose={onClose}/></div>;
  if(type==='shop')return<div className="partner-reg-overlay"><ShopFlow onBack={()=>setType(null)} onDone={()=>setDone(true)}/></div>;
  if(type==='technician')return<div className="partner-reg-overlay"><WorkerFlow mode="technician" onBack={()=>setType(null)} onDone={()=>setDone(true)}/></div>;
  if(type==='specialist')return<div className="partner-reg-overlay"><WorkerFlow mode="specialist" onBack={()=>setType(null)} onDone={()=>setDone(true)}/></div>;

  return (
    <div className="partner-reg-overlay relative z-0">
      <div className="auth-bg-motion"><div className="orb orb-1"/><div className="orb orb-2"/><div className="orb orb-3"/></div>
      <div className="partner-landing relative z-10" style={{background: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(16px)', borderRadius: 32, boxShadow: '0 20px 40px -10px rgba(0,0,0,0.1)'}}>
        <button className="partner-back-btn" onClick={onClose}><ArrowLeft size={16}/> Back to app</button>
        <div className="partner-landing-hero">
          <img src="/brand/repaido-logo-transparent.png" alt="Repaido" className="h-10 object-contain mb-4"/>
          <h1 style={{fontSize: '3rem', fontWeight: 900, background: 'linear-gradient(to right, #0f306e, #2563eb)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', lineHeight: 1.1, marginBottom: 16}}>
            Become a Lifetime Partner
          </h1>
          <p style={{fontSize: '1.25rem', color: '#334155', fontWeight: 500, lineHeight: 1.6, maxWidth: 600, margin: '0 auto'}}>
            Unlock endless opportunities for work and business. Join Repaido's premium network of verified shops, skilled technicians, and elite specialists.
          </p>
        </div>
        <div className="partner-options-grid">
          <button className="partner-option-card shop-card" onClick={()=>setType('shop')}>
            <div className="option-card-icon shop-icon"><Store size={32}/></div>
            <div className="option-card-content">
              <h3>Register Your Shop</h3>
              <p>List your spare parts & supplies store. Get discovered by Repaido technicians and customers.</p>
              <ul className="option-perks">
                <li><CheckCircle2 size={12}/> Zero inventory risk — sell on demand</li>
                <li><CheckCircle2 size={12}/> Verified supplier badge</li>
                <li><CheckCircle2 size={12}/> Direct payout to your bank</li>
              </ul>
            </div>
            <div className="option-card-cta">Register Shop <ChevronRight size={16}/></div>
          </button>

          <button className="partner-option-card technician-card" onClick={()=>setType('technician')}>
            <div className="option-card-icon technician-icon"><Wrench size={32}/></div>
            <div className="option-card-content">
              <h3>Register as Technician</h3>
              <p>Offer your skills to customers in your area. Set your own pricing and grow your reputation.</p>
              <ul className="option-perks">
                <li><CheckCircle2 size={12}/> Free registration — no upfront cost</li>
                <li><CheckCircle2 size={12}/> Earn ₹299–₹999/hr based on skills</li>
                <li><CheckCircle2 size={12}/> Level up to unlock Specialist role</li>
              </ul>
            </div>
            <div className="option-card-cta">Register Free <ChevronRight size={16}/></div>
          </button>

          <button className="partner-option-card specialist-card" onClick={()=>setType('specialist')}>
            <div className="option-card-icon specialist-icon">
              <Crown size={32}/>
              <span className="specialist-card-badge">PREMIUM</span>
            </div>
            <div className="option-card-content">
              <h3>Register as Specialist <BadgeCheck size={16} className="inline text-violet-500 ml-1"/></h3>
              <p>Get the <strong>Verified Specialist badge</strong>, priority placement in all customer searches, and exclusive perks.</p>
              <ul className="option-perks">
                <li><Crown size={12} className="text-yellow-500"/> Priority discovery over technicians</li>
                <li><Crown size={12} className="text-yellow-500"/> Verified badge on profile & bookings</li>
                <li><Crown size={12} className="text-yellow-500"/> Specialist Pro Kit — tools & uniform</li>
              </ul>
              <div className="specialist-pricing-row">
                <span>₹1,499/mo</span><span className="sep">or</span><span>₹9,999/yr <em>save 44%</em></span>
              </div>
            </div>
            <div className="option-card-cta specialist-cta"><Crown size={13}/> Activate Specialist <ChevronRight size={16}/></div>
          </button>
        </div>
      </div>
    </div>
  );
}
