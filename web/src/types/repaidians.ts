export type Trade = 'cleaning' | 'electrician' | 'plumber' | 'ac' | 'pest' | 'carpenter' | 'civil' | 'spares';
export type Visibility = 'public' | 'trade';
export type StudioKind = 'post' | 'reel' | 'story' | 'tender';
export type CommunityTab = 'feed' | 'reels' | 'tenders' | 'profile' | 'search' | 'inbox' | 'notifications';
export interface CommunityMember {
  id: string; name: string; handle: string; trade: Trade; role: string; avatarUrl: string; bio: string;
  registeredId?: string; reviewed?: boolean; completedTasks?: number; rating?: number | null;
  followersCount?: number; followingCount?: number; postsCount?: number;
}
export interface CommunityMedia { url: string; kind: 'image' | 'video'; alt: string; }
export interface CommunityItem {
  id: string; authorId: string; createdAt: number; trade: Trade; visibility: Visibility; sample: boolean;
}
export interface CommunityPost extends CommunityItem { caption: string; media: CommunityMedia[]; likeCount?: number; commentCount?: number; liked?: boolean; saved?: boolean; }
export interface CommunityStory extends CommunityItem { caption: string; media: CommunityMedia; expiresAt: number; }
export interface CommunityReel extends CommunityItem { caption: string; media: CommunityMedia; likeCount?: number; commentCount?: number; liked?: boolean; saved?: boolean; }
export interface CommunityTender extends CommunityItem {
  title: string; details: string; location: string; budgetRupees: number; slots: number; deadline: number;
  contact: string;
}
export interface CommunityComment {
  id: string; targetId: string; authorId: string; text: string; createdAt: number;
}
export interface CommunityMessage { id: string; recipientId: string; senderId?: string; text: string; createdAt: number; }
export type CommunitySubscription =
  {plan:'pro';amountPaise:19900;startsAt:number;endsAt:number;provider:'razorpay'} |
  {plan:'trial';amountPaise:0;startsAt:number;endsAt:number;provider:'trial'};
export interface CommunityTrial {startsAt:number;endsAt:number;status:'active'|'expired';}
export interface DailyUsage { day: string; usedMs: number; chargedUntil: number; }
export interface CommunityData {
  version: 1; members: CommunityMember[]; posts: CommunityPost[]; stories: CommunityStory[];
  reels: CommunityReel[]; tenders: CommunityTender[]; comments: CommunityComment[];
  follows: {from: string; to: string}[];
}
export interface CommunityActivity {
  likes: string[]; saved: string[]; following: string[]; bids: string[]; messages: CommunityMessage[];
  profile?: Pick<CommunityMember, 'name' | 'trade' | 'bio'>;
}
export interface CommunitySnapshot {
  data: CommunityData; activity: CommunityActivity; member: CommunityMember;
  subscription: CommunitySubscription | null; trial:CommunityTrial|null; remainingMs: number; serverNow:number;
  authenticated: boolean; paymentsReady: boolean; mediaReady: boolean; unreadCount?: number;
}
export interface PublicationDraft {
  kind: StudioKind; caption: string; trade: Trade; visibility: Visibility; media: CommunityMedia[];
  title?: string; location?: string; budgetRupees?: number; slots?: number; deadline?: number; contact?: string;
  clientId?: string;
}
export interface CommunityPage<T> {items: T[]; members: CommunityMember[]; nextCursor: string | null;}
export interface CommunityNotification {id: string; type: string; actorId?: string; authorId?: string; targetId?: string; text?: string; createdAt: number; read?: boolean;}
export interface CommunityThread {id: string; memberId?: string; recipientId?: string; lastMessage?: string; text?: string; updatedAt?: number; unreadCount?: number;}
export interface SubscriptionStatus {active: boolean; subscription: CommunitySubscription | null; trial:CommunityTrial|null; serverNow:number; paymentsReady: boolean; amount: number; currency: string; paymentStatus?: string;}
