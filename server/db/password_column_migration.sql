-- Adds a password_hash column to profiles for the new email/password auth.
-- Keep the email column unique.
alter table public.profiles
  add column if not exists password_hash text,
  add column if not exists email text;

create unique index if not exists profiles_email_uidx on public.profiles (email);
