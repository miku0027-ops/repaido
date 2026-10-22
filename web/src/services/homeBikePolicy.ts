import {bikePolicy,type BikePolicy} from './bike-rides-api';

// One short-lived public metadata read shared by home entries; no maps or GPS.
let current:{policy:BikePolicy;at:number}|undefined,pending:Promise<BikePolicy>|undefined;
export function homeBikePolicy(){
 if(current&&Date.now()-current.at<60000)return Promise.resolve(current.policy);
 if(!pending)pending=bikePolicy().then(policy=>{current={policy,at:Date.now()};return policy;}).finally(()=>{pending=undefined;});
 return pending;
}
