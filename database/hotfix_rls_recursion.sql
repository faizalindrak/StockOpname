-- =====================================================
-- HOTFIX: Fix Infinite Recursion in RLS Policies
-- Run this in a PostgreSQL client to fix existing migration policy recursion
-- =====================================================

BEGIN;

-- =====================================================
-- 1. CREATE HELPER FUNCTION (in public schema)
-- =====================================================

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
DECLARE
  user_role text;
BEGIN
  -- First try JWT claims
  IF auth.jwt() ->> 'role' = 'admin' OR
     auth.jwt() -> 'user_metadata' ->> 'role' = 'admin' OR
     auth.jwt() -> 'app_metadata' ->> 'role' = 'admin' THEN
    RETURN true;
  END IF;

  -- Fallback to profiles table query
  SELECT role INTO user_role FROM profiles WHERE id = auth.uid();
  RETURN user_role = 'admin';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 2. FIX ADMIN POLICIES (Replace queries with function calls)
-- =====================================================

-- PROFILES: Fix admin policy
DROP POLICY IF EXISTS "Admins can manage all profiles" ON profiles;
CREATE POLICY "Admins can manage all profiles" ON profiles
    FOR ALL USING (public.is_admin());

-- CATEGORIES: Fix admin policy
DROP POLICY IF EXISTS "Admins can manage categories" ON categories;
CREATE POLICY "Admins can manage categories" ON categories
    FOR ALL USING (public.is_admin());

-- LOCATIONS: Fix admin policy
DROP POLICY IF EXISTS "Admins can manage locations" ON locations;
CREATE POLICY "Admins can manage locations" ON locations
    FOR ALL USING (public.is_admin());

-- ITEMS: Fix admin policy
DROP POLICY IF EXISTS "Admins can manage items" ON items;
CREATE POLICY "Admins can manage items" ON items
    FOR ALL USING (public.is_admin());

-- SESSIONS: Fix admin policies
DROP POLICY IF EXISTS "Users can view assigned or created sessions" ON sessions;
CREATE POLICY "Users can view assigned or created sessions" ON sessions
    FOR SELECT USING (
        auth.uid() = created_by OR
        EXISTS (
            SELECT 1 FROM session_users su
            WHERE su.session_id = sessions.id AND su.user_id = auth.uid()
        ) OR
        public.is_admin()
    );

DROP POLICY IF EXISTS "Admins can manage all sessions" ON sessions;
CREATE POLICY "Admins can manage all sessions" ON sessions
    FOR ALL USING (public.is_admin());

-- SESSION_USERS: Fix admin policies
DROP POLICY IF EXISTS "Users can view their session assignments" ON session_users;
CREATE POLICY "Users can view their session assignments" ON session_users
    FOR SELECT USING (
        user_id = auth.uid() OR
        public.is_admin()
    );

DROP POLICY IF EXISTS "Admins can manage session assignments" ON session_users;
CREATE POLICY "Admins can manage session assignments" ON session_users
    FOR ALL USING (public.is_admin());

-- SESSION_ITEMS: Fix admin policies
DROP POLICY IF EXISTS "Users can view session items for accessible sessions" ON session_items;
CREATE POLICY "Users can view session items for accessible sessions" ON session_items
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM sessions s
            WHERE s.id = session_items.session_id AND (
                s.created_by = auth.uid() OR
                EXISTS (
                    SELECT 1 FROM session_users su
                    WHERE su.session_id = s.id AND su.user_id = auth.uid()
                ) OR
                public.is_admin()
            )
        )
    );

DROP POLICY IF EXISTS "Admins can manage session items" ON session_items;
CREATE POLICY "Admins can manage session items" ON session_items
    FOR ALL USING (public.is_admin());

-- COUNTS: Fix admin policies
DROP POLICY IF EXISTS "Users can view counts for accessible sessions" ON counts;
CREATE POLICY "Users can view counts for accessible sessions" ON counts
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM sessions s
            WHERE s.id = counts.session_id AND (
                s.created_by = auth.uid() OR
                EXISTS (
                    SELECT 1 FROM session_users su
                    WHERE su.session_id = s.id AND su.user_id = auth.uid()
                ) OR
                public.is_admin()
            )
        )
    );

DROP POLICY IF EXISTS "Admins can manage all counts" ON counts;
CREATE POLICY "Admins can manage all counts" ON counts
    FOR ALL USING (public.is_admin());

-- =====================================================
-- 3. VERIFY THE FIX
-- =====================================================

-- Test query to ensure no recursion (run after hotfix)
-- SELECT public.is_admin(); -- Should work without recursion

COMMIT;

-- =====================================================
-- POST-HOTFIX VERIFICATION
-- =====================================================
/*
Run these queries in SQL Editor after hotfix:

1. Test admin function:
SELECT public.is_admin();

2. Test profile access (as authenticated user):
SELECT id, name FROM profiles WHERE id = auth.uid();

3. Test session access (as counter):
SELECT * FROM sessions LIMIT 1;

4. Check all policies are updated:
SELECT schemaname, tablename, policyname
FROM pg_policies
WHERE schemaname = 'public' AND policyname LIKE '%Admin%'
ORDER BY tablename;
*/
