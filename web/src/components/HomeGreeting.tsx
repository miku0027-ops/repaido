import {useEffect,useRef,useState,type CSSProperties} from 'react';
import {ChevronDown,MapPin} from 'lucide-react';

export function HomeGreeting({greeting,location,onLocation}:{greeting:string;location:string;onLocation:()=>void}) {
  const text=useRef<HTMLSpanElement>(null);
  const [width,setWidth]=useState(180);
  useEffect(()=>{
    if(!text.current)return;
    const measure=()=>setWidth(Math.ceil(text.current?.getBoundingClientRect().width||180));
    const observer=new ResizeObserver(measure);observer.observe(text.current);measure();
    return()=>observer.disconnect();
  },[location]);
  return <div className="home-greeting lg:hidden">
    <button type="button" className="home-location-summary" aria-label={`${greeting} Change service location: ${location}`} onClick={onLocation}>
      <span className="repaido-greeting-text">{greeting}</span>
      <span className="home-location-line" aria-hidden="true">
        <MapPin size={13}/>
        <span className="home-location-ticker" style={{'--location-text-width':`${width}px`} as CSSProperties}>
          <span className="home-location-track"><span ref={text}>{location}</span><span>{location}</span></span>
        </span>
        <ChevronDown size={13}/>
      </span>
    </button>
    
  </div>;
}
