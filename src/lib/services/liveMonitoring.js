/**
 * Live Monitoring Service
 *
 * Fetches real-time progress for active/scheduled cycle count sessions.
 * Progress is derived at query time by joining session_items LEFT JOIN counts
 * — no schema migration is required.
 *
 * The existing WebSocket realtime infrastructure (LISTEN/NOTIFY bridge in
 * server/src/realtime.js) already broadcasts `counts_changes`,
 * `sessions_changes`, and `session_items_changes` events. This module exposes
 * helpers to subscribe to those channels so the UI can refresh instantly when
 * counters submit counts.
 */

import { supabase } from '../db/compat.js';

/**
 * Fetch all sessions that are "live" (active or scheduled) with derived progress.
 *
 * For each session we compute:
 *   - totalItems      : number of items assigned to the session
 *   - countedItems    : number of distinct items that have at least one count
 *   - totalQty        : sum of all counted_qty across the session
 *   - countEntries    : total number of count rows
 *   - progressPct     : countedItems / totalItems * 100 (0 if no items)
 *
 * @returns {Promise<{ data: Array|null, error: Object|null }>}
 */
export async function fetchLiveSessions() {
  try {
    // 1. Fetch active + scheduled sessions
    const { data: sessions, error: sessionError } = await supabase
      .from('sessions')
      .select(`*, session_users (user_id)`)
      .in('status', ['active', 'scheduled'])
      .order('created_date', { ascending: false });

    if (sessionError) throw sessionError;
    if (!sessions || sessions.length === 0) return { data: [], error: null };

    const sessionIds = sessions.map((s) => s.id);

    // 2. Fetch session_items counts per session (total items assigned)
    const { data: sessionItems, error: siError } = await supabase
      .from('session_items')
      .select('session_id, item_id')
      .in('session_id', sessionIds);

    if (siError) throw siError;

    // 3. Fetch all counts for these sessions (for derived progress)
    const { data: counts, error: countsError } = await supabase
      .from('counts')
      .select('session_id, item_id, counted_qty, user_id, timestamp')
      .in('session_id', sessionIds)
      .order('timestamp', { ascending: false });

    if (countsError) throw countsError;

    // 4. Fetch assigned user profiles
    const userIds = [...new Set(sessions.flatMap((s) => s.session_users?.map((su) => su.user_id) || []))];
    let profileMap = {};
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, name, username')
        .in('id', userIds);
      profiles?.forEach((p) => { profileMap[p.id] = p; });
    }

    // 5. Build per-session aggregates
    const itemsBySession = {};
    sessionItems?.forEach((si) => {
      if (!itemsBySession[si.session_id]) itemsBySession[si.session_id] = new Set();
      itemsBySession[si.session_id].add(si.item_id);
    });

    const countsBySession = {};
    const countedItemsBySession = {};
    const qtyBySession = {};
    const lastActivityBySession = {};
    const activeCountersBySession = {};

    counts?.forEach((c) => {
      const sid = c.session_id;
      countsBySession[sid] = (countsBySession[sid] || 0) + 1;
      qtyBySession[sid] = (qtyBySession[sid] || 0) + (c.counted_qty || 0);

      if (!countedItemsBySession[sid]) countedItemsBySession[sid] = new Set();
      countedItemsBySession[sid].add(c.item_id);

      if (!lastActivityBySession[sid] || new Date(c.timestamp) > new Date(lastActivityBySession[sid])) {
        lastActivityBySession[sid] = c.timestamp;
      }

      if (!activeCountersBySession[sid]) activeCountersBySession[sid] = new Set();
      activeCountersBySession[sid].add(c.user_id);
    });

    // 6. Merge into session objects
    const enriched = sessions.map((session) => {
      const totalItems = itemsBySession[session.id]?.size || 0;
      const countedItems = countedItemsBySession[session.id]?.size || 0;
      const totalQty = qtyBySession[session.id] || 0;
      const countEntries = countsBySession[session.id] || 0;
      const progressPct = totalItems > 0 ? Math.round((countedItems / totalItems) * 100) : 0;

      // Attach profiles to session_users
      session.session_users?.forEach((su) => {
        su.profiles = profileMap[su.user_id];
      });

      return {
        ...session,
        assignedCounters: session.session_users?.map((su) => profileMap[su.user_id]).filter(Boolean) || [],
        activeCounterIds: [...(activeCountersBySession[session.id] || [])],
        totalItems,
        countedItems,
        totalQty,
        countEntries,
        progressPct,
        lastActivity: lastActivityBySession[session.id] || null,
        isTimeWindowOpen: isSessionTimeWindowOpen(session),
        timeRemainingMs: computeTimeRemaining(session),
      };
    });

    return { data: enriched, error: null };
  } catch (err) {
    console.error('Error fetching live sessions:', err);
    return { data: null, error: { message: err.message || 'Failed to fetch live sessions' } };
  }
}

