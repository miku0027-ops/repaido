import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {B2BMarketplace} from '../src/components/B2BMarketplace';
import {ShopB2BSection} from '../src/components/ShopB2BSection';
import {apiFetch} from '../src/services/api';
import '../src/styles.css';
import '../src/design-system.css';
import '../src/customer-layout.css';
import '../src/components/operations.css';

// Presentation props come from the same verified test session used by the API.
// This preview never replaces authentication or supplies fabricated responses.
const params=new URLSearchParams(location.search);
async function verifiedAccount(){
  const token=localStorage.getItem('repaido.token');
  if(!token)return null;
  const response=await apiFetch('/api/auth/me',{headers:{Authorization:'Bearer '+token}});
  return response.ok?response.json():null;
}
const initial=await verifiedAccount();
function Preview(){
  const [account,setAccount]=useState(initial);
  useEffect(()=>{
    const changed=()=>{void verifiedAccount().then(setAccount);};
    window.addEventListener('b2b-preview-account',changed);
    return()=>window.removeEventListener('b2b-preview-account',changed);
  },[]);
  // Reproduce accounts with the same displayed contact fields while their real
  // signed sessions and IDs differ. Contact display is never an auth boundary.
  const display=account&&params.get('sharedContact')==='1'?{...account,email:'',phone:''}:account;
  return (
  <main className={params.get('mode')==='shop'?'operations':'repaido-customer-shell'} style={{padding:16}}>
    <h1 style={{fontSize:18}}>Wholesale verification</h1>
    {params.get('mode')==='shop'
      ?<ShopB2BSection shopId={params.get('shop')||undefined} shopName="Isolated wholesale shop"/>
      :<B2BMarketplace customerUser={display} onSignIn={()=>window.dispatchEvent(new Event('b2b-preview-sign-in'))}/>}
    <p role="status" id="preview-action"/>
  </main>
  );
}
createRoot(document.getElementById('root')!).render(<Preview/>);
window.addEventListener('b2b-preview-sign-in',()=>{document.getElementById('preview-action')!.textContent='Sign-in requested';});
