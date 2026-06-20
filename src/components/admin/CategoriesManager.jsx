import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  Package, Users, Building, ClipboardList, Plus, Search, Edit, Trash2, Save, X,
  ChevronDown, AlertCircle, Calendar, Clock, UserPlus, UserMinus, Download,
  CheckCircle, Tag, Hash, Code, Folder, Layers
} from 'lucide-react';
import { supabase, checkCategoryUsage, checkLocationUsage, softDeleteLocation, reactivateLocation } from '../../lib/supabase';
import * as XLSX from 'xlsx';
import CategoryEditor from './modals/CategoryEditor.jsx';
import LocationEditor from './modals/LocationEditor.jsx';
import CategoryForm from './forms/CategoryForm.jsx';
import LocationForm from './forms/LocationForm.jsx';
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

export default CategoriesManager;
