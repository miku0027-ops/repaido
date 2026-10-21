import {ArrowLeft,ArrowRight,Bell,CarFront,History,TwoWheeler} from '../icons';
import {RideNotificationControl} from './RideNotificationControl';
import {nativeAvailable} from '../services/native';
import {MobilityExperience,type TravelMode} from './MobilityExperience';
import type {TransportArea} from './TransportRail';
import './repaido-go.css';

/** One quiet home entry. Discovery and location reads start inside Go. */
export function RepaidoGoEntry({onOpen}:{onOpen:()=>void}){
 return <button type="button" className="repaido-go-entry" onClick={onOpen}>
  <span className="go-entry-symbol" aria-hidden="true"><CarFront size={28}/><TwoWheeler size={20}/></span>
  <span className="go-entry-copy"><strong>Repaido <b>Go</b></strong><span>Bike & cab rides. One place to go.</span></span>
  <span className="go-entry-arrow" aria-hidden="true"><ArrowRight size={20}/></span>
 </button>;
}

export function RepaidoGo({location,onSignIn,onHome,onBookings,onModeSelect,onSearch,initialMode='bike',active=true}:{location:TransportArea;onSignIn:()=>void;onHome:()=>void;onBookings:()=>void;onModeSelect:(mode:TravelMode)=>void;onSearch:(mode:TravelMode)=>void;initialMode?:TravelMode;active?:boolean}){
 return <section className="repaido-go" aria-label="Repaido Go">
  <header className="go-header">
   <button type="button" className="go-back" aria-label="Back to Repaido home" onClick={onHome}><ArrowLeft size={21} aria-hidden="true"/></button>
   <div className="go-wordmark"><h1>repaido <span>Go</span><i aria-hidden="true">.</i></h1><p>Bike & cab rides</p></div>
   <button type="button" className="go-history" onClick={onBookings}><History size={20} aria-hidden="true"/><span>My rides</span></button>
  </header>
  {nativeAvailable()&&<details className="go-alerts-menu"><summary><Bell size={17} aria-hidden="true"/>Ride alerts</summary><RideNotificationControl onSignIn={onSignIn}/></details>}
  <MobilityExperience presentation="go" active={active} initialMode={initialMode} initialLocation={location} onSignIn={onSignIn} onModeSelect={onModeSelect} onSearch={onSearch}/>
 </section>;
}
