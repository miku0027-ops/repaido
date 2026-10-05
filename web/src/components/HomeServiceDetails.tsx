import type {Service} from '../types';
import ServiceImage from './ServiceImage';
import {Modal} from './ui';
import {ServiceTerms} from './ServiceTerms';
import {formatMoney,formatDuration} from '../data';
export function HomeServiceDetails({service,onClose,onBook}:{service:Service;onClose:()=>void;onBook:()=>void}){
 return <Modal title={service.name} className="reference-detail-sheet" onClose={onClose}><div className="operations"><ServiceImage service={service} className="home-detail-photo"/><div className="ops-total"><strong>{formatMoney(service.price)}</strong><span>{formatDuration(service.duration)}</span></div><p>{service.description}</p><details open><summary>Included in this service</summary><ul>{service.included.map(x=><li key={x}>{x}</li>)}</ul></details><details><summary>Not included</summary><ul>{service.excluded.map(x=><li key={x}>{x}</li>)}</ul></details><p>Extra work and parts need your approval. A professional confirms your requested visit.</p><details><summary>Service terms & conditions</summary><ServiceTerms serviceId={service.id}/></details><button className="ops-primary" onClick={onBook}>Choose this service</button></div></Modal>;
}
