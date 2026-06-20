import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import {
  Package, Users, Building, ClipboardList, Plus, Search, Edit, Trash2, Save, X,
  ChevronDown, AlertCircle, Calendar, Clock, UserPlus, UserMinus, Download,
  CheckCircle, Tag, Hash, Code, Folder, Layers
} from 'lucide-react';
import { supabase, checkCategoryUsage, checkLocationUsage, softDeleteLocation, reactivateLocation } from '../../../lib/supabase';
import * as XLSX from 'xlsx';
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

export default ItemGroupEditor;
