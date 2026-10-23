import type {CategoryId} from '../types';

// Practical guidance describes the published scope; it makes no availability,
// health, savings or quality claims about an individual professional.
export function serviceGuidance(category:CategoryId){
 const guidance:Partial<Record<CategoryId,{title:string;body:string}>>={
  ac:{title:'Know what your appliance visit covers',body:'Check the cleaning and inspection scope. Parts and repairs need your approval.'},
  cleaning:{title:'A clearer plan for your space',body:'Review the surfaces and tasks included, then add access details for your visit.'},
  electrician:{title:'Start with the right electrical scope',body:'Check the inspection and fitting work included. Materials and extra work are reviewed separately.'},
  plumber:{title:'Help your professional prepare',body:'Review the included plumbing work and describe the affected fixture in your access notes.'},
  salon:{title:'Choose the care that suits you',body:'Review the treatment, products and exclusions before choosing your visit time.'},
  car:{title:'Review your vehicle service first',body:'Check the inspection or cleaning scope. Parts and extra work require approval.'},
 };
 return guidance[category]||{title:'A little clarity before your visit',body:'Review the included work and exclusions, then choose your time and service address.'};
}
