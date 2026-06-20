import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Plus, Filter, AlertTriangle, TrendingUp, Clock, CheckCircle, Edit, Download, Home, LogOut, LayoutList, LayoutGrid, QrCode, X, Menu, History } from 'lucide-react';
import StatusModal from './StatusModal';
import StatusList from './StatusList';
import BulkFollowUpModal from './BulkFollowUpModal';
import KanbanBoard from './KanbanBoard';
import ScanModal from './ScanModal';
import { supabase } from '../lib/supabase';
import { isMobileDevice } from '../lib/deviceDetection';
import writeXlsxFile from 'write-excel-file';

const ReportStatus = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('all');
  const [viewMode, setViewMode] = useState('list'); // 'list' or 'kanban'
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [statusType, setStatusType] = useState('kritis'); // 'kritis' or 'over'
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterDate, setFilterDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedItems, setSelectedItems] = useState([]);
  const [isBulkStatusModalOpen, setIsBulkStatusModalOpen] = useState(false);
  const [showScanModal, setShowScanModal] = useState(false);
  const [scannedItem, setScannedItem] = useState(null);
  const [toast, setToast] = useState({ show: false, message: '', type: '' }); // type: 'success' | 'error' | 'warning'
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // Refs to store subscriptions
  const reportStatusSubscription = useRef(null);
  const profilesSubscription = useRef(null);
  const itemsSubscription = useRef(null);
  const menuRef = useRef(null);

  // Auto-hide toast after 4 seconds
  useEffect(() => {
    if (toast.show) {
      const timer = setTimeout(() => {
        setToast({ show: false, message: '', type: '' });
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [toast.show]);

  // Handle click outside menu to close it
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsMenuOpen(false);
      }
    };

    if (isMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isMenuOpen]);

  // Fetch reports on component mount and when filter changes
  useEffect(() => {
    fetchReports();

    // Set up real-time subscriptions
    setupRealtimeSubscriptions();

    // Cleanup function to unsubscribe when component unmounts
    return () => {
      cleanupSubscriptions();
    };
  }, [filterDate]);
  
  // Setup real-time subscriptions
  const setupRealtimeSubscriptions = () => {
    // Subscribe to report_status_raw_mat table changes
    reportStatusSubscription.current = supabase
      .channel('report_status_changes')
      .on(
        'postgres_changes',
        {
          event: '*', // Listen to all changes (INSERT, UPDATE, DELETE)
          schema: 'public',
          table: 'report_status_raw_mat',
          filter: `date_input=eq.${filterDate}`
        },
        (payload) => {
          console.log('Report status change received:', payload);
          // Refresh reports when any change occurs
          fetchReports();
        }
      )
      .subscribe();
      
    // Subscribe to profiles table changes (for user name updates)
    profilesSubscription.current = supabase
      .channel('profiles_changes')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles'
        },
        (payload) => {
          console.log('Profile change received:', payload);
          // Refresh reports to get updated user names
          fetchReports();
        }
      )
      .subscribe();
      
    // Subscribe to items table changes (for category updates)
    itemsSubscription.current = supabase
      .channel('items_changes')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'items'
        },
        (payload) => {
          console.log('Items change received:', payload);
          // Refresh reports to get updated categories
          fetchReports();
        }
      )
      .subscribe();
  };
  
  // Cleanup subscriptions
  const cleanupSubscriptions = () => {
    if (reportStatusSubscription.current) {
      supabase.removeChannel(reportStatusSubscription.current);
      reportStatusSubscription.current = null;
    }
    
    if (profilesSubscription.current) {
      supabase.removeChannel(profilesSubscription.current);
      profilesSubscription.current = null;
    }
    
    if (itemsSubscription.current) {
      supabase.removeChannel(itemsSubscription.current);
      itemsSubscription.current = null;
    }
  };

  const fetchReports = async () => {
    try {
      setLoading(true);

      // Fetch reports for the selected date
      const { data: dateReports, error: dateError } = await supabase
        .from('report_status_raw_mat')
        .select('*')
        .eq('date_input', filterDate)
        .order('created_at', { ascending: false });

      if (dateError) throw dateError;

      // Fetch all open and on_progress reports (regardless of date)
      const { data: activeReports, error: activeError } = await supabase
        .from('report_status_raw_mat')
        .select('*')
        .in('follow_up_status', ['open', 'on_progress'])
        .neq('date_input', filterDate) // Exclude the ones already in dateReports
        .order('created_at', { ascending: false });

      if (activeError) throw activeError;

      // Combine both datasets
      const data = [...(dateReports || []), ...(activeReports || [])];

      // Get unique SKUs and internal product codes from reports
      const skuCodes = [...new Set((data || []).map(r => r.sku).filter(Boolean))];
      const internalCodes = [...new Set((data || []).map(r => r.internal_product_code).filter(Boolean))];

      // Fetch items data to get categories
      let categoryMap = {};
      if (skuCodes.length > 0 || internalCodes.length > 0) {
        let itemsQuery = supabase.from('items').select('sku, internal_product_code, category');

        // Build OR condition for matching either SKU or internal product code
        const conditions = [];
        if (skuCodes.length > 0) {
          conditions.push(`sku.in.(${skuCodes.map(s => `"${s}"`).join(',')})`);
        }
        if (internalCodes.length > 0) {
          conditions.push(`internal_product_code.in.(${internalCodes.map(c => `"${c}"`).join(',')})`);
        }

        if (conditions.length > 0) {
          const { data: itemsData, error: itemsError } = await itemsQuery.or(conditions.join(','));
          if (!itemsError && itemsData) {
            itemsData.forEach(item => {
              if (item.sku) categoryMap[item.sku] = item.category;
              if (item.internal_product_code) categoryMap[item.internal_product_code] = item.category;
            });
          }
        }
      }

      // Map user_report and user_follow_up UUIDs to profile full names
      const userIds = [...new Set(
        (data || []).flatMap(r => [r.user_report, r.user_follow_up]).filter(Boolean)
      )];
      let profileMap = {};
      if (userIds.length > 0) {
        const { data: profilesData, error: profilesError } = await supabase
          .from('profiles')
          .select('id, name')
          .in('id', userIds);
        if (!profilesError && profilesData) {
          profilesData.forEach(p => { profileMap[p.id] = p.name; });
        }
      }

      const enriched = (data || []).map(r => ({
        ...r,
        category: categoryMap[r.sku] || categoryMap[r.internal_product_code] || 'Unknown',
        user_report_name: profileMap[r.user_report] || null,
        user_follow_up_name: profileMap[r.user_follow_up] || null
      }));

      setReports(enriched);
    } catch (error) {
      console.error('Error fetching reports:', error);
    } finally {
      setLoading(false);
    }
  };

  const showToast = (message, type = 'success') => {
    setToast({ show: true, message, type });
  };

  const handleAddStatus = (type) => {
    setStatusType(type);
    setScannedItem(null); // Clear scanned item when manually adding
    setIsStatusModalOpen(true);
  };

  const handleScanSuccess = async (parsedCode, originalScan, showError) => {
    try {
      // Find item from database by internal_product_code
      const { data: itemData, error } = await supabase
        .from('items')
        .select('id, sku, item_code, item_name, internal_product_code')
        .eq('internal_product_code', parsedCode)
        .single();

      if (error || !itemData) {
        console.log('Scanned code not found in items:', parsedCode);
        // Show error in scan modal instead of closing it
        showError(`Item dengan kode ${parsedCode} tidak ditemukan di database`);
        return;
      }

      // Check if SKU is already active
      // Use case-insensitive and trimmed comparison
      const activeSkus = [
        ...new Set(
          reports
            .filter(r => r.follow_up_status === 'open' || r.follow_up_status === 'on_progress')
            .map(r => r.sku)
            .filter(Boolean)
        )
      ];

      // Normalize SKUs for comparison (case-insensitive and trimmed)
      const normalizedActiveSkus = activeSkus.map(sku => (sku || '').toString().trim().toLowerCase());
      const scannedSku = (itemData.sku || '').toString().trim().toLowerCase();

      if (normalizedActiveSkus.includes(scannedSku)) {
        // Show error in scan modal instead of closing it
        showError(`SKU ${itemData.sku} sudah ada dalam status Open/On Progress`);
        return;
      }

      // Set scanned item and close scan modal
      setScannedItem(itemData);
      setShowScanModal(false);

      // Open status modal - user will select kritis/over
      // For now, we'll default to kritis, but user can change in modal
      setStatusType('kritis');
      setIsStatusModalOpen(true);
    } catch (error) {
      console.error('Error fetching scanned item:', error);
      // Show error in scan modal instead of closing it
      showError('Terjadi kesalahan saat memproses scan');
    }
  };

  const handleScanError = (error) => {
    console.error('Scan error:', error);
    // Error is already handled in ScanModal component
  };

  const handleStatusSubmit = async (formData) => {
    console.log('handleStatusSubmit called with:', formData);

    // Track if this was a scanned item submission
    const wasScannedItem = scannedItem !== null;
    const itemName = formData.item_name;
    const statusType = formData.inventory_status;

    try {
      const { data, error } = await supabase
        .from('report_status_raw_mat')
        .insert([{
          ...formData,
          user_report: user.id,
          date_input: filterDate // Use the selected filter date
          // inventory_status is already included in formData from StatusModal
        }])
        .select();

      if (error) {
        console.error('Supabase error:', error);
        showToast(`Gagal menyimpan report: ${error.message}`, 'error');
        throw error;
      }

      console.log('Insert successful:', data);

      // Show success toast
      showToast(
        `Report ${statusType?.toUpperCase()} berhasil ditambahkan: ${itemName}`,
        'success'
      );

      // Refresh reports
      fetchReports();
      setIsStatusModalOpen(false);
      setScannedItem(null); // Clear scanned item after successful submit

      // If this was from a scanned item, open scan modal again for next scan
      if (wasScannedItem) {
        // Small delay to ensure StatusModal is fully closed first
        setTimeout(() => {
          setShowScanModal(true);
        }, 200);
      }
    } catch (error) {
      console.error('Error adding status report:', error);
      throw error; // Re-throw error so modal can handle it
    }
  };


  const handleSelectionChange = (itemId, isSelected) => {
    if (isSelected) {
      setSelectedItems(prev => [...prev, itemId]);
    } else {
      setSelectedItems(prev => prev.filter(id => id !== itemId));
    }
  };

  const handleBulkStatusUpdate = async (newStatus) => {
    try {
      const { data, error } = await supabase
        .from('report_status_raw_mat')
        .update({
          follow_up_status: newStatus,
          user_follow_up: user.id
        })
        .in('id', selectedItems)
        .select();

      if (error) throw error;

      // Refresh reports and clear selection
      fetchReports();
      setSelectedItems([]);
      setIsBulkStatusModalOpen(false);
    } catch (error) {
      console.error('Error updating bulk follow up status:', error);
      throw error;
    }
  };

  const handleKanbanStatusUpdate = async (itemId, newStatus) => {
    // Optimistic update: Update local state immediately
    const previousReports = [...reports];
    setReports(prevReports =>
      prevReports.map(report =>
        report.id === itemId
          ? { ...report, follow_up_status: newStatus, user_follow_up: user.id }
          : report
      )
    );

    try {
      const { data, error } = await supabase
        .from('report_status_raw_mat')
        .update({
          follow_up_status: newStatus,
          user_follow_up: user.id
        })
        .eq('id', itemId)
        .select();

      if (error) throw error;

      // Don't refresh - optimistic update already applied
    } catch (error) {
      console.error('Error updating follow up status:', error);
      // Revert to previous state on error
      setReports(previousReports);
      throw error;
    }
  };

  const clearSelection = () => {
    setSelectedItems([]);
  };

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      // ignore
    } finally {
      navigate('/');
    }
  };

  const handleDownloadReport = async () => {
    try {
      // Count reports by date and status
      const dateFilteredCount = reports.filter(r => r.date_input === filterDate).length;
      const activeFromOtherDatesCount = reports.filter(
        r => r.date_input !== filterDate && (r.follow_up_status === 'open' || r.follow_up_status === 'on_progress')
      ).length;

      const schema = [
        { column: 'Date', type: String, value: r => r.date_input, width: 12 },
        { column: 'SKU', type: String, value: r => r.sku, width: 8 },
        { column: 'Internal Product Code', type: String, value: r => r.internal_product_code, width: 22 },
        { column: 'Item Name', type: String, value: r => r.item_name, width: 40 },
        { column: 'Category', type: String, value: r => (r.category || ''), width: 20 },
        { column: 'Inventory Status', type: String, value: r => r.inventory_status?.toUpperCase(), width: 16 },
        { column: 'Remarks', type: String, value: r => (r.remarks || ''), width: 40 },
        { column: 'Qty', type: Number, value: r => (typeof r.qty === 'number' ? r.qty : undefined), width: 10 },
        { column: 'Follow Up Status', type: String, value: r => r.follow_up_status, width: 18 },
        { column: 'Created By', type: String, value: r => (r.user_report_name || ''), width: 14 },
        { column: 'Updated By', type: String, value: r => (r.user_follow_up_name || ''), width: 14 },
        { column: 'Created At', type: String, value: r => new Date(r.created_at).toLocaleString('id-ID', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }), width: 22 },
        { column: 'Updated At', type: String, value: r => new Date(r.updated_at).toLocaleString('id-ID', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }), width: 22 },
      ];

      // Generate filename that reflects the data content
      const fileName = activeFromOtherDatesCount > 0
        ? `report_status_${filterDate}_plus_active.xlsx`
        : `report_status_${filterDate}.xlsx`;

      const sheetName = activeFromOtherDatesCount > 0
        ? `${filterDate}+Active`
        : `Reports_${filterDate}`;

      await writeXlsxFile(reports || [], {
        schema,
        fileName: fileName,
        sheet: sheetName,
      });

      // Show success message with details
      const message = activeFromOtherDatesCount > 0
        ? `Download berhasil!\n\n` +
          `- Report tanggal ${filterDate}: ${dateFilteredCount} items\n` +
          `- Report aktif (open/on progress) dari tanggal lain: ${activeFromOtherDatesCount} items\n` +
          `- Total: ${reports.length} items`
        : `Download berhasil! Total: ${reports.length} items`;

      alert(message);
    } catch (err) {
      console.error('Error generating Excel:', err);
      alert('Failed to download Excel report.');
    }
  };

  // Filter reports based on active tab
  const filteredReports = reports.filter(report => {
    if (activeTab === 'all') return true;
    return report.follow_up_status === activeTab;
  });

  // Group reports by follow up status for display
  const groupedReports = {
    open: reports.filter(r => r.follow_up_status === 'open'),
    on_progress: reports.filter(r => r.follow_up_status === 'on_progress'),
    closed: reports.filter(r => r.follow_up_status === 'closed')
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'kritis':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-600 text-white">
            Critical
          </span>
        );
      case 'over':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-800 text-white">
            Over
          </span>
        );
      default:
        return null;
    }
  };

  const getFollowUpIcon = (status) => {
    switch (status) {
      case 'open':
        return <Clock className="h-4 w-4 text-blue-500" />;
      case 'on_progress':
        return <Clock className="h-4 w-4 text-yellow-500" />;
      case 'closed':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <div className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-3">
            <div className="flex items-center gap-3">
              <div className="inline-flex items-center justify-center w-10 h-10 bg-blue-100 rounded-full">
                <AlertTriangle className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Report Status Raw Mat</h1>
                <p className="text-gray-600">Monitor and manage raw material inventory status</p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-gray-600 hidden sm:block">
                Welcome, {user?.name || user?.email}
              </span>
              <button
                onClick={() => navigate('/home')}
                className="text-blue-600 hover:text-blue-800"
                title="Go to Home"
              >
                <Home className="h-5 w-5" />
              </button>
              <button
                onClick={handleLogout}
                className="text-red-600 hover:text-red-800 flex items-center space-x-1"
                title="Logout"
              >
                <LogOut className="h-5 w-5" />
                <span className="hidden sm:block">Logout</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto pt-3 pb-8 sm:px-6 lg:px-8">
        <div className="px-4 py-3 sm:px-0">
          {/* Action Buttons + Date Filter */}
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <button
              onClick={() => handleAddStatus('kritis')}
              className="bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700 flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Kritis
            </button>
            <button
              onClick={() => handleAddStatus('over')}
              className="bg-purple-800 text-white px-4 py-2 rounded-md hover:bg-purple-900 flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Over
            </button>

            {isMobileDevice() && (
              <button
                onClick={() => setShowScanModal(true)}
                className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 flex items-center gap-2"
                title="Scan QR Code"
              >
                <QrCode className="h-4 w-4" />
                <span>Scan</span>
              </button>
            )}

            {/* Hamburger Menu */}
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                className="bg-gray-600 text-white px-4 py-2 rounded-md hover:bg-gray-700 flex items-center gap-2"
                title="Menu"
              >
                <Menu className="h-5 w-5" />
                <span className="hidden sm:inline">Menu</span>
              </button>

              {/* Dropdown Menu */}
              {isMenuOpen && (
                <div className="absolute left-0 mt-2 w-48 bg-white rounded-md shadow-lg py-1 z-50 border border-gray-200">
                  <button
                    onClick={() => {
                      navigate('/history');
                      setIsMenuOpen(false);
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                  >
                    <History className="h-4 w-4" />
                    History
                  </button>
                  <button
                    onClick={() => {
                      handleDownloadReport();
                      setIsMenuOpen(false);
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                  >
                    <Download className="h-4 w-4" />
                    Download Report
                  </button>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-gray-500" />
              <input
                type="date"
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
                className="bg-gray-100 text-gray-700 px-3 py-2 rounded-md hover:bg-gray-200 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
              />
            </div>
            
            {/* View Toggle */}
            <div className="flex items-center bg-gray-100 rounded-md p-1">
              <button
                onClick={() => setViewMode('list')}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  viewMode === 'list'
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <LayoutList className="h-4 w-4" />
                List
              </button>
              <button
                onClick={() => setViewMode('kanban')}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  viewMode === 'kanban'
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <LayoutGrid className="h-4 w-4" />
                Kanban
              </button>
            </div>
          </div>

          {/* Bulk Selection Actions */}
          {selectedItems.length > 0 && (
            <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-blue-900">
                    {selectedItems.length} item{selectedItems.length !== 1 ? 's' : ''} selected
                  </span>
                  <button
                    onClick={clearSelection}
                    className="text-xs text-blue-600 hover:text-blue-800 underline"
                  >
                    Clear selection
                  </button>
                </div>
                <button
                  onClick={() => setIsBulkStatusModalOpen(true)}
                  className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 flex items-center gap-2"
                >
                  <Edit className="h-4 w-4" />
                  Change Status
                </button>
              </div>
            </div>
          )}

          {/* Date filter moved next to action buttons */}

          {/* Status Tabs - Only show in list view */}
          {viewMode === 'list' && (
            <div className="mb-6">
              <div className="border-b border-gray-200">
                <nav className="-mb-px flex space-x-8">
                  {[
                    { key: 'all', label: 'All Status', count: reports.length },
                    { key: 'open', label: 'Open', count: groupedReports.open.length },
                    { key: 'on_progress', label: 'On Progress', count: groupedReports.on_progress.length },
                    { key: 'closed', label: 'Closed', count: groupedReports.closed.length }
                  ].map((tab) => (
                    <button
                      key={tab.key}
                      onClick={() => setActiveTab(tab.key)}
                      className={`py-2 px-1 border-b-2 font-medium text-sm ${
                        activeTab === tab.key
                          ? 'border-blue-500 text-blue-600'
                          : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                      }`}
                    >
                      {tab.label} ({tab.count})
                    </button>
                  ))}
                </nav>
              </div>
            </div>
          )}

          {/* Loading State */}
          {loading ? (
            <div className="text-center py-8">
              <div className="inline-flex items-center px-4 py-2 font-semibold leading-6 text-sm shadow rounded-md text-blue-500 bg-white transition ease-in-out duration-150">
                Loading...
              </div>
            </div>
          ) : (
            /* Status Lists or Kanban Board */
            viewMode === 'list' ? (
              <div className="space-y-6">
                {activeTab === 'all' || activeTab === 'open' ? (
                  <StatusList
                    title="Open Status"
                    items={groupedReports.open}
                    getStatusIcon={getStatusIcon}
                    getFollowUpIcon={getFollowUpIcon}
                    emptyMessage="No open status reports"
                    selectedItems={selectedItems}
                    onSelectionChange={handleSelectionChange}
                  />
                ) : null}

                {activeTab === 'all' || activeTab === 'on_progress' ? (
                  <StatusList
                    title="On Progress Status"
                    items={groupedReports.on_progress}
                    getStatusIcon={getStatusIcon}
                    getFollowUpIcon={getFollowUpIcon}
                    emptyMessage="No on progress status reports"
                    selectedItems={selectedItems}
                    onSelectionChange={handleSelectionChange}
                  />
                ) : null}

                {activeTab === 'all' || activeTab === 'closed' ? (
                  <StatusList
                    title="Closed Status"
                    items={groupedReports.closed}
                    getStatusIcon={getStatusIcon}
                    getFollowUpIcon={getFollowUpIcon}
                    emptyMessage="No closed status reports"
                    selectedItems={selectedItems}
                    onSelectionChange={handleSelectionChange}
                  />
                ) : null}
              </div>
            ) : (
              <KanbanBoard
                groupedReports={groupedReports}
                getStatusIcon={getStatusIcon}
                getFollowUpIcon={getFollowUpIcon}
                onStatusUpdate={handleKanbanStatusUpdate}
              />
            )
          )}
        </div>
      </main>

      {/* Modals */}
      <StatusModal
        isOpen={isStatusModalOpen}
        onClose={() => {
          setIsStatusModalOpen(false);
          setScannedItem(null); // Clear scanned item when modal closes
        }}
        onSubmit={handleStatusSubmit}
        statusType={statusType}
        activeSkus={[...new Set(
          reports
            .filter(r =>
              (r.follow_up_status === 'open' || r.follow_up_status === 'on_progress') &&
              r.date_input === filterDate // Only filter SKUs active on the current selected date
            )
            .map(r => r.sku)
            .filter(Boolean)
        )]}
        scannedItem={scannedItem}
      />

      <BulkFollowUpModal
        isOpen={isBulkStatusModalOpen}
        onClose={() => {
          setIsBulkStatusModalOpen(false);
        }}
        onSubmit={handleBulkStatusUpdate}
        selectedItems={selectedItems}
        reports={reports}
      />

      {/* Scan Modal */}
      <ScanModal
        isOpen={showScanModal}
        onClose={() => setShowScanModal(false)}
        onScanSuccess={handleScanSuccess}
        onScanError={handleScanError}
      />

      {/* Toast Notification */}
      {toast.show && (
        <div className="fixed bottom-4 right-4 z-50 transition-all duration-300 ease-in-out">
          <div
            className={`max-w-md rounded-lg shadow-lg p-4 flex items-start gap-3 ${
              toast.type === 'success'
                ? 'bg-green-50 border border-green-200'
                : toast.type === 'error'
                ? 'bg-red-50 border border-red-200'
                : toast.type === 'warning'
                ? 'bg-yellow-50 border border-yellow-200'
                : 'bg-blue-50 border border-blue-200'
            }`}
          >
            <div className="flex-shrink-0">
              {toast.type === 'success' && (
                <CheckCircle className="h-5 w-5 text-green-600" />
              )}
              {toast.type === 'error' && (
                <AlertTriangle className="h-5 w-5 text-red-600" />
              )}
              {toast.type === 'warning' && (
                <AlertTriangle className="h-5 w-5 text-yellow-600" />
              )}
            </div>
            <div className="flex-1">
              <p
                className={`text-sm font-medium ${
                  toast.type === 'success'
                    ? 'text-green-800'
                    : toast.type === 'error'
                    ? 'text-red-800'
                    : toast.type === 'warning'
                    ? 'text-yellow-800'
                    : 'text-blue-800'
                }`}
              >
                {toast.message}
              </p>
            </div>
            <button
              onClick={() => setToast({ show: false, message: '', type: '' })}
              className={`flex-shrink-0 ${
                toast.type === 'success'
                  ? 'text-green-400 hover:text-green-600'
                  : toast.type === 'error'
                  ? 'text-red-400 hover:text-red-600'
                  : toast.type === 'warning'
                  ? 'text-yellow-400 hover:text-yellow-600'
                  : 'text-blue-400 hover:text-blue-600'
              }`}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReportStatus;