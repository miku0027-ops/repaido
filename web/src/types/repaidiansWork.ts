import type {CommunityMember,Trade} from './repaidians';

export interface WorkPreferences {
  personalizedDiscovery:boolean;contractUpdates:boolean;sharePlacements:boolean;shareSalary:boolean;
}
export interface WorkInterest {trade:Trade;weight:number;reason:string;}
export interface WorkInterests {trades:WorkInterest[];personalized:boolean;}
export interface WorkJobFilters {
  query?:string;trade?:Trade|'all';city?:string;sector?:string;minimumPayPaise?:number;
  experience?:number;workType?:'all'|'project'|'private_request';closesWithinDays?:0|7|30;
  cursor?:string;limit?:number;
}
export interface HiringNotice {
  version:number;status:string;city:string;area:string;sector:string;summary:string;
  skills:string[];worker_role:string;openings:number;minimum_experience:number;
  daily_rate_paise:number;hours_per_day:number;deadline:number;terms:string;benefits?:string;
}
export interface WorkJob {
  id:string;title:string;trade:Trade;city:string;sourceKind:string;
  workType:'project'|'private_request';ownerId:string;ownerName:string;
  skills:string[];minimumExperience:number;dailyRatePaise:number;openings:number;
  deadline:number;startsAt:number;endsAt:number;match:{score:number;reasons:string[]};
  details:{id:string;title:string;status:string;hiring:HiringNotice;starts_at:number;ends_at:number;preparing_tender?:boolean};
  application?:{id:string;status:string}|null;
}
export interface WorkJobsPage {items:WorkJob[];nextCursor:string|null;personalized:boolean;preferences?:WorkPreferences;indexing?:boolean;}
export type WorkApplicationStatus='applied'|'shortlisted'|'on_hold'|'offered'|'hired'|'declined'|'rejected'|'withdrawn'|'cancelled'|'completed'|'ended'|'offer_withdrawn';
export interface WorkApplicationEvent {id?:string;action?:string;status:string;at:number;actor?:string;note?:string;}
export interface WorkInvitation {id:string;role:string;daily_rate_paise:number;terms:string;status:string;}
export interface WorkApplication {
  id:string;project_id:string;project_title:string;project_version:number;source_kind?:string;
  owner_id:string;worker_id:string;worker_name:string;version:number;status:WorkApplicationStatus;
  note:string;decision_note?:string;notice_snapshot:HiringNotice;starts_at:number;ends_at:number;
  created_at:number;updated_at:number;events:WorkApplicationEvent[];
  invitation_id?:string;invitation_status?:string|null;invitation?:WorkInvitation|null;
}
export interface WorkApplicationsPage {applications:WorkApplication[];next_cursor:string|null;has_more?:boolean;}
export interface WorkConnection {
  member:CommunityMember;placementId:string;projectTitle:string;role:string;city:string;startsAt:number;endsAt:number;
}
export interface WorkCompany {id:string;name:string;city:string;sector:string;scope:string;reviewed?:boolean;connections?:WorkConnection[];}
export interface WorkCompaniesPage {items:WorkCompany[];nextCursor:string|null;}
export interface WorkCompanyDetails {company:WorkCompany;jobs:WorkJob[];connections:WorkConnection[];}
export interface WorkPlacement {
  id:string;member:CommunityMember;ownerId:string;ownerName:string;projectId:string;projectTitle:string;
  role:string;city:string;startsAt:number;endsAt:number;dailyRatePaise?:number;congratulated?:boolean;
}
export type WorkCongratulations='congratulations'|'good_luck'|'well_deserved';
