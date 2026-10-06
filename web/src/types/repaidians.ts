export type Trade = 'cleaning' | 'electrician' | 'plumber' | 'ac' | 'pest' | 'carpenter' | 'civil' | 'spares';
export type Visibility = 'public' | 'trade';
export type StudioKind = 'post' | 'reel' | 'story' | 'tender';
export type CommunityTab = 'feed' | 'reels' | 'tenders' | 'profile';
export interface CommunityMember {
  id: string; name: string; handle: string; trade: Trade; role: string; avatarUrl: string; bio: string;
  registeredId?: string; reviewed?: boolean; completedTasks?: number; rating?: number | null;
}
export interface CommunityMedia { url: string; kind: 'image' | 'video'; alt: string; }
export interface CommunityItem {
  id: string; authorId: string; createdAt: number; trade: Trade; visibility: Visibility; sample: boolean;
}
export interface CommunityPost extends CommunityItem { caption: string; media: CommunityMedia[]; }
export interface CommunityStory extends CommunityItem { caption: string; media: CommunityMedia; expiresAt: number; }
export interface CommunityReel extends CommunityItem { caption: string; media: CommunityMedia; }
export interface CommunityTender extends CommunityItem {
  title: string; details: string; location: string; budgetRupees: number; slots: number; deadline: number;
  contact: string;
}
export interface CommunityComment {
  id: string; targetId: string; authorId: string; text: string; createdAt: number;
}
export interface CommunityMessage { id: string; recipientId: string; text: string; createdAt: number; }
export interface CommunitySubscription {
  plan: 'demo-pro'; amountPaise: 19900; startsAt: number; endsAt: number; provider: 'mock';
}
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
  subscription: CommunitySubscription | null; remainingMs: number;
}
export interface PublicationDraft {
  kind: StudioKind; caption: string; trade: Trade; visibility: Visibility; media: CommunityMedia[];
  title?: string; location?: string; budgetRupees?: number; slots?: number; deadline?: number; contact?: string;
}
