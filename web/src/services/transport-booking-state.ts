/** A view summary only. Each product keeps its own authorized records and actions. */
export interface TransportBookingSummary {
 uid:string;
 loaded:boolean;
 busy:boolean;
 error:string;
 active:number;
 history:number;
 focused?:boolean;
}