/**
 * Fetch recent count activity (the latest N counts across all live sessions).
 * Used for the activity feed in the monitoring dashboard.
 *
 * @param {string[]} sessionIds - Session IDs to fetch activity for
 * @param {number} limit - Max number of recent counts to return
 * @returns {Promise<{ data: Array|null, error: Object|null }>}
 */
export async function fetchRecentActivity(sessionIds, limit = 20) {
  if (!sessionIds || sessionIds.length === 0) return { data: [], error: null };
  try {
    const { data: counts, error } = await supabase
      .from('counts')
      .select(`
        id, session_id, item_id, user_id, location_id, counted_qty, timestamp,
        items (sku, item_name),
        locations (name)
      `)
      .in('session_id', sessionIds)
      .order('timestamp', { ascending: false })
      .range(0, limit - 1);

    if (error) throw error;

    // Resolve user names
    const userIds = [...new Set((counts || []).map((c) => c.user_id))];
    let profileMap = {};
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, name, username')
        .in('id', userIds);
      profiles?.forEach((p) => { profileMap[p.id] = p; });
    }

    const enriched = (counts || []).map((c) => ({
      id: c.id,
      sessionId: c.session_id,
      itemId: c.item_id,
      sku: c.items?.sku || '',
      itemName: c.items?.item_name || '',
      locationName: c.locations?.name || '',
      countedQty: c.counted_qty,
      userId: c.user_id,
      userName: profileMap[c.user_id]?.name || profileMap[c.user_id]?.username || 'Unknown',
      timestamp: c.timestamp,
    }));

    return { data: enriched, error: null };
  } catch (err) {
    console.error('Error fetching recent activity:', err);
    return { data: null, error: { message: err.message } };
  }
}

/**
 * Fetch full drill-down details for a single session — used by the "Full View"
 * modal in the live monitoring dashboard.
 *
 * Returns:
 *   - session      : the session row with all columns
 *   - items        : array of { item_id, sku, name, category, ... } for each
 *                    assigned item, enriched with count stats:
 *                      - countedQty  : sum of counted_qty for this item
 *                      - countEntries: number of count rows
 *                      - lastCountedAt: timestamp of most recent count
 *                      - countedBy   : array of { userId, name, qty } contributors
 *                      - isCounted   : boolean (at least one count exists)
 *   - counters     : array of { id, name, username, itemsCounted, totalQty,
 *                    lastActivity } — one entry per assigned counter
 *   - allCounts    : full chronological list of count rows with item/profile
 *                    names resolved, newest first
 *   - progress     : { totalItems, countedItems, totalQty, countEntries, progressPct }
 *
 * @param {string} sessionId
 * @returns {Promise<{ data: Object|null, error: Object|null }>}
 */
