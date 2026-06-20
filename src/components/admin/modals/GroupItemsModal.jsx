import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import {
  Package, Users, Building, ClipboardList, Plus, Search, Edit, Trash2, Save, X,
  ChevronDown, AlertCircle, Calendar, Clock, UserPlus, UserMinus, Download,
  CheckCircle, Tag, Hash, Code, Folder, Layers
} from 'lucide-react';
import { supabase, checkCategoryUsage, checkLocationUsage, softDeleteLocation, reactivateLocation } from '../../../lib/supabase';
import * as XLSX from 'xlsx';
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


export default GroupItemsModal;
