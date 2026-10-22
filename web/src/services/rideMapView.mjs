const rad=Math.PI/180;
const merc=lat=>Math.log(Math.tan(Math.PI/4+Math.max(-85,Math.min(85,lat))*rad/2));
const valid=p=>p&&Number.isFinite(p.lat)&&Math.abs(p.lat)<=90&&Number.isFinite(p.lng)&&Math.abs(p.lng)<=180;
/** Fit actual confirmed stops/route to the available map, reserving attribution.
 * @returns {{center:{lat:number,lng:number},zoom:number}|null}
 * @param {{phase?:string,origin?:{lat:number,lng:number},destination?:{lat:number,lng:number},route?:Array<{lat:number,lng:number}>,position?:{lat:number,lng:number}|null,width?:number,height?:number}} input
 */
export function rideMapView({phase='planning',origin,destination,route=[],position,width=360,height=250}){
 if(!valid(origin))return null;
 if(phase==='searching'||phase==='empty')return {center:origin,zoom:phase==='searching'?13.5:13};
 if(phase==='arrived')return {center:origin,zoom:17};
 if(phase==='assigned')return {center:valid(position)?position:origin,zoom:15.5};
 const points=(phase==='in_progress'?[position||origin,destination,...route]:[origin,destination,...route]).filter(valid);
 if(points.length<2)return {center:origin,zoom:14.5};
 const ys=points.map(p=>merc(p.lat)),anchor=points[0].lng;
 const xs=points.map(p=>anchor+((p.lng-anchor+540)%360-180));
 const minY=Math.min(...ys),maxY=Math.max(...ys),minX=Math.min(...xs),maxX=Math.max(...xs);
 const xZoom=Math.log2(Math.max(100,width-64)/(256*Math.max((maxX-minX)/360,1e-8)));
 const yZoom=Math.log2(Math.max(100,height-72)/(256*Math.max((maxY-minY)/(2*Math.PI),1e-8)));
 return {center:{lat:(2*Math.atan(Math.exp((minY+maxY)/2))-Math.PI/2)/rad,lng:((minX+maxX)/2+540)%360-180},zoom:Math.max(3,Math.min(17,xZoom,yZoom))};
}
