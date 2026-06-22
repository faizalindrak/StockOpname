import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Activity,
  Users,
  Package,
  Clock,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  TrendingUp,
  Radio,
  Calendar,
  Hash,
  MapPin,
  Maximize2,
} from 'lucide-react';
import {
  fetchLiveSessions,
  fetchRecentActivity,
  subscribeToLiveChanges,
  isSessionTimeWindowOpen,
  computeTimeRemaining,
  formatTimeRemaining,
  formatRelativeTime,
} from '../../lib/services/liveMonitoring.js';
import LiveMonitoringFullView from './LiveMonitoringFullView.jsx';

/**
 * LiveMonitoring — Admin real-time monitoring dashboard for cycle count sessions.
 *
 * Shows all active/scheduled sessions with live progress (items counted vs total),
 * assigned counters, time-window status, and a recent activity feed. Subscribes
 * to counts/sessions/session_items changes via the existing WebSocket realtime
 * bridge so the view updates instantly when counters submit counts.
 */
const LiveMonitoring = () => {
  const [sessions, setSessions] = useState([]);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [connected, setConnected] = useState(false);
  const [expandedSession, setExpandedSession] = useState(null);
  const [fullViewSession, setFullViewSession] = useState(null);

  // Refs to avoid stale closures in realtime callback
  const refreshTimerRef = useRef(null);
  const isFetchingRef = useRef(false);
  const activityFeedRef = useRef(null);

  // ---- Data fetching -------------------------------------------------------

  const loadAll = useCallback(async ({ showLoading = false } = {}) => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    if (showLoading) setLoading(true);
    try {
      const { data: liveSessions, error: sessError } = await fetchLiveSessions();
      if (sessError) throw new Error(sessError.message);

      setSessions(liveSessions || []);

      // Fetch recent activity for all live sessions
      const sessionIds = (liveSessions || []).map((s) => s.id);
      if (sessionIds.length > 0) {
        const { data: activityData } = await fetchRecentActivity(sessionIds, 25);
        setActivity(activityData || []);
      } else {
        setActivity([]);
      }

      setError('');
      setLastUpdated(new Date());
    } catch (err) {
      console.error('LiveMonitoring load error:', err);
      setError(err.message || 'Failed to load live monitoring data');
    } finally {
      if (showLoading) setLoading(false);
      isFetchingRef.current = false;
    }
  }, []);

  // ---- Realtime subscription ----------------------------------------------

  useEffect(() => {
    loadAll({ showLoading: true });

    // Debounced refresh: when a realtime event fires, wait 1s then re-fetch.
    // This batches bursts of count submissions into a single query.
    const scheduleRefresh = () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => {
        loadAll();
      }, 1000);
    };

    const unsubscribe = subscribeToLiveChanges(() => {
      setConnected(true);
      scheduleRefresh();
    });

    // Mark as disconnected after 10s of silence (for UI indicator)
    const silenceTimer = setInterval(() => {
      setConnected(false);
    }, 10000);

    // Periodic refresh every 30s as a fallback (in case realtime misses events)
    const pollTimer = setInterval(() => {
      loadAll();
    }, 30000);

    // Countdown tick for time-remaining displays
    const tickTimer = setInterval(() => {
      setSessions((prev) =>
        prev.map((s) => ({
          ...s,
          timeRemainingMs: computeTimeRemaining(s),
          isTimeWindowOpen: isSessionTimeWindowOpen(s),
        }))
      );
    }, 1000);

    return () => {
      unsubscribe();
      clearInterval(silenceTimer);
      clearInterval(pollTimer);
      clearInterval(tickTimer);
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [loadAll]);

  // ---- Derived summary stats ----------------------------------------------

  const stats = {
    totalSessions: sessions.length,
    activeSessions: sessions.filter((s) => s.status === 'active').length,
    scheduledSessions: sessions.filter((s) => s.status === 'scheduled').length,
    totalItems: sessions.reduce((sum, s) => sum + s.totalItems, 0),
    countedItems: sessions.reduce((sum, s) => sum + s.countedItems, 0),
    totalQty: sessions.reduce((sum, s) => sum + s.totalQty, 0),
    totalEntries: sessions.reduce((sum, s) => sum + s.countEntries, 0),
    activeCounters: new Set(sessions.flatMap((s) => s.activeCounterIds)).size,
    assignedCounters: new Set(
      sessions.flatMap((s) => s.session_users?.map((su) => su.user_id) || [])
    ).size,
  };

  const overallProgress =
    stats.totalItems > 0 ? Math.round((stats.countedItems / stats.totalItems) * 100) : 0;

  // ---- Render helpers ------------------------------------------------------

  const getProgressColor = (pct) => {
    if (pct === 100) return 'bg-green-500';
    if (pct >= 75) return 'bg-blue-500';
    if (pct >= 50) return 'bg-yellow-500';
    if (pct >= 25) return 'bg-orange-500';
    return 'bg-red-500';
  };

  const getStatusBadge = (session) => {
    if (session.status === 'active') {
      return session.isTimeWindowOpen
        ? { text: 'LIVE', cls: 'bg-green-100 text-green-800' }
        : { text: 'ACTIVE (WINDOW CLOSED)', cls: 'bg-yellow-100 text-yellow-800' };
    }
    if (session.status === 'scheduled') {
      return { text: 'SCHEDULED', cls: 'bg-blue-100 text-blue-800' };
    }
    return { text: session.status?.toUpperCase(), cls: 'bg-gray-100 text-gray-800' };
  };

  // ---- Render --------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="spinner"></div>
        <span className="ml-2 text-gray-600">Loading live monitoring data...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Activity className="h-6 w-6 text-blue-600" />
            <h2 className="text-2xl font-bold text-gray-900">Live Monitoring</h2>
          </div>
          {/* Connection indicator */}
          <span
            className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
              connected
                ? 'bg-green-100 text-green-700'
                : 'bg-gray-100 text-gray-500'
            }`}
            title={connected ? 'Receiving live updates' : 'Waiting for updates...'}
          >
            <span
              className={`inline-block w-2 h-2 rounded-full ${
                connected ? 'bg-green-500 animate-pulse' : 'bg-gray-400'
              }`}
            />
            {connected ? 'Live' : 'Idle'}
          </span>
        </div>
        <div className="flex items-center gap-3 text-sm text-gray-500">
          {lastUpdated && (
            <span className="flex items-center gap-1">
              <Clock className="h-4 w-4" />
              Updated {formatRelativeTime(lastUpdated.toISOString())}
            </span>
          )}
          <button
            type="button"
            onClick={() => loadAll({ showLoading: false })}
            className="flex items-center gap-1 text-blue-600 hover:text-blue-800"
            title="Refresh now"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center p-3 bg-red-100 border border-red-400 text-red-700 rounded">
          <AlertCircle className="h-4 w-4 mr-2" />
          {error}
        </div>
      )}

      {/* Summary stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <StatCard
          icon={Activity}
          label="Active Sessions"
          value={stats.activeSessions}
          sub={`${stats.scheduledSessions} scheduled`}
          color="green"
        />
        <StatCard
          icon={Package}
          label="Items Counted"
          value={stats.countedItems}
          sub={`of ${stats.totalItems} total`}
          color="blue"
        />
        <StatCard
          icon={TrendingUp}
          label="Overall Progress"
          value={`${overallProgress}%`}
          sub={`${stats.totalEntries} count entries`}
          color="purple"
        />
        <StatCard
          icon={Hash}
          label="Total Quantity"
          value={stats.totalQty.toLocaleString('en-US')}
          sub="across all sessions"
          color="indigo"
        />
        <StatCard
          icon={Users}
          label="Active Counters"
          value={stats.activeCounters}
          sub={`${stats.assignedCounters} assigned`}
          color="orange"
        />
        <StatCard
          icon={Radio}
          label="Live Entries"
          value={stats.totalEntries}
          sub="total count rows"
          color="teal"
        />
      </div>

      {/* Overall progress bar */}
      {stats.totalItems > 0 && (
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">
              Overall Counting Progress
            </span>
            <span className="text-sm font-bold text-gray-900">
              {stats.countedItems} / {stats.totalItems} items ({overallProgress}%)
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${getProgressColor(overallProgress)}`}
              style={{ width: `${overallProgress}%` }}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Session cards */}
        <div className="lg:col-span-2 space-y-4">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Activity className="h-5 w-5 text-blue-600" />
            Sessions ({sessions.length})
          </h3>

          {sessions.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
              <Package className="h-12 w-12 mx-auto mb-3 text-gray-300" />
              <p className="font-medium">No active or scheduled sessions</p>
              <p className="text-sm mt-1">
                Create and activate a session to see live monitoring here.
              </p>
            </div>
          ) : (
            sessions.map((session) => {
              const badge = getStatusBadge(session);
              const isExpanded = expandedSession === session.id;
              const pct = session.progressPct || 0;
              const remaining = session.timeRemainingMs;

              return (
                <div
                  key={session.id}
                  className="bg-white rounded-lg shadow overflow-hidden hover:shadow-md transition-shadow"
                >
                  <button
                    type="button"
                    className="p-4 cursor-pointer w-full text-left block"
                    onClick={() =>
                      setExpandedSession(isExpanded ? null : session.id)
                    }
                  >
                    {/* Session header */}
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="text-base font-semibold text-gray-900 truncate">
                            {session.name}
                          </h4>
                          <span
                            className={`px-2 py-0.5 text-xs font-semibold rounded-full ${badge.cls}`}
                          >
                            {badge.text}
                          </span>
                          {session.is_scheduled && (
                            <span className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs font-medium rounded-full flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {session.scheduled_date
                                ? new Date(session.scheduled_date).toLocaleDateString()
                                : 'Scheduled'}
                            </span>
                          )}
                          {session.parent_session_id && (
                            <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs font-medium rounded-full">
                              AUTO
                            </span>
                          )}
                        </div>
                        {/* Assigned counters */}
                        <div className="mt-1.5 flex items-center gap-1.5 text-sm text-gray-500">
                          <Users className="h-4 w-4" />
                          <span>{session.assignedCounters?.length || 0} assigned</span>
                          {session.activeCounterIds?.length > 0 && (
                            <span className="flex items-center gap-1 text-green-600 font-medium">
                              <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                              {session.activeCounterIds.length} counting
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Time remaining */}
                      {remaining != null && remaining > 0 && (
                        <div
                          className={`text-right flex-shrink-0 ${
                            remaining < 10 * 60 * 1000
                              ? 'text-red-600'
                              : remaining < 30 * 60 * 1000
                              ? 'text-orange-600'
                              : 'text-gray-700'
                          }`}
                        >
                          <div className="text-xs font-medium uppercase tracking-wide">
                            Time Left
                          </div>
                          <div className="text-lg font-bold font-mono tabular-nums">
                            {formatTimeRemaining(remaining)}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Progress bar */}
                    <div className="mb-2">
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="text-gray-600">
                          {session.countedItems} / {session.totalItems} items counted
                        </span>
                        <span className="font-semibold text-gray-900">{pct}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${getProgressColor(pct)}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>

                    {/* Quick stats row */}
                    <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
                      <span className="flex items-center gap-1">
                        <Hash className="h-3.5 w-3.5" />
                        {session.countEntries} entries
                      </span>
                      <span className="flex items-center gap-1">
                        <Package className="h-3.5 w-3.5" />
                        Qty: {session.totalQty.toLocaleString('en-US')}
                      </span>
                      {session.lastActivity && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          Last activity {formatRelativeTime(session.lastActivity)}
                        </span>
                      )}
                      {pct === 100 && (
                        <span className="flex items-center gap-1 text-green-600 font-medium">
                          <CheckCircle className="h-3.5 w-3.5" />
                          Complete
                        </span>
                      )}
                    </div>
                  </button>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div className="border-t border-gray-100 bg-gray-50 p-4 space-y-3">
                      {/* Assigned counter chips */}
                      <div>
                        <div className="text-xs font-semibold text-gray-500 uppercase mb-2">
                          Assigned Counters
                        </div>
                        {session.assignedCounters?.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {session.assignedCounters.map((counter) => {
                              const isActive = session.activeCounterIds?.includes(
                                counter.id
                              );
                              return (
                                <span
                                  key={counter.id}
                                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                                    isActive
                                      ? 'bg-green-100 text-green-800'
                                      : 'bg-gray-100 text-gray-700'
                                  }`}
                                >
                                  <span
                                    className={`inline-block w-1.5 h-1.5 rounded-full ${
                                      isActive ? 'bg-green-500 animate-pulse' : 'bg-gray-400'
                                    }`}
                                  />
                                  {counter.name || counter.username}
                                </span>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-sm text-gray-400">
                            No counters assigned to this session.
                          </p>
                        )}
                      </div>

                      {/* Time window */}
                      {(session.valid_from || session.valid_until) && (
                        <div>
                          <div className="text-xs font-semibold text-gray-500 uppercase mb-1">
                            Time Window
                          </div>
                          <div className="text-sm text-gray-700">
                            {session.valid_from &&
                              new Date(session.valid_from).toLocaleString('en-US', {
                                hour: '2-digit',
                                minute: '2-digit',
                                month: 'short',
                                day: 'numeric',
                              })}
                            {' — '}
                            {session.valid_until &&
                              new Date(session.valid_until).toLocaleString('en-US', {
                                hour: '2-digit',
                                minute: '2-digit',
                                month: 'short',
                                day: 'numeric',
                              })}
                          </div>
                        </div>
                      )}

                      {/* Full View button */}
                      <div className="pt-1">
                        <button
                          type="button"
                          onClick={() => setFullViewSession(session)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
                        >
                          <Maximize2 className="h-4 w-4" />
                          Full View
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Recent activity feed */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-lg shadow sticky top-4">
            <div className="p-4 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Radio className="h-5 w-5 text-green-500" />
                Live Activity
              </h3>
            </div>
            <div
              ref={activityFeedRef}
              className="max-h-[600px] overflow-y-auto divide-y divide-gray-50"
            >
              {activity.length === 0 ? (
                <div className="p-6 text-center text-gray-400">
                  <Activity className="h-8 w-8 mx-auto mb-2 text-gray-300" />
                  <p className="text-sm">No recent activity.</p>
                  <p className="text-xs mt-1">
                    Count submissions will appear here in real time.
                  </p>
                </div>
              ) : (
                activity.map((entry) => (
                  <div key={entry.id} className="p-3 hover:bg-gray-50">
                    <div className="flex items-start gap-2">
                      <div className="flex-shrink-0 mt-0.5">
                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                          <Package className="h-4 w-4 text-blue-600" />
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm">
                          <span className="font-medium text-gray-900">
                            {entry.userName}
                          </span>
                          <span className="text-gray-500"> counted </span>
                          <span className="font-medium text-gray-900">
                            {entry.countedQty.toLocaleString('en-US')}
                          </span>
                        </div>
                        <div className="text-xs text-gray-500 truncate">
                          {entry.itemName || entry.sku}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-gray-400 mt-0.5">
                          {entry.locationName && (
                            <span className="flex items-center gap-0.5">
                              <MapPin className="h-3 w-3" />
                              {entry.locationName}
                            </span>
                          )}
                          <span>{formatRelativeTime(entry.timestamp)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Full View modal */}
      {fullViewSession && (
        <LiveMonitoringFullView
          session={fullViewSession}
          onClose={() => setFullViewSession(null)}
        />
      )}
    </div>
  );
};

// ---- Sub-components --------------------------------------------------------

const colorMap = {
  green: { bg: 'bg-green-50', icon: 'text-green-600', text: 'text-green-900' },
  blue: { bg: 'bg-blue-50', icon: 'text-blue-600', text: 'text-blue-900' },
  purple: { bg: 'bg-purple-50', icon: 'text-purple-600', text: 'text-purple-900' },
  indigo: { bg: 'bg-indigo-50', icon: 'text-indigo-600', text: 'text-indigo-900' },
  orange: { bg: 'bg-orange-50', icon: 'text-orange-600', text: 'text-orange-900' },
  teal: { bg: 'bg-teal-50', icon: 'text-teal-600', text: 'text-teal-900' },
};

function StatCard({ icon: Icon, label, value, sub, color = 'blue' }) {
  const c = colorMap[color] || colorMap.blue;
  return (
    <div className={`rounded-lg shadow p-3 ${c.bg}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-gray-600 uppercase tracking-wide">
          {label}
        </span>
        <Icon className={`h-4 w-4 ${c.icon}`} />
      </div>
      <div className={`text-xl font-bold ${c.text}`}>{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

export default React.memo(LiveMonitoring);
