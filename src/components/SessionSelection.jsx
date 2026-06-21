import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, Users, Calendar, Package2, Clock, LogOut, Home, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';

// Countdown Timer Component
const CountdownTimer = ({ targetTime }) => {
  const [timeLeft, setTimeLeft] = useState(calculateTimeLeft(targetTime));

  function calculateTimeLeft(target) {
    const now = new Date();
    const targetDate = new Date(target);
    const difference = targetDate - now;

    if (difference <= 0) {
      return { expired: true, text: 'Expired' };
    }

    const hours = Math.floor(difference / (1000 * 60 * 60));
    const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((difference % (1000 * 60)) / 1000);

    const isWarning = difference < 30 * 60 * 1000; // Less than 30 minutes
    const isCritical = difference < 10 * 60 * 1000; // Less than 10 minutes

    let text = '';
    if (hours > 0) {
      text = `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
      text = `${minutes}m ${seconds}s`;
    } else {
      text = `${seconds}s`;
    }

    return { expired: false, text, isWarning, isCritical, difference };
  }

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(calculateTimeLeft(targetTime));
    }, 1000);

    return () => clearInterval(timer);
  }, [targetTime]);

  if (timeLeft.expired) {
    return (
      <span className="text-red-600 font-semibold">
        Session Expired
      </span>
    );
  }

  const colorClass = timeLeft.isCritical
    ? 'text-red-600 font-bold'
    : timeLeft.isWarning
    ? 'text-orange-600 font-semibold'
    : 'text-green-600';

  return (
    <span className={colorClass}>
      Closes in: {timeLeft.text}
    </span>
  );
};

const SessionSelection = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (user) {
      fetchUserSessions();
    }
  }, [user]);

  const fetchUserSessions = async () => {
    try {
      setLoading(true);
      setError('');

      const today = new Date().toISOString().split('T')[0];

      // Non-admin users are scoped to assigned sessions by the API server.
      const { data, error } = await supabase
        .from('sessions')
        .select(`
          *,
          session_users (
            user_id
          )
        `)
        .in('status', ['active'])
        .order('created_date', { ascending: false });

      if (error) throw error;

      // Filter out scheduled sessions that are not for today and expired sessions
      const now = new Date();
      const validSessions = (data || []).filter(session => {
        // Hide scheduled sessions that are not for today
        if (session.status === 'scheduled' && session.scheduled_date !== today) {
          return false;
        }

        // Hide sessions that have expired (past valid_until)
        if (session.valid_until && new Date(session.valid_until) < now) {
          return false;
        }

        // Hide sessions that haven't started yet (before valid_from)
        if (session.valid_from && new Date(session.valid_from) > now) {
          return false;
        }

        // Hide recurring templates (users should only see generated sessions)
        if (session.is_recurring_template) {
          return false;
        }

        return true;
      });

      setSessions(validSessions);
    } catch (err) {
      console.error('Error fetching sessions:', err);
      setError('Failed to load sessions');
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (err) {
      console.error('Sign out error:', err);
    }
  };

  const handleGoHome = () => {
    navigate('/home');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100">
        <div className="bg-white shadow-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center py-4">
              <h1 className="text-2xl font-bold text-gray-900">Select Session</h1>
              <div className="flex items-center space-x-4">
                <span className="text-gray-600 hidden sm:block">
                  Welcome, {user?.name || user?.email}
                </span>
                <button
                  onClick={handleGoHome}
                  className="text-blue-600 hover:text-blue-800"
                  title="Go to Home"
                >
                  <Home className="h-5 w-5" />
                </button>
                <button
                  onClick={handleSignOut}
                  className="text-red-600 hover:text-red-800"
                  title="Logout"
                >
                  <LogOut className="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-center py-8">
          <div className="spinner"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <h1 className="text-2xl font-bold text-gray-900">Select Session</h1>
            <div className="flex items-center space-x-4">
              <span className="text-gray-600 hidden sm:block">
                Welcome, {user?.name || user?.email}
              </span>
              <button
                onClick={handleGoHome}
                className="text-blue-600 hover:text-blue-800"
                title="Go to Home"
              >
                <Home className="h-5 w-5" />
              </button>
              <button
                onClick={handleSignOut}
                className="text-red-600 hover:text-red-800"
                title="Logout"
              >
                <LogOut className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-4xl mx-auto py-6 sm:px-6 lg:px-8">
        {error && (
          <div className="mb-6 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
            {error}
          </div>
        )}

        <div className="grid gap-4">
          {sessions.length === 0 ? (
            <div className="text-center py-8">
              <ClipboardList className="mx-auto h-12 w-12 text-gray-400 mb-4" />
              <p className="text-gray-500">
                {error || 'No active sessions available.'}
              </p>
            </div>
          ) : (
            sessions.map((session) => {
              const hasTimeWindow = session.valid_from && session.valid_until;
              const now = new Date();
              const validUntil = session.valid_until ? new Date(session.valid_until) : null;
              const timeUntilClose = validUntil ? validUntil - now : null;
              const showWarning = timeUntilClose && timeUntilClose < 30 * 60 * 1000; // Less than 30 minutes

              return (
                <div key={session.id} className="bg-white rounded-lg shadow hover:shadow-md transition-shadow">
                  {showWarning && (
                    <div className="bg-orange-100 border-l-4 border-orange-500 px-4 py-2 rounded-t-lg flex items-center">
                      <AlertCircle className="h-4 w-4 text-orange-700 mr-2" />
                      <span className="text-sm text-orange-700 font-medium">
                        Session closing soon!
                      </span>
                    </div>
                  )}
                  <div
                    onClick={() => navigate(`/counting/${session.id}`)}
                    className="p-6 cursor-pointer"
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <h3 className="text-lg font-semibold text-gray-900">
                          {session.name}
                        </h3>
                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
                          <span className="flex items-center">
                            <Calendar className="h-4 w-4 mr-1" />
                            {session.type}
                          </span>
                          <span className="flex items-center">
                            <Package2 className="h-4 w-4 mr-1" />
                            Items to count
                          </span>
                          {session.scheduled_date && (
                            <span className="flex items-center">
                              <Calendar className="h-4 w-4 mr-1" />
                              {new Date(session.scheduled_date).toLocaleDateString()}
                            </span>
                          )}
                          {hasTimeWindow && (
                            <span className="flex items-center">
                              <Clock className="h-4 w-4 mr-1" />
                              {new Date(session.valid_from).toLocaleTimeString('en-US', {hour: '2-digit', minute: '2-digit'})} - {new Date(session.valid_until).toLocaleTimeString('en-US', {hour: '2-digit', minute: '2-digit'})}
                            </span>
                          )}
                        </div>

                        {/* Countdown Timer */}
                        {hasTimeWindow && validUntil && (
                          <div className="mt-3 flex items-center">
                            <Clock className="h-4 w-4 mr-2 text-gray-600" />
                            <CountdownTimer targetTime={session.valid_until} />
                          </div>
                        )}
                      </div>
                      <span className={`px-3 py-1 rounded-full text-sm shrink-0 ${
                        session.status === 'active'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-yellow-100 text-yellow-800'
                      }`}>
                        {session.status}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </main>
    </div>
  );
};

export default SessionSelection;