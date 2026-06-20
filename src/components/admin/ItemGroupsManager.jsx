import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  Package, Users, Building, ClipboardList, Plus, Search, Edit, Trash2, Save, X,
  ChevronDown, AlertCircle, Calendar, Clock, UserPlus, UserMinus, Download,
  CheckCircle, Tag, Hash, Code, Folder, Layers
} from 'lucide-react';
import { supabase, checkCategoryUsage, checkLocationUsage, softDeleteLocation, reactivateLocation } from '../../lib/supabase';
import * as XLSX from 'xlsx';
import ItemGroupEditor from './modals/ItemGroupEditor.jsx';
import GroupItemsModal from './modals/GroupItemsModal.jsx';
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

export default ItemGroupsManager;
