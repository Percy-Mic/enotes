export interface Profile {
  id: string;
  full_text_name?: string;
  username?: string;
  avatar_url?: string;
  bio?: string;
  is_private?: boolean;
  followers_count?: number;
  following_count?: number;
  posts_count?: number;
  is_admin?: boolean;
  is_creator?: boolean;
  creator_bio?: string;
  creator_verified?: boolean;
  created_at: string;
}

export type FollowState = 'none' | 'following' | 'requested';

/* ---------- settings & presence ---------- */

export interface UserSettings {
  user_id: string;
  show_active_status: boolean;
  read_receipts_enabled: boolean;
  allow_messages: 'everyone' | 'following' | 'nobody';
  allow_comments: 'everyone' | 'following' | 'nobody';
  allow_interactions: 'everyone' | 'following' | 'nobody';
  notify_messages: boolean;
  notify_comments: boolean;
  notify_reactions: boolean;
  notify_mentions: boolean;
  notify_calls: boolean;
  notify_journal_activity: boolean;
  theme: 'light' | 'dark' | 'system';
  accent_color: string;
  autoplay_media: boolean;
  default_post_visibility: 'public' | 'followers';
  created_at: string;
  updated_at: string;
}

export type PresenceStatus = 'online' | 'away' | 'offline';

export interface PresenceRow {
  user_id: string;
  status: PresenceStatus;
  last_seen_at: string;
  updated_at: string;
}

/* ---------- posts & reactions ---------- */

export type PostType = 'text' | 'photo' | 'video' | 'gif' | 'link';

export interface Post {
  id: string;
  author_id: string;
  journal_id?: string | null;
  page_id?: string | null;
  content: string;
  media_url?: string | null;
  media_type?: string | null;
  media_size?: number | null;
  post_type?: PostType;
  link_url?: string | null;
  mentions?: { id: string; username: string }[];
  hashtags?: string[];
  visibility: 'public' | 'followers';
  edited_at?: string | null;
  created_at: string;
  /* joined data (fetched via separate queries, assembled client-side) */
  author?: Pick<Profile, 'id' | 'full_text_name' | 'username' | 'avatar_url'>;
  journal_title?: string | null;
  journal_background?: string | null;
  like_count?: number;
  comment_count?: number;
  liked_by_me?: boolean;
  reactions?: Record<string, { count: number; mine: boolean }>;
  saved_by_me?: boolean;
  /* reposts (joined client-side from the reposts table) */
  repost_count?: number;
  reposted_by_me?: boolean;
  /** username of someone I follow (or me) who reposted this — shown above the card */
  reposted_by?: string | null;
  /* embedded count aggregates — Supabase `relation(count)` shape */
  likes?: { count: number }[];
  comments?: { count: number }[];
}

export type CommentReactionMap = Record<string, { count: number; mine: boolean }>;

export interface Comment {
  id: string;
  post_id: string;
  author_id: string;
  content: string;
  parent_comment_id?: string | null;
  gif_url?: string | null;
  edited_at?: string | null;
  deleted_at?: string | null;
  created_at: string;
  author?: Pick<Profile, 'id' | 'full_text_name' | 'username' | 'avatar_url'>;
  reactions?: CommentReactionMap;
  reply_count?: number;
}

/* ---------- notifications ---------- */

export type NotificationType =
  | 'like'
  | 'comment'
  | 'comment_reply'
  | 'follow'
  | 'share'
  | 'message'
  | 'group_invite'
  | 'story_reply'
  | 'mention'
  | 'call_missed'
  | 'call_declined'
  | 'journal_invite'
  | 'journal_edit'
  | 'reaction';

export interface Notification {
  id: string;
  user_id: string;
  actor_id: string | null;
  type: NotificationType;
  entity_type?: string | null;
  entity_id?: string | null;
  message?: string | null;
  read: boolean;
  created_at: string;
  actor?: Pick<Profile, 'id' | 'full_text_name' | 'username' | 'avatar_url'>;
}

/* ---------- messaging ---------- */

export type MessageType = 'text' | 'image' | 'video' | 'audio' | 'file' | 'gif' | 'sticker';

export interface Conversation {
  id: string;
  is_group: boolean;
  title?: string | null;
  avatar_url?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
  /* client-side extras */
  members?: Pick<Profile, 'id' | 'full_text_name' | 'username' | 'avatar_url'>[];
  last_message?: string | null;
  last_message_at?: string | null;
  unread_count?: number;
  muted?: boolean;
}

export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read';

export type MessageReactionMap = Record<string, number>;

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  message_type: MessageType;
  media_url?: string | null;
  media_type?: string | null;
  media_name?: string | null;
  reply_to_id?: string | null;
  forwarded_from?: string | null;
  edited_at?: string | null;
  deleted_at?: string | null;
  delivered_at?: string | null;
  read_at?: string | null;
  created_at: string;
  sender?: Pick<Profile, 'id' | 'full_text_name' | 'username' | 'avatar_url'>;
  reply_to?: Message | null;
  reactions?: { emoji: string; users: string[]; count: number; mine: boolean }[];
  /* client-side only */
  status?: MessageStatus;
  local?: boolean;
}

export interface ChatThemeRow {
  id: string;
  conversation_id: string;
  user_id: string;
  background_color?: string | null;
  background_url?: string | null;
  bubble_color_mine?: string | null;
  bubble_color_theirs?: string | null;
  text_color_mine?: string | null;
  text_color_theirs?: string | null;
  accent_color?: string | null;
  bubble_style?: string | null;
  font_family?: string | null;
}

/* ---------- calls ---------- */

export type CallStatus =
  | 'calling'
  | 'ringing'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'declined'
  | 'missed'
  | 'ended'
  | 'failed';

export interface CallRow {
  id: string;
  conversation_id: string | null;
  caller_id: string;
  callee_id: string;
  media: 'video' | 'audio';
  status: CallStatus;
  started_at: string;
  connected_at?: string | null;
  ended_at?: string | null;
}

/* ---------- reports & moderation ---------- */

export type ReportTargetType = 'user' | 'post' | 'comment' | 'message';
export type ReportReason = 'spam' | 'harassment' | 'inappropriate' | 'violence' | 'other';

export interface ReportRow {
  id: string;
  reporter_id: string;
  target_type: ReportTargetType;
  target_id: string;
  reason: ReportReason;
  details?: string | null;
  status: 'open' | 'reviewed' | 'dismissed';
  created_at: string;
}

/* ---------- stories ---------- */

export interface Story {
  id: string;
  author_id: string;
  media_url: string;
  media_type: 'image' | 'video';
  caption?: string | null;
  background_color?: string | null;
  created_at: string;
  expires_at: string;
  author?: Pick<Profile, 'id' | 'full_text_name' | 'username' | 'avatar_url'>;
  viewed_by_me?: boolean;
}

/* ---------- journals ---------- */

export interface JournalShare {
  id: string;
  journal_id: string;
  shared_with: string | null;
  share_token: string;
  can_edit: boolean;
  role: 'viewer' | 'commenter' | 'editor';
  status: 'active' | 'revoked';
  created_at: string;
}

export type JournalRole = 'owner' | 'editor' | 'commenter' | 'viewer' | null;
