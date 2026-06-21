-- Migration for Item Groups feature
-- This migration creates tables to support item groups functionality

-- Create item_groups table
CREATE TABLE IF NOT EXISTS public.item_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_by UUID NOT NULL REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create item_group_items junction table (many-to-many relationship)
CREATE TABLE IF NOT EXISTS public.item_group_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_group_id UUID NOT NULL REFERENCES item_groups(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(item_group_id, item_id)
);

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_item_groups_created_by ON public.item_groups(created_by);
CREATE INDEX IF NOT EXISTS idx_item_groups_name ON public.item_groups(name);
CREATE INDEX IF NOT EXISTS idx_item_group_items_group_id ON public.item_group_items(item_group_id);
CREATE INDEX IF NOT EXISTS idx_item_group_items_item_id ON public.item_group_items(item_id);

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_item_groups_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER item_groups_updated_at
    BEFORE UPDATE ON public.item_groups
    FOR EACH ROW
    EXECUTE FUNCTION update_item_groups_updated_at();
