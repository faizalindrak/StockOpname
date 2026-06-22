import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  X,
  Users,
  Package,
  Clock,
  AlertCircle,
  TrendingUp,
  Calendar,
  Hash,
  Download,
  Search,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import {
  fetchSessionDetails,
  isSessionTimeWindowOpen,
  computeTimeRemaining,
  formatTimeRemaining,
  formatRelativeTime,
} from '../../lib/services/liveMonitoring.js';
import * as XLSX from 'xlsx';

/**
 * LiveMonitoringFullView — Full-screen modal showing detailed drill-down for a
 * single live cycle count session.
 *
 * Tabs:
 *   - Overview  : summary stats + progress + per-counter breakdown
 *   - Items     : per-item table with count status, qty, who counted, when
 *   - Activity  : full chronological list of every count entry
 *
 * Data is fetched on mount and auto-refreshed every 30s. Also subscribes to
 * realtime changes (counts/sessions/session_items) so the view stays live.
 */
const LiveMonitoringFullView = ({ session, onClose }) => {
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('overview');
  const [itemFilter, setItemFilter] = useState('all'); // all | counted | uncounted
  const [itemSearch, setItemSearch] = useState('');
  const [activitySearch, setActivitySearch] = useState('');
  const [sortField, setSortField] = useState('name');
  const [sortDir, setSortDir] = useState('asc');
  const [now, setNow] = useState(Date.now());

  const isFetchingRef = useRef(false);
  const refreshTimerRef = useRef(null);
  const unsubscribeRef = useRef(null);

  // ---- Data fetching -------------------------------------------------------

  const loadDetails = useCallback(
    async ({ showLoading = false } = {}) => {
      if (isFetchingRef.current) return;
      isFetchingRef.current = true;
      if (showLoading) setLoading(true);
      try {
        const { data, error: err } = await fetchSessionDetails(session.id);
        if (err) throw new Error(err.message);
        setDetails(data);
        setError('');
      } catch (err) {
        console.error('FullView load error:', err);
        setError(err.message || 'Failed to load session details');
      } finally {
        isFetchingRef.current = false;
        setLoading(false);
      }
    },
    [session.id]
  );

  // Initial load + auto-refresh + realtime
  useEffect(() => {
    loadDetails({ showLoading: true });

    // Auto-refresh every 30s
    refreshTimerRef.current = setInterval(() => {
      loadDetails({ showLoading: false });
    }, 30000);

    // Tick for countdown timer
    const tickInterval = setInterval(() => setNow(Date.now()), 1000);

    // Realtime subscription
    let mounted = true;
    import('../../lib/services/liveMonitoring.js').then(({ subscribeToLiveChanges }) => {
      if (!mounted) return;
      unsubscribeRef.current = subscribeToLiveChanges(() => {
        loadDetails({ showLoading: false });
      });
    });

    return () => {
      mounted = false;
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
      clearInterval(tickInterval);
      if (unsubscribeRef.current) unsubscribeRef.current();
    };
  }, [loadDetails]);

  // ---- Close on Escape -----------------------------------------------------

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  // ---- Derived data --------------------------------------------------------

  const sess = details?.session || session;
  const progress = details?.progress || {
    totalItems: 0,
    countedItems: 0,
    totalQty: 0,
    countEntries: 0,
    progressPct: 0,
  };

  const timeOpen = sess ? isSessionTimeWindowOpen(sess) : false;
  // `now` is referenced here so the countdown re-renders every second.
  const timeRemaining = sess ? computeTimeRemaining(sess, now) : null;

  const filteredItems = React.useMemo(() => {
    if (!details?.items) return [];
    let result = details.items;

    if (itemFilter === 'counted') {
      result = result.filter((i) => i.isCounted);
    } else if (itemFilter === 'uncounted') {
      result = result.filter((i) => !i.isCounted);
    }

    if (itemSearch.trim()) {
      const q = itemSearch.toLowerCase();
      result = result.filter(
        (i) =>
          i.name?.toLowerCase().includes(q) ||
          i.sku?.toLowerCase().includes(q) ||
          i.category?.toLowerCase().includes(q)
      );
    }

    // Sort
    result = [...result].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'name') cmp = (a.name || '').localeCompare(b.name || '');
      else if (sortField === 'sku') cmp = (a.sku || '').localeCompare(b.sku || '');
      else if (sortField === 'countedQty') cmp = a.countedQty - b.countedQty;
      else if (sortField === 'countEntries') cmp = a.countEntries - b.countEntries;
      else if (sortField === 'lastCountedAt') {
        cmp = (a.lastCountedAt ? new Date(a.lastCountedAt).getTime() : 0) -
              (b.lastCountedAt ? new Date(b.lastCountedAt).getTime() : 0);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [details, itemFilter, itemSearch, sortField, sortDir]);

  const filteredCounts = React.useMemo(() => {
    if (!details?.allCounts) return [];
    if (!activitySearch.trim()) return details.allCounts;
    const q = activitySearch.toLowerCase();
    return details.allCounts.filter(
      (c) =>
        c.itemName?.toLowerCase().includes(q) ||
        c.itemSku?.toLowerCase().includes(q) ||
        c.counterName?.toLowerCase().includes(q) ||
        c.locationName?.toLowerCase().includes(q) ||
        c.notes?.toLowerCase().includes(q)
    );
  }, [details, activitySearch]);

  // ---- Export --------------------------------------------------------------

  const handleExport = () => {
    if (!details) return;

    // Items sheet
    const itemsData = details.items.map((i) => ({
      SKU: i.sku,
      Name: i.name,
      Category: i.category,
      'Counted Qty': i.countedQty,
      'Count Entries': i.countEntries,
      'Is Counted': i.isCounted ? 'Yes' : 'No',
      'Last Counted At': i.lastCountedAt
        ? new Date(i.lastCountedAt).toLocaleString()
        : '—',
      'Counted By': i.countedBy.map((c) => `${c.name} (${c.qty})`).join(', ') || '—',
    }));

    // Counts sheet
    const countsData = details.allCounts.map((c) => ({
      Timestamp: c.timestamp ? new Date(c.timestamp).toLocaleString() : '—',
      SKU: c.itemSku,
      Item: c.itemName,
      'Counter': c.counterName,
      'Location': c.locationName,
      'Qty': c.counted_qty,
      'Notes': c.notes || '',
    }));

    // Counters sheet
    const countersData = details.counters.map((c) => ({
      Name: c.name,
      Username: c.username,
      'Items Counted': c.itemsCounted,
      'Total Qty': c.totalQty,
      'Last Activity': c.lastActivity
        ? new Date(c.lastActivity).toLocaleString()
        : '—',
    }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(itemsData), 'Items');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(countsData), 'Counts');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(countersData), 'Counters');
    XLSX.writeFile(wb, `session_${sess.name || session.id}_details.xlsx`);
  };

  // ---- Helpers -------------------------------------------------------------

  const toggleSort = (field) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const SortHeader = ({ field, children, className = '' }) => (
    <th
      className={`px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide cursor-pointer select-none hover:text-gray-900 ${className}`}
      onClick={() => toggleSort(field)}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {sortField === field &&
          (sortDir === 'asc' ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          ))}
      </span>
    </th>
  );

  const pct = progress.progressPct;
  const progressBarColor =
    pct === 100
      ? 'bg-green-500'
      : pct >= 50
        ? 'bg-blue-500'
        : pct > 0
          ? 'bg-amber-500'
          : 'bg-gray-300';

  // ---- Render --------------------------------------------------------------

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 flex items-start justify-center p-2 sm:p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-6xl my-4 flex flex-col max-h-[95vh]">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 p-4 border-b border-gray-200 shrink-0">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl font-bold text-gray-900 truncate">
                {sess.name || 'Session'}
              </h2>
              <span
                className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
                  sess.status === 'active'
                    ? 'bg-green-100 text-green-700'
                    : 'bg-blue-100 text-blue-700'
                }`}
              >
                {sess.status}
              </span>
              {timeOpen ? (
                <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-green-50 text-green-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                  Live
                </span>
              ) : (
                <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-600">
                  <Clock className="h-3 w-3" />
                  Closed
                </span>
              )}
            </div>
            <div className="mt-1 text-sm text-gray-500 flex items-center gap-3 flex-wrap">
              {sess.valid_from && (
                <span className="flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" />
                  {new Date(sess.valid_from).toLocaleString()}
                </span>
              )}
              {sess.valid_until && (
                <>
                  <span className="text-gray-400">→</span>
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5" />
                    {new Date(sess.valid_until).toLocaleString()}
                  </span>
                </>
              )}
              {timeRemaining !== null && timeRemaining > 0 && (
                <span className="flex items-center gap-1 font-mono text-blue-600">
                  <Clock className="h-3.5 w-3.5" />
                  {formatTimeRemaining(timeRemaining)} left
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleExport}
              disabled={!details}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">Export</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              title="Close (Esc)"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 shrink-0">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-sm font-semibold text-gray-700">
              Overall Progress
            </span>
            <span className="text-sm font-bold text-gray-900">
              {progress.countedItems} / {progress.totalItems} items ({pct}%)
            </span>
          </div>
          <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`h-full ${progressBarColor} transition-all duration-500 rounded-full`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-2 flex items-center gap-4 text-xs text-gray-500 flex-wrap">
            <span className="flex items-center gap-1">
              <Hash className="h-3.5 w-3.5" />
              {progress.countEntries} count entries
            </span>
            <span className="flex items-center gap-1">
              <Package className="h-3.5 w-3.5" />
              {progress.totalQty.toLocaleString('en-US')} total qty
            </span>
            <span className="flex items-center gap-1">
              <Users className="h-3.5 w-3.5" />
              {details?.counters?.length || 0} counters
            </span>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 px-4 shrink-0">
          {[
            { id: 'overview', label: 'Overview' },
            { id: 'items', label: `Items (${progress.totalItems})` },
            { id: 'activity', label: `Activity (${progress.countEntries})` },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="spinner" />
              <span className="ml-2 text-gray-600">Loading session details…</span>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-16">
              <AlertCircle className="h-5 w-5 text-red-500 mr-2" />
              <span className="text-red-600">{error}</span>
            </div>
          ) : !details ? (
            <div className="flex items-center justify-center py-16 text-gray-500">
              No data available.
            </div>
          ) : (
            <>
              {/* ---- Overview Tab ---- */}
              {activeTab === 'overview' && (
                <div className="space-y-6">
                  {/* Stat cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <StatCard
                      icon={Package}
                      label="Items Counted"
                      value={`${progress.countedItems}/${progress.totalItems}`}
                      sub={`${pct}% complete`}
                      color="blue"
                    />
                    <StatCard
                      icon={Hash}
                      label="Count Entries"
                      value={progress.countEntries}
                      sub="total submissions"
                      color="teal"
                    />
                    <StatCard
                      icon={TrendingUp}
                      label="Total Quantity"
                      value={progress.totalQty.toLocaleString('en-US')}
                      sub="sum of all counts"
                      color="purple"
                    />
                    <StatCard
                      icon={Users}
                      label="Active Counters"
                      value={
                        details.counters.filter((c) => c.itemsCounted > 0).length
                      }
                      sub={`${details.counters.length} assigned`}
                      color="green"
                    />
                  </div>

                  {/* Per-counter breakdown */}
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
                      Counter Breakdown
                    </h3>
                    {details.counters.length === 0 ? (
                      <p className="text-sm text-gray-500 italic">
                        No counters assigned to this session.
                      </p>
                    ) : (
                      <div className="overflow-x-auto rounded-lg border border-gray-200">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">
                                Counter
                              </th>
                              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">
                                Items Counted
                              </th>
                              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">
                                Total Qty
                              </th>
                              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">
                                Contribution
                              </th>
                              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">
                                Last Activity
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {details.counters.map((c) => {
                              const contribution =
                                progress.totalQty > 0
                                  ? Math.round((c.totalQty / progress.totalQty) * 100)
                                  : 0;
                              return (
                                <tr key={c.id} className="hover:bg-gray-50">
                                  <td className="px-3 py-2 text-sm">
                                    <div className="font-medium text-gray-900">
                                      {c.name}
                                    </div>
                                    {c.username && (
                                      <div className="text-xs text-gray-500">
                                        @{c.username}
                                      </div>
                                    )}
                                  </td>
                                  <td className="px-3 py-2 text-sm text-gray-700">
                                    {c.itemsCounted}
                                  </td>
                                  <td className="px-3 py-2 text-sm text-gray-700">
                                    {c.totalQty.toLocaleString('en-US')}
                                  </td>
                                  <td className="px-3 py-2">
                                    <div className="flex items-center gap-2">
                                      <div className="h-2 w-20 bg-gray-200 rounded-full overflow-hidden">
                                        <div
                                          className="h-full bg-blue-500 rounded-full"
                                          style={{ width: `${contribution}%` }}
                                        />
                                      </div>
                                      <span className="text-xs text-gray-500">
                                        {contribution}%
                                      </span>
                                    </div>
                                  </td>
                                  <td className="px-3 py-2 text-sm text-gray-500">
                                    {c.lastActivity
                                      ? formatRelativeTime(c.lastActivity)
                                      : '—'}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ---- Items Tab ---- */}
              {activeTab === 'items' && (
                <div className="space-y-3">
                  {/* Filters */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                      {[
                        { id: 'all', label: 'All' },
                        { id: 'counted', label: 'Counted' },
                        { id: 'uncounted', label: 'Uncounted' },
                      ].map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => setItemFilter(f.id)}
                          className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                            itemFilter === f.id
                              ? 'bg-blue-500 text-white'
                              : 'bg-white text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                    <div className="relative flex-1 min-w-[200px]">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <input
                        type="text"
                        value={itemSearch}
                        onChange={(e) => setItemSearch(e.target.value)}
                        placeholder="Search by name, SKU, category…"
                        className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <span className="text-xs text-gray-500">
                      {filteredItems.length} of {details.items.length}
                    </span>
                  </div>

                  {/* Table */}
                  <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <SortHeader field="sku">SKU</SortHeader>
                          <SortHeader field="name">Item</SortHeader>
                          <SortHeader field="countedQty">Counted Qty</SortHeader>
                          <SortHeader field="countEntries">Entries</SortHeader>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
                            Counted By
                          </th>
                          <SortHeader field="lastCountedAt">Last Counted</SortHeader>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {filteredItems.length === 0 ? (
                          <tr>
                            <td
                              colSpan={6}
                              className="px-3 py-8 text-center text-sm text-gray-500"
                            >
                              No items match the current filter.
                            </td>
                          </tr>
                        ) : (
                          filteredItems.map((item) => (
                            <tr
                              key={item.item_id}
                              className={`hover:bg-gray-50 ${
                                !item.isCounted ? 'bg-amber-50/30' : ''
                              }`}
                            >
                              <td className="px-3 py-2 text-sm font-mono text-gray-600">
                                {item.sku}
                              </td>
                              <td className="px-3 py-2 text-sm">
                                <div className="font-medium text-gray-900">
                                  {item.name}
                                </div>
                                {item.category !== '—' && (
                                  <div className="text-xs text-gray-500">
                                    {item.category}
                                  </div>
                                )}
                              </td>
                              <td className="px-3 py-2 text-sm font-semibold text-gray-900">
                                {item.countedQty > 0
                                  ? item.countedQty.toLocaleString('en-US')
                                  : '—'}
                                {item.unit && item.countedQty > 0 && (
                                  <span className="text-xs text-gray-400 ml-1">
                                    {item.unit}
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-sm text-gray-700">
                                {item.countEntries}
                              </td>
                              <td className="px-3 py-2 text-sm">
                                {item.countedBy.length > 0 ? (
                                  <div className="flex flex-wrap gap-1">
                                    {item.countedBy.map((c) => (
                                      <span
                                        key={c.userId}
                                        className="px-1.5 py-0.5 text-xs bg-gray-100 text-gray-700 rounded"
                                        title={`Qty: ${c.qty}`}
                                      >
                                        {c.name} ({c.qty})
                                      </span>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="text-gray-400">—</span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-sm text-gray-500">
                                {item.lastCountedAt
                                  ? formatRelativeTime(item.lastCountedAt)
                                  : '—'}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ---- Activity Tab ---- */}
              {activeTab === 'activity' && (
                <div className="space-y-3">
                  {/* Search */}
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <input
                        type="text"
                        value={activitySearch}
                        onChange={(e) => setActivitySearch(e.target.value)}
                        placeholder="Search by item, counter, location, notes…"
                        className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <span className="text-xs text-gray-500">
                      {filteredCounts.length} of {details.allCounts.length}
                    </span>
                  </div>

                  {/* Table */}
                  <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">
                            Time
                          </th>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">
                            Counter
                          </th>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">
                            Item
                          </th>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">
                            Location
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase">
                            Qty
                          </th>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">
                            Notes
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {filteredCounts.length === 0 ? (
                          <tr>
                            <td
                              colSpan={6}
                              className="px-3 py-8 text-center text-sm text-gray-500"
                            >
                              No count entries found.
                            </td>
                          </tr>
                        ) : (
                          filteredCounts.map((c) => (
                            <tr key={c.id} className="hover:bg-gray-50">
                              <td className="px-3 py-2 text-sm text-gray-500 whitespace-nowrap">
                                {c.timestamp
                                  ? formatRelativeTime(c.timestamp)
                                  : '—'}
                              </td>
                              <td className="px-3 py-2 text-sm text-gray-700">
                                {c.counterName}
                              </td>
                              <td className="px-3 py-2 text-sm">
                                <div className="font-medium text-gray-900">
                                  {c.itemName}
                                </div>
                                <div className="text-xs text-gray-500 font-mono">
                                  {c.itemSku}
                                </div>
                              </td>
                              <td className="px-3 py-2 text-sm text-gray-600">
                                {c.locationName}
                              </td>
                              <td className="px-3 py-2 text-sm text-right font-semibold text-gray-900">
                                {Number(c.counted_qty).toLocaleString('en-US')}
                              </td>
                              <td className="px-3 py-2 text-sm text-gray-500 max-w-[200px] truncate">
                                {c.notes || '—'}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-200 bg-gray-50 shrink-0">
          <span className="text-xs text-gray-400">
            Auto-refreshing every 30s · Press Esc to close
          </span>
          <button
            type="button"
            onClick={() => loadDetails({ showLoading: false })}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
          >
            Refresh now
          </button>
        </div>
      </div>
    </div>
  );
};

// ---- Small stat card (matches LiveMonitoring style) -------------------------

const colorMap = {
  blue: { bg: 'bg-blue-50', icon: 'text-blue-600', text: 'text-blue-900' },
  green: { bg: 'bg-green-50', icon: 'text-green-600', text: 'text-green-900' },
  purple: { bg: 'bg-purple-50', icon: 'text-purple-600', text: 'text-purple-900' },
  teal: { bg: 'bg-teal-50', icon: 'text-teal-600', text: 'text-teal-900' },
};

function StatCard({ icon: Icon, label, value, sub, color = 'blue' }) {
  const c = colorMap[color] || colorMap.blue;
  return (
    <div className={`rounded-lg shadow-sm p-3 ${c.bg}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-gray-600 uppercase tracking-wide">
          {label}
        </span>
        <Icon className={`h-4 w-4 ${c.icon}`} />
      </div>
      <div className={`text-lg font-bold ${c.text}`}>{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

export default React.memo(LiveMonitoringFullView);
