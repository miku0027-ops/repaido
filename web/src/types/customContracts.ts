import type {Trade} from './repaidians';
import type {RepaidianBadgeMetadata} from '../components/RepaidianBadge';

export type ContractReaction='interested'|'useful'|'support';
export interface ContractPublicMember {id:string;name:string;city?:string;role?:string;avatarUrl?:string;portrait_url?:string;repaidianBadge?:RepaidianBadgeMetadata|null;}
export interface CustomContractBid {id:string;contractor_id:string;contractor_name:string;amount_paise:number;proposal:string;status:string;submitted_at:number;}
export interface CustomContractQuery {
  id:string;title:string;sector:string;work_trade:Trade;city:string;area:string;scope:string;skills:string[];minimum_experience:number;
  budget_paise:number;starts_at:number;ends_at:number;deadline:number;status:string;version:number;owner_id:string;owner_name:string;terms?:string;phase?:string;distance_km?:number;opening_project_id?:string;message_recipient_id?:string;message_recipients?:ContractPublicMember[];interest_access?:'membership'|'nearby_trial';
  controls:{reactions_enabled:boolean;comments_enabled:boolean;public_progress:boolean;cta_label?:string;cta_enabled?:boolean};
  stats:{views:number;comments:number;bids:number;interests?:number;reactions:Record<ContractReaction,number>};my_reaction:ContractReaction|null;bids:CustomContractBid[];
  match?:{eligible:boolean;reasons:string[]};site?:string;
  permissions:{can_bid:boolean;can_award:boolean;can_close:boolean;can_react:boolean;can_comment:boolean;can_manage_engagement:boolean;can_enquire:boolean;can_message:boolean;can_view_site:boolean;can_use_cta?:boolean;can_interest?:boolean;can_message_nearby?:boolean};
  matched_contractors?:{contractor_id:string;name:string;member:ContractPublicMember;reasons:string[];fit:{score:number;model:'custom-contract-fit-v1';components:{trade:number;city:number;skills:number;experience:number}}}[];matches_state?:{indexing:boolean;complete:boolean;shown:number;scope:string};
  workforce_requirements?:{worker_type:string;count:number}[];my_interest?:{id:string;status:string;note:string;worker_type:string;approx_distance_km?:number}|null;
}
export interface CustomContractProjectReference {id:string;version:number;status:string;title:string;owner_id:string;owner_name:string;client_id:string;awarded_at:number;contract_value_paise:number;}
export interface CustomContractDetails {query:CustomContractQuery;project:CustomContractProjectReference|null;members:ContractPublicMember[];}
export interface CustomContractsPage {items:CustomContractQuery[];members:ContractPublicMember[];nextCursor:string|null;}
export interface CustomContractDraft {title:string;sector:string;work_trade:Trade;city:string;area:string;site:string;scope:string;skills:string[];minimum_experience:number;starts_at:number;ends_at:number;deadline:number;budget_paise:number;terms:string;public_progress:boolean;cta_label?:string;cta_enabled?:boolean;location?:{lat:number;lng:number};workforce_requirements?:{worker_type:string;count:number}[];}
export interface ContractFreshLocation {lat:number;lng:number;accuracy:number;captured_at:number;}
export interface CustomContractComment {id:string;author_id:string;author_name?:string;text:string;parent_id:string|null;created_at:number;}
export interface CustomContractCommentsPage {items:CustomContractComment[];members:ContractPublicMember[];nextCursor:string|null;}
export interface CustomContractMessage {id:string;author_id:string;author_name?:string;sender_id?:string;text:string;created_at:number;bid_id?:string;}
export interface CustomContractMessagesPage {items:CustomContractMessage[];members:ContractPublicMember[];nextCursor:string|null;}

export interface CustomContractInterest {id:string;query_id:string;worker_id:string;worker_type:string;note:string;status:string;available:boolean;created_at:number;updated_at:number;}
export interface CustomContractInterestsPage {items:CustomContractInterest[];members:ContractPublicMember[];nextCursor:string|null;}
