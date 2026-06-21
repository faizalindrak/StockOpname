import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  Package, Users, Building, ClipboardList, Plus, Search, Edit, Trash2, Save, X,
  ChevronDown, AlertCircle, Calendar, Clock, UserPlus, UserMinus, Download,
  CheckCircle, Tag, Hash, Code, Folder, Layers
} from 'lucide-react';
import { supabase, checkCategoryUsage, checkLocationUsage, softDeleteLocation, reactivateLocation } from '../../lib/supabase';
import * as XLSX from 'xlsx';
import ItemEditor from './modals/ItemEditor.jsx';
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

export default ItemsManager;
