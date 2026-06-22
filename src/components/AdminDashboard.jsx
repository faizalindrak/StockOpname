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
  Layers,
  Activity
} from 'lucide-react';
import { supabase, checkCategoryUsage, checkLocationUsage, softDeleteLocation, reactivateLocation } from '../lib/supabase';
import TagManagement from './TagManagement';
import * as XLSX from 'xlsx';
import SessionsManager from './admin/SessionsManager.jsx';
import ItemGroupsManager from './admin/ItemGroupsManager.jsx';
import ItemsManager from './admin/ItemsManager.jsx';
import UsersManager from './admin/UsersManager.jsx';
import CategoriesManager from './admin/CategoriesManager.jsx';
import LiveMonitoring from './admin/LiveMonitoring.jsx';

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
    { id: 'live-monitoring', label: 'Live Monitor', icon: Activity, path: '/admin/live-monitoring' },
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

        {/*
          Live Monitoring is self-contained (fetches its own data via WebSocket
          realtime) so it renders outside the shared dataLoading gate. All other
          tabs depend on the cached dashboard data and remain gated.
        */}
        <Routes>
          <Route path="live-monitoring" element={<LiveMonitoring />} />
        </Routes>

        {activeTab !== 'live-monitoring' && (
          dataLoading ? (
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
          )
        )}
      </main>
    </div>
  );
};

export default React.memo(AdminDashboard);
