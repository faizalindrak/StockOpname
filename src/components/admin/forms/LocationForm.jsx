import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import {
  Package, Users, Building, ClipboardList, Plus, Search, Edit, Trash2, Save, X,
  ChevronDown, AlertCircle, Calendar, Clock, UserPlus, UserMinus, Download,
  CheckCircle, Tag, Hash, Code, Folder, Layers
} from 'lucide-react';
import { supabase, checkCategoryUsage, checkLocationUsage, softDeleteLocation, reactivateLocation } from '../../../lib/supabase';
import * as XLSX from 'xlsx';
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

export default LocationForm;
