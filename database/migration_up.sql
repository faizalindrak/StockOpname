-- =====================================================
-- CycleCountAppStark Database Migration - UP
-- Updated: standalone PostgreSQL (no Supabase/RLS)
-- Auth is enforced by the Hono server middleware.
-- =====================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- ENUMS
-- =====================================================

DO $$ BEGIN CREATE TYPE user_role    AS ENUM ('admin', 'user');           EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE user_status  AS ENUM ('active', 'inactive');      EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE session_status AS ENUM ('draft', 'active', 'completed', 'cancelled'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE session_type AS ENUM ('inventory');               EXCEPTION WHEN duplicate_object THEN null; END $$;

-- =====================================================
-- TABLES
-- =====================================================

CREATE TABLE IF NOT EXISTS public.profiles (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT        UNIQUE NOT NULL,
    name          TEXT        NOT NULL,
    username      TEXT        UNIQUE NOT NULL,
    role          user_role   NOT NULL DEFAULT 'user',
    status        user_status NOT NULL DEFAULT 'inactive',
    password_hash TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.categories (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT        UNIQUE NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.locations (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name           TEXT        NOT NULL,
    category_id    UUID        NOT NULL REFERENCES public.categories(id) ON DELETE RESTRICT,
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.items (
    id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    sku       TEXT        UNIQUE NOT NULL,
    item_code TEXT        NOT NULL,
    item_name TEXT        NOT NULL,
    category  TEXT        NOT NULL,
    uom       TEXT        NOT NULL,
    tags      TEXT[]      DEFAULT '{}',
    created_by UUID       NOT NULL REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.sessions (
    id           UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    name         TEXT           NOT NULL,
    type         session_type   NOT NULL DEFAULT 'inventory',
    status       session_status NOT NULL DEFAULT 'draft',
    created_date TIMESTAMPTZ    DEFAULT NOW(),
    created_by   UUID           NOT NULL REFERENCES public.profiles(id),
    updated_at   TIMESTAMPTZ    DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.session_users (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id  UUID        NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
    user_id     UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(session_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.session_items (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID        NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
    item_id    UUID        NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(session_id, item_id)
);

CREATE TABLE IF NOT EXISTS public.counts (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id  UUID        NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
    item_id     UUID        NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
    user_id     UUID        NOT NULL REFERENCES public.profiles(id),
    location_id UUID        NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
    counted_qty INTEGER     NOT NULL CHECK (counted_qty >= 0),
    timestamp   TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- INDEXES
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_profiles_email          ON public.profiles(email);
CREATE INDEX IF NOT EXISTS idx_locations_category_id   ON public.locations(category_id);
CREATE INDEX IF NOT EXISTS idx_items_created_by        ON public.items(created_by);
CREATE INDEX IF NOT EXISTS idx_sessions_created_by     ON public.sessions(created_by);
CREATE INDEX IF NOT EXISTS idx_session_users_session_id ON public.session_users(session_id);
CREATE INDEX IF NOT EXISTS idx_session_users_user_id   ON public.session_users(user_id);
CREATE INDEX IF NOT EXISTS idx_session_items_session_id ON public.session_items(session_id);
CREATE INDEX IF NOT EXISTS idx_session_items_item_id   ON public.session_items(item_id);
CREATE INDEX IF NOT EXISTS idx_counts_session_id       ON public.counts(session_id);
CREATE INDEX IF NOT EXISTS idx_counts_item_id          ON public.counts(item_id);
CREATE INDEX IF NOT EXISTS idx_counts_location_id      ON public.counts(location_id);
CREATE INDEX IF NOT EXISTS idx_counts_user_id          ON public.counts(user_id);
CREATE INDEX IF NOT EXISTS idx_items_sku               ON public.items(sku);
CREATE INDEX IF NOT EXISTS idx_items_item_name         ON public.items USING gin(to_tsvector('english', item_name));
CREATE INDEX IF NOT EXISTS idx_items_tags              ON public.items USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_sessions_status_created_date ON public.sessions(status, created_date DESC);
CREATE INDEX IF NOT EXISTS idx_counts_session_timestamp ON public.counts(session_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_active         ON public.sessions(created_date DESC) WHERE status = 'active';

-- =====================================================
-- TRIGGERS: updated_at
-- =====================================================

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['profiles','categories','locations','items','sessions'] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS update_%I_updated_at ON public.%I', t, t);
        EXECUTE format(
            'CREATE TRIGGER update_%I_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()',
            t, t
        );
    END LOOP;
END $$;

COMMIT;
