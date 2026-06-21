import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Routes, Route, useNavigate, useLocation, Link, Navigate } from 'react-router-dom';
import {
  Package,
  Users,
  Building,
  ClipboardList,
  LogOut,
  Plus,
  Search,
  Edit,
  Trash2,
  Save,
  X,
  ChevronDown,
  AlertCircle,
  Calendar,
  Clock,
  UserPlus,
  UserMinus,
  Download,
  CheckCircle,
  Tag,
  Hash,
  Code,
  Folder,
  Home,
  Layers
} from 'lucide-react';
import { supabase, checkCategoryUsage, checkLocationUsage, softDeleteLocation, reactivateLocation } from '../lib/supabase';
import TagManagement from './TagManagement';
import * as XLSX from 'xlsx';

const AdminDashboard = ({ user, signOut }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Get current tab from URL path
  const getCurrentTab = () => {
    const pathSegments = location.pathname.split('/');
    const lastSegment = pathSegments[pathSegments.length - 1];
    return lastSegment || 'sessions';
  };

  const activeTab = getCurrentTab();

  // Shared state for all manager components
  const [sessions, setSessions] = useState([]);
  const [items, setItems] = useState([]);
  const [itemGroups, setItemGroups] = useState([]);
  const [categories, setCategories] = useState([]);
  const [locations, setLocations] = useState([]);
  const [users, setUsers] = useState([]);
  const [dataLoading, setDataLoading] = useState(true);
  const cacheDuration = 5 * 60 * 1000; // 5 minutes
  const lastFetchTimeRef = useRef(0);
  const isFetchingRef = useRef(false);
  const [dataFetched, setDataFetched] = useState(() => {
    // Check if data is already cached in localStorage (expires after 5 minutes)
    const cached = localStorage.getItem('adminDashboardData');
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        const cacheAge = Date.now() - (parsed.timestamp || 0);

        if (cacheAge < cacheDuration) {
          setSessions(parsed.sessions || []);
          setItems(parsed.items || []);
          setItemGroups(parsed.itemGroups || []);
          setCategories(parsed.categories || []);
          setLocations(parsed.locations || []);
          setUsers(parsed.users || []);
          setDataLoading(false);
          lastFetchTimeRef.current = parsed.timestamp || Date.now();
          return true;
        } else {
          // Cache is expired, remove it
          localStorage.removeItem('adminDashboardData');
        }
      } catch (e) {
        console.error('Error parsing cached data:', e);
        localStorage.removeItem('adminDashboardData');
      }
    }
    return false;
  });

  const fetchAllData = useCallback(async ({ showLoading = true } = {}) => {
    if (isFetchingRef.current) return;

    try {
      if (showLoading) {
        setDataLoading(true);
      }
      isFetchingRef.current = true;

      // Fetch all data - for items, use pagination to ensure we get all items
      let allItems = [];
      let itemsStart = 0;
      const itemsPageSize = 1000;
      let hasMoreItems = true;

      // Fetch items in chunks to handle large datasets
      while (hasMoreItems) {
        const { data: itemsChunk, error: itemsChunkError } = await supabase
          .from('items')
          .select('id, sku, item_code, item_name, category, uom, internal_product_code, tags, created_by, created_at, updated_at')
          .order('item_name')
          .range(itemsStart, itemsStart + itemsPageSize - 1);

        if (itemsChunkError) throw itemsChunkError;

        if (itemsChunk && itemsChunk.length > 0) {
          allItems = allItems.concat(itemsChunk);
          itemsStart += itemsPageSize;

          // If we got fewer items than page size, we've reached the end
          if (itemsChunk.length < itemsPageSize) {
            hasMoreItems = false;
          }
        } else {
          hasMoreItems = false;
        }
      }

      // Fetch other data in parallel
      const [sessionsRes, itemGroupsRes, categoriesRes, locationsRes, usersRes] = await Promise.all([
        supabase.from('sessions').select(`*, session_users (user_id)`).order('created_date', { ascending: false }),
        supabase.from('item_groups').select('*, item_group_items(item_id)').order('name'),
        supabase.from('categories').select('*').order('name'),
        supabase.from('location_usage').select('*').order('name'),
        supabase.from('profiles').select('*').order('name')
      ]);

      const itemsRes = { data: allItems, error: null };

      // Handle sessions with user profiles
      if (sessionsRes.data) {
        const userIds = [...new Set(sessionsRes.data.flatMap(session =>
          session.session_users?.map(su => su.user_id) || []
        ))];

        if (userIds.length > 0) {
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, name, username')
            .in('id', userIds);

          const profileMap = {};
          profiles?.forEach(profile => {
            profileMap[profile.id] = profile;
          });

          sessionsRes.data.forEach(session => {
            session.session_users?.forEach(su => {
              su.profiles = profileMap[su.user_id];
            });
          });
        }
      }

      const sessionsData = sessionsRes.data || [];
      const itemsData = itemsRes.data || [];
      const itemGroupsData = itemGroupsRes.data || [];
      const categoriesData = categoriesRes.data || [];
      const locationsData = locationsRes.data || [];
      const usersData = usersRes.data || [];

      if (sessionsRes.error) throw sessionsRes.error;
      if (itemsRes.error) throw itemsRes.error;
      if (itemGroupsRes.error) throw itemGroupsRes.error;
      if (categoriesRes.error) throw categoriesRes.error;
      if (locationsRes.error) throw locationsRes.error;
      if (usersRes.error) throw usersRes.error;

      setSessions(sessionsData);
      setItems(itemsData);
      setItemGroups(itemGroupsData);
      setCategories(categoriesData);
      setLocations(locationsData);
      setUsers(usersData);
      setError('');

      // Cache data in localStorage
      const dataToCache = {
        sessions: sessionsData,
        items: itemsData,
        itemGroups: itemGroupsData,
        categories: categoriesData,
        locations: locationsData,
        users: usersData,
        timestamp: Date.now()
      };
      localStorage.setItem('adminDashboardData', JSON.stringify(dataToCache));

      setDataFetched(true);
      lastFetchTimeRef.current = dataToCache.timestamp;
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
      setError('Failed to load dashboard data');
    } finally {
      if (showLoading) {
        setDataLoading(false);
      }
      isFetchingRef.current = false;
    }
  }, []);

  // Fetch all shared data once when component mounts
  useEffect(() => {
    if (!dataFetched) {
      fetchAllData();
    }
  }, [dataFetched, fetchAllData]);

  // Handle tab visibility changes to prevent unnecessary reloads
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const now = Date.now();
        const timeSinceLastFetch = now - lastFetchTimeRef.current;

        if (timeSinceLastFetch >= cacheDuration && !isFetchingRef.current) {
          fetchAllData({ showLoading: false });
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [cacheDuration, fetchAllData]);

  const tabs = [
    { id: 'sessions', label: 'Sessions', icon: ClipboardList, path: '/admin/sessions' },
    { id: 'item-groups', label: 'Item Groups', icon: Layers, path: '/admin/item-groups' },
    { id: 'items', label: 'Items', icon: Package, path: '/admin/items' },
    { id: 'tags', label: 'Tags', icon: Tag, path: '/admin/tags' },
    { id: 'users', label: 'Users', icon: Users, path: '/admin/users' },
    { id: 'categories', label: 'Categories & Locations', icon: Building, path: '/admin/categories' },
  ];

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (err) {
      console.error('Sign out error:', err);
    }
  };

  // Function to refresh items data when tags are updated
  const refreshItemsData = async () => {
    try {
      console.log('Refreshing items data after tag update...');

      // Fetch all items using pagination to handle large datasets
      let allItems = [];
      let itemsStart = 0;
      const itemsPageSize = 1000;
      let hasMoreItems = true;

      while (hasMoreItems) {
        const { data: itemsChunk, error: itemsChunkError } = await supabase
          .from('items')
          .select('id, sku, item_code, item_name, category, uom, internal_product_code, tags, created_by, created_at, updated_at')
          .order('item_name')
          .range(itemsStart, itemsStart + itemsPageSize - 1);

        if (itemsChunkError) {
          console.error('Supabase error fetching items:', itemsChunkError);
          throw itemsChunkError;
        }

        if (itemsChunk && itemsChunk.length > 0) {
          allItems = allItems.concat(itemsChunk);
          itemsStart += itemsPageSize;

          if (itemsChunk.length < itemsPageSize) {
            hasMoreItems = false;
          }
        } else {
          hasMoreItems = false;
        }
      }

      console.log('Successfully fetched updated items:', allItems.length, 'items');
      setItems(allItems);

      // Update localStorage cache with fresh data
      const cached = localStorage.getItem('adminDashboardData');
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          parsed.items = itemsData;
          parsed.timestamp = Date.now();
          localStorage.setItem('adminDashboardData', JSON.stringify(parsed));
          console.log('Updated localStorage cache with fresh items data');
        } catch (e) {
          console.error('Error updating localStorage cache:', e);
        }
      } else {
        console.log('No existing cache found to update');
      }
    } catch (err) {
      console.error('Error refreshing items data:', err);
      alert('Error refreshing data: ' + err.message);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <div className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
            <div className="flex items-center space-x-4">
              <span className="text-gray-600 hidden sm:block">
                Welcome, {user?.user_metadata?.name || user?.email}
              </span>
              <button
                onClick={() => navigate('/home')}
                className="text-blue-600 hover:text-blue-800"
                title="Go to Home"
              >
                <Home className="h-5 w-5" />
              </button>
              <button
                onClick={handleSignOut}
                className="text-red-600 hover:text-red-800 flex items-center space-x-1"
                title="Logout"
              >
                <LogOut className="h-5 w-5" />
                <span className="hidden sm:block">Logout</span>
              </button>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="border-b border-gray-200">
            <nav className="-mb-px flex space-x-4 overflow-x-auto">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <Link
                    key={tab.id}
                    to={tab.path}
                    className={`flex items-center gap-2 whitespace-nowrap py-3 px-2 border-b-2 font-medium text-sm ${
                      isActive
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {tab.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        {error && (
          <div className="mb-6 flex items-center p-3 bg-red-100 border border-red-400 text-red-700 rounded">
            <AlertCircle className="h-4 w-4 mr-2" />
            {error}
          </div>
        )}

        {dataLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="spinner"></div>
            <span className="ml-2 text-gray-600">Loading dashboard data...</span>
          </div>
        ) : (
          <Routes>
            <Route path="sessions" element={<SessionsManager sessions={sessions} setSessions={setSessions} onDataChange={fetchAllData} />} />
            <Route path="item-groups" element={<ItemGroupsManager itemGroups={itemGroups} setItemGroups={setItemGroups} items={items} onDataChange={fetchAllData} />} />
            <Route path="items" element={<ItemsManager items={items} setItems={setItems} categories={categories} setCategories={setCategories} onDataChange={fetchAllData} />} />
            <Route path="tags" element={
              <>
                <div className="mb-6">
                  <h3 className="text-xl font-semibold">Tag Management</h3>
                  <p className="text-gray-600 text-sm mt-1">
                    Manage tags for all items in the system. Select items to add or remove tags in bulk.
                  </p>
                </div>
                <TagManagement
                  items={items}
                  onTagsUpdated={refreshItemsData}
                />
              </>
            } />
            <Route path="users" element={<UsersManager users={users} setUsers={setUsers} onDataChange={fetchAllData} />} />
            <Route path="categories" element={<CategoriesManager items={items} categories={categories} setCategories={setCategories} locations={locations} setLocations={setLocations} onDataChange={fetchAllData} />} />
            {/* Default redirect to sessions */}
            <Route path="*" element={<Navigate to="sessions" replace />} />
          </Routes>
        )}
      </main>
    </div>
  );
};

// Sessions Manager Component
const SessionsManager = React.memo(({ sessions, setSessions, onDataChange }) => {
  const [showEditor, setShowEditor] = useState(false);
  const [editingSession, setEditingSession] = useState(null);
  const [showUserAssignment, setShowUserAssignment] = useState(false);
  const [showItemSelection, setShowItemSelection] = useState(false);
  const [selectedSessionForAssignment, setSelectedSessionForAssignment] = useState(null);
  const [selectedSessionForItems, setSelectedSessionForItems] = useState(null);

  // Refresh only sessions data (not all dashboard data)
  const refreshSessions = async () => {
    try {
      const { data: sessionsData, error } = await supabase
        .from('sessions')
        .select(`*, session_users (user_id)`)
        .order('created_date', { ascending: false });

      if (error) throw error;

      // Fetch user profiles for assigned users
      if (sessionsData) {
        const userIds = [...new Set(sessionsData.flatMap(session =>
          session.session_users?.map(su => su.user_id) || []
        ))];

        if (userIds.length > 0) {
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, name, username')
            .in('id', userIds);

          const profileMap = {};
          profiles?.forEach(profile => {
            profileMap[profile.id] = profile;
          });

          sessionsData.forEach(session => {
            session.session_users?.forEach(su => {
              su.profiles = profileMap[su.user_id];
            });
          });
        }
      }

      setSessions(sessionsData || []);
    } catch (err) {
      console.error('Error refreshing sessions:', err);
    }
  };

  const handleCreateSession = () => {
    setEditingSession(null);
    setShowEditor(true);
  };

  const handleEditSession = (session) => {
    setEditingSession(session);
    setShowEditor(true);
  };

  const handleDeleteSession = async (sessionId) => {
    if (!window.confirm('Are you sure you want to delete this session? All count data will be lost.')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('sessions')
        .delete()
        .eq('id', sessionId);

      if (error) throw error;

      await refreshSessions(); // Only refresh sessions, not all data
    } catch (err) {
      console.error('Error deleting session:', err);
    }
  };

  const handleManageUsers = (session) => {
    setSelectedSessionForAssignment(session);
    setShowUserAssignment(true);
  };

  const handleManageItems = (session) => {
    setSelectedSessionForItems(session);
    setShowItemSelection(true);
  };

  const formatDate = (date) => {
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
  };

  const exportReport = async (session) => {
    try {
      // Fetch session items with counts
      const { data: sessionItems, error: sessionItemsError } = await supabase
        .from('session_items')
        .select(`
          items (
            id,
            sku,
            item_name,
            internal_product_code
          )
        `)
        .eq('session_id', session.id);

      if (sessionItemsError) throw sessionItemsError;

      const itemIds = sessionItems.map(si => si.items.id);

      // Fetch counts for this session
      const { data: countsData, error: countsError } = await supabase
        .from('counts')
        .select(`
          *,
          items (
            sku,
            item_name
          ),
          locations (
            name
          )
        `)
        .eq('session_id', session.id);

      if (countsError) throw countsError;

      // Fetch user profiles
      const userIds = [...new Set(countsData.map(c => c.user_id))];
      const { data: profilesData, error: profilesError } = await supabase
        .from('profiles')
        .select('id, name')
        .in('id', userIds);

      if (profilesError) throw profilesError;

      const profileMap = {};
      profilesData?.forEach(profile => {
        profileMap[profile.id] = profile.name;
      });

      const csvContent = "data:text/csv;charset=utf-8,Session,SKU,Item Name,Internal Product Code,Location,Counted Qty,User,Timestamp\n";

      const reportData = countsData.map(count => ({
        sessionName: session.name,
        sku: count.items?.sku || '',
        itemName: count.items?.item_name || '',
        internalProductCode: count.items?.internal_product_code || '',
        location: count.locations?.name || '',
        quantity: count.counted_qty,
        userName: profileMap[count.user_id] || '',
        timestamp: formatDate(count.timestamp)
      }));

      const csvRows = reportData.map(row =>
        `${row.sessionName},"${row.sku}","${row.itemName}","${row.internalProductCode}",${row.location},${row.quantity},"${row.userName}","${row.timestamp}"`
      ).join('\n');

      const finalContent = csvContent + csvRows;

      const encodedUri = encodeURI(finalContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", `${session.name}_report.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('Error exporting report:', err);
      alert('Error exporting report: ' + err.message);
    }
  };


  return (
    <div>
      <div className="mb-6">
        <button
          onClick={handleCreateSession}
          className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 flex items-center space-x-2"
        >
          <Plus className="h-4 w-4" />
          <span>Create Session</span>
        </button>
      </div>

      <div className="bg-white shadow overflow-hidden sm:rounded-md">
        <ul className="divide-y divide-gray-200">
          {sessions.map((session) => (
            <li key={session.id} className="px-6 py-4">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-medium text-gray-900">
                      {session.name}
                    </h3>
                    {session.is_recurring_template && (
                      <span className="px-2 py-1 bg-purple-100 text-purple-800 text-xs font-semibold rounded-full">
                        RECURRING TEMPLATE
                      </span>
                    )}
                    {session.is_scheduled && (
                      <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs font-semibold rounded-full">
                        SCHEDULED
                      </span>
                    )}
                    {session.parent_session_id && (
                      <span className="px-2 py-1 bg-gray-100 text-gray-700 text-xs font-semibold rounded-full">
                        AUTO-GENERATED
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
                    <span className="flex items-center">
                      <ClipboardList className="h-4 w-4 mr-1" />
                      {session.type}
                    </span>
                    <span className="flex items-center">
                      <Users className="h-4 w-4 mr-1" />
                      {session.session_users?.length || 0} Counter(s)
                    </span>
                    <span className="flex items-center">
                      <Calendar className="h-4 w-4 mr-1" />
                      {session.scheduled_date ? new Date(session.scheduled_date).toLocaleDateString() : new Date(session.created_date).toLocaleDateString()}
                    </span>
                    {session.valid_from && session.valid_until && (
                      <span className="flex items-center">
                        <Clock className="h-4 w-4 mr-1" />
                        {new Date(session.valid_from).toLocaleTimeString('en-US', {hour: '2-digit', minute: '2-digit'})} - {new Date(session.valid_until).toLocaleTimeString('en-US', {hour: '2-digit', minute: '2-digit'})}
                      </span>
                    )}
                    <span className={`px-2 py-1 rounded-full text-xs ${
                      session.status === 'active' ? 'bg-green-100 text-green-800' :
                      session.status === 'completed' ? 'bg-blue-100 text-blue-800' :
                      session.status === 'closed' ? 'bg-red-100 text-red-800' :
                      session.status === 'scheduled' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {session.status}
                    </span>
                  </div>
                  {session.recurring_config && (
                    <div className="mt-2 text-xs text-gray-600">
                      <strong>Recurrence:</strong> {session.recurring_config.type}
                      {session.recurring_config.type === 'weekly' && session.recurring_config.days && (
                        <span> (Days: {session.recurring_config.days.map(d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ')})</span>
                      )}
                      {session.recurring_config.type === 'monthly' && session.recurring_config.dates && (
                        <span> (Dates: {session.recurring_config.dates.join(', ')})</span>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => handleManageUsers(session)}
                    className="text-blue-600 hover:text-blue-800 p-2"
                    title="Manage Users"
                  >
                    <Users className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() => handleManageItems(session)}
                    className="text-green-600 hover:text-green-800 p-2"
                    title="Manage Items"
                  >
                    <Package className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() => handleEditSession(session)}
                    className="text-indigo-600 hover:text-indigo-800 p-2"
                    title="Edit Session"
                  >
                    <Edit className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() => exportReport(session)}
                    className="text-green-600 hover:text-green-800 p-2"
                    title="Export Report"
                  >
                    <Download className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() => handleDeleteSession(session.id)}
                    className="text-red-600 hover:text-red-800 p-2"
                    title="Delete Session"
                  >
                    <Trash2 className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {showEditor && (
        <SessionEditor
          session={editingSession}
          onClose={() => setShowEditor(false)}
          onSave={refreshSessions} // Only refresh sessions, not all data
        />
      )}

      {showUserAssignment && (
        <UserAssignmentModal
          session={selectedSessionForAssignment}
          onClose={() => {
            setShowUserAssignment(false);
            setSelectedSessionForAssignment(null);
            refreshSessions(); // Only refresh sessions, not all data
          }}
          onSave={refreshSessions} // Only refresh sessions, not all data
        />
      )}

      {showItemSelection && (
        <ItemSelectionModal
          session={selectedSessionForItems}
          onClose={() => {
            setShowItemSelection(false);
            setSelectedSessionForItems(null);
            refreshSessions(); // Only refresh sessions, not all data
          }}
          onSave={refreshSessions} // Only refresh sessions, not all data
          onDataChange={refreshSessions} // Only refresh sessions, not all data
        />
      )}
    </div>
  );
});

// Item Groups Manager Component
const ItemGroupsManager = React.memo(({ itemGroups, setItemGroups, items, onDataChange }) => {
  const { user } = useAuth();
  const [showEditor, setShowEditor] = useState(false);
  const [editingGroup, setEditingGroup] = useState(null);
  const [showItemsManagement, setShowItemsManagement] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Refresh only item groups data (not all dashboard data)
  const refreshItemGroups = async () => {
    try {
      const { data, error } = await supabase
        .from('item_groups')
        .select('*, item_group_items(item_id)')
        .order('name');

      if (error) throw error;
      setItemGroups(data || []);
    } catch (err) {
      console.error('Error refreshing item groups:', err);
    }
  };

  const handleCreateGroup = () => {
    setEditingGroup(null);
    setShowEditor(true);
  };

  const handleEditGroup = (group) => {
    setEditingGroup(group);
    setShowEditor(true);
  };

  const handleDeleteGroup = async (groupId) => {
    if (!window.confirm('Are you sure you want to delete this item group? This will not delete the items themselves.')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('item_groups')
        .delete()
        .eq('id', groupId);

      if (error) throw error;

      await refreshItemGroups(); // Only refresh item groups, not all data
    } catch (err) {
      console.error('Error deleting item group:', err);
      alert('Error deleting item group: ' + err.message);
    }
  };

  const handleManageItems = (group) => {
    setSelectedGroup(group);
    setShowItemsManagement(true);
  };

  // Filter groups based on search term
  const filteredGroups = React.useMemo(() => {
    if (!searchTerm.trim()) return itemGroups;

    const searchLower = searchTerm.toLowerCase().trim();
    return itemGroups.filter(group => {
      return (
        group.name?.toLowerCase().includes(searchLower) ||
        group.description?.toLowerCase().includes(searchLower)
      );
    });
  }, [itemGroups, searchTerm]);

  return (
    <div>
      <div className="mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h3 className="text-xl font-semibold">Item Groups</h3>
            <p className="text-gray-600 text-sm mt-1">
              Create groups of items for easy bulk assignment to sessions.
            </p>
          </div>
          <button
            onClick={handleCreateGroup}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 flex items-center justify-center space-x-2 w-full sm:w-auto"
          >
            <Plus className="h-4 w-4" />
            <span>Create Item Group</span>
          </button>
        </div>

        {/* Search Bar */}
        <div className="mt-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search item groups..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      {filteredGroups.length === 0 ? (
        <div className="bg-white shadow overflow-hidden sm:rounded-md p-6 text-center">
          <Layers className="h-12 w-12 text-gray-400 mx-auto mb-3" />
          <p className="text-gray-500">
            {searchTerm ? 'No item groups found matching your search.' : 'No item groups yet. Create one to get started!'}
          </p>
        </div>
      ) : (
        <div className="bg-white shadow overflow-hidden sm:rounded-md">
          <ul className="divide-y divide-gray-200">
            {filteredGroups.map((group) => (
              <li key={group.id} className="px-6 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <h3 className="text-lg font-medium text-gray-900">
                      {group.name}
                    </h3>
                    {group.description && (
                      <p className="mt-1 text-sm text-gray-500">{group.description}</p>
                    )}
                    <div className="mt-2 flex items-center gap-x-4 text-sm text-gray-500">
                      <span className="flex items-center">
                        <Package className="h-4 w-4 mr-1" />
                        {group.item_group_items?.length || 0} item(s)
                      </span>
                      <span className="flex items-center">
                        <Calendar className="h-4 w-4 mr-1" />
                        {new Date(group.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => handleManageItems(group)}
                      className="text-green-600 hover:text-green-800 p-2"
                      title="Manage Items"
                    >
                      <Package className="h-5 w-5" />
                    </button>
                    <button
                      onClick={() => handleEditGroup(group)}
                      className="text-indigo-600 hover:text-indigo-800 p-2"
                      title="Edit Group"
                    >
                      <Edit className="h-5 w-5" />
                    </button>
                    <button
                      onClick={() => handleDeleteGroup(group.id)}
                      className="text-red-600 hover:text-red-800 p-2"
                      title="Delete Group"
                    >
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {showEditor && (
        <ItemGroupEditor
          group={editingGroup}
          onClose={() => setShowEditor(false)}
          onSave={refreshItemGroups} // Only refresh item groups, not all data
        />
      )}

      {showItemsManagement && (
        <GroupItemsModal
          group={selectedGroup}
          onClose={() => {
            setShowItemsManagement(false);
            setSelectedGroup(null);
            refreshItemGroups(); // Only refresh item groups, not all data
          }}
          onSave={refreshItemGroups} // Only refresh item groups, not all data
        />
      )}
    </div>
  );
});

// Items Manager Component
const ItemsManager = React.memo(({ items, setItems, categories, setCategories, onDataChange }) => {
  const { user } = useAuth();
  const [showEditor, setShowEditor] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [bulkFile, setBulkFile] = useState(null);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [bulkError, setBulkError] = useState('');
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [previewItems, setPreviewItems] = useState([]);
  const [showPreview, setShowPreview] = useState(false);
  const [duplicateInfo, setDuplicateInfo] = useState({ inCsv: [], inDb: [] });

  // Search and pagination state
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);

  // Data is now passed as props from parent component

  // Filter items based on search term
  const filteredItems = React.useMemo(() => {
    if (!searchTerm.trim()) return items;

    const searchLower = searchTerm.toLowerCase().trim();
    return items.filter(item => {
      return (
        item.sku?.toLowerCase().includes(searchLower) ||
        item.item_code?.toLowerCase().includes(searchLower) ||
        item.item_name?.toLowerCase().includes(searchLower) ||
        item.internal_product_code?.toLowerCase().includes(searchLower) ||
        item.category?.toLowerCase().includes(searchLower) ||
        item.uom?.toLowerCase().includes(searchLower)
      );
    });
  }, [items, searchTerm]);

  // Paginate filtered items
  const paginatedItems = React.useMemo(() => {
    if (itemsPerPage === -1) return filteredItems; // Show all

    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return filteredItems.slice(startIndex, endIndex);
  }, [filteredItems, currentPage, itemsPerPage]);

  // Calculate total pages
  const totalPages = React.useMemo(() => {
    if (itemsPerPage === -1) return 1;
    return Math.ceil(filteredItems.length / itemsPerPage);
  }, [filteredItems.length, itemsPerPage]);

  // Reset to page 1 when search term or items per page changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, itemsPerPage]);

  const handleCreateItem = () => {
    setEditingItem(null);
    setShowEditor(true);
  };

  const handleEditItem = (item) => {
    setEditingItem(item);
    setShowEditor(true);
  };

  const handleDeleteItem = async (itemId) => {
    if (!window.confirm('Are you sure you want to delete this item?')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('items')
        .delete()
        .eq('id', itemId);

      if (error) throw error;

      await onDataChange();
    } catch (err) {
      console.error('Error deleting item:', err);
    }
  };

  const downloadTemplate = () => {
    const csvContent = "data:text/csv;charset=utf-8,SKU,Item Code,Item Name,Internal Product Code,Category,UOM,Tags\n";
    const sampleRow = "SAMPLE001,SAMPLE001,Sample Item,JI4ACO-GCAS17BK04,Electronics,Pcs,tag1;tag2\n";
    const finalContent = csvContent + sampleRow;

    const encodedUri = encodeURI(finalContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "items_template.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadItems = async () => {
    try {
      // Fetch ALL items directly from database with pagination
      let allItems = [];
      let start = 0;
      const pageSize = 1000;
      let hasMore = true;

      // Show loading indicator
      const originalButtonText = document.querySelector('button[onclick*="downloadItems"]')?.innerText;

      while (hasMore) {
        const { data, error, count } = await supabase
          .from('items')
          .select('id, sku, item_code, item_name, category, uom, internal_product_code, tags', { count: 'exact' })
          .order('item_name')
          .range(start, start + pageSize - 1);

        if (error) {
          console.error('Error fetching items:', error);
          alert('Error fetching items from database');
          return;
        }

        if (data && data.length > 0) {
          allItems = allItems.concat(data);
          start += pageSize;

          // Check if there are more items
          if (count && allItems.length >= count) {
            hasMore = false;
          } else if (data.length < pageSize) {
            hasMore = false;
          }
        } else {
          hasMore = false;
        }
      }

      if (allItems.length === 0) {
        alert('No items to download');
        return;
      }

      // Prepare data for Excel
      const excelData = allItems.map(item => ({
        'SKU': item.sku || '',
        'Item Code': item.item_code || '',
        'Item Name': item.item_name || '',
        'Internal Product Code': item.internal_product_code || '',
        'Category': item.category || '',
        'UOM': item.uom || '',
        'Tags': item.tags && item.tags.length > 0 ? item.tags.join(';') : ''
      }));

      // Create workbook and worksheet
      const worksheet = XLSX.utils.json_to_sheet(excelData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Items');

      // Set column widths
      const colWidths = [
        { wch: 15 }, // SKU
        { wch: 15 }, // Item Code
        { wch: 30 }, // Item Name
        { wch: 20 }, // Internal Product Code
        { wch: 15 }, // Category
        { wch: 10 }, // UOM
        { wch: 30 }  // Tags
      ];
      worksheet['!cols'] = colWidths;

      // Generate filename with current date
      const date = new Date().toISOString().split('T')[0];
      const filename = `items_list_${date}.xlsx`;

      // Write file
      XLSX.writeFile(workbook, filename);

      console.log(`Successfully downloaded ${allItems.length} items`);
    } catch (err) {
      console.error('Error downloading items:', err);
      alert('Error downloading items');
    }
  };

  const handleParseCSV = async () => {
    if (!bulkFile) {
      setBulkError('Please select a CSV file');
      return;
    }

    setBulkUploading(true);
    setBulkError('');

    try {
      const text = await bulkFile.text();
      const rows = text.split('\n').filter(row => row.trim());
      const headers = rows[0].split(',').map(h => h.trim().replace(/"/g, ''));

      // Expected headers: SKU,Item Code,Item Name,Internal Product Code,Category,UOM,Tags
      const expectedHeaders = ['SKU', 'Item Code', 'Item Name', 'Internal Product Code', 'Category', 'UOM', 'Tags'];
      const headerMatch = expectedHeaders.every(h => headers.includes(h));

      if (!headerMatch) {
        throw new Error('CSV must have headers: SKU, Item Code, Item Name, Internal Product Code, Category, UOM, Tags');
      }

      const dataRows = rows.slice(1);
      const itemsToInsert = [];
      const skusInCsv = new Set();
      const duplicatesInCsv = [];

      for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        const cols = row.split(',').map(col => col.trim().replace(/"/g, ''));

        if (cols.length !== 7) {
          throw new Error(`Row ${i + 2}: Invalid number of columns (expected 7)`);
        }

        const [sku, itemCode, itemName, internalProductCode, category, uom, tags] = cols;

        if (!sku || !itemCode || !itemName || !category || !uom) {
          throw new Error(`Row ${i + 2}: Required fields missing`);
        }

        // Check if category exists
        const categoryExists = categories.some(cat => cat.name === category);
        if (!categoryExists) {
          throw new Error(`Row ${i + 2}: Category "${category}" does not exist`);
        }

        // Check for duplicate SKU within CSV (case-insensitive, trimmed)
        const skuNormalized = sku.trim().toLowerCase();
        if (skusInCsv.has(skuNormalized)) {
          duplicatesInCsv.push(sku);
          console.warn(`Duplicate SKU found in CSV row ${i + 2}: ${sku}`);
          // Still add to preview but mark as duplicate
        } else {
          skusInCsv.add(skuNormalized);
        }

        // Always add to preview for display, but duplicates will be filtered before upload
        itemsToInsert.push({
          sku: sku.trim(),
          item_code: itemCode,
          item_name: itemName,
          internal_product_code: internalProductCode || null,
          category,
          uom,
          tags: tags ? tags.split(';').map(tag => tag.trim()).filter(tag => tag) : [],
          created_by: user.id,
          rowNumber: i + 2 // For display purposes
        });
      }

      if (itemsToInsert.length === 0) {
        throw new Error('No valid items to upload');
      }

      // Fetch ALL items from database using pagination to avoid missing any SKUs
      console.log('Fetching existing SKUs from database...');
      let allExistingItems = [];
      let page = 0;
      const pageSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data: pageData, error: fetchError } = await supabase
          .from('items')
          .select('sku')
          .range(page * pageSize, (page + 1) * pageSize - 1);

        if (fetchError) throw fetchError;

        if (pageData && pageData.length > 0) {
          allExistingItems = allExistingItems.concat(pageData);
          page++;
          hasMore = pageData.length === pageSize; // Continue if we got a full page
        } else {
          hasMore = false;
        }
      }

      console.log(`Found ${allExistingItems.length} existing items in database`);
      console.log(`Checking ${itemsToInsert.length} items from CSV for duplicates`);

      // Check for existing SKUs in database (case-insensitive comparison)
      const existingSkusNormalized = allExistingItems.map(item => item.sku.trim().toLowerCase());
      console.log('Sample existing SKUs:', existingSkusNormalized.slice(0, 5));

      const duplicatesInDb = itemsToInsert.filter(item =>
        existingSkusNormalized.includes(item.sku.trim().toLowerCase())
      ).map(item => item.sku);

      console.log(`Found ${duplicatesInDb.length} duplicates in database:`, duplicatesInDb);

      setPreviewItems(itemsToInsert);
      setDuplicateInfo({
        inCsv: [...new Set(duplicatesInCsv)],
        inDb: [...new Set(duplicatesInDb)]
      });
      setShowPreview(true);
      setShowBulkModal(false);
    } catch (err) {
      setBulkError(err.message);
    } finally {
      setBulkUploading(false);
    }
  };

  const handleConfirmUpload = async () => {
    setBulkUploading(true);
    setBulkError('');

    try {
      // Remove rowNumber before inserting
      const itemsToInsert = previewItems.map(({ rowNumber, ...item }) => item);

      console.log('=== UPLOAD ATTEMPT ===');
      console.log(`Uploading ${itemsToInsert.length} items`);
      console.log('SKUs to upload:', itemsToInsert.map(item => item.sku));

      // Check for duplicates within the upload batch itself
      const skusInBatch = itemsToInsert.map(item => item.sku.trim().toLowerCase());
      const duplicatesInBatch = skusInBatch.filter((sku, index) => skusInBatch.indexOf(sku) !== index);
      if (duplicatesInBatch.length > 0) {
        console.error('DUPLICATE SKUs IN UPLOAD BATCH:', [...new Set(duplicatesInBatch)]);
        throw new Error(`Upload contains duplicate SKUs: ${[...new Set(duplicatesInBatch)].join(', ')}`);
      }

      const { error } = await supabase
        .from('items')
        .insert(itemsToInsert);

      if (error) {
        console.error('Upload error:', error);
        throw error;
      }

      setBulkFile(null);
      setShowPreview(false);
      setShowBulkModal(false);
      setBulkError('');
      setPreviewItems([]);
      setDuplicateInfo({ inCsv: [], inDb: [] });
      await onDataChange();
      alert(`Successfully uploaded ${itemsToInsert.length} items`);
    } catch (err) {
      setBulkError(err.message);
    } finally {
      setBulkUploading(false);
    }
  };

  const handleCancelPreview = () => {
    setShowPreview(false);
    setPreviewItems([]);
    setDuplicateInfo({ inCsv: [], inDb: [] });
    setShowBulkModal(true);
  };

  const downloadErrorReport = () => {
    // Create CSV with error information
    const headers = ['Row', 'SKU', 'Item Code', 'Item Name', 'Internal Code', 'Category', 'UOM', 'Tags', 'Error Type', 'Error Details'];
    const csvRows = [headers.join(',')];

    previewItems.forEach(item => {
      const isDuplicateInCsv = duplicateInfo.inCsv.includes(item.sku);
      const isDuplicateInDb = duplicateInfo.inDb.includes(item.sku);

      let errorType = '';
      let errorDetails = '';

      if (isDuplicateInCsv && isDuplicateInDb) {
        errorType = 'DUPLICATE';
        errorDetails = 'Duplicate in CSV file AND already exists in database';
      } else if (isDuplicateInCsv) {
        errorType = 'DUPLICATE IN CSV';
        errorDetails = 'This SKU appears multiple times in your CSV file';
      } else if (isDuplicateInDb) {
        errorType = 'ALREADY EXISTS';
        errorDetails = 'This SKU already exists in the database';
      } else {
        errorType = 'OK';
        errorDetails = 'No errors';
      }

      const row = [
        item.rowNumber,
        `"${item.sku}"`,
        `"${item.item_code}"`,
        `"${item.item_name}"`,
        `"${item.internal_product_code || ''}"`,
        `"${item.category}"`,
        `"${item.uom}"`,
        `"${item.tags.join('; ')}"`,
        errorType,
        `"${errorDetails}"`
      ];

      csvRows.push(row.join(','));
    });

    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', `bulk_upload_error_report_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Loading is now handled by parent component

  return (
    <div className="bg-white p-4 rounded-lg shadow">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-xl font-semibold">Manage Items</h3>
        <div className="flex space-x-2">
          <button
            onClick={downloadItems}
            className="bg-purple-600 text-white px-4 py-2 rounded-md hover:bg-purple-700 flex items-center space-x-2"
          >
            <Download className="h-4 w-4" />
            <span>Download Items</span>
          </button>
          <button
            onClick={handleCreateItem}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 flex items-center space-x-2"
          >
            <Plus className="h-4 w-4" />
            <span>Add Item</span>
          </button>
          <button
            onClick={() => setShowBulkModal(true)}
            className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 flex items-center space-x-2"
          >
            <Plus className="h-4 w-4" />
            <span>Bulk Add</span>
          </button>
        </div>
      </div>

      {/* Search and Display Options */}
      <div className="mb-4 flex flex-col sm:flex-row gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
          <input
            type="text"
            placeholder="Search by SKU, Item Code, Item Name, Product Code, Category, UOM..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-2 top-1/2 transform -translate-y-1/2 bg-gray-500 text-white p-1 rounded-md hover:bg-gray-600"
              title="Clear search"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        <div className="flex gap-2 items-center">
          <label className="text-sm text-gray-600 whitespace-nowrap">Display:</label>
          <select
            value={itemsPerPage}
            onChange={(e) => setItemsPerPage(Number(e.target.value))}
            className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value={10}>10 per page</option>
            <option value={50}>50 per page</option>
            <option value={100}>100 per page</option>
            <option value={-1}>All items</option>
          </select>
        </div>
      </div>

      {/* Items Count */}
      <div className="mb-3 text-sm text-gray-600">
        Showing {paginatedItems.length} of {filteredItems.length} items
        {searchTerm && ` (filtered from ${items.length} total)`}
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                SKU
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Item Name
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Internal Product Code
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Category
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                UOM
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {paginatedItems.length === 0 ? (
              <tr>
                <td colSpan="6" className="px-6 py-8 text-center text-gray-500">
                  {searchTerm ? 'No items found matching your search' : 'No items available'}
                </td>
              </tr>
            ) : (
              paginatedItems.map((item) => (
                <tr key={item.id}>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-gray-900">
                    {item.sku}
                  </div>
                  <div className="text-sm text-gray-500">
                    {item.item_code}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {item.item_name}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 font-mono">
                  {item.internal_product_code || '-'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {item.category}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {item.uom}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                  <button
                    onClick={() => handleEditItem(item)}
                    className="text-indigo-600 hover:text-indigo-900"
                  >
                    <Edit className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() => handleDeleteItem(item.id)}
                    className="text-red-600 hover:text-red-900"
                  >
                    <Trash2 className="h-5 w-5" />
                  </button>
                </td>
              </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
      {itemsPerPage !== -1 && totalPages > 1 && (
        <div className="mt-4 flex justify-between items-center">
          <div className="text-sm text-gray-600">
            Page {currentPage} of {totalPages}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
              className="px-3 py-1 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              First
            </button>
            <button
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (currentPage <= 3) {
                  pageNum = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = currentPage - 2 + i;
                }
                return (
                  <button
                    key={pageNum}
                    onClick={() => setCurrentPage(pageNum)}
                    className={`px-3 py-1 border rounded-md ${
                      currentPage === pageNum
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
            <button
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage === totalPages}
              className="px-3 py-1 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Last
            </button>
          </div>
        </div>
      )}

      {showBulkModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg w-full max-w-md flex flex-col">
            <div className="p-4 border-b flex justify-between items-center">
              <h3 className="text-xl font-bold">Bulk Upload Items</h3>
              <button onClick={() => setShowBulkModal(false)} className="text-gray-500 hover:text-gray-700">
                <X className="h-6 w-6" />
              </button>
            </div>
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <p className="text-sm text-gray-600">
                  Upload a CSV file with columns: SKU, Item Code, Item Name, Internal Product Code, Category, UOM, Tags (multiple tags separated by semicolons)
                </p>
                <button
                  onClick={downloadTemplate}
                  className="text-blue-600 hover:text-blue-800 text-sm underline"
                >
                  Download Template
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    CSV File
                  </label>
                  <input
                    type="file"
                    accept=".csv"
                    onChange={(e) => setBulkFile(e.target.files[0])}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                {bulkError && (
                  <div className="p-3 bg-red-100 border border-red-400 text-red-700 rounded">
                    {bulkError}
                  </div>
                )}
              </div>
              <div className="flex justify-end space-x-2 mt-6">
                <button
                  onClick={() => {
                    setShowBulkModal(false);
                    setBulkFile(null);
                    setBulkError('');
                  }}
                  className="px-4 py-2 text-gray-600 border rounded-md hover:bg-gray-50"
                  disabled={bulkUploading}
                >
                  Cancel
                </button>
                <button
                  onClick={handleParseCSV}
                  disabled={!bulkFile || bulkUploading}
                  className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                >
                  {bulkUploading ? (
                    <div className="spinner w-4 h-4"></div>
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                  <span>{bulkUploading ? 'Processing...' : 'Preview'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showPreview && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg w-full max-w-6xl flex flex-col max-h-[90vh]">
            <div className="p-4 border-b flex justify-between items-center">
              <div>
                <h3 className="text-xl font-bold">Preview Bulk Upload</h3>
                <p className="text-sm text-gray-600 mt-1">
                  {previewItems.length} item(s) ready to upload
                </p>
              </div>
              <button onClick={handleCancelPreview} className="text-gray-500 hover:text-gray-700">
                <X className="h-6 w-6" />
              </button>
            </div>

            {/* Duplicate Warnings */}
            {(duplicateInfo.inCsv.length > 0 || duplicateInfo.inDb.length > 0) && (
              <div className="p-4 border-b bg-red-50">
                <div className="flex items-start justify-between">
                  <div className="flex items-start space-x-2 flex-1">
                    <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
                    <div className="flex-1">
                      <h4 className="font-semibold text-red-800">❌ Upload Blocked - Duplicate SKUs Detected</h4>
                      {duplicateInfo.inCsv.length > 0 && (
                        <p className="text-sm text-red-700 mt-1">
                          <strong>Duplicates within CSV:</strong> {duplicateInfo.inCsv.join(', ')}
                        </p>
                      )}
                      {duplicateInfo.inDb.length > 0 && (
                        <p className="text-sm text-red-700 mt-1">
                          <strong>Already exist in database:</strong> {duplicateInfo.inDb.join(', ')}
                        </p>
                      )}
                      <p className="text-sm text-red-700 mt-2 font-medium">
                        🚫 You must remove all duplicate SKUs from your CSV file before uploading. Please fix the duplicates and try again.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={downloadErrorReport}
                    className="ml-4 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 flex items-center space-x-2 whitespace-nowrap"
                    title="Download detailed error report"
                  >
                    <Download className="h-4 w-4" />
                    <span>Download Error Report</span>
                  </button>
                </div>
              </div>
            )}

            {/* Preview Table */}
            <div className="flex-1 overflow-auto p-4">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Row
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        SKU
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Item Code
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Item Name
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Internal Code
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Category
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        UOM
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Tags
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {previewItems.map((item, index) => {
                      const isDuplicateInCsv = duplicateInfo.inCsv.includes(item.sku);
                      const isDuplicateInDb = duplicateInfo.inDb.includes(item.sku);
                      const isDuplicate = isDuplicateInCsv || isDuplicateInDb;

                      return (
                        <tr key={index} className={isDuplicate ? 'bg-yellow-50' : ''}>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                            {item.rowNumber}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm">
                            <div className="flex items-center space-x-1">
                              <span className={isDuplicate ? 'text-red-600 font-semibold' : 'text-gray-900'}>
                                {item.sku}
                              </span>
                              {isDuplicate && (
                                <AlertCircle className="h-4 w-4 text-red-600" title={
                                  isDuplicateInCsv ? 'Duplicate in CSV' : 'Already exists in database'
                                } />
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                            {item.item_code}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900">
                            {item.item_name}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                            {item.internal_product_code || '-'}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                            {item.category}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                            {item.uom}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500">
                            {item.tags.length > 0 ? item.tags.join(', ') : '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Error Display */}
            {bulkError && (
              <div className="px-4 pb-4">
                <div className="p-3 bg-red-100 border border-red-400 text-red-700 rounded">
                  {bulkError}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="p-4 border-t flex justify-between items-center">
              <div className="text-sm text-gray-600">
                {duplicateInfo.inCsv.length + duplicateInfo.inDb.length > 0 ? (
                  <span className="text-red-700 font-medium">
                    🚫 {duplicateInfo.inCsv.length + duplicateInfo.inDb.length} duplicate(s) detected - Upload blocked
                  </span>
                ) : (
                  <span className="text-green-700 font-medium">
                    ✅ No duplicates - Ready to upload
                  </span>
                )}
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={handleCancelPreview}
                  className="px-4 py-2 text-gray-600 border rounded-md hover:bg-gray-50"
                  disabled={bulkUploading}
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmUpload}
                  disabled={bulkUploading || duplicateInfo.inCsv.length > 0 || duplicateInfo.inDb.length > 0}
                  className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                >
                  {bulkUploading ? (
                    <>
                      <div className="spinner w-4 h-4"></div>
                      <span>Uploading...</span>
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4" />
                      <span>Confirm & Upload</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showEditor && (
        <ItemEditor
          item={editingItem}
          categories={categories}
          onClose={() => setShowEditor(false)}
          onSave={onDataChange}
        />
      )}
    </div>
  );
});

// Users Manager Component
const UsersManager = React.memo(({ users, setUsers, onDataChange }) => {
  const [showEditor, setShowEditor] = useState(false);
  const [editingUser, setEditingUser] = useState(null);

  // Data is now passed as props from parent component

  const handleCreateUser = () => {
    setEditingUser(null);
    setShowEditor(true);
  };

  const handleEditUser = (user) => {
    setEditingUser(user);
    setShowEditor(true);
  };

  const handleDeleteUser = async (userId) => {
    if (!window.confirm('Are you sure you want to delete this user?')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('profiles')
        .delete()
        .eq('id', userId);

      if (error) throw error;

      await onDataChange();
    } catch (err) {
      console.error('Error deleting user:', err);
    }
  };

  // Loading is now handled by parent component

  return (
    <div className="bg-white p-4 rounded-lg shadow">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-xl font-semibold">Manage Users</h3>
        <button
          onClick={handleCreateUser}
          className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 flex items-center space-x-2"
        >
          <Plus className="h-4 w-4" />
          <span>Add User</span>
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Name
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Username
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Role
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {users.map((user) => (
              <tr key={user.id}>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-gray-900">
                    {user.name}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {user.username}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                    user.role === 'admin'
                      ? 'bg-red-100 text-red-800'
                      : 'bg-green-100 text-green-800'
                  }`}>
                    {user.role === 'counter' ? 'Counter' : user.role}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                    user.status === 'active'
                      ? 'bg-green-100 text-green-800'
                      : 'bg-yellow-100 text-yellow-800'
                  }`}>
                    {user.status || 'inactive'}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                  <button
                    onClick={() => handleEditUser(user)}
                    className="text-indigo-600 hover:text-indigo-900"
                  >
                    <Edit className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() => handleDeleteUser(user.id)}
                    className="text-red-600 hover:text-red-900"
                  >
                    <Trash2 className="h-5 w-5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showEditor && (
        <UserEditor
          user={editingUser}
          onClose={() => setShowEditor(false)}
          onSave={onDataChange}
        />
      )}
    </div>
  );
});

// Categories Manager Component
const CategoriesManager = React.memo(({ items, categories, setCategories, locations, setLocations, onDataChange }) => {
  const [showEditor, setShowEditor] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [showLocationEditor, setShowLocationEditor] = useState(false);
  const [editingLocation, setEditingLocation] = useState(null);

  // Helper function to get category usage information
  const getCategoryUsageInfo = (category) => {
    const itemCount = items.filter(item => item.category === category.name).length;
    const locationCount = locations.filter(location => location.category_id === category.id).length;

    return {
      isInUse: itemCount > 0 || locationCount > 0,
      itemCount,
      locationCount
    };
  };

  const handleCreateCategory = async (name) => {
    try {
      const { error } = await supabase
        .from('categories')
        .insert([{ name }]);

      if (error) throw error;

      await onDataChange();
    } catch (err) {
      console.error('Error creating category:', err);
      throw err;
    }
  };

  const handleEditCategory = (category) => {
    setEditingCategory(category);
    setShowEditor(true);
  };

  const handleDeleteCategory = async (categoryId) => {
    try {
      const usage = await checkCategoryUsage(categoryId);

      if (!usage.canDelete) {
        const message = `Cannot delete category "${usage.category}" because it is currently in use:\n\n` +
          (usage.itemCount > 0 ? `• Used by ${usage.itemCount} item(s)\n` : '') +
          (usage.locationCount > 0 ? `• Has ${usage.locationCount} location(s)\n` : '') +
          `\nPlease reassign or remove these dependencies before deleting the category.`;

        alert(message);
        return;
      }

      if (window.confirm(`Are you sure you want to delete the category "${usage.category}"?`)) {
        const { error } = await supabase
          .from('categories')
          .delete()
          .eq('id', categoryId);

        if (error) throw error;
  
        await onDataChange();
      }
    } catch (err) {
      console.error('Error deleting category:', err);
      alert('Error deleting category: ' + err.message);
    }
  };

  const handleCreateLocation = async (name, categoryId) => {
    try {
      const { error } = await supabase
        .from('locations')
        .insert([{ name, category_id: categoryId }]);

      if (error) throw error;

      await onDataChange();
    } catch (err) {
      console.error('Error creating location:', err);
      throw err;
    }
  };

  const handleEditLocation = (location) => {
    setEditingLocation(location);
    setShowLocationEditor(true);
  };

  const handleDeleteLocation = async (locationId) => {
    try {
      const usage = await checkLocationUsage(locationId);

      if (!usage.canModify) {
        const message = `Cannot delete location "${usage.location}" because it has count data in ${usage.countRecords} record(s) across ${usage.sessions.length} session(s).\n\n` +
          `This location will be hidden instead to preserve data integrity.`;

        if (window.confirm(message + '\n\nDo you want to hide this location?')) {
          const success = await softDeleteLocation(locationId, user.id);
          if (success) {
            await onDataChange();
            alert('Location has been hidden successfully.');
          }
        }
        return;
      }

      if (window.confirm(`Are you sure you want to delete the location "${usage.location}"? This action cannot be undone.`)) {
        const { error } = await supabase
          .from('locations')
          .delete()
          .eq('id', locationId);

        if (error) throw error;

        await onDataChange();
      }
    } catch (err) {
      console.error('Error managing location:', err);
      alert('Error managing location: ' + err.message);
    }
  };

  const handleToggleLocationVisibility = async (locationId) => {
    try {
      const usage = await checkLocationUsage(locationId);

      if (usage.isActive) {
        // Hide location
        const message = `This will hide the location "${usage.location}" from future use while preserving existing count data.\n\n` +
          `Count records: ${usage.countRecords}\n` +
          `Sessions affected: ${usage.sessions.length}\n\n` +
          `Do you want to proceed?`;

        if (window.confirm(message)) {
          const success = await softDeleteLocation(locationId, user.id);
          if (success) {
            await onDataChange();
            alert('Location has been hidden successfully.');
          }
        }
      } else {
        // Show location
        if (window.confirm(`Do you want to reactivate the location "${usage.location}"?`)) {
          const success = await reactivateLocation(locationId);
          if (success) {
            await onDataChange();
            alert('Location has been reactivated successfully.');
          }
        }
      }
    } catch (err) {
      console.error('Error toggling location visibility:', err);
      alert('Error toggling location visibility: ' + err.message);
    }
  };


  return (
    <div>
      <CategoryForm onSubmit={handleCreateCategory} />
      <LocationForm
        categories={categories}
        onSubmit={handleCreateLocation}
      />

      <div className="grid gap-6 md:grid-cols-2 mt-6">
        {categories.map((category) => {
          // Get usage information for this category
          const categoryUsage = getCategoryUsageInfo(category);

          return (
            <div key={category.id} className={`bg-white p-4 rounded-lg shadow ${categoryUsage.isInUse ? 'border-l-4 border-orange-500' : ''}`}>
              <div className="flex justify-between items-center border-b pb-2 mb-3">
                <div>
                  <h4 className="font-bold text-gray-800">{category.name}</h4>
                  {categoryUsage.isInUse && (
                    <div className="flex items-center gap-4 mt-1">
                      {categoryUsage.itemCount > 0 && (
                        <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                          {categoryUsage.itemCount} item(s)
                        </span>
                      )}
                      {categoryUsage.locationCount > 0 && (
                        <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                          {categoryUsage.locationCount} location(s)
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex space-x-2">
                  <button
                    onClick={() => handleEditCategory(category)}
                    className={`hover:text-blue-700 ${categoryUsage.isInUse ? 'text-gray-400 cursor-not-allowed' : 'text-blue-500'}`}
                    title={categoryUsage.isInUse ? 'Cannot edit category that is in use' : 'Edit Category'}
                    disabled={categoryUsage.isInUse}
                  >
                    <Edit className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDeleteCategory(category.id)}
                    className={`hover:text-red-700 ${categoryUsage.isInUse ? 'text-gray-400 cursor-not-allowed' : 'text-red-500'}`}
                    title={categoryUsage.isInUse ? 'Cannot delete category that is in use' : 'Delete Category'}
                    disabled={categoryUsage.isInUse}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            <ul className="space-y-2">
              {locations
                .filter(loc => loc.category_id === category.id)
                .map(loc => {
                  // Check if this location has count data
                  const hasCountData = loc.count_records > 0;

                  return (
                    <li key={loc.id} className={`flex justify-between items-center p-2 rounded ${!loc.is_active ? 'bg-red-50 opacity-60' : 'bg-gray-50'}`}>
                      <div className="flex-1">
                        <span className={`text-gray-700 ${!loc.is_active ? 'line-through' : ''}`}>
                          {loc.name}
                          {!loc.is_active && <span className="text-xs text-red-600 ml-2">(Hidden)</span>}
                        </span>
                        {hasCountData && (
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs bg-purple-100 text-purple-800 px-2 py-1 rounded">
                              {loc.count_records} count(s)
                            </span>
                            <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                              {loc.sessions_with_counts} session(s)
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="flex space-x-2">
                        {hasCountData ? (
                          // Location with count data - show toggle visibility button
                          <button
                            onClick={() => handleToggleLocationVisibility(loc.id)}
                            className={`p-1 rounded ${loc.is_active ? 'text-orange-500 hover:text-orange-700' : 'text-green-500 hover:text-green-700'}`}
                            title={loc.is_active ? 'Hide Location' : 'Show Location'}
                          >
                            {loc.is_active ? <X className="h-4 w-4" /> : <CheckCircle className="h-4 w-4" />}
                          </button>
                        ) : (
                          // Location without count data - show normal edit/delete buttons
                          <>
                            <button
                              onClick={() => handleEditLocation(loc)}
                              className="text-blue-500 hover:text-blue-700"
                              title="Edit Location"
                            >
                              <Edit className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => handleDeleteLocation(loc.id)}
                              className="text-red-500 hover:text-red-700"
                              title="Delete Location"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
               {locations.filter(loc => loc.category_id === category.id).length === 0 && (
                 <p className="text-gray-500 text-sm">No locations defined.</p>
               )}
             </ul>
           </div>
         );
       })}
      </div>

      {showEditor && (
        <CategoryEditor
          category={editingCategory}
          onClose={() => { setShowEditor(false); setEditingCategory(null); }}
          onSave={() => { onDataChange(); setShowEditor(false); setEditingCategory(null); }}
        />
      )}

      {showLocationEditor && (
        <LocationEditor
          location={editingLocation}
          categories={categories}
          onClose={() => { setShowLocationEditor(false); setEditingLocation(null); }}
          onSave={() => { onDataChange(); setShowLocationEditor(false); setEditingLocation(null); }}
        />
      )}
    </div>
  );
});

// Form Components (simplified for brevity)
const CategoryForm = ({ onSubmit }) => {
  const [name, setName] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(name);
    setName('');
  };

  return (
    <div className="bg-white p-4 rounded-lg shadow mb-6">
      <h3 className="text-lg font-semibold mb-3">Add New Category</h3>
      <form onSubmit={handleSubmit} className="flex gap-3">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New category name"
          className="flex-1 px-3 py-2 border border-gray-300 rounded-md"
          required
        />
        <button
          type="submit"
          className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 flex items-center justify-center space-x-2"
        >
          <Plus className="h-4 w-4" />
          <span>Add Category</span>
        </button>
      </form>
    </div>
  );
};

const LocationForm = ({ categories, onSubmit }) => {
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(name, categoryId);
    setName('');
    setCategoryId('');
  };

  return (
    <div className="bg-white p-4 rounded-lg shadow mb-6">
      <h3 className="text-lg font-semibold mb-3">Add New Location</h3>
      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="w-full sm:w-1/3 px-3 py-2 border border-gray-300 rounded-md"
          required
        >
          <option value="">Select Category</option>
          {categories.map(cat => (
            <option key={cat.id} value={cat.id}>{cat.name}</option>
          ))}
        </select>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New location name"
          className="flex-1 px-3 py-2 border border-gray-300 rounded-md"
          required
        />
        <button
          type="submit"
          className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 flex items-center justify-center space-x-2"
        >
          <Plus className="h-4 w-4" />
          <span>Add Location</span>
        </button>
      </form>
    </div>
  );
};

// User Assignment Modal Component
const UserAssignmentModal = React.memo(({ session, onClose, onSave }) => {
  const [availableUsers, setAvailableUsers] = useState([]);
  const [assignedUsers, setAssignedUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(false);

  useEffect(() => {
    if (session) {
      fetchUsers();
    }
  }, [session]);

  const fetchUsers = async () => {
    try {
      setLoading(true);

      // Fetch all users
      const { data: allUsers, error: usersError } = await supabase
        .from('profiles')
        .select('id, name, username')
        .order('name');

      if (usersError) throw usersError;

      // Fetch currently assigned users
      const { data: assigned, error: assignedError } = await supabase
        .from('session_users')
        .select('user_id')
        .eq('session_id', session.id);

      if (assignedError) throw assignedError;

      const assignedUserIds = new Set(assigned.map(a => a.user_id));

      // Separate available and assigned users
      const available = allUsers.filter(user => !assignedUserIds.has(user.id));
      const assignedList = allUsers.filter(user => assignedUserIds.has(user.id));

      setAvailableUsers(available);
      setAssignedUsers(assignedList);
    } catch (err) {
      console.error('Error fetching users:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAssignUser = async (userId) => {
    try {
      setAssigning(true);
      const { error } = await supabase
        .from('session_users')
        .insert([{ session_id: session.id, user_id: userId }]);

      if (error) throw error;

      // Update state incrementally instead of full re-fetch
      const userToMove = availableUsers.find(user => user.id === userId);
      if (userToMove) {
        setAvailableUsers(prev => prev.filter(user => user.id !== userId));
        setAssignedUsers(prev => [...prev, userToMove].sort((a, b) => a.name.localeCompare(b.name)));
      }
    } catch (err) {
      console.error('Error assigning user:', err);
    } finally {
      setAssigning(false);
    }
  };

  const handleUnassignUser = async (userId) => {
    try {
      setAssigning(true);
      const { error } = await supabase
        .from('session_users')
        .delete()
        .eq('session_id', session.id)
        .eq('user_id', userId);

      if (error) throw error;

      // Update state incrementally instead of full re-fetch
      const userToMove = assignedUsers.find(user => user.id === userId);
      if (userToMove) {
        setAssignedUsers(prev => prev.filter(user => user.id !== userId));
        setAvailableUsers(prev => [...prev, userToMove].sort((a, b) => a.name.localeCompare(b.name)));
      }
    } catch (err) {
      console.error('Error unassigning user:', err);
    } finally {
      setAssigning(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-4 border-b flex justify-between items-center">
          <h3 className="text-xl font-bold">
            Manage Users for Session: {session?.name}
          </h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="p-6 flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="spinner"></div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Available Users */}
              <div>
                <h4 className="text-lg font-semibold mb-4 text-gray-700">Available Users</h4>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {availableUsers.length === 0 ? (
                    <p className="text-gray-500 text-sm">No available users</p>
                  ) : (
                    availableUsers.map(user => (
                      <div key={user.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div>
                          <p className="font-medium text-gray-900">{user.name}</p>
                          <p className="text-sm text-gray-500">@{user.username}</p>
                        </div>
                        <button
                          onClick={() => handleAssignUser(user.id)}
                          disabled={assigning}
                          className="text-blue-600 hover:text-blue-800 disabled:opacity-50"
                          title="Assign User"
                        >
                          <UserPlus className="h-5 w-5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Assigned Users */}
              <div>
                <h4 className="text-lg font-semibold mb-4 text-gray-700">Assigned Users ({assignedUsers.length})</h4>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {assignedUsers.length === 0 ? (
                    <p className="text-gray-500 text-sm">No users assigned</p>
                  ) : (
                    assignedUsers.map(user => (
                      <div key={user.id} className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                        <div>
                          <p className="font-medium text-gray-900">{user.name}</p>
                          <p className="text-sm text-gray-500">@{user.username}</p>
                        </div>
                        <button
                          onClick={() => handleUnassignUser(user.id)}
                          disabled={assigning}
                          className="text-red-600 hover:text-red-800 disabled:opacity-50"
                          title="Unassign User"
                        >
                          <UserMinus className="h-5 w-5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
});

// Item Selection Modal Component
const ItemSelectionModal = React.memo(({ session, onClose, onSave, onDataChange }) => {
  const [availableItems, setAvailableItems] = useState([]);
  const [selectedItems, setSelectedItems] = useState([]);
  const [itemGroups, setItemGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchLoading, setSearchLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [activeTab, setActiveTab] = useState('items');
  const [selectedItemIds, setSelectedItemIds] = useState(new Set());
  const [hasMoreAvailable, setHasMoreAvailable] = useState(true);
  const [availableOffset, setAvailableOffset] = useState(0);
  const loadMoreRef = React.useRef(null);

  useEffect(() => {
    if (session) {
      fetchSelectedItems();
      fetchItemGroups();
    }
  }, [session]);

  // Load initial available items when selected items are loaded
  useEffect(() => {
    if (!loading && selectedItemIds.size >= 0 && !searchTerm.trim() && availableItems.length === 0) {
      loadInitialAvailableItems();
    }
  }, [loading]);

  // Debounced search for available items
  useEffect(() => {
    if (!searchTerm.trim()) {
      // Reset to initial state when search is cleared
      if (availableOffset > 0) {
        setAvailableItems([]);
        setAvailableOffset(0);
        setHasMoreAvailable(true);
        loadInitialAvailableItems();
      }
      return;
    }

    const timeoutId = setTimeout(() => {
      searchAvailableItems(searchTerm);
    }, 300); // 300ms debounce

    return () => clearTimeout(timeoutId);
  }, [searchTerm]);

  // Intersection Observer for infinite scroll
  useEffect(() => {
    const currentRef = loadMoreRef.current;
    if (!currentRef || searchTerm.trim()) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMoreAvailable && !loadingMore) {
          loadMoreAvailableItems();
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(currentRef);

    return () => {
      if (currentRef) {
        observer.unobserve(currentRef);
      }
    };
  }, [hasMoreAvailable, loadingMore, searchTerm, availableOffset]);

  // Fetch only selected items (full list)
  const fetchSelectedItems = async () => {
    try {
      setLoading(true);

      // Fetch currently selected items IDs
      const { data: selected, error: selectedError } = await supabase
        .from('session_items')
        .select('item_id')
        .eq('session_id', session.id);

      if (selectedError) throw selectedError;

      const itemIds = new Set(selected.map(s => s.item_id));
      setSelectedItemIds(itemIds);

      // Fetch full item details for selected items
      if (itemIds.size > 0) {
        const { data: itemsInSession, error: itemsError } = await supabase
          .from('items')
          .select('id, sku, item_code, item_name, internal_product_code, category, tags')
          .in('id', Array.from(itemIds))
          .order('item_name');

        if (itemsError) throw itemsError;
        setSelectedItems(itemsInSession || []);
      } else {
        setSelectedItems([]);
      }
    } catch (err) {
      console.error('Error fetching selected items:', err);
    } finally {
      setLoading(false);
    }
  };

  // Load initial available items (first batch)
  const loadInitialAvailableItems = async () => {
    try {
      const pageSize = 50;
      const { data: items, error } = await supabase
        .from('items')
        .select('id, sku, item_code, item_name, internal_product_code, category, tags')
        .order('item_name')
        .range(0, pageSize - 1);

      if (error) throw error;

      // Filter out items already in session
      const available = (items || []).filter(item => !selectedItemIds.has(item.id));
      setAvailableItems(available);
      setAvailableOffset(pageSize);
      setHasMoreAvailable(items && items.length === pageSize);
    } catch (err) {
      console.error('Error loading initial items:', err);
    }
  };

  // Load more available items (infinite scroll)
  const loadMoreAvailableItems = async () => {
    try {
      setLoadingMore(true);
      const pageSize = 50;
      const { data: items, error } = await supabase
        .from('items')
        .select('id, sku, item_code, item_name, internal_product_code, category, tags')
        .order('item_name')
        .range(availableOffset, availableOffset + pageSize - 1);

      if (error) throw error;

      // Filter out items already in session
      const available = (items || []).filter(item => !selectedItemIds.has(item.id));
      setAvailableItems(prev => [...prev, ...available]);
      setAvailableOffset(prev => prev + pageSize);
      setHasMoreAvailable(items && items.length === pageSize);
    } catch (err) {
      console.error('Error loading more items:', err);
    } finally {
      setLoadingMore(false);
    }
  };

  // Search available items from server (only when user types)
  const searchAvailableItems = async (searchText) => {
    try {
      setSearchLoading(true);
      const search = searchText.toLowerCase().trim();

      // Build query to search across multiple fields
      let query = supabase
        .from('items')
        .select('id, sku, item_code, item_name, internal_product_code, category, tags')
        .order('item_name')
        .limit(100); // Limit results to 100 for performance

      // Search using OR conditions
      query = query.or(
        `sku.ilike.%${search}%,` +
        `item_code.ilike.%${search}%,` +
        `item_name.ilike.%${search}%,` +
        `internal_product_code.ilike.%${search}%,` +
        `category.ilike.%${search}%`
      );

      const { data: searchResults, error } = await query;

      if (error) throw error;

      // Filter out items already in session
      const available = (searchResults || []).filter(item => !selectedItemIds.has(item.id));
      setAvailableItems(available);
    } catch (err) {
      console.error('Error searching items:', err);
    } finally {
      setSearchLoading(false);
    }
  };

  const fetchItemGroups = async () => {
    try {
      const { data: groups, error } = await supabase
        .from('item_groups')
        .select(`
          id,
          name,
          description,
          item_group_items (
            item_id,
            items (
              id,
              sku,
              item_name
            )
          )
        `)
        .order('name');

      if (error) throw error;
      setItemGroups(groups || []);
    } catch (err) {
      console.error('Error fetching item groups:', err);
    }
  };

  const handleAddGroup = async (groupId) => {
    try {
      setAssigning(true);

      // Get items from this group
      const group = itemGroups.find(g => g.id === groupId);
      if (!group || !group.item_group_items) return;

      const groupItemIds = group.item_group_items.map(gi => gi.item_id);

      if (groupItemIds.length === 0) {
        alert('This group has no items.');
        return;
      }

      // Fetch fresh from database to get accurate list of items already in session
      const { data: currentSessionItems, error: sessionError } = await supabase
        .from('session_items')
        .select('item_id')
        .eq('session_id', session.id);

      if (sessionError) throw sessionError;

      // Skip items that are already in the session (only add new ones)
      const currentSelectedIds = new Set(currentSessionItems.map(item => item.item_id));
      const newItemIds = groupItemIds.filter(id => !currentSelectedIds.has(id));

      if (newItemIds.length === 0) {
        alert(`All ${groupItemIds.length} items from "${group.name}" are already in the session.`);
        return;
      }

      // Fetch full item details from database for NEW items only
      const { data: itemsToAdd, error: fetchError } = await supabase
        .from('items')
        .select('id, sku, item_code, item_name, internal_product_code, category, tags')
        .in('id', newItemIds);

      if (fetchError) throw fetchError;

      if (!itemsToAdd || itemsToAdd.length === 0) {
        alert('Could not fetch items from this group.');
        return;
      }

      // Insert only new items to session
      const itemsToInsert = itemsToAdd.map(item => ({
        session_id: session.id,
        item_id: item.id
      }));

      const { error: insertError } = await supabase
        .from('session_items')
        .insert(itemsToInsert);

      if (insertError) throw insertError;

      // Update state: remove from available, add to selected
      setAvailableItems(prev => prev.filter(item => !newItemIds.includes(item.id)));
      setSelectedItems(prev => [...prev, ...itemsToAdd].sort((a, b) => a.item_name.localeCompare(b.item_name)));
      setSelectedItemIds(prev => new Set([...prev, ...newItemIds]));

      const skippedCount = groupItemIds.length - newItemIds.length;
      const message = skippedCount > 0
        ? `Successfully added ${itemsToAdd.length} items from "${group.name}".\n${skippedCount} items were skipped (already in session).`
        : `Successfully added ${itemsToAdd.length} items from "${group.name}" to the session.`;

      alert(message);
    } catch (err) {
      console.error('Error adding group:', err);
      alert('Error adding items from group: ' + err.message);
    } finally {
      setAssigning(false);
    }
  };

  const handleSelectItem = async (itemId) => {
    try {
      setAssigning(true);
      const { error } = await supabase
        .from('session_items')
        .insert([{ session_id: session.id, item_id: itemId }]);

      if (error) throw error;

      // Update state incrementally instead of full re-fetch
      const itemToMove = availableItems.find(item => item.id === itemId);
      if (itemToMove) {
        setAvailableItems(prev => prev.filter(item => item.id !== itemId));
        setSelectedItems(prev => [...prev, itemToMove]);
        setSelectedItemIds(prev => new Set([...prev, itemId]));
      }
    } catch (err) {
      console.error('Error selecting item:', err);
    } finally {
      setAssigning(false);
    }
  };

  const handleDeselectItem = async (itemId) => {
    try {
      setAssigning(true);
      const { error } = await supabase
        .from('session_items')
        .delete()
        .eq('session_id', session.id)
        .eq('item_id', itemId);

      if (error) throw error;

      // Update state incrementally instead of full re-fetch
      const itemToMove = selectedItems.find(item => item.id === itemId);
      if (itemToMove) {
        setSelectedItems(prev => prev.filter(item => item.id !== itemId));
        setSelectedItemIds(prev => {
          const newSet = new Set(prev);
          newSet.delete(itemId);
          return newSet;
        });
        // Add back to available items if it matches current search/view
        if (!searchTerm.trim() ||
            itemToMove.sku?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            itemToMove.item_code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            itemToMove.item_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            itemToMove.internal_product_code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            itemToMove.category?.toLowerCase().includes(searchTerm.toLowerCase())) {
          setAvailableItems(prev => [...prev, itemToMove].sort((a, b) => a.item_name.localeCompare(b.item_name)));
        }
      }
    } catch (err) {
      console.error('Error deselecting item:', err);
    } finally {
      setAssigning(false);
    }
  };

  const handleAddAllFiltered = async () => {
    if (availableItems.length === 0) return;

    try {
      setAssigning(true);
      const itemsToAdd = availableItems.map(item => ({
        session_id: session.id,
        item_id: item.id
      }));

      const { error } = await supabase
        .from('session_items')
        .insert(itemsToAdd);

      if (error) throw error;

      // Update state incrementally instead of full re-fetch
      const itemsToMove = availableItems;
      setSelectedItems(prev => [...prev, ...itemsToMove].sort((a, b) => a.item_name.localeCompare(b.item_name)));
      setSelectedItemIds(prev => new Set([...prev, ...itemsToMove.map(i => i.id)]));
      setAvailableItems([]);

      // Clear search term after adding all
      setSearchTerm('');
    } catch (err) {
      console.error('Error adding all filtered items:', err);
    } finally {
      setAssigning(false);
    }
  };

  // availableItems is already filtered (from server-side search or initial load)
  // No need for client-side filtering anymore

  const filteredGroups = itemGroups.filter(group =>
    !searchTerm.trim() ||
    group.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    group.description?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-4 border-b flex justify-between items-center">
          <h3 className="text-xl font-bold">
            Manage Items for Session: {session?.name}
          </h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200 px-4">
          <nav className="-mb-px flex space-x-4">
            <button
              onClick={() => setActiveTab('items')}
              className={`py-3 px-2 border-b-2 font-medium text-sm ${
                activeTab === 'items'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Individual Items
            </button>
            <button
              onClick={() => setActiveTab('groups')}
              className={`py-3 px-2 border-b-2 font-medium text-sm flex items-center gap-2 ${
                activeTab === 'groups'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <Layers className="h-4 w-4" />
              Item Groups
            </button>
          </nav>
        </div>

        <div className="p-6 flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="spinner"></div>
            </div>
          ) : activeTab === 'items' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Available Items */}
              <div>
                <h4 className="text-lg font-semibold mb-4 text-gray-700">Available Items</h4>
                <div className="mb-4 flex gap-2">
                  <input
                    type="text"
                    placeholder="Search items..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={handleAddAllFiltered}
                    disabled={assigning || availableItems.length === 0}
                    className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Add All ({availableItems.length})</span>
                  </button>
                </div>
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {searchLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="spinner-small"></div>
                      <span className="ml-2 text-gray-600">Searching items...</span>
                    </div>
                  ) : availableItems.length === 0 ? (
                    <p className="text-gray-500 text-sm">
                      {searchTerm ? 'No items match your search' : 'No available items'}
                    </p>
                  ) : (
                    <>
                      {availableItems.map(item => (
                        <div key={item.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                          <div>
                            <p className="font-medium text-gray-900">{item.item_name}</p>
                            <p className="text-sm text-gray-500">
                              <Hash className="h-4 w-4 inline mr-1" />
                              {item.sku}
                              <Hash className="h-4 w-4 inline mr-1 ml-2" />
                              {item.item_code}
                              <Folder className="h-4 w-4 inline mr-1 ml-2" />
                              {item.category}
                            </p>
                          </div>
                          <button
                            onClick={() => handleSelectItem(item.id)}
                            disabled={assigning}
                            className="text-green-600 hover:text-green-800 disabled:opacity-50"
                            title="Select Item"
                          >
                            <Plus className="h-5 w-5" />
                          </button>
                        </div>
                      ))}

                      {/* Infinite scroll trigger */}
                      {!searchTerm.trim() && hasMoreAvailable && (
                        <div ref={loadMoreRef} className="flex items-center justify-center py-3">
                          {loadingMore ? (
                            <>
                              <div className="spinner-small"></div>
                              <span className="ml-2 text-gray-500 text-sm">Loading more...</span>
                            </>
                          ) : (
                            <span className="text-gray-400 text-xs">Scroll for more</span>
                          )}
                        </div>
                      )}

                      {/* End of list */}
                      {!searchTerm.trim() && !hasMoreAvailable && availableItems.length > 0 && (
                        <p className="text-center text-gray-400 text-xs py-2">
                          No more items
                        </p>
                      )}

                      {/* Search result info */}
                      {searchTerm.trim() && availableItems.length === 100 && (
                        <p className="text-center text-blue-600 text-xs py-2">
                          Showing first 100 results. Refine search for more specific results.
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Selected Items */}
              <div>
                <h4 className="text-lg font-semibold mb-4 text-gray-700">Selected Items ({selectedItems.length})</h4>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {selectedItems.length === 0 ? (
                    <p className="text-gray-500 text-sm">No items selected</p>
                  ) : (
                    selectedItems.map(item => (
                      <div key={item.id} className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                        <div>
                          <p className="font-medium text-gray-900">{item.item_name}</p>
                          <p className="text-sm text-gray-500">
                            <Hash className="h-4 w-4 inline mr-1" />
                            {item.sku}
                            <Hash className="h-4 w-4 inline mr-1 ml-2" />
                            {item.item_code}
                            <Folder className="h-4 w-4 inline mr-1 ml-2" />
                            {item.category}
                          </p>
                        </div>
                        <button
                          onClick={() => handleDeselectItem(item.id)}
                          disabled={assigning}
                          className="text-red-600 hover:text-red-800 disabled:opacity-50"
                          title="Deselect Item"
                        >
                          <Trash2 className="h-5 w-5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* Item Groups Tab */
            <div>
              <div className="mb-4">
                <input
                  type="text"
                  placeholder="Search item groups..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {filteredGroups.length === 0 ? (
                <div className="text-center py-8">
                  <Layers className="h-12 w-12 text-gray-400 mx-auto mb-3" />
                  <p className="text-gray-500">
                    {searchTerm ? 'No item groups found matching your search.' : 'No item groups available. Create some in the Item Groups tab first.'}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredGroups.map(group => (
                    <div key={group.id} className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h5 className="font-semibold text-gray-900 flex items-center gap-2">
                            <Layers className="h-5 w-5 text-blue-600" />
                            {group.name}
                          </h5>
                          {group.description && (
                            <p className="text-sm text-gray-600 mt-1">{group.description}</p>
                          )}
                          <p className="text-sm text-gray-500 mt-2 flex items-center gap-1">
                            <Package className="h-4 w-4" />
                            {group.item_group_items?.length || 0} items in this group
                          </p>
                          {group.item_group_items && group.item_group_items.length > 0 && (
                            <div className="mt-2">
                              <p className="text-xs text-gray-400 mb-1">Preview:</p>
                              <div className="flex flex-wrap gap-1">
                                {group.item_group_items.slice(0, 3).map(gi => (
                                  <span key={gi.item_id} className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                                    {gi.items?.item_name}
                                  </span>
                                ))}
                                {group.item_group_items.length > 3 && (
                                  <span className="text-xs text-gray-500 px-2 py-1">
                                    +{group.item_group_items.length - 3} more
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => handleAddGroup(group.id)}
                          disabled={assigning || !group.item_group_items || group.item_group_items.length === 0}
                          className="ml-4 bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                          <Plus className="h-4 w-4" />
                          Add All
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {selectedItems.length > 0 && (
                <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg">
                  <h5 className="font-semibold text-green-900 mb-2">
                    Selected Items ({selectedItems.length})
                  </h5>
                  <p className="text-sm text-green-700">
                    {selectedItems.length} item(s) are currently added to this session. Switch to "Individual Items" tab to view or remove them.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-4 border-t flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
});

// Placeholder components for editors
// Item Group Editor Component
const ItemGroupEditor = React.memo(({ group, onClose, onSave }) => {
  const { user } = useAuth();
  const [formData, setFormData] = useState({
    name: group?.name || '',
    description: group?.description || ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const groupData = {
        name: formData.name,
        description: formData.description
      };

      if (group) {
        // Update
        const { error } = await supabase
          .from('item_groups')
          .update(groupData)
          .eq('id', group.id);
        if (error) throw error;
      } else {
        // Create
        const { error } = await supabase
          .from('item_groups')
          .insert([{
            ...groupData,
            created_by: user.id
          }]);
        if (error) throw error;
      }

      onSave();
      onClose();
    } catch (err) {
      console.error('Error saving item group:', err);
      setError(err.message || 'Failed to save item group');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-md flex flex-col">
        <div className="p-4 border-b flex justify-between items-center">
          <h3 className="text-xl font-bold">
            {group ? 'Edit Item Group' : 'Create New Item Group'}
          </h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X className="h-6 w-6" />
          </button>
        </div>
        <div className="p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Group Name *
              </label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <textarea
                name="description"
                value={formData.description}
                onChange={handleChange}
                rows="3"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Optional description for this group"
              />
            </div>

            <div className="flex justify-end space-x-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
                disabled={loading}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 flex items-center space-x-2 disabled:bg-blue-400"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <div className="spinner-small"></div>
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4" />
                    <span>{group ? 'Update' : 'Create'}</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
});

// Group Items Modal Component - Manage items in a group
const GroupItemsModal = React.memo(({ group, onClose, onSave }) => {
  const [availableItems, setAvailableItems] = useState([]);
  const [groupItems, setGroupItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchLoading, setSearchLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('available');
  const [groupItemIds, setGroupItemIds] = useState(new Set());
  const [hasMoreAvailable, setHasMoreAvailable] = useState(true);
  const [availableOffset, setAvailableOffset] = useState(0);
  const loadMoreRef = React.useRef(null);

  useEffect(() => {
    fetchGroupItems();
  }, [group]);

  // Load initial available items when group items are loaded
  useEffect(() => {
    if (!loading && groupItemIds.size >= 0 && !searchTerm.trim() && availableItems.length === 0) {
      loadInitialAvailableItems();
    }
  }, [loading]);

  // Debounced search for available items
  useEffect(() => {
    if (!searchTerm.trim()) {
      // Reset to initial state when search is cleared
      if (availableOffset > 0) {
        setAvailableItems([]);
        setAvailableOffset(0);
        setHasMoreAvailable(true);
        loadInitialAvailableItems();
      }
      return;
    }

    const timeoutId = setTimeout(() => {
      searchAvailableItems(searchTerm);
    }, 300); // 300ms debounce

    return () => clearTimeout(timeoutId);
  }, [searchTerm]);

  // Intersection Observer for infinite scroll
  useEffect(() => {
    const currentRef = loadMoreRef.current;
    if (!currentRef || searchTerm.trim()) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMoreAvailable && !loadingMore) {
          loadMoreAvailableItems();
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(currentRef);

    return () => {
      if (currentRef) {
        observer.unobserve(currentRef);
      }
    };
  }, [hasMoreAvailable, loadingMore, searchTerm, availableOffset]);

  // Fetch only group items (not all items - too heavy)
  const fetchGroupItems = async () => {
    try {
      setLoading(true);

      // Fetch items in this group with pagination
      let groupItemsData = [];
      let hasMoreGroupItems = true;
      let groupItemsStart = 0;
      const groupItemsPageSize = 1000;

      while (hasMoreGroupItems) {
        const { data: groupItemsChunk, error: groupItemsChunkError } = await supabase
          .from('item_group_items')
          .select('item_id')
          .eq('item_group_id', group.id)
          .range(groupItemsStart, groupItemsStart + groupItemsPageSize - 1);

        if (groupItemsChunkError) throw groupItemsChunkError;

        if (groupItemsChunk && groupItemsChunk.length > 0) {
          groupItemsData = [...groupItemsData, ...groupItemsChunk];
          groupItemsStart += groupItemsPageSize;
          hasMoreGroupItems = groupItemsChunk.length === groupItemsPageSize;
        } else {
          hasMoreGroupItems = false;
        }
      }

      const itemIds = new Set(groupItemsData.map(gi => gi.item_id));
      setGroupItemIds(itemIds);

      // Fetch full item details for items in group
      if (itemIds.size > 0) {
        const { data: itemsInGroup, error: itemsError } = await supabase
          .from('items')
          .select('id, sku, item_code, item_name, internal_product_code, category')
          .in('id', Array.from(itemIds))
          .order('item_name');

        if (itemsError) throw itemsError;
        setGroupItems(itemsInGroup || []);
      } else {
        setGroupItems([]);
      }
    } catch (err) {
      console.error('Error fetching group items:', err);
      alert('Error loading items: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Load initial available items (first batch)
  const loadInitialAvailableItems = async () => {
    try {
      const pageSize = 50;
      const { data: items, error } = await supabase
        .from('items')
        .select('id, sku, item_code, item_name, internal_product_code, category')
        .order('item_name')
        .range(0, pageSize - 1);

      if (error) throw error;

      // Filter out items already in group
      const available = (items || []).filter(item => !groupItemIds.has(item.id));
      setAvailableItems(available);
      setAvailableOffset(pageSize);
      setHasMoreAvailable(items && items.length === pageSize);
    } catch (err) {
      console.error('Error loading initial items:', err);
      alert('Error loading items: ' + err.message);
    }
  };

  // Load more available items (infinite scroll)
  const loadMoreAvailableItems = async () => {
    try {
      setLoadingMore(true);
      const pageSize = 50;
      const { data: items, error } = await supabase
        .from('items')
        .select('id, sku, item_code, item_name, internal_product_code, category')
        .order('item_name')
        .range(availableOffset, availableOffset + pageSize - 1);

      if (error) throw error;

      // Filter out items already in group
      const available = (items || []).filter(item => !groupItemIds.has(item.id));
      setAvailableItems(prev => [...prev, ...available]);
      setAvailableOffset(prev => prev + pageSize);
      setHasMoreAvailable(items && items.length === pageSize);
    } catch (err) {
      console.error('Error loading more items:', err);
      alert('Error loading more items: ' + err.message);
    } finally {
      setLoadingMore(false);
    }
  };

  // Search available items from server (only when user types)
  const searchAvailableItems = async (searchText) => {
    try {
      setSearchLoading(true);
      const search = searchText.toLowerCase().trim();

      // Build query to search across multiple fields
      let query = supabase
        .from('items')
        .select('id, sku, item_code, item_name, internal_product_code, category')
        .order('item_name')
        .limit(100); // Limit results to 100 for performance

      // Search using OR conditions
      query = query.or(
        `sku.ilike.%${search}%,` +
        `item_code.ilike.%${search}%,` +
        `item_name.ilike.%${search}%,` +
        `internal_product_code.ilike.%${search}%,` +
        `category.ilike.%${search}%`
      );

      const { data: searchResults, error } = await query;

      if (error) throw error;

      // Filter out items already in group
      const available = (searchResults || []).filter(item => !groupItemIds.has(item.id));
      setAvailableItems(available);
    } catch (err) {
      console.error('Error searching items:', err);
      alert('Error searching items: ' + err.message);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleAddItem = async (itemId) => {
    try {
      const { error } = await supabase
        .from('item_group_items')
        .insert([{ item_group_id: group.id, item_id: itemId }]);

      if (error) throw error;

      // Move item from available to group
      const item = availableItems.find(i => i.id === itemId);
      setAvailableItems(prev => prev.filter(i => i.id !== itemId));
      setGroupItems(prev => [...prev, item].sort((a, b) => a.item_name.localeCompare(b.item_name)));
      setGroupItemIds(prev => new Set([...prev, itemId]));
      // onSave() will be called when modal closes, not on every add
    } catch (err) {
      console.error('Error adding item to group:', err);
      alert('Error adding item: ' + err.message);
    }
  };

  const handleRemoveItem = async (itemId) => {
    try {
      const { error } = await supabase
        .from('item_group_items')
        .delete()
        .eq('item_group_id', group.id)
        .eq('item_id', itemId);

      if (error) throw error;

      // Move item from group to available (if search is active, add back to available list)
      const item = groupItems.find(i => i.id === itemId);
      setGroupItems(prev => prev.filter(i => i.id !== itemId));
      setGroupItemIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(itemId);
        return newSet;
      });

      // If there's a search term and removed item matches, add it to available items
      if (searchTerm.trim() && item) {
        const search = searchTerm.toLowerCase();
        const matchesSearch =
          item.sku?.toLowerCase().includes(search) ||
          item.item_code?.toLowerCase().includes(search) ||
          item.item_name?.toLowerCase().includes(search) ||
          item.internal_product_code?.toLowerCase().includes(search) ||
          item.category?.toLowerCase().includes(search);

        if (matchesSearch) {
          setAvailableItems(prev => [...prev, item].sort((a, b) => a.item_name.localeCompare(b.item_name)));
        }
      }
      // onSave() will be called when modal closes, not on every remove
    } catch (err) {
      console.error('Error removing item from group:', err);
      alert('Error removing item: ' + err.message);
    }
  };

  // Filter group items on client side (already loaded)
  const filteredGroupItems = groupItems.filter(item => {
    if (!searchTerm.trim()) return true;
    const search = searchTerm.toLowerCase();
    return (
      item.sku?.toLowerCase().includes(search) ||
      item.item_code?.toLowerCase().includes(search) ||
      item.item_name?.toLowerCase().includes(search) ||
      item.internal_product_code?.toLowerCase().includes(search) ||
      item.category?.toLowerCase().includes(search)
    );
  });

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-4xl flex flex-col max-h-[90vh]">
        <div className="p-4 border-b flex justify-between items-center">
          <div>
            <h3 className="text-xl font-bold">Manage Items in Group</h3>
            <p className="text-sm text-gray-600 mt-1">{group.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200 px-4">
          <nav className="-mb-px flex space-x-4">
            <button
              onClick={() => setActiveTab('available')}
              className={`py-3 px-2 border-b-2 font-medium text-sm ${
                activeTab === 'available'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Available Items {searchTerm.trim() ? `(${availableItems.length})` : ''}
            </button>
            <button
              onClick={() => setActiveTab('in-group')}
              className={`py-3 px-2 border-b-2 font-medium text-sm ${
                activeTab === 'in-group'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              In Group ({filteredGroupItems.length})
            </button>
          </nav>
        </div>

        {/* Search */}
        <div className="p-4 border-b">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search items..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="spinner"></div>
              <span className="ml-2 text-gray-600">Loading items...</span>
            </div>
          ) : (
            <div>
              {activeTab === 'available' ? (
                <div className="space-y-2">
                  {searchLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="spinner-small"></div>
                      <span className="ml-2 text-gray-600">Searching items...</span>
                    </div>
                  ) : availableItems.length === 0 && searchTerm.trim() ? (
                    <p className="text-center text-gray-500 py-8">
                      No items found matching "{searchTerm}"
                    </p>
                  ) : availableItems.length === 0 ? (
                    <p className="text-center text-gray-500 py-8">
                      No available items to add.
                    </p>
                  ) : (
                    <>
                      {/* Search info banner */}
                      {searchTerm.trim() && availableItems.length === 100 && (
                        <div className="mb-3 p-2 bg-blue-50 border border-blue-200 rounded-md text-sm text-blue-700">
                          Showing first 100 results. Refine your search for more specific results.
                        </div>
                      )}

                      {/* Items list */}
                      {availableItems.map(item => (
                        <div key={item.id} className="flex items-center justify-between p-3 border border-gray-200 rounded-md hover:bg-gray-50">
                          <div>
                            <p className="font-medium text-gray-900">{item.item_name}</p>
                            <p className="text-sm text-gray-500">
                              SKU: {item.sku} | Code: {item.item_code} | Category: {item.category}
                            </p>
                          </div>
                          <button
                            onClick={() => handleAddItem(item.id)}
                            className="bg-green-600 text-white px-3 py-1 rounded-md hover:bg-green-700 flex items-center space-x-1"
                          >
                            <Plus className="h-4 w-4" />
                            <span>Add</span>
                          </button>
                        </div>
                      ))}

                      {/* Infinite scroll trigger */}
                      {!searchTerm.trim() && hasMoreAvailable && (
                        <div ref={loadMoreRef} className="flex items-center justify-center py-4">
                          {loadingMore ? (
                            <>
                              <div className="spinner-small"></div>
                              <span className="ml-2 text-gray-600">Loading more items...</span>
                            </>
                          ) : (
                            <span className="text-gray-400 text-sm">Scroll for more items</span>
                          )}
                        </div>
                      )}

                      {/* End of list */}
                      {!searchTerm.trim() && !hasMoreAvailable && availableItems.length > 0 && (
                        <p className="text-center text-gray-400 text-sm py-4">
                          No more items to load
                        </p>
                      )}
                    </>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredGroupItems.length === 0 ? (
                    <p className="text-center text-gray-500 py-8">
                      {searchTerm ? 'No items found matching your search.' : 'No items in this group yet. Add some from the Available Items tab.'}
                    </p>
                  ) : (
                    filteredGroupItems.map(item => (
                      <div key={item.id} className="flex items-center justify-between p-3 border border-gray-200 rounded-md hover:bg-gray-50">
                        <div>
                          <p className="font-medium text-gray-900">{item.item_name}</p>
                          <p className="text-sm text-gray-500">
                            SKU: {item.sku} | Code: {item.item_code} | Category: {item.category}
                          </p>
                        </div>
                        <button
                          onClick={() => handleRemoveItem(item.id)}
                          className="bg-red-600 text-white px-3 py-1 rounded-md hover:bg-red-700 flex items-center space-x-1"
                        >
                          <X className="h-4 w-4" />
                          <span>Remove</span>
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t bg-gray-50">
          <button
            onClick={onClose}
            className="w-full bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
});

const SessionEditor = React.memo(({ session, onClose, onSave }) => {
  const { user } = useAuth();
  const [formData, setFormData] = useState({
    name: session?.name || '',
    status: session?.status || 'draft',
    sessionType: session?.is_recurring_template ? 'recurring' : session?.is_scheduled ? 'scheduled' : 'regular',
    // Time fields
    validFromTime: session?.valid_from ? new Date(session.valid_from).toTimeString().slice(0, 5) : '08:00',
    validUntilTime: session?.valid_until ? new Date(session.valid_until).toTimeString().slice(0, 5) : '17:00',
    // Scheduled session
    scheduledDate: session?.scheduled_date || '',
    // Recurring config
    recurrenceType: session?.recurring_config?.type || 'daily',
    weeklyDays: session?.recurring_config?.days || [],
    monthlyDates: session?.recurring_config?.dates || []
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const sessionData = {
        name: formData.name,
        status: formData.status
      };

      // Add recurring/scheduled fields
      if (formData.sessionType === 'recurring') {
        sessionData.is_recurring_template = true;
        sessionData.is_scheduled = false;

        // Build recurring config
        const config = { type: formData.recurrenceType };
        if (formData.recurrenceType === 'weekly') {
          config.days = formData.weeklyDays;
        } else if (formData.recurrenceType === 'monthly') {
          config.dates = formData.monthlyDates;
        }
        sessionData.recurring_config = config;

        // Set time windows (use today as placeholder date)
        const today = new Date().toISOString().split('T')[0];
        sessionData.valid_from = `${today}T${formData.validFromTime}:00`;
        sessionData.valid_until = `${today}T${formData.validUntilTime}:00`;

      } else if (formData.sessionType === 'scheduled') {
        sessionData.is_scheduled = true;
        sessionData.is_recurring_template = false;
        sessionData.scheduled_date = formData.scheduledDate;

        // Set full datetime for scheduled session
        sessionData.valid_from = `${formData.scheduledDate}T${formData.validFromTime}:00`;
        sessionData.valid_until = `${formData.scheduledDate}T${formData.validUntilTime}:00`;

      } else {
        // Regular session
        sessionData.is_recurring_template = false;
        sessionData.is_scheduled = false;
      }

      if (session) {
        // Update
        const { error: updateError } = await supabase
          .from('sessions')
          .update(sessionData)
          .eq('id', session.id);

        if (updateError) throw updateError;

        // If updating a recurring template, update future sessions
        if (session.is_recurring_template && formData.sessionType === 'recurring') {
          const { error: updateFutureError } = await supabase
            .rpc('update_future_sessions_from_template', {
              p_master_session_id: session.id
            });

          if (updateFutureError) {
            console.warn('Error updating future sessions:', updateFutureError);
          }
        }
      } else {
        // Create
        const { data: newSession, error: insertError } = await supabase
          .from('sessions')
          .insert([{
            ...sessionData,
            type: 'inventory',
            created_by: user.id
          }])
          .select()
          .single();

        if (insertError) throw insertError;

        // If recurring template, generate sessions for next 30 days
        if (formData.sessionType === 'recurring') {
          const { error: generateError } = await supabase
            .rpc('generate_recurring_sessions', {
              p_master_session_id: newSession.id,
              p_days_ahead: 30
            });

          if (generateError) {
            console.warn('Error generating recurring sessions:', generateError);
          }
        }
      }

      onSave();
      onClose();
    } catch (err) {
      console.error('Error saving session:', err);
      setError(err.message || 'Failed to save session');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const handleWeeklyDayToggle = (day) => {
    setFormData(prev => ({
      ...prev,
      weeklyDays: prev.weeklyDays.includes(day)
        ? prev.weeklyDays.filter(d => d !== day)
        : [...prev.weeklyDays, day].sort()
    }));
  };

  const handleMonthlyDateToggle = (date) => {
    setFormData(prev => ({
      ...prev,
      monthlyDates: prev.monthlyDates.includes(date)
        ? prev.monthlyDates.filter(d => d !== date)
        : [...prev.monthlyDates, date].sort((a, b) => a - b)
    }));
  };

  const weekDays = [
    { value: 0, label: 'Sun' },
    { value: 1, label: 'Mon' },
    { value: 2, label: 'Tue' },
    { value: 3, label: 'Wed' },
    { value: 4, label: 'Thu' },
    { value: 5, label: 'Fri' },
    { value: 6, label: 'Sat' }
  ];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-lg w-full max-w-2xl flex flex-col my-8">
        <div className="p-4 border-b flex justify-between items-center sticky top-0 bg-white rounded-t-lg z-10">
          <h3 className="text-xl font-bold">
            {session ? 'Edit Session' : 'Create New Session'}
          </h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X className="h-6 w-6" />
          </button>
        </div>
        <div className="p-6 overflow-y-auto">
          {error && (
            <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Session Name *
              </label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>

            {/* Session Type Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Session Type *
              </label>
              <div className="space-y-2">
                <label className="flex items-center">
                  <input
                    type="radio"
                    name="sessionType"
                    value="regular"
                    checked={formData.sessionType === 'regular'}
                    onChange={handleChange}
                    className="mr-2"
                  />
                  <span className="text-sm">Regular Session (One-time, immediate)</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="radio"
                    name="sessionType"
                    value="scheduled"
                    checked={formData.sessionType === 'scheduled'}
                    onChange={handleChange}
                    className="mr-2"
                  />
                  <span className="text-sm">Scheduled Session (One-time, future date)</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="radio"
                    name="sessionType"
                    value="recurring"
                    checked={formData.sessionType === 'recurring'}
                    onChange={handleChange}
                    className="mr-2"
                  />
                  <span className="text-sm">Recurring Template (Auto-generate daily/weekly/monthly)</span>
                </label>
              </div>
            </div>

            {/* Scheduled Session: Date */}
            {formData.sessionType === 'scheduled' && (
              <div className="p-4 bg-blue-50 rounded-lg space-y-3">
                <h4 className="font-medium text-sm text-blue-900">Scheduled Session Settings</h4>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Scheduled Date *
                  </label>
                  <input
                    type="date"
                    name="scheduledDate"
                    value={formData.scheduledDate}
                    onChange={handleChange}
                    min={new Date().toISOString().split('T')[0]}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>
              </div>
            )}

            {/* Recurring Template: Recurrence Settings */}
            {formData.sessionType === 'recurring' && (
              <div className="p-4 bg-purple-50 rounded-lg space-y-3">
                <h4 className="font-medium text-sm text-purple-900">Recurring Template Settings</h4>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Recurrence Pattern *
                  </label>
                  <select
                    name="recurrenceType"
                    value={formData.recurrenceType}
                    onChange={handleChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>

                {/* Weekly: Select Days */}
                {formData.recurrenceType === 'weekly' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Select Days *
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {weekDays.map(day => (
                        <button
                          key={day.value}
                          type="button"
                          onClick={() => handleWeeklyDayToggle(day.value)}
                          className={`px-3 py-2 rounded-md text-sm font-medium ${
                            formData.weeklyDays.includes(day.value)
                              ? 'bg-purple-600 text-white'
                              : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          {day.label}
                        </button>
                      ))}
                    </div>
                    {formData.weeklyDays.length === 0 && (
                      <p className="text-xs text-red-600 mt-1">Please select at least one day</p>
                    )}
                  </div>
                )}

                {/* Monthly: Select Dates */}
                {formData.recurrenceType === 'monthly' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Select Dates *
                    </label>
                    <div className="grid grid-cols-7 gap-1">
                      {Array.from({ length: 31 }, (_, i) => i + 1).map(date => (
                        <button
                          key={date}
                          type="button"
                          onClick={() => handleMonthlyDateToggle(date)}
                          className={`px-2 py-2 rounded text-sm font-medium ${
                            formData.monthlyDates.includes(date)
                              ? 'bg-purple-600 text-white'
                              : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          {date}
                        </button>
                      ))}
                    </div>
                    {formData.monthlyDates.length === 0 && (
                      <p className="text-xs text-red-600 mt-1">Please select at least one date</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Time Window (for scheduled and recurring) */}
            {(formData.sessionType === 'scheduled' || formData.sessionType === 'recurring') && (
              <div className="p-4 bg-green-50 rounded-lg space-y-3">
                <h4 className="font-medium text-sm text-green-900">Time Window</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Valid From (Time) *
                    </label>
                    <input
                      type="time"
                      name="validFromTime"
                      value={formData.validFromTime}
                      onChange={handleChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Valid Until (Time) *
                    </label>
                    <input
                      type="time"
                      name="validUntilTime"
                      value={formData.validUntilTime}
                      onChange={handleChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>
                </div>
                <p className="text-xs text-gray-600">
                  Sessions can only be filled between these times. Sessions will auto-close after the end time.
                </p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Status *
              </label>
              <select
                name="status"
                value={formData.status}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              >
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
                <option value="closed">Closed</option>
              </select>
            </div>

            <div className="text-sm text-gray-600 bg-gray-50 p-3 rounded">
              <p><strong>Note:</strong> User assignments and item selections for this session are managed separately after creation.</p>
              {formData.sessionType === 'recurring' && (
                <p className="mt-2"><strong>Recurring:</strong> Creating this template will auto-generate sessions for the next 30 days based on your schedule.</p>
              )}
            </div>

            <div className="flex justify-end space-x-2 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-gray-600 border rounded-md hover:bg-gray-50"
                disabled={loading}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                disabled={loading}
              >
                {loading ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
});

const ItemEditor = React.memo(({ item, categories, onClose, onSave }) => {
  const { user } = useAuth();
  const [formData, setFormData] = useState({
    sku: item?.sku || '',
    item_code: item?.item_code || '',
    item_name: item?.item_name || '',
    category: item?.category || '',
    uom: item?.uom || '',
    internal_product_code: item?.internal_product_code || '',
    tags: item?.tags?.join(', ') || ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const itemData = {
        sku: formData.sku,
        item_code: formData.item_code,
        item_name: formData.item_name,
        category: formData.category,
        uom: formData.uom,
        internal_product_code: formData.internal_product_code,
        tags: formData.tags.split(',').map(tag => tag.trim()).filter(tag => tag)
      };

      if (item) {
        // Update
        const { error } = await supabase
          .from('items')
          .update(itemData)
          .eq('id', item.id);
        if (error) throw error;
      } else {
        // Create
        const { error } = await supabase
          .from('items')
          .insert([{ ...itemData, created_by: user.id }]);
        if (error) throw error;
      }

      onSave();
      onClose();
    } catch (err) {
      console.error('Error saving item:', err);
      setError(err.message || 'Failed to save item');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white p-6 rounded-lg w-full max-w-md">
        <h3 className="text-lg font-bold mb-4">
          {item ? 'Edit Item' : 'Add New Item'}
        </h3>

        {error && (
          <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              SKU *
            </label>
            <input
              type="text"
              name="sku"
              value={formData.sku}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Item Code *
            </label>
            <input
              type="text"
              name="item_code"
              value={formData.item_code}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Item Name *
            </label>
            <input
              type="text"
              name="item_name"
              value={formData.item_name}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Category *
            </label>
            <select
              name="category"
              value={formData.category}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            >
              <option value="">Select Category</option>
              {categories.map(cat => (
                <option key={cat.id} value={cat.name}>{cat.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              UOM *
            </label>
            <input
              type="text"
              name="uom"
              value={formData.uom}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Internal Product Code
            </label>
            <input
              type="text"
              name="internal_product_code"
              value={formData.internal_product_code}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g., JI4ACO-GCAS17BK04"
              maxLength="20"
            />
            <p className="text-xs text-gray-500 mt-1">
              Maximum 20 characters, used for barcode scanning (optional)
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Tags (comma-separated)
            </label>
            <input
              type="text"
              name="tags"
              value={formData.tags}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="tag1, tag2, tag3"
            />
          </div>

          <div className="flex justify-end space-x-2 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-600 border rounded-md hover:bg-gray-50"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              disabled={loading}
            >
              {loading ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
});

const UserEditor = React.memo(({ user, onClose, onSave }) => {
  const [formData, setFormData] = useState({
    name: user?.name || '',
    username: user?.username || '',
    role: user?.role || 'user',
    status: user?.status || 'inactive'
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          name: formData.name,
          username: formData.username,
          role: formData.role,
          status: formData.status
        })
        .eq('id', user.id);

      if (error) throw error;

      onSave();
      onClose();
    } catch (err) {
      console.error('Error updating user:', err);
      setError(err.message || 'Failed to update user');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  if (!user) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white p-6 rounded-lg w-full max-w-md">
          <h3 className="text-lg font-bold mb-4">Add New User</h3>
          <p className="text-gray-600 mb-4">
            User creation is handled through the signup process. Only existing users can be edited.
          </p>
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              OK
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white p-6 rounded-lg w-full max-w-md">
        <h3 className="text-lg font-bold mb-4">Edit User</h3>

        {error && (
          <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Name *
            </label>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Username *
            </label>
            <input
              type="text"
              name="username"
              value={formData.username}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Role *
            </label>
            <select
              name="role"
              value={formData.role}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            >
              <option value="counter">Counter</option>
              <option value="admin">Admin</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Status *
            </label>
            <select
              name="status"
              value={formData.status}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            >
              <option value="inactive">Inactive</option>
              <option value="active">Active</option>
            </select>
          </div>

          <div className="flex justify-end space-x-2 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-600 border rounded-md hover:bg-gray-50"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              disabled={loading}
            >
              {loading ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
});

const CategoryEditor = React.memo(({ category, onClose, onSave }) => {
  const [formData, setFormData] = useState({
    name: category?.name || '',
    description: category?.description || ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (category) {
        // Update
        const { error } = await supabase
          .from('categories')
          .update(formData)
          .eq('id', category.id);
        if (error) throw error;
      } else {
        // Create - but handled by CategoryForm
        throw new Error('Create not implemented here');
      }

      onSave();
      onClose();
    } catch (err) {
      console.error('Error saving category:', err);
      setError(err.message || 'Failed to save category');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white p-6 rounded-lg w-full max-w-md">
        <h3 className="text-lg font-bold mb-4">Edit Category</h3>

        {error && (
          <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Name *
            </label>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              name="description"
              value={formData.description}
              onChange={handleChange}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex justify-end space-x-2 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-600 border rounded-md hover:bg-gray-50"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              disabled={loading}
            >
              {loading ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
});

const LocationEditor = React.memo(({ location, categories, onClose, onSave }) => {
  const [formData, setFormData] = useState({
    name: location?.name || '',
    category_id: location?.category_id || ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (location) {
        // Update
        const { error } = await supabase
          .from('locations')
          .update(formData)
          .eq('id', location.id);
        if (error) throw error;
      } else {
        // Create - but handled by LocationForm
        throw new Error('Create not implemented here');
      }

      onSave();
      onClose();
    } catch (err) {
      console.error('Error saving location:', err);
      setError(err.message || 'Failed to save location');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white p-6 rounded-lg w-full max-w-md">
        <h3 className="text-lg font-bold mb-4">Edit Location</h3>

        {error && (
          <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Name *
            </label>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Category *
            </label>
            <select
              name="category_id"
              value={formData.category_id}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            >
              <option value="">Select Category</option>
              {categories.map(cat => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>

          <div className="flex justify-end space-x-2 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-600 border rounded-md hover:bg-gray-50"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              disabled={loading}
            >
              {loading ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
});

export default React.memo(AdminDashboard);