export async function fetchSessionDetails(sessionId) {
  try {
    // 1. Fetch the session with assigned users
    const { data: session, error: sessError } = await supabase
      .from('sessions')
      .select(`*, session_users (user_id)`)
      .eq('id', sessionId)
      .single();

    if (sessError) throw sessError;
    if (!session) return { data: null, error: { message: 'Session not found' } };

    // 2. Fetch session_items joined with items for names/SKU
    const { data: sessionItems, error: siError } = await supabase
      .from('session_items')
      .select('item_id, items (id, sku, name, category, unit)')
      .eq('session_id', sessionId);

    if (siError) throw siError;

    // 3. Fetch ALL counts for this session
    const { data: counts, error: countsError } = await supabase
      .from('counts')
      .select('id, item_id, location_id, counted_qty, user_id, timestamp, notes')
      .eq('session_id', sessionId)
      .order('timestamp', { ascending: false });

    if (countsError) throw countsError;

    // 4. Fetch assigned user profiles
    const userIds = [
      ...new Set([
        ...(session.session_users?.map((su) => su.user_id) || []),
        ...(counts?.map((c) => c.user_id).filter(Boolean) || []),
      ]),
    ];
    let profileMap = {};
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, name, username')
        .in('id', userIds);
      profiles?.forEach((p) => { profileMap[p.id] = p; });
    }

    // 5. Fetch location names for count rows
    const locationIds = [...new Set(counts?.map((c) => c.location_id).filter(Boolean) || [])];
    let locationMap = {};
    if (locationIds.length > 0) {
      const { data: locations } = await supabase
        .from('locations')
        .select('id, name')
        .in('id', locationIds);
      locations?.forEach((l) => { locationMap[l.id] = l; });
    }

    // 6. Build per-item stats
    const countsByItem = {};
    for (const c of counts || []) {
      if (!countsByItem[c.item_id]) {
        countsByItem[c.item_id] = { entries: [], totalQty: 0, countedBy: {} };
      }
      countsByItem[c.item_id].entries.push(c);
      countsByItem[c.item_id].totalQty += Number(c.counted_qty) || 0;
      if (c.user_id) {
        if (!countsByItem[c.item_id].countedBy[c.user_id]) {
          countsByItem[c.item_id].countedBy[c.user_id] = { userId: c.user_id, name: profileMap[c.user_id]?.name || 'Unknown', qty: 0 };
        }
        countsByItem[c.item_id].countedBy[c.user_id].qty += Number(c.counted_qty) || 0;
      }
    }

    const items = (sessionItems || []).map((si) => {
      const itemData = si.items || {};
      const stats = countsByItem[si.item_id] || { entries: [], totalQty: 0, countedBy: {} };
      const lastCount = stats.entries[0]; // already sorted desc
      return {
        item_id: si.item_id,
        sku: itemData.sku || '—',
        name: itemData.name || 'Unknown item',
        category: itemData.category || '—',
        unit: itemData.unit || '',
        countedQty: stats.totalQty,
        countEntries: stats.entries.length,
        lastCountedAt: lastCount?.timestamp || null,
        countedBy: Object.values(stats.countedBy).sort((a, b) => b.qty - a.qty),
        isCounted: stats.entries.length > 0,
      };
    });

    // 7. Build per-counter stats
    const counterStats = {};
    for (const c of counts || []) {
      if (!c.user_id) continue;
      if (!counterStats[c.user_id]) {
        counterStats[c.user_id] = {
          id: c.user_id,
          name: profileMap[c.user_id]?.name || 'Unknown',
          username: profileMap[c.user_id]?.username || '',
          itemsCounted: new Set(),
          totalQty: 0,
          lastActivity: null,
        };
      }
      counterStats[c.user_id].itemsCounted.add(c.item_id);
      counterStats[c.user_id].totalQty += Number(c.counted_qty) || 0;
      if (!counterStats[c.user_id].lastActivity || new Date(c.timestamp) > new Date(counterStats[c.user_id].lastActivity)) {
        counterStats[c.user_id].lastActivity = c.timestamp;
      }
    }
    // Also include assigned counters who haven't counted anything yet
    for (const su of session.session_users || []) {
      if (!counterStats[su.user_id]) {
        counterStats[su.user_id] = {
          id: su.user_id,
          name: profileMap[su.user_id]?.name || 'Unknown',
          username: profileMap[su.user_id]?.username || '',
          itemsCounted: new Set(),
          totalQty: 0,
          lastActivity: null,
        };
      }
    }
    const counters = Object.values(counterStats).map((cs) => ({
      ...cs,
      itemsCounted: cs.itemsCounted.size,
    })).sort((a, b) => b.totalQty - a.totalQty);

    // 8. Build all-counts list with resolved names
    const allCounts = (counts || []).map((c) => ({
      ...c,
      itemName: items.find((i) => i.item_id === c.item_id)?.name || 'Unknown',
      itemSku: items.find((i) => i.item_id === c.item_id)?.sku || '—',
      counterName: profileMap[c.user_id]?.name || 'Unknown',
      locationName: locationMap[c.location_id]?.name || '—',
    }));

    // 9. Compute aggregate progress
    const totalItems = items.length;
    const countedItems = items.filter((i) => i.isCounted).length;
    const totalQty = (counts || []).reduce((sum, c) => sum + (Number(c.counted_qty) || 0), 0);

    return {
      data: {
        session,
        items,
        counters,
        allCounts,
        progress: {
          totalItems,
          countedItems,
          totalQty,
          countEntries: counts?.length || 0,
          progressPct: totalItems > 0 ? Math.round((countedItems / totalItems) * 100) : 0,
        },
      },
      error: null,
    };
  } catch (err) {
    console.error('Error fetching session details:', err);
    return { data: null, error: { message: err.message } };
  }
}

