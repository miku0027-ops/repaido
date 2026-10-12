export function discoveryFocus({now=new Date(),personalised=false,transportInterest=false,repairInterest=false}={}){
 const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',hourCycle:'h23'}).format(now));
 if((hour>=7&&hour<9)||(hour>=17&&hour<19))return 'transport';
 if(hour>=10&&hour<12)return 'repair';
 if(personalised&&transportInterest)return 'transport';
 return personalised&&repairInterest?'repair':'transport';
}
