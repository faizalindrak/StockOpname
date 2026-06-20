import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import {
  Package, Users, Building, ClipboardList, Plus, Search, Edit, Trash2, Save, X,
  ChevronDown, AlertCircle, Calendar, Clock, UserPlus, UserMinus, Download,
  CheckCircle, Tag, Hash, Code, Folder, Layers
} from 'lucide-react';
import { supabase, checkCategoryUsage, checkLocationUsage, softDeleteLocation, reactivateLocation } from '../../../lib/supabase';
import * as XLSX from 'xlsx';
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


export default ItemEditor;
