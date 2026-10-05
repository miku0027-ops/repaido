/** Isolated artwork from the supplied reference, not a screenshot used as UI. */
const crops:Record<string,[number,number,number,number]>={
 cleaning:[185,646,110,100],plumber:[415,648,115,97],electrician:[647,646,105,100],
 ac:[194,818,100,100],road:[391,833,151,75],garden:[650,816,115,104],
 hero:[490,370,310,244],
};
export default function ReferenceArt({name,className=''}:{name:string;className?:string}){
 const [x,y,w,h]=crops[name]||crops.cleaning;
 return <span aria-hidden="true" className={`reference-art ${className}`} style={{aspectRatio:`${w}/${h}`}}><img src="/reference/home-source.png" alt="" style={{width:`${941/w*100}%`,height:`${1672/h*100}%`,left:`${-x/w*100}%`,top:`${-y/h*100}%`}}/></span>;
}
