-- ── Blog Posts Table ──────────────────────────────────────────────────────────
-- Run this in Supabase → SQL Editor

create table if not exists blog_posts (
  id              uuid default gen_random_uuid() primary key,
  title           text not null,
  slug            text unique not null,
  tag             text,
  excerpt         text,
  cover_image     text,
  content         text,
  seo_title       text,
  seo_description text,
  og_image        text,
  published       boolean default false,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- Enable Row Level Security
alter table blog_posts enable row level security;

-- Anyone can read published posts
create policy "Public read published posts"
  on blog_posts for select
  using (published = true);

-- Admin (arpietmalpani@gmail.com) can do everything
create policy "Admin full access"
  on blog_posts for all
  using  (auth.jwt() ->> 'email' = 'arpietmalpani@gmail.com')
  with check (auth.jwt() ->> 'email' = 'arpietmalpani@gmail.com');
