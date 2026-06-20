import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { onTokenChange } from '../lib/db/http.js';
import { resolveSession } from '../lib/services/auth.js';

const AuthContext = createContext({});

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const applySession = useCallback((session) => {
    if (!session) {
      setUser(null);
      setProfile(null);
      return;
    }
    setUser(session.user);
    setProfile(session.profile);
  }, []);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const session = await resolveSession();
        if (active) applySession(session);
      } catch (error) {
        console.error('Error getting initial session:', error);
      } finally {
        if (active) setLoading(false);
      }
    };

    load();

    const unsubscribe = onTokenChange(async () => {
      const session = await resolveSession();
      applySession(session);
      setLoading(false);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [applySession]);

  const signIn = useCallback(async (email, password) => {
    try {
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) throw authError;

      const session = await resolveSession();
      if (!session) {
        throw new Error('Your account is inactive or missing a profile. Please contact your administrator.');
      }

      applySession(session);
      return { data: authData, error: null };
    } catch (error) {
      console.error('Sign in error:', error);
      await supabase.auth.signOut();
      setUser(null);
      setProfile(null);
      return { data: null, error };
    }
  }, [applySession]);

  const signUp = useCallback(async (email, password, userData) => {
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        name: userData.name,
        username: userData.username,
        role: userData.role,
        status: userData.status,
      });

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Sign up error:', error);
      return { data: null, error };
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setUser(null);
      setProfile(null);
    } catch (error) {
      console.error('Sign out error:', error);
      throw error;
    }
  }, []);

  const updateProfile = useCallback(async (updates) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', user.id)
        .select()
        .single();

      if (error) throw error;
      setProfile(data);
      return { data, error: null };
    } catch (error) {
      console.error('Update profile error:', error);
      return { data: null, error };
    }
  }, [user?.id]);

  const value = useMemo(() => ({
    user,
    profile,
    loading,
    signIn,
    signUp,
    signOut,
    updateProfile,
    isAdmin: profile?.role === 'admin' || user?.role === 'admin',
    isAuthenticated: !!user && !!profile && profile.status === 'active',
  }), [user, profile, loading, signIn, signUp, signOut, updateProfile]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};