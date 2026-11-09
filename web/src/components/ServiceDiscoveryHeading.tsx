import './home-content-motion.css';
export function ServiceDiscoveryHeading({city}:{city?:string;paused:boolean}){
 return <h2 className="service-discovery-heading">{city?`Home services in ${city}`:'Home services nearby'}</h2>;
}
