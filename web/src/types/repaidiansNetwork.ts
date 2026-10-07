import type {CommunityMember} from './repaidians';

export interface ProfessionalExperience {id:string;title:string;organization:string;city:string;startMonth:string;endMonth:string|null;current:boolean;description:string;}
export interface ProfessionalEducation {id:string;institution:string;qualification:string;fieldOfStudy:string;startMonth:string;endMonth:string|null;current:boolean;description:string;}
export interface ProfessionalCertification {id:string;name:string;issuer:string;issuedMonth:string;expiresMonth:string|null;credentialId:string;credentialUrl:string;}
export interface ProfessionalFeatured {id:string;title:string;url:string;description:string;}
export interface NetworkProfessionalProfile {
  userId:string;about:string;visibility:'public'|'connections';experience:ProfessionalExperience[];education:ProfessionalEducation[];
  certifications:ProfessionalCertification[];featured:ProfessionalFeatured[];version:number;updatedAt:number;
}
export type ConnectionStatus='self'|'anonymous'|'none'|'incoming'|'outgoing'|'connected';
export interface NetworkConnection {status:ConnectionStatus;version:number;canRequest:boolean;updatedAt?:number;note?:string;}
export interface NetworkConnectionItem extends NetworkConnection {memberId:string;}
export interface NetworkConnectionsPage {items:NetworkConnectionItem[];members:CommunityMember[];nextCursor:string|null;connectionsCount:number;}
export interface NetworkEndorsement {id:string;authorId:string;recipientId:string;skill:string;createdAt:number;}
export interface NetworkEndorsementsPage {items:NetworkEndorsement[];members:CommunityMember[];nextCursor:string|null;viewerEndorsed?:string[];}
export interface NetworkRecommendation {id:string;authorId:string;recipientId:string;text:string;relationship:string;status:'pending'|'approved'|'declined'|'retracted';version:number;createdAt:number;updatedAt:number;approvedAt?:number;}
export interface NetworkRecommendationsPage {items:NetworkRecommendation[];members:CommunityMember[];nextCursor:string|null;}
export interface NetworkProfileDetails {profile:NetworkProfessionalProfile|null;profileInfoSource:'member';connection:NetworkConnection;endorsements:NetworkEndorsementsPage;recommendations:NetworkRecommendationsPage;stats:{connections:number};}
export interface NetworkPreferences {connectionPrivacy:'everyone'|'nobody';allowEndorsements:boolean;allowRecommendations:boolean;networkNotifications:boolean;}
export type NetworkProfilePatch=Partial<Omit<NetworkProfessionalProfile,'userId'|'version'|'updatedAt'>>;
