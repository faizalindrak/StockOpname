-- =====================================================
-- Add user_status column to profiles table
-- Run this in a PostgreSQL client connected to the application database
-- =====================================================

BEGIN;

-- Create user_status enum if it doesn't exist
DO $$ BEGIN
    CREATE TYPE user_status AS ENUM ('active', 'inactive');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Add status column to profiles table if it doesn't exist
DO $$ BEGIN
    ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS status user_status NOT NULL DEFAULT 'inactive';
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

-- Set existing users to active status (assuming they were active before)
UPDATE public.profiles SET status = 'active';

COMMIT;

-- Verify the changes
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'profiles' AND table_schema = 'public'
ORDER BY ordinal_position;
