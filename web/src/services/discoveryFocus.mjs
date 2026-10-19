/** @param {{now?:Date,personalised?:boolean,transportInterest?:boolean,repairInterest?:boolean,preferredFocus?:'transport'|'repair'|'marketplace'|null}} [options] */
export function discoveryFocus({now=new Date(),personalised=false,transportInterest=false,repairInterest=false,preferredFocus=null}={}){
 const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',hourCycle:'h23'}).format(now));
 if((hour>=7&&hour<9)||(hour>=17&&hour<19))return 'transport';
 if(hour>=10&&hour<12)return 'repair';
 if(personalised&&['transport','repair','marketplace'].includes(preferredFocus))return preferredFocus;
 if(personalised&&transportInterest)return 'transport';
 return personalised&&repairInterest?'repair':'transport';
}

// Only server-confirmed catalogue categories describe an intent. No keywords,
// coordinates or form data are retained in the UI's event bridge.
/** @returns {{focus:'transport',mode:string|null}|{focus:'repair',category:string}|{focus:'marketplace',mode:string}|null} */
export function typeDiscoveryIntent(categories){
 if(!Array.isArray(categories)||!categories.length)return null;
 const marketMode=['refurbished','preowned','rentals','sell'].find(mode=>categories.includes('market_'+mode));
 if(marketMode)return {focus:'marketplace',mode:marketMode};
 const modes=['bike','cab','shared','self_drive','rental'];
 const mode=modes.find(mode=>categories.includes('transport_'+mode));
 if(mode||categories.includes('transport'))return {focus:'transport',mode:mode||null};
 const category=categories.find(value=>typeof value==='string'&&/^[a-z][a-z0-9_:-]{0,99}$/.test(value)&&!value.startsWith('transport')&&!value.startsWith('market'));
 return category?{focus:'repair',category}:null;
}
