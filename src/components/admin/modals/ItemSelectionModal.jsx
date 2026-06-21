import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import {
  Package, Users, Building, ClipboardList, Plus, Search, Edit, Trash2, Save, X,
  ChevronDown, AlertCircle, Calendar, Clock, UserPlus, UserMinus, Download,
  CheckCircle, Tag, Hash, Code, Folder, Layers
} from 'lucide-react';
import { supabase, checkCategoryUsage, checkLocationUsage, softDeleteLocation, reactivateLocation } from '../../../lib/supabase';
import * as XLSX from 'xlsx';
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

export default ItemSelectionModal;
