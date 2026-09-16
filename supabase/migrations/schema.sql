-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.profiles (
  id uuid NOT NULL,
  full_text_name text,
  username text UNIQUE,
  avatar_url text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  bio text DEFAULT ''::text,
  is_private boolean DEFAULT false,
  followers_count integer DEFAULT 0,
  following_count integer DEFAULT 0,
  posts_count integer DEFAULT 0,
  is_admin boolean NOT NULL DEFAULT false,
  is_creator boolean NOT NULL DEFAULT false,
  creator_bio text DEFAULT ''::text,
  creator_verified boolean NOT NULL DEFAULT false,
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
);
CREATE TABLE public.journals (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  cover_config jsonb DEFAULT '{}'::jsonb,
  theme_config jsonb DEFAULT '{}'::jsonb,
  visibility text DEFAULT 'private'::text,
  password_hash text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  background_color text DEFAULT '#FFF7F8'::text,
  cover_theme text DEFAULT 'classic'::text,
  font_style text DEFAULT 'serif'::text,
  cover_media_type text DEFAULT 'image'::text,
  cover_media_url text,
  cover_stickers ARRAY DEFAULT '{}'::text[],
  cover_type text,
  cover_url text,
  foreword text,
  cover_elements jsonb DEFAULT '[]'::jsonb,
  CONSTRAINT journals_pkey PRIMARY KEY (id),
  CONSTRAINT journals_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.journal_pages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  journal_id uuid NOT NULL,
  page_number integer NOT NULL,
  title text,
  background text DEFAULT '#FFFDF8'::text,
  width integer DEFAULT 800,
  height integer DEFAULT 1100,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  media_type text DEFAULT 'image'::text,
  media_url text,
  stickers ARRAY DEFAULT '{}'::text[],
  elements jsonb DEFAULT '[]'::jsonb,
  CONSTRAINT journal_pages_pkey PRIMARY KEY (id),
  CONSTRAINT journal_pages_journal_id_fkey FOREIGN KEY (journal_id) REFERENCES public.journals(id)
);
CREATE TABLE public.page_elements (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL,
  type text NOT NULL,
  content jsonb DEFAULT '{}'::jsonb,
  x numeric DEFAULT 0,
  y numeric DEFAULT 0,
  width numeric DEFAULT 200,
  height numeric DEFAULT 150,
  rotation numeric DEFAULT 0,
  z_index integer DEFAULT 1,
  opacity numeric DEFAULT 1 CHECK (opacity >= 0::numeric AND opacity <= 1::numeric),
  locked boolean DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT page_elements_pkey PRIMARY KEY (id),
  CONSTRAINT page_elements_page_id_fkey FOREIGN KEY (page_id) REFERENCES public.journal_pages(id)
);
CREATE TABLE public.page_locks (
  page_id uuid NOT NULL,
  journal_id uuid NOT NULL,
  locked boolean NOT NULL DEFAULT true,
  pin_hash text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT page_locks_pkey PRIMARY KEY (page_id),
  CONSTRAINT page_locks_page_id_fkey FOREIGN KEY (page_id) REFERENCES public.journal_pages(id),
  CONSTRAINT page_locks_journal_id_fkey FOREIGN KEY (journal_id) REFERENCES public.journals(id)
);
CREATE TABLE public.journal_shares (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  journal_id uuid NOT NULL,
  shared_with uuid,
  share_token uuid NOT NULL DEFAULT gen_random_uuid(),
  can_edit boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  role text NOT NULL DEFAULT 'viewer'::text,
  status text NOT NULL DEFAULT 'active'::text,
  CONSTRAINT journal_shares_pkey PRIMARY KEY (id),
  CONSTRAINT journal_shares_journal_id_fkey FOREIGN KEY (journal_id) REFERENCES public.journals(id),
  CONSTRAINT journal_shares_shared_with_fkey FOREIGN KEY (shared_with) REFERENCES public.profiles(id)
);
CREATE TABLE public.follows (
  follower_id uuid NOT NULL,
  following_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT follows_pkey PRIMARY KEY (follower_id, following_id),
  CONSTRAINT follows_follower_id_fkey FOREIGN KEY (follower_id) REFERENCES public.profiles(id),
  CONSTRAINT follows_following_id_fkey FOREIGN KEY (following_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.posts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL,
  journal_id uuid,
  page_id uuid,
  content text NOT NULL DEFAULT ''::text CHECK (char_length(content) <= 20000),
  media_url text,
  media_type text DEFAULT 'image'::text,
  visibility text NOT NULL DEFAULT 'public'::text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  media_width integer,
  media_height integer,
  media_size bigint,
  post_type text NOT NULL DEFAULT 'text'::text,
  link_url text,
  mentions jsonb NOT NULL DEFAULT '[]'::jsonb,
  hashtags jsonb NOT NULL DEFAULT '[]'::jsonb,
  edited_at timestamp with time zone,
  deleted_at timestamp with time zone,
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  search_tsv tsvector DEFAULT to_tsvector('english'::regconfig, COALESCE(content, ''::text)),
  CONSTRAINT posts_pkey PRIMARY KEY (id),
  CONSTRAINT posts_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.profiles(id),
  CONSTRAINT posts_journal_id_fkey FOREIGN KEY (journal_id) REFERENCES public.journals(id),
  CONSTRAINT posts_page_id_fkey FOREIGN KEY (page_id) REFERENCES public.journal_pages(id)
);
CREATE TABLE public.post_likes (
  post_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT post_likes_pkey PRIMARY KEY (post_id, user_id),
  CONSTRAINT post_likes_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id),
  CONSTRAINT post_likes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.comments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL,
  author_id uuid NOT NULL,
  content text NOT NULL CHECK (char_length(content) <= 4000),
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  parent_comment_id uuid,
  edited_at timestamp with time zone,
  deleted_at timestamp with time zone,
  mentions jsonb NOT NULL DEFAULT '[]'::jsonb,
  gif_url text,
  search_tsv tsvector DEFAULT to_tsvector('english'::regconfig, COALESCE(content, ''::text)),
  CONSTRAINT comments_pkey PRIMARY KEY (id),
  CONSTRAINT comments_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id),
  CONSTRAINT comments_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.profiles(id),
  CONSTRAINT comments_parent_comment_id_fkey FOREIGN KEY (parent_comment_id) REFERENCES public.comments(id)
);
CREATE TABLE public.notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  actor_id uuid,
  type text NOT NULL,
  entity_type text,
  entity_id text,
  message text,
  read boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  dedupe_key text,
  CONSTRAINT notifications_pkey PRIMARY KEY (id),
  CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT notifications_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.conversations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  is_group boolean NOT NULL DEFAULT false,
  title text,
  avatar_url text,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT conversations_pkey PRIMARY KEY (id),
  CONSTRAINT conversations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id)
);
CREATE TABLE public.conversation_members (
  conversation_id uuid NOT NULL,
  user_id uuid NOT NULL,
  joined_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  last_read_at timestamp with time zone DEFAULT '1970-01-01 00:00:00+00'::timestamp with time zone,
  muted boolean NOT NULL DEFAULT false,
  role text NOT NULL DEFAULT 'member'::text,
  CONSTRAINT conversation_members_pkey PRIMARY KEY (conversation_id, user_id),
  CONSTRAINT conversation_members_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id),
  CONSTRAINT conversation_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL,
  sender_id uuid NOT NULL,
  content text NOT NULL CHECK (char_length(content) <= 8000),
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  media_url text,
  media_type text,
  media_name text,
  reply_to_id uuid,
  message_type text NOT NULL DEFAULT 'text'::text,
  edited_at timestamp with time zone,
  deleted_at timestamp with time zone,
  forwarded_from uuid,
  delivered_at timestamp with time zone,
  read_at timestamp with time zone,
  CONSTRAINT messages_pkey PRIMARY KEY (id),
  CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id),
  CONSTRAINT messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.profiles(id),
  CONSTRAINT messages_reply_to_id_fkey FOREIGN KEY (reply_to_id) REFERENCES public.messages(id),
  CONSTRAINT messages_forwarded_from_fkey FOREIGN KEY (forwarded_from) REFERENCES public.profiles(id)
);
CREATE TABLE public.stories (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL,
  media_url text NOT NULL,
  media_type text NOT NULL DEFAULT 'image'::text,
  caption text,
  background_color text DEFAULT '#111111'::text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  expires_at timestamp with time zone NOT NULL DEFAULT (timezone('utc'::text, now()) + '24:00:00'::interval),
  CONSTRAINT stories_pkey PRIMARY KEY (id),
  CONSTRAINT stories_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.story_views (
  story_id uuid NOT NULL,
  viewer_id uuid NOT NULL,
  viewed_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT story_views_pkey PRIMARY KEY (story_id, viewer_id),
  CONSTRAINT story_views_story_id_fkey FOREIGN KEY (story_id) REFERENCES public.stories(id),
  CONSTRAINT story_views_viewer_id_fkey FOREIGN KEY (viewer_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.activity_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type text NOT NULL,
  entity_type text,
  entity_id text,
  summary text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT activity_events_pkey PRIMARY KEY (id),
  CONSTRAINT activity_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.user_blocks (
  blocker_id uuid NOT NULL,
  blocked_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT user_blocks_pkey PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT user_blocks_blocker_id_fkey FOREIGN KEY (blocker_id) REFERENCES public.profiles(id),
  CONSTRAINT user_blocks_blocked_id_fkey FOREIGN KEY (blocked_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.user_settings (
  user_id uuid NOT NULL,
  show_active_status boolean NOT NULL DEFAULT true,
  read_receipts_enabled boolean NOT NULL DEFAULT true,
  allow_messages text NOT NULL DEFAULT 'everyone'::text,
  allow_comments text NOT NULL DEFAULT 'everyone'::text,
  allow_interactions text NOT NULL DEFAULT 'everyone'::text,
  notify_messages boolean NOT NULL DEFAULT true,
  notify_comments boolean NOT NULL DEFAULT true,
  notify_reactions boolean NOT NULL DEFAULT true,
  notify_mentions boolean NOT NULL DEFAULT true,
  notify_calls boolean NOT NULL DEFAULT true,
  notify_journal_activity boolean NOT NULL DEFAULT true,
  theme text NOT NULL DEFAULT 'system'::text,
  accent_color text NOT NULL DEFAULT '#E5798F'::text,
  autoplay_media boolean NOT NULL DEFAULT true,
  default_post_visibility text NOT NULL DEFAULT 'public'::text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT user_settings_pkey PRIMARY KEY (user_id),
  CONSTRAINT user_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.user_presence (
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'offline'::text,
  last_seen_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT user_presence_pkey PRIMARY KEY (user_id),
  CONSTRAINT user_presence_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.post_reactions (
  post_id uuid NOT NULL,
  user_id uuid NOT NULL,
  emoji text NOT NULL CHECK (length(btrim(emoji)) >= 1 AND length(btrim(emoji)) <= 16),
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT post_reactions_pkey PRIMARY KEY (post_id, user_id, emoji),
  CONSTRAINT post_reactions_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id),
  CONSTRAINT post_reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.saved_posts (
  post_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT saved_posts_pkey PRIMARY KEY (post_id, user_id),
  CONSTRAINT saved_posts_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id),
  CONSTRAINT saved_posts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.comment_reactions (
  comment_id uuid NOT NULL,
  user_id uuid NOT NULL,
  emoji text NOT NULL CHECK (length(btrim(emoji)) >= 1 AND length(btrim(emoji)) <= 16),
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT comment_reactions_pkey PRIMARY KEY (comment_id, user_id, emoji),
  CONSTRAINT comment_reactions_comment_id_fkey FOREIGN KEY (comment_id) REFERENCES public.comments(id),
  CONSTRAINT comment_reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.message_reactions (
  message_id uuid NOT NULL,
  user_id uuid NOT NULL,
  emoji text NOT NULL CHECK (length(btrim(emoji)) >= 1 AND length(btrim(emoji)) <= 16),
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT message_reactions_pkey PRIMARY KEY (message_id, user_id, emoji),
  CONSTRAINT message_reactions_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id),
  CONSTRAINT message_reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.chat_themes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL,
  user_id uuid NOT NULL,
  background_color text,
  background_url text,
  bubble_color_mine text,
  bubble_color_theirs text,
  text_color_mine text,
  text_color_theirs text,
  accent_color text,
  bubble_style text DEFAULT 'rounded'::text,
  font_family text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT chat_themes_pkey PRIMARY KEY (id),
  CONSTRAINT chat_themes_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id),
  CONSTRAINT chat_themes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.calls (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  conversation_id uuid,
  caller_id uuid NOT NULL,
  callee_id uuid NOT NULL,
  media text NOT NULL DEFAULT 'video'::text,
  status text NOT NULL DEFAULT 'ringing'::text,
  started_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  connected_at timestamp with time zone,
  ended_at timestamp with time zone,
  CONSTRAINT calls_pkey PRIMARY KEY (id),
  CONSTRAINT calls_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id),
  CONSTRAINT calls_caller_id_fkey FOREIGN KEY (caller_id) REFERENCES public.profiles(id),
  CONSTRAINT calls_callee_id_fkey FOREIGN KEY (callee_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.reports (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  reason text NOT NULL,
  details text,
  status text NOT NULL DEFAULT 'open'::text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT reports_pkey PRIMARY KEY (id),
  CONSTRAINT reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.platform_config (
  key text NOT NULL,
  value jsonb NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT platform_config_pkey PRIMARY KEY (key)
);
CREATE TABLE public.follow_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL,
  target_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending'::text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT follow_requests_pkey PRIMARY KEY (id),
  CONSTRAINT follow_requests_requester_id_fkey FOREIGN KEY (requester_id) REFERENCES public.profiles(id),
  CONSTRAINT follow_requests_target_id_fkey FOREIGN KEY (target_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.entitlements (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  key text NOT NULL,
  source text NOT NULL DEFAULT 'plan'::text,
  source_id text,
  granted_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  expires_at timestamp with time zone,
  CONSTRAINT entitlements_pkey PRIMARY KEY (id),
  CONSTRAINT entitlements_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.subscriptions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  plan text NOT NULL DEFAULT 'free'::text,
  status text NOT NULL DEFAULT 'active'::text,
  provider text,
  provider_subscription_id text UNIQUE,
  price_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD'::text,
  trial_ends_at timestamp with time zone,
  current_period_end timestamp with time zone,
  canceled_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT subscriptions_pkey PRIMARY KEY (id),
  CONSTRAINT subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.purchases (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  product_type text NOT NULL,
  product_id uuid,
  title text NOT NULL,
  price_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD'::text,
  provider text,
  provider_transaction_id text UNIQUE,
  status text NOT NULL DEFAULT 'pending'::text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT purchases_pkey PRIMARY KEY (id),
  CONSTRAINT purchases_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.video_projects (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL DEFAULT 'Untitled project'::text,
  project jsonb NOT NULL DEFAULT '{}'::jsonb,
  aspect_ratio text NOT NULL DEFAULT 'original'::text,
  duration_seconds numeric NOT NULL DEFAULT 0,
  template_id uuid,
  thumbnail_url text,
  exported_url text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  project_version integer NOT NULL DEFAULT 2,
  editor_version text NOT NULL DEFAULT 'enotes-video-2'::text,
  render_status text NOT NULL DEFAULT 'idle'::text,
  render_error text,
  render_progress integer NOT NULL DEFAULT 0 CHECK (render_progress >= 0 AND render_progress <= 100),
  last_rendered_at timestamp with time zone,
  deleted_at timestamp with time zone,
  CONSTRAINT video_projects_pkey PRIMARY KEY (id),
  CONSTRAINT video_projects_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.media_library (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  bucket text NOT NULL,
  path text NOT NULL,
  url text NOT NULL,
  media_type text NOT NULL,
  size_bytes bigint,
  duration_seconds numeric,
  width integer,
  height integer,
  source text NOT NULL DEFAULT 'upload'::text,
  video_project_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT media_library_pkey PRIMARY KEY (id),
  CONSTRAINT media_library_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT media_library_video_project_id_fkey FOREIGN KEY (video_project_id) REFERENCES public.video_projects(id)
);
CREATE TABLE public.sounds (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL,
  artist text NOT NULL DEFAULT 'enotes'::text,
  category text NOT NULL DEFAULT 'ambient'::text,
  url text NOT NULL,
  duration_seconds numeric NOT NULL DEFAULT 0,
  license_type text NOT NULL DEFAULT 'cc0'::text,
  rights_holder text NOT NULL DEFAULT 'enotes'::text,
  commercial_use boolean NOT NULL DEFAULT true,
  attribution_required boolean NOT NULL DEFAULT false,
  restrictions text,
  premium boolean NOT NULL DEFAULT false,
  plays integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT sounds_pkey PRIMARY KEY (id)
);
CREATE TABLE public.favorite_sounds (
  sound_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT favorite_sounds_pkey PRIMARY KEY (sound_id, user_id),
  CONSTRAINT favorite_sounds_sound_id_fkey FOREIGN KEY (sound_id) REFERENCES public.sounds(id),
  CONSTRAINT favorite_sounds_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.templates (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT ''::text,
  category text NOT NULL DEFAULT 'trending'::text,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  project jsonb NOT NULL DEFAULT '{}'::jsonb,
  aspect_ratio text NOT NULL DEFAULT '9:16'::text,
  duration_seconds numeric NOT NULL DEFAULT 0,
  thumbnail_url text,
  preview_url text,
  premium boolean NOT NULL DEFAULT false,
  price_cents integer NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  currency text NOT NULL DEFAULT 'USD'::text,
  status text NOT NULL DEFAULT 'draft'::text CHECK (status = ANY (ARRAY['draft'::text, 'pending'::text, 'published'::text, 'rejected'::text, 'archived'::text])),
  rejection_reason text,
  featured boolean NOT NULL DEFAULT false,
  views integer NOT NULL DEFAULT 0,
  uses integer NOT NULL DEFAULT 0,
  saves integer NOT NULL DEFAULT 0,
  rating_sum integer NOT NULL DEFAULT 0,
  rating_count integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  submitted_at timestamp with time zone,
  reviewed_at timestamp with time zone,
  reviewed_by uuid,
  review_note text,
  published_at timestamp with time zone,
  CONSTRAINT templates_pkey PRIMARY KEY (id),
  CONSTRAINT templates_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.profiles(id),
  CONSTRAINT templates_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.profiles(id)
);
CREATE TABLE public.saved_templates (
  template_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT saved_templates_pkey PRIMARY KEY (template_id, user_id),
  CONSTRAINT saved_templates_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.templates(id),
  CONSTRAINT saved_templates_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.template_ratings (
  template_id uuid NOT NULL,
  user_id uuid NOT NULL,
  rating integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT template_ratings_pkey PRIMARY KEY (template_id, user_id),
  CONSTRAINT template_ratings_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.templates(id),
  CONSTRAINT template_ratings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.asset_packs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL,
  pack_type text NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT ''::text,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  thumbnail_url text,
  premium boolean NOT NULL DEFAULT false,
  price_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD'::text,
  license_type text NOT NULL DEFAULT 'platform'::text,
  rights_declaration boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'draft'::text,
  installs integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT asset_packs_pkey PRIMARY KEY (id),
  CONSTRAINT asset_packs_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.creator_earnings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL,
  purchase_id uuid,
  gross_cents integer NOT NULL DEFAULT 0,
  commission_cents integer NOT NULL DEFAULT 0,
  net_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD'::text,
  status text NOT NULL DEFAULT 'pending'::text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT creator_earnings_pkey PRIMARY KEY (id),
  CONSTRAINT creator_earnings_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.profiles(id),
  CONSTRAINT creator_earnings_purchase_id_fkey FOREIGN KEY (purchase_id) REFERENCES public.purchases(id)
);
CREATE TABLE public.payouts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  currency text NOT NULL DEFAULT 'USD'::text,
  provider text,
  provider_payout_id text UNIQUE,
  status text NOT NULL DEFAULT 'processing'::text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  paid_at timestamp with time zone,
  CONSTRAINT payouts_pkey PRIMARY KEY (id),
  CONSTRAINT payouts_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.template_events (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  template_id uuid NOT NULL,
  user_id uuid,
  event text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT template_events_pkey PRIMARY KEY (id),
  CONSTRAINT template_events_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.templates(id),
  CONSTRAINT template_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.promotions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  description text,
  percent_off integer NOT NULL DEFAULT 0 CHECK (percent_off >= 0 AND percent_off <= 100),
  applies_to text NOT NULL DEFAULT 'all'::text,
  product_id uuid,
  max_redemptions integer,
  times_redeemed integer NOT NULL DEFAULT 0,
  starts_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  ends_at timestamp with time zone,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT promotions_pkey PRIMARY KEY (id),
  CONSTRAINT promotions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id)
);
CREATE TABLE public.reposts (
  user_id uuid NOT NULL,
  post_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT reposts_pkey PRIMARY KEY (user_id, post_id),
  CONSTRAINT reposts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT reposts_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id)
);
CREATE TABLE public.communities (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT ''::text,
  topic text NOT NULL DEFAULT 'general'::text,
  emoji text NOT NULL DEFAULT '✨'::text,
  cover_url text,
  created_by uuid NOT NULL,
  members_count integer NOT NULL DEFAULT 0,
  posts_count integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT communities_pkey PRIMARY KEY (id),
  CONSTRAINT communities_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id)
);
CREATE TABLE public.community_members (
  community_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'member'::text CHECK (role = ANY (ARRAY['member'::text, 'moderator'::text])),
  joined_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT community_members_pkey PRIMARY KEY (community_id, user_id),
  CONSTRAINT community_members_community_id_fkey FOREIGN KEY (community_id) REFERENCES public.communities(id),
  CONSTRAINT community_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.community_posts (
  community_id uuid NOT NULL,
  post_id uuid NOT NULL,
  posted_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT community_posts_pkey PRIMARY KEY (community_id, post_id),
  CONSTRAINT community_posts_community_id_fkey FOREIGN KEY (community_id) REFERENCES public.communities(id),
  CONSTRAINT community_posts_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id),
  CONSTRAINT community_posts_posted_by_fkey FOREIGN KEY (posted_by) REFERENCES public.profiles(id)
);
CREATE TABLE public.template_reviews (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL,
  reviewer_id uuid NOT NULL,
  action text NOT NULL CHECK (action = ANY (ARRAY['submitted'::text, 'approved'::text, 'rejected'::text, 'resubmitted'::text, 'archived'::text])),
  note text,
  previous_status text,
  new_status text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT template_reviews_pkey PRIMARY KEY (id),
  CONSTRAINT template_reviews_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.templates(id),
  CONSTRAINT template_reviews_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES public.profiles(id)
);