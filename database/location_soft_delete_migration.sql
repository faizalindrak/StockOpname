-- =====================================================
-- Location Soft Delete Migration
-- Implements soft delete for locations with count data
-- =====================================================

BEGIN;

-- Add soft delete columns to locations table
ALTER TABLE locations
ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS deactivated_by UUID REFERENCES public.profiles(id);

-- Create index for active locations
CREATE INDEX IF NOT EXISTS idx_locations_active ON locations(is_active, category_id);

-- Create function to check if location has count data
CREATE OR REPLACE FUNCTION location_has_count_data(location_id_param UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM counts
        WHERE location_id = location_id_param
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to prevent location deletion when it has count data
CREATE OR REPLACE FUNCTION prevent_location_deletion_with_counts()
RETURNS TRIGGER AS $$
BEGIN
    -- Check if location has count data
    IF location_has_count_data(OLD.id) THEN
        RAISE EXCEPTION 'Cannot delete location "%" because it has associated count data. Use soft delete instead.', OLD.name;
    END IF;

    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to prevent hard deletion of locations with count data
DROP TRIGGER IF EXISTS prevent_location_deletion_with_counts_trigger ON locations;
CREATE TRIGGER prevent_location_deletion_with_counts_trigger
    BEFORE DELETE ON locations
    FOR EACH ROW EXECUTE FUNCTION prevent_location_deletion_with_counts();

-- Create function to soft delete location
CREATE OR REPLACE FUNCTION soft_delete_location(
    location_id_param UUID,
    user_id_param UUID DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
    has_counts BOOLEAN;
BEGIN
    -- Check if location has count data
    SELECT location_has_count_data(location_id_param) INTO has_counts;

    IF has_counts THEN
        -- Soft delete: mark as inactive
        UPDATE locations
        SET
            is_active = false,
            deactivated_at = NOW(),
            deactivated_by = user_id_param,
            updated_at = NOW()
        WHERE id = location_id_param AND is_active = true;

        RETURN true;
    ELSE
        -- Hard delete: actually remove the record
        DELETE FROM locations WHERE id = location_id_param;
        RETURN true;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to reactivate location
CREATE OR REPLACE FUNCTION reactivate_location(location_id_param UUID)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE locations
    SET
        is_active = true,
        deactivated_at = NULL,
        deactivated_by = NULL,
        updated_at = NOW()
    WHERE id = location_id_param AND is_active = false;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create view for location usage tracking
CREATE OR REPLACE VIEW location_usage AS
SELECT
    l.id,
    l.name,
    l.category_id,
    l.is_active,
    l.deactivated_at,
    l.deactivated_by,
    c.name as category_name,
    COUNT(co.id) as count_records,
    COUNT(DISTINCT co.session_id) as sessions_with_counts,
    CASE
        WHEN COUNT(co.id) > 0 THEN true
        ELSE false
    END as has_count_data,
    l.created_at,
    l.updated_at
FROM locations l
LEFT JOIN categories c ON l.category_id = c.id
LEFT JOIN counts co ON l.id = co.location_id
GROUP BY l.id, l.name, l.category_id, l.is_active, l.deactivated_at, l.deactivated_by, c.name, l.created_at, l.updated_at;

-- Update counts table foreign key to RESTRICT instead of CASCADE
-- First drop the existing constraint
ALTER TABLE counts DROP CONSTRAINT IF EXISTS counts_location_id_fkey;

-- Add new constraint with RESTRICT
ALTER TABLE counts
ADD CONSTRAINT counts_location_id_fkey
FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE RESTRICT;

-- Create index for location usage queries
CREATE INDEX IF NOT EXISTS idx_counts_location_session ON counts(location_id, session_id);

COMMIT;