/**
 * Subscribe to realtime changes for live monitoring.
 *
 * Subscribes to three postgres_changes channels:
 *   - counts         (a counter submitted/updated/deleted a count)
 *   - sessions       (session status changed, e.g. auto-closed)
 *   - session_items  (admin assigned/removed items)
 *
 * @param {function} onChange - Callback invoked when any relevant change occurs.
 *                              Receives ({ table, eventType, record }).
 * @returns {function} unsubscribe - Call to tear down all subscriptions.
 */
export function subscribeToLiveChanges(onChange) {
  const channels = [];
  const tables = ['counts', 'sessions', 'session_items'];

  for (const table of tables) {
    const ch = supabase
      .channel(`live_monitor:${table}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        (payload) => {
          onChange({
            table,
            eventType: payload.eventType,
            record: payload.new || payload.old,
          });
        }
      )
      .subscribe();

    channels.push(ch);
  }

  return () => {
    channels.forEach((ch) => {
      try { supabase.removeChannel(ch); } catch {}
    });
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check whether the session's time window is currently open (i.e. counters
 * are allowed to submit counts right now).
 */
export function isSessionTimeWindowOpen(session) {
  if (session.status !== 'active') return false;
  const now = Date.now();
  const fromOk = !session.valid_from || new Date(session.valid_from).getTime() <= now;
  const untilOk = !session.valid_until || new Date(session.valid_until).getTime() >= now;
  return fromOk && untilOk;
}

/**
 * Compute milliseconds remaining until the session's valid_until.
 * Returns null if no valid_until is set.
 */
export function computeTimeRemaining(session) {
  if (!session.valid_until) return null;
  const remaining = new Date(session.valid_until).getTime() - Date.now();
  return remaining > 0 ? remaining : 0;
}

/**
 * Format milliseconds as "HH:MM:SS" for countdown display.
 */
export function formatTimeRemaining(ms) {
  if (ms == null) return '--:--:--';
  if (ms <= 0) return '00:00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

/**
 * Format a relative time string like "2m ago", "just now", "1h ago".
 */
export function formatRelativeTime(timestamp) {
  if (!timestamp) return '—';
  const diffMs = Date.now() - new Date(timestamp).getTime();
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
