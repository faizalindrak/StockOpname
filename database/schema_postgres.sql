-- =====================================================
-- StockOpname - PostgreSQL Schema
-- Standalone schema for plain PostgreSQL (no Supabase).
-- Auth is handled by the Hono server + JWT; no RLS needed.
-- =====================================================

BEGIN;

-- Required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- ENUMS
-- =====================================================

DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('admin', 'user');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE user_status AS ENUM ('active', 'inactive');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE session_status AS ENUM ('draft', 'active', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE session_type AS ENUM ('inventory');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE follow_up_status_enum AS ENUM ('open', 'on_progress', 'closed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE inventory_status_enum AS ENUM ('kritis', 'over');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- =====================================================
-- TABLES
-- =====================================================

-- profiles is now a standalone table (no dependency on auth.users).
-- password_hash and email are managed by the Hono auth server.
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
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT        NOT NULL,
    category_id     UUID        NOT NULL REFERENCES public.categories(id) ON DELETE RESTRICT,
    is_active       BOOLEAN     NOT NULL DEFAULT true,
    deactivated_at  TIMESTAMPTZ,
    deactivated_by  UUID        REFERENCES public.profiles(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.items (
    id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    sku                   TEXT         UNIQUE NOT NULL,
    internal_product_code VARCHAR(20)  UNIQUE NOT NULL,
    item_code             TEXT         NOT NULL,
    item_name             TEXT         NOT NULL,
    category              TEXT         NOT NULL,
    uom                   TEXT         NOT NULL,
    tags                  TEXT[]       DEFAULT '{}',
    created_by            UUID         NOT NULL REFERENCES public.profiles(id),
    created_at            TIMESTAMPTZ  DEFAULT NOW(),
    updated_at            TIMESTAMPTZ  DEFAULT NOW(),
    CONSTRAINT items_internal_product_code_not_empty
        CHECK (LENGTH(TRIM(internal_product_code)) > 0),
    CONSTRAINT items_internal_product_code_max_length
        CHECK (LENGTH(internal_product_code) <= 20)
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
    id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id             UUID        NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
    item_id                UUID        NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
    user_id                UUID        NOT NULL REFERENCES public.profiles(id),
    location_id            UUID        NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
    counted_qty            INTEGER     NOT NULL CHECK (counted_qty >= 0),
    counted_qty_calculation TEXT,
    timestamp              TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT counts_location_id_fkey_restrict
        FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.item_groups (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT        NOT NULL UNIQUE,
    description TEXT,
    created_by  UUID        NOT NULL REFERENCES public.profiles(id),
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.item_group_items (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    item_group_id UUID        NOT NULL REFERENCES public.item_groups(id) ON DELETE CASCADE,
    item_id       UUID        NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(item_group_id, item_id)
);

CREATE TABLE IF NOT EXISTS public.report_status_raw_mat (
    id                    UUID                   PRIMARY KEY DEFAULT gen_random_uuid(),
    date_input            DATE                   NOT NULL DEFAULT CURRENT_DATE,
    sku                   TEXT                   NOT NULL,
    internal_product_code VARCHAR(20)            NOT NULL,
    item_name             TEXT                   NOT NULL,
    inventory_status      inventory_status_enum  NOT NULL,
    remarks               TEXT,
    qty                   INTEGER,
    follow_up_status      follow_up_status_enum  NOT NULL DEFAULT 'open',
    user_report           UUID                   NOT NULL REFERENCES public.profiles(id),
    user_follow_up        UUID                   REFERENCES public.profiles(id),
    created_at            TIMESTAMPTZ            DEFAULT NOW(),
    updated_at            TIMESTAMPTZ            DEFAULT NOW()
);

-- =====================================================
-- INDEXES
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);
CREATE INDEX IF NOT EXISTS idx_locations_category_id ON public.locations(category_id);
CREATE INDEX IF NOT EXISTS idx_locations_active ON public.locations(is_active, category_id);
CREATE INDEX IF NOT EXISTS idx_items_created_by ON public.items(created_by);
CREATE INDEX IF NOT EXISTS idx_items_sku ON public.items(sku);
CREATE INDEX IF NOT EXISTS idx_items_internal_product_code ON public.items(internal_product_code);
CREATE INDEX IF NOT EXISTS idx_items_item_name ON public.items USING gin(to_tsvector('english', item_name));
CREATE INDEX IF NOT EXISTS idx_items_tags ON public.items USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_sessions_created_by ON public.sessions(created_by);
CREATE INDEX IF NOT EXISTS idx_sessions_status_created_date ON public.sessions(status, created_date DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_active ON public.sessions(created_date DESC) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_session_users_session_id ON public.session_users(session_id);
CREATE INDEX IF NOT EXISTS idx_session_users_user_id ON public.session_users(user_id);
CREATE INDEX IF NOT EXISTS idx_session_items_session_id ON public.session_items(session_id);
CREATE INDEX IF NOT EXISTS idx_session_items_item_id ON public.session_items(item_id);
CREATE INDEX IF NOT EXISTS idx_counts_session_id ON public.counts(session_id);
CREATE INDEX IF NOT EXISTS idx_counts_item_id ON public.counts(item_id);
CREATE INDEX IF NOT EXISTS idx_counts_location_id ON public.counts(location_id);
CREATE INDEX IF NOT EXISTS idx_counts_user_id ON public.counts(user_id);
CREATE INDEX IF NOT EXISTS idx_counts_session_timestamp ON public.counts(session_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_counts_location_session ON public.counts(location_id, session_id);
CREATE INDEX IF NOT EXISTS idx_item_groups_created_by ON public.item_groups(created_by);
CREATE INDEX IF NOT EXISTS idx_item_groups_name ON public.item_groups(name);
CREATE INDEX IF NOT EXISTS idx_item_group_items_group_id ON public.item_group_items(item_group_id);
CREATE INDEX IF NOT EXISTS idx_item_group_items_item_id ON public.item_group_items(item_id);
CREATE INDEX IF NOT EXISTS idx_report_status_date_input ON public.report_status_raw_mat(date_input DESC);
CREATE INDEX IF NOT EXISTS idx_report_status_inventory_status ON public.report_status_raw_mat(inventory_status);
CREATE INDEX IF NOT EXISTS idx_report_status_follow_up_status ON public.report_status_raw_mat(follow_up_status);
CREATE INDEX IF NOT EXISTS idx_report_status_user_report ON public.report_status_raw_mat(user_report);
CREATE INDEX IF NOT EXISTS idx_report_status_sku ON public.report_status_raw_mat(sku);
CREATE INDEX IF NOT EXISTS idx_report_status_internal_product_code ON public.report_status_raw_mat(internal_product_code);

-- =====================================================
-- TRIGGERS: updated_at maintenance
-- =====================================================

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
    t text;
    tables text[] := ARRAY[
        'profiles', 'categories', 'locations', 'items',
        'sessions', 'item_groups', 'report_status_raw_mat'
    ];
BEGIN
    FOREACH t IN ARRAY tables LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS %I_updated_at_trg ON public.%I',
            t, t
        );
        EXECUTE format(
            'CREATE TRIGGER %I_updated_at_trg
             BEFORE UPDATE ON public.%I
             FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()',
            t, t
        );
    END LOOP;
END $$;

-- =====================================================
-- TRIGGERS: NOTIFY for realtime WebSocket relay
-- =====================================================

CREATE OR REPLACE FUNCTION public.notify_table_change() RETURNS trigger AS $$
DECLARE
    payload jsonb;
BEGIN
    IF (tg_op = 'DELETE') THEN
        payload := jsonb_build_object('event', 'DELETE', 'table', tg_table_name, 'old', to_jsonb(old));
    ELSIF (tg_op = 'UPDATE') THEN
        payload := jsonb_build_object('event', 'UPDATE', 'table', tg_table_name, 'new', to_jsonb(new), 'old', to_jsonb(old));
    ELSE
        payload := jsonb_build_object('event', 'INSERT', 'table', tg_table_name, 'new', to_jsonb(new));
    END IF;
    PERFORM pg_notify(tg_table_name || '_changes', payload::text);
    RETURN COALESCE(new, old);
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
    t text;
    tables text[] := ARRAY[
        'items', 'categories', 'locations', 'profiles', 'sessions',
        'session_items', 'session_users', 'counts', 'item_groups',
        'item_group_items', 'report_status_raw_mat'
    ];
BEGIN
    FOREACH t IN ARRAY tables LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS %I_notify_trg ON public.%I', t, t);
        EXECUTE format(
            'CREATE TRIGGER %I_notify_trg
             AFTER INSERT OR UPDATE OR DELETE ON public.%I
             FOR EACH ROW EXECUTE FUNCTION public.notify_table_change()',
            t, t
        );
    END LOOP;
END $$;

-- =====================================================
-- CATEGORY PROTECTION
-- =====================================================

CREATE OR REPLACE FUNCTION public.prevent_category_deletion()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.items WHERE category = OLD.name) THEN
        RAISE EXCEPTION 'Cannot delete category "%" because it is used by existing items', OLD.name;
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_category_deletion_trigger ON public.categories;
CREATE TRIGGER prevent_category_deletion_trigger
    BEFORE DELETE ON public.categories
    FOR EACH ROW EXECUTE FUNCTION public.prevent_category_deletion();

-- =====================================================
-- LOCATION SOFT DELETE
-- =====================================================

CREATE OR REPLACE FUNCTION public.location_has_count_data(location_id_param UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (SELECT 1 FROM public.counts WHERE location_id = location_id_param);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.prevent_location_deletion_with_counts()
RETURNS TRIGGER AS $$
BEGIN
    IF public.location_has_count_data(OLD.id) THEN
        RAISE EXCEPTION 'Cannot delete location "%" because it has associated count data. Use soft delete instead.', OLD.name;
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_location_deletion_with_counts_trigger ON public.locations;
CREATE TRIGGER prevent_location_deletion_with_counts_trigger
    BEFORE DELETE ON public.locations
    FOR EACH ROW EXECUTE FUNCTION public.prevent_location_deletion_with_counts();

CREATE OR REPLACE FUNCTION public.soft_delete_location(
    location_id_param UUID,
    user_id_param     UUID DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    IF public.location_has_count_data(location_id_param) THEN
        UPDATE public.locations
        SET is_active = false, deactivated_at = NOW(), deactivated_by = user_id_param, updated_at = NOW()
        WHERE id = location_id_param AND is_active = true;
    ELSE
        DELETE FROM public.locations WHERE id = location_id_param;
    END IF;
    RETURN true;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.reactivate_location(location_id_param UUID)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE public.locations
    SET is_active = true, deactivated_at = NULL, deactivated_by = NULL, updated_at = NOW()
    WHERE id = location_id_param AND is_active = false;
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- VIEWS
-- =====================================================

CREATE OR REPLACE VIEW public.category_usage AS
SELECT
    c.id,
    c.name,
    c.description,
    COUNT(DISTINCT i.id)  AS item_count,
    COUNT(DISTINCT l.id)  AS location_count,
    (COUNT(DISTINCT i.id) > 0 OR COUNT(DISTINCT l.id) > 0) AS is_in_use,
    c.created_at,
    c.updated_at
FROM public.categories c
LEFT JOIN public.items     i ON i.category   = c.name
LEFT JOIN public.locations l ON l.category_id = c.id
GROUP BY c.id, c.name, c.description, c.created_at, c.updated_at;

CREATE OR REPLACE VIEW public.location_usage AS
SELECT
    l.id,
    l.name,
    l.category_id,
    l.is_active,
    l.deactivated_at,
    l.deactivated_by,
    c.name                        AS category_name,
    COUNT(co.id)                  AS count_records,
    COUNT(DISTINCT co.session_id) AS sessions_with_counts,
    (COUNT(co.id) > 0)            AS has_count_data,
    l.created_at,
    l.updated_at
FROM public.locations l
LEFT JOIN public.categories c  ON l.category_id = c.id
LEFT JOIN public.counts     co ON l.id = co.location_id
GROUP BY l.id, l.name, l.category_id, l.is_active, l.deactivated_at,
         l.deactivated_by, c.name, l.created_at, l.updated_at;

COMMIT;
