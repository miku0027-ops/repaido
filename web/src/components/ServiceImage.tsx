import type { Service } from '../types';

/** Each service uses one cell of a shared 5 × 4 photographic sheet. */
export default function ServiceImage({service,className='',decorative=false}:{service:Service;className?:string;decorative?:boolean}) {
  const tile=service.imageTile;
  return <span className={`relative block overflow-hidden ${className}`}>
    <img src={service.image} alt={decorative?'':service.imageAlt} loading="lazy" style={tile===undefined?{width:'100%',height:'100%',objectFit:'cover'}:{position:'absolute',maxWidth:'none',width:'500%',height:'400%',left:`-${tile%5*100}%`,top:`-${Math.floor(tile/5)*100}%`}}/>
  </span>;
}
