-- NexaLink Production Database Migrations Schema (Supabase PostgreSQL)
-- Run this script inside the SQL Editor of your Supabase project dashboard (uejwhikwtjikrsbnaabo).

-- Enable pgvector for semantic transcripts search
CREATE EXTENSION IF NOT EXISTS vector;

-- 1. Create Public User Profiles Table (Linked to Supabase Auth)
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    bio TEXT,
    profile_pic TEXT,
    theme TEXT DEFAULT 'dark',
    chat_settings JSONB DEFAULT '{"pressEnterToSend": true, "soundEnabled": true, "typingIndicators": true}',
    notif_settings JSONB DEFAULT '{"desktopEnabled": true, "showToastAlerts": true, "pushWakingEnabled": true}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Ensure columns exist on pre-existing tables in live Supabase instances
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS profile_pic TEXT;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS theme TEXT DEFAULT 'dark';
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS chat_settings JSONB DEFAULT '{"pressEnterToSend": true, "soundEnabled": true, "typingIndicators": true}';
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS notif_settings JSONB DEFAULT '{"desktopEnabled": true, "showToastAlerts": true, "pushWakingEnabled": true}';

-- Force Supabase PostgREST to reload its schema cache to pick up the new columns immediately
NOTIFY pgrst, 'reload schema';

-- Row Level Security (RLS)
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- Helper to verify if the request is originating from the trusted Signalling Server
CREATE OR REPLACE FUNCTION public.is_signalling_server()
RETURNS BOOLEAN AS $$
DECLARE
    headers_text TEXT;
BEGIN
    headers_text := current_setting('request.headers', true);
    IF headers_text IS NULL OR headers_text = '' THEN
        RETURN FALSE;
    END IF;
    RETURN (
        coalesce(headers_text::json->>'x-signalling-secret', '') = '3f8a2c1d9e7b4f6a0d5c8e2b1a9f3d7e4c6b0a8f2e5d1c9b7a4f3e6d0c2b8a5f'
        OR
        coalesce(headers_text::json->>'X-Signalling-Secret', '') = '3f8a2c1d9e7b4f6a0d5c8e2b1a9f3d7e4c6b0a8f2e5d1c9b7a4f3e6d0c2b8a5f'
        OR
        coalesce(headers_text::json->>'x_signalling_secret', '') = '3f8a2c1d9e7b4f6a0d5c8e2b1a9f3d7e4c6b0a8f2e5d1c9b7a4f3e6d0c2b8a5f'
    );
EXCEPTION
    WHEN OTHERS THEN
        RETURN FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Allow public read access to profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "Allow users to update their own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Allow users to update your own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Allow users to modify their own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Allow signalling modify profiles" ON public.user_profiles;

-- Create hardened policies for user_profiles
CREATE POLICY "Allow public read access to profiles" 
ON public.user_profiles FOR SELECT USING (true);

CREATE POLICY "Allow users to modify their own profile"
ON public.user_profiles FOR ALL 
TO authenticated, anon
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

CREATE POLICY "Allow signalling modify profiles"
ON public.user_profiles FOR ALL
USING (public.is_signalling_server())
WITH CHECK (public.is_signalling_server());

