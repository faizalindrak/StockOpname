import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import {
  Package, Users, Building, ClipboardList, Plus, Search, Edit, Trash2, Save, X,
  ChevronDown, AlertCircle, Calendar, Clock, UserPlus, UserMinus, Download,
  CheckCircle, Tag, Hash, Code, Folder, Layers
} from 'lucide-react';
import { supabase, checkCategoryUsage, checkLocationUsage, softDeleteLocation, reactivateLocation } from '../../../lib/supabase';
import * as XLSX from 'xlsx';
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


export default CategoryForm;
