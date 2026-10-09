import {CalendarCheck} from 'lucide-react';
import {BusinessEmptyState} from './BusinessUI';

export function BookingSignIn({title='Sign in to view your bookings',description='Keep your visits, plans and requests together.',actionLabel='Sign in',onSignIn}:{title?:string;description?:string;actionLabel?:string;onSignIn?:()=>void}) {
  return <section className="booking-sign-in" aria-label="Your booking account"><BusinessEmptyState icon={<CalendarCheck size={28}/>} title={title} description={description} action={onSignIn&&<button className="button-primary" onClick={onSignIn}>{actionLabel}</button>}/></section>;
}