-- Trigger to automatically map Auth users to Public user_profiles upon signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.user_profiles (id, username, email)
    VALUES (
        new.id,
        COALESCE(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
        new.email
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- 2. Create Room Sessions Table
CREATE TABLE IF NOT EXISTS public.rooms (
    id VARCHAR(50) PRIMARY KEY,
    room_name VARCHAR(100) NOT NULL,
    ephemeral_mode BOOLEAN DEFAULT TRUE,
    metadata_stripping BOOLEAN DEFAULT TRUE,
    data_residency_region VARCHAR(10) DEFAULT 'US',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    concluded_at TIMESTAMP WITH TIME ZONE
);

ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow room access policies" ON public.rooms;
DROP POLICY IF EXISTS "Allow room select" ON public.rooms;
DROP POLICY IF EXISTS "Allow room insert" ON public.rooms;
DROP POLICY IF EXISTS "Allow signalling select rooms" ON public.rooms;
DROP POLICY IF EXISTS "Allow signalling insert rooms" ON public.rooms;

CREATE POLICY "Allow signalling select rooms" ON public.rooms FOR SELECT USING (public.is_signalling_server());
CREATE POLICY "Allow signalling insert rooms" ON public.rooms FOR INSERT WITH CHECK (public.is_signalling_server());


-- 3. Create Call Logs Table (Tracks who joined, when, and when they left)
CREATE TABLE IF NOT EXISTS public.call_logs (
    id BIGSERIAL PRIMARY KEY,
    room_id VARCHAR(50) REFERENCES public.rooms(id) ON DELETE SET NULL,
    room_name VARCHAR(100) NOT NULL,
    username VARCHAR(50) NOT NULL,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    left_at TIMESTAMP WITH TIME ZONE
);

ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow call logs access" ON public.call_logs;
DROP POLICY IF EXISTS "Allow signalling select call logs" ON public.call_logs;
DROP POLICY IF EXISTS "Allow signalling insert call logs" ON public.call_logs;
DROP POLICY IF EXISTS "Allow signalling update call logs" ON public.call_logs;

CREATE POLICY "Allow signalling select call logs" ON public.call_logs FOR SELECT USING (public.is_signalling_server());
CREATE POLICY "Allow signalling insert call logs" ON public.call_logs FOR INSERT WITH CHECK (public.is_signalling_server());
CREATE POLICY "Allow signalling update call logs" ON public.call_logs FOR UPDATE USING (public.is_signalling_server()) WITH CHECK (public.is_signalling_server());


-- 4. Create Selective Recording Consent Audit Trails
CREATE TABLE IF NOT EXISTS public.recording_consents (
    id BIGSERIAL PRIMARY KEY,
    room_name VARCHAR(100) NOT NULL,
    participant_id VARCHAR(100) NOT NULL,
    consent_granted BOOLEAN NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.recording_consents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow recording consents access" ON public.recording_consents;
DROP POLICY IF EXISTS "Allow signalling select recording consents" ON public.recording_consents;
DROP POLICY IF EXISTS "Allow signalling insert recording consents" ON public.recording_consents;

CREATE POLICY "Allow signalling select recording consents" ON public.recording_consents FOR SELECT USING (public.is_signalling_server());
CREATE POLICY "Allow signalling insert recording consents" ON public.recording_consents FOR INSERT WITH CHECK (public.is_signalling_server());


-- 5. Create Meeting Summaries & Action Items Table
CREATE TABLE IF NOT EXISTS public.meeting_summaries (
    id BIGSERIAL PRIMARY KEY,
    room_name VARCHAR(100) NOT NULL,
    transcript TEXT NOT NULL,
    summary TEXT NOT NULL,
    action_items JSONB NOT NULL, -- Stored as queryable JSON documents
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.meeting_summaries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow meeting summaries access" ON public.meeting_summaries;
DROP POLICY IF EXISTS "Allow signalling select meeting summaries" ON public.meeting_summaries;
DROP POLICY IF EXISTS "Allow signalling insert meeting summaries" ON public.meeting_summaries;

CREATE POLICY "Allow signalling select meeting summaries" ON public.meeting_summaries FOR SELECT USING (public.is_signalling_server());
CREATE POLICY "Allow signalling insert meeting summaries" ON public.meeting_summaries FOR INSERT WITH CHECK (public.is_signalling_server());


-- 6. Create Whiteboard Saves Table (referenced by save_whiteboard_snapshot_db)
CREATE TABLE IF NOT EXISTS public.whiteboard_saves (
    id BIGSERIAL PRIMARY KEY,
    room_name VARCHAR(100) NOT NULL,
    url TEXT NOT NULL,
    saved_by VARCHAR(50) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.whiteboard_saves ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow whiteboard saves access" ON public.whiteboard_saves;
DROP POLICY IF EXISTS "Allow signalling select whiteboard saves" ON public.whiteboard_saves;
DROP POLICY IF EXISTS "Allow signalling insert whiteboard saves" ON public.whiteboard_saves;

CREATE POLICY "Allow signalling select whiteboard saves" ON public.whiteboard_saves FOR SELECT USING (public.is_signalling_server());
CREATE POLICY "Allow signalling insert whiteboard saves" ON public.whiteboard_saves FOR INSERT WITH CHECK (public.is_signalling_server());


-- 7. Direct Messages Table
--    Stores 1-to-1 chat messages between users persistently.
--    conversation_key = sorted concatenation of both usernames e.g. "alice|bob"
CREATE TABLE IF NOT EXISTS public.direct_messages (
    id          BIGSERIAL PRIMARY KEY,
    conversation_key  VARCHAR(120) NOT NULL,  -- sorted "userA|userB"
    sender      VARCHAR(50)  NOT NULL,
    recipient   VARCHAR(50)  NOT NULL,
    text        TEXT         NOT NULL,
    sent_at     TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    read        BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_direct_messages_convo
    ON public.direct_messages (conversation_key, sent_at DESC);

ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow direct messages access" ON public.direct_messages;
DROP POLICY IF EXISTS "Allow signalling select DMs" ON public.direct_messages;
DROP POLICY IF EXISTS "Allow signalling insert DMs" ON public.direct_messages;
DROP POLICY IF EXISTS "Allow signalling update DMs" ON public.direct_messages;
DROP POLICY IF EXISTS "Allow signalling delete DMs" ON public.direct_messages;

CREATE POLICY "Allow signalling select DMs" ON public.direct_messages FOR SELECT USING (public.is_signalling_server());
CREATE POLICY "Allow signalling insert DMs" ON public.direct_messages FOR INSERT WITH CHECK (public.is_signalling_server());
CREATE POLICY "Allow signalling update DMs" ON public.direct_messages FOR UPDATE USING (public.is_signalling_server()) WITH CHECK (public.is_signalling_server());
CREATE POLICY "Allow signalling delete DMs" ON public.direct_messages FOR DELETE USING (public.is_signalling_server());


-- 8. Direct Call Logs Table
--    One row per call attempt between two users.
CREATE TABLE IF NOT EXISTS public.direct_call_logs (
    id               BIGSERIAL PRIMARY KEY,
    conversation_key VARCHAR(120) NOT NULL,
    caller           VARCHAR(50)  NOT NULL,
    callee           VARCHAR(50)  NOT NULL,
    call_type        VARCHAR(10)  NOT NULL DEFAULT 'video',  -- 'video' | 'voice'
    status           VARCHAR(20)  NOT NULL DEFAULT 'missed', -- 'accepted' | 'declined' | 'missed'
    room_name        VARCHAR(120),
    started_at       TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    ended_at         TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_direct_call_logs_convo
    ON public.direct_call_logs (conversation_key, started_at DESC);

ALTER TABLE public.direct_call_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow direct call logs access" ON public.direct_call_logs;
DROP POLICY IF EXISTS "Allow signalling select direct call logs" ON public.direct_call_logs;
DROP POLICY IF EXISTS "Allow signalling insert direct call logs" ON public.direct_call_logs;
DROP POLICY IF EXISTS "Allow signalling update direct call logs" ON public.direct_call_logs;
DROP POLICY IF EXISTS "Allow signalling delete direct call logs" ON public.direct_call_logs;

CREATE POLICY "Allow signalling select direct call logs" ON public.direct_call_logs FOR SELECT USING (public.is_signalling_server());
CREATE POLICY "Allow signalling insert direct call logs" ON public.direct_call_logs FOR INSERT WITH CHECK (public.is_signalling_server());
CREATE POLICY "Allow signalling update direct call logs" ON public.direct_call_logs FOR UPDATE USING (public.is_signalling_server()) WITH CHECK (public.is_signalling_server());
CREATE POLICY "Allow signalling delete direct call logs" ON public.direct_call_logs FOR DELETE USING (public.is_signalling_server());

-- 9. Contacts Table (E2E persistent contact lists)
CREATE TABLE IF NOT EXISTS public.contacts (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL,
    contact_username VARCHAR(50) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(username, contact_username)
);

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow contacts access" ON public.contacts;
DROP POLICY IF EXISTS "Allow signalling select contacts" ON public.contacts;
DROP POLICY IF EXISTS "Allow signalling insert contacts" ON public.contacts;
DROP POLICY IF EXISTS "Allow signalling delete contacts" ON public.contacts;

CREATE POLICY "Allow signalling select contacts" ON public.contacts FOR SELECT USING (public.is_signalling_server());
CREATE POLICY "Allow signalling insert contacts" ON public.contacts FOR INSERT WITH CHECK (public.is_signalling_server());
CREATE POLICY "Allow signalling delete contacts" ON public.contacts FOR DELETE USING (public.is_signalling_server());


-- 10. File Transfers Table (Tracks metadata & status of secure transfers)
CREATE TABLE IF NOT EXISTS public.file_transfers (
    id BIGSERIAL PRIMARY KEY,
    conversation_key VARCHAR(120) NOT NULL,
    sender VARCHAR(50) NOT NULL,
    recipient VARCHAR(50) NOT NULL,
    file_name TEXT NOT NULL,
    file_size BIGINT NOT NULL,
    file_type VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'accepted', 'declined'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_file_transfers_recipient_status
    ON public.file_transfers (recipient, status);
CREATE INDEX IF NOT EXISTS idx_file_transfers_convo
    ON public.file_transfers (conversation_key, created_at DESC);

ALTER TABLE public.file_transfers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow file transfers access" ON public.file_transfers;
DROP POLICY IF EXISTS "Allow signalling select file transfers" ON public.file_transfers;
DROP POLICY IF EXISTS "Allow signalling insert file transfers" ON public.file_transfers;
DROP POLICY IF EXISTS "Allow signalling update file transfers" ON public.file_transfers;

CREATE POLICY "Allow signalling select file transfers" ON public.file_transfers FOR SELECT USING (public.is_signalling_server());
CREATE POLICY "Allow signalling insert file transfers" ON public.file_transfers FOR INSERT WITH CHECK (public.is_signalling_server());
CREATE POLICY "Allow signalling update file transfers" ON public.file_transfers FOR UPDATE USING (public.is_signalling_server()) WITH CHECK (public.is_signalling_server());


-- 11. Notification Audit & Diagnostics Logs
CREATE TABLE IF NOT EXISTS public.notification_logs (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL,
    notification_type VARCHAR(20) NOT NULL, -- 'chat' | 'call' | 'file_transfer'
    status VARCHAR(20) NOT NULL,            -- 'delivered' | 'failed' | 'no_subscription'
    error_details TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notification_logs_user ON public.notification_logs(username, created_at DESC);

ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow notification logs access" ON public.notification_logs;
DROP POLICY IF EXISTS "Allow signalling insert notification logs" ON public.notification_logs;

CREATE POLICY "Allow signalling insert notification logs" ON public.notification_logs FOR INSERT WITH CHECK (public.is_signalling_server());


-- 12. Push Subscriptions Persistence Table
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL,
    subscription JSONB NOT NULL,
    endpoint TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_username ON public.push_subscriptions(username);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow push subscriptions access" ON public.push_subscriptions;
DROP POLICY IF EXISTS "Allow signalling select push subs" ON public.push_subscriptions;
DROP POLICY IF EXISTS "Allow signalling insert push subs" ON public.push_subscriptions;
DROP POLICY IF EXISTS "Allow signalling update push subs" ON public.push_subscriptions;
DROP POLICY IF EXISTS "Allow signalling delete push subs" ON public.push_subscriptions;

CREATE POLICY "Allow signalling select push subs" ON public.push_subscriptions FOR SELECT USING (public.is_signalling_server());
CREATE POLICY "Allow signalling insert push subs" ON public.push_subscriptions FOR INSERT WITH CHECK (public.is_signalling_server());
CREATE POLICY "Allow signalling update push subs" ON public.push_subscriptions FOR UPDATE USING (public.is_signalling_server()) WITH CHECK (public.is_signalling_server());
CREATE POLICY "Allow signalling delete push subs" ON public.push_subscriptions FOR DELETE USING (public.is_signalling_server());



