export const tips = [
 ['home','A little care today makes home feel better tomorrow.'],
 ['home','Make room for celebrations, not unfinished repairs.'],
 ['home','Welcome Maa Durga with a home ready for loved ones.'],
 ['home','Explore cleaning, repairs and home projects in one place.'],
 ['home','Plan the essentials before your festive guests arrive.'],
 ['home','Your next home improvement can start with one clear request.'],
 ['cleaning','Fresh spaces make everyday moments feel special.'],
 ['cleaning','A cleaner kitchen is a lovely place to begin the day.'],
 ['cleaning','Give busy rooms the attention they deserve.'],
 ['cleaning','Explore deep cleaning before the festive rush.'],
 ['ac','Give your appliances a little attention before they need a lot.'],
 ['ac','Describe your appliance model for a more useful service request.'],
 ['ac','Regular appliance care can help you spot problems early.'],
 ['ac','Check the service details to see what is included.'],
 ['electrician','Small electrical concerns deserve professional attention.'],
 ['electrician','Share the symptoms so your electrician can prepare.'],
 ['electrician','Plan your lighting before the celebrations begin.'],
 ['plumber','A small drip is a good reason to plan a repair.'],
 ['plumber','Tell your plumber where the problem starts.'],
 ['plumber','Better-maintained spaces make everyday routines easier.'],
 ['care','Care for family starts with understanding their daily routine.'],
 ['care','Share the daily tasks that matter most to your family.'],
 ['care','Explore maid and family-care plans at your own pace.'],
 ['care','A clear schedule helps everyone plan the day.'],
 ['hire','Choose skills that match the work you need done.'],
 ['hire','Compare completed work and customer reviews before hiring.'],
 ['hire','A detailed brief helps the right professional prepare.'],
 ['hire','Check availability and service coverage before booking.'],
 ['market','Check compatibility before selecting a spare part.'],
 ['market','Compare the details, not just the price.'],
 ['market','Rent the equipment you need for the time you need it.'],
 ['market','Review warranty information before requesting an item.'],
 ['market','Clear return terms make equipment rental easier.'],
 ['painting','A thoughtful colour choice can refresh a familiar room.'],
 ['painting','Share room dimensions to help plan your home project.'],
 ['painting','Great home projects begin with a clear brief.'],
 ['general','One platform for the practical things that keep home running.'],
 ['general','Your time matters. We are getting the latest details ready.'],
 ['general','Check the scope, then choose what works for you.'],
 ['general','Keep your booking details handy for a smoother visit.'],
 ['general','Small improvements can make a big difference to everyday comfort.'],
 ['general','Thoughtful planning leaves more time for the people you love.'],
 ['worker','Clear work records make every completed visit easier to review.'],
 ['worker','Confirm the scope before beginning the work.'],
 ['worker','Keep the customer informed at every important stage.'],
 ['worker','Review the task brief before setting off.']
];
export function loadingLabel(path){
 if(/tracking|position|availability/.test(path))return 'Updating location and availability…';
 if(/payment|checkout|refund|payout/.test(path))return 'Checking payment details securely…';
 if(/hire|professionals|leaderboard/.test(path))return 'Finding professionals and hiring options…';
 if(/home.plan/.test(path))return 'Loading home plans and care schedules…';
 if(/inventory|market|rental/.test(path))return 'Finding available parts and equipment…';
 if(/jobs|booking/.test(path))return 'Updating your tasks and bookings…';
 if(/catalog|discovery|campaign/.test(path))return 'Finding services and suggestions for you…';
 return 'Getting your latest details ready…';
}
export function selectTip(path,index,interests=[],worker=false){
 const context=worker?'worker':/market|inventory|rental/.test(path)?'market':/hire|professionals/.test(path)?'hire':/home.plan/.test(path)?'care':null;
 const preferred=tips.filter(([tag])=>context?tag===context:interests.includes(tag));
 const pool=preferred.length?preferred:tips.filter(([tag])=>tag==='general'||tag==='home');
 return pool[Math.abs(index)%pool.length][1];
}
