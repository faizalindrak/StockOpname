import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Search,
  QrCode,
  ChevronLeft,
  LogOut,
  Home,
  CheckCircle,
  XCircle,
  MapPin,
  Package,
  Save,
  X,
  Download,
  ChevronDown,
  ChevronUp,
  Tag,
  Calculator,
  Bookmark
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { isMobileDevice } from '../lib/deviceDetection';
import CalculatorComponent from './Calculator';
import ScanModal from './ScanModal';

const ItemsList = () => {
  const { user } = useAuth();
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState({});
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [showCountModal, setShowCountModal] = useState(false);
  const [showCalculationPopup, setShowCalculationPopup] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [countLocation, setCountLocation] = useState('');
  const [countQuantity, setCountQuantity] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [expandedItems, setExpandedItems] = useState(new Set());
  const [isEditing, setIsEditing] = useState(false);
  const [selectedCountId, setSelectedCountId] = useState(null);
  const [lastSelectedLocation, setLastSelectedLocation] = useState('');
  const [categories, setCategories] = useState([]);
  const [calculatedResult, setCalculatedResult] = useState(0);
  const [calculationError, setCalculationError] = useState(null);
  const [errorPosition, setErrorPosition] = useState(null);
  const [calcConn, setCalcConn] = useState('idle');
  const [showScanModal, setShowScanModal] = useState(false);

  const calcChannelRef = useRef(null);
  const lastSenderRef = useRef(null);
  const clientIdRef = useRef((typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const isCalcInputFocusedRef = useRef(false);
  const lastInputTsRef = useRef(0);

  const getCalcChannelName = (itm) => {
    if (!session || !itm) return null;
    return `calc:${session.id}:${itm.id}`;
  };

  const handleCountQuantityChange = useCallback((newValue) => {
    setCountQuantity(newValue);
    // mark local typing timestamp to prevent remote echo causing caret flicker
    lastInputTsRef.current = Date.now();
    try {
      if (calcChannelRef.current && selectedItem) {
        
        calcChannelRef.current.send({
          type: 'broadcast',
          event: 'calc_update',
          payload: {
            expr: newValue,
            itemId: selectedItem.id,
            location: countLocation,
            senderId: user?.id || null,
            clientId: clientIdRef.current,
            ts: Date.now()
          }
        });
      }
    } catch (err) {
      
    }
  }, [selectedItem, countLocation, user]);

  // Format number with thousand separators for display
  const formatNumber = (num) => {
    if (num === 0) return '0';
    return num.toLocaleString('en-US');
  };

  // Enhanced mathematical expression evaluator with error detection
  const evaluateExpression = (expression) => {
    // Clear any previous errors
    setCalculationError(null);
    setErrorPosition(null);

    if (!expression || expression.trim() === '' || expression.trim() === '+') {
      setCalculatedResult(0);
      return 0;
    }

    try {
      // Remove any potentially dangerous characters and validate
      let sanitized = expression.replace(/[^0-9+\-*/.() ]/g, '');

      // Handle trailing operators by removing them for calculation
      sanitized = sanitized.replace(/[+\-*/.]+$/, '').trim();

      // If nothing left after removing trailing operators, return 0
      if (!sanitized) {
        setCalculatedResult(0);
        return 0;
      }

      // Check for common error patterns and identify their positions
      const errorPatterns = [
        // Invalid operator combinations (same or different operators except ++)
        { pattern: /\d+\s*[\*\/]\s*[\+\-\*\/]\s*\d+/, message: 'Invalid operator combination', type: 'invalid_combination' },
        { pattern: /\d+\s*[\+\-]\s*[\*\/]\s*\d+/, message: 'Invalid operator combination', type: 'invalid_combination' },

        // Double operators (except ++)
        { pattern: /\d+\s*\*\s*\*\s*\d+/, message: 'Double multiplication operator', type: 'double_operator' },
        { pattern: /\d+\s*\/\s*\/\s*\d+/, message: 'Double division operator', type: 'double_operator' },
        { pattern: /\d+\s*\-\s*\-\s*\d+/, message: 'Double minus operator', type: 'double_operator' },

        // Multiple trailing operators (real errors)
        { pattern: /\d+\s*\*{2,}$/, message: 'Multiple trailing multiplication operators', type: 'trailing_operator' },
        { pattern: /\d+\s*\/+$/, message: 'Trailing division operator', type: 'trailing_operator' },
        { pattern: /\d+\s*\-{2,}$/, message: 'Multiple trailing minus operators', type: 'trailing_operator' },

        // Leading operators (except +)
        { pattern: /^\s*\*/, message: 'Leading multiplication operator', type: 'leading_operator' },
        { pattern: /^\s*\//, message: 'Leading division operator', type: 'leading_operator' },

        // Other errors
        { pattern: /\(\s*\)/, message: 'Empty parentheses', type: 'empty_parentheses' },
        { pattern: /\d+\s*\(\s*\d+/, message: 'Missing operator before parentheses', type: 'missing_operator' },
        { pattern: /\d+\s*\)\s*\d+/, message: 'Missing operator after parentheses', type: 'missing_operator' }
      ];

      for (const { pattern, message, type } of errorPatterns) {
        const match = pattern.exec(expression);
        if (match) {
          setCalculationError({
            message: `Calculation error: ${message}`,
            position: match.index,
            length: match[0].length,
            type: type
          });
          setCalculatedResult(0);
          return 0;
        }
      }

      // Basic validation - ensure we have a valid mathematical expression
      if (!/^[0-9+\-*/.() ]+$/.test(sanitized)) {
        setCalculationError({
          message: 'Invalid characters in expression',
          position: expression.search(/[^0-9+\-*/.() ]/),
          length: 1,
          type: 'invalid_character'
        });
        setCalculatedResult(0);
        return 0;
      }

      // Use Function constructor for safer evaluation than eval()
      const result = new Function('return ' + sanitized)();

      // Ensure result is a valid number
      if (typeof result !== 'number' || isNaN(result) || !isFinite(result)) {
        setCalculationError({
          message: 'Invalid calculation result',
          position: 0,
          length: expression.length,
          type: 'calculation_error'
        });
        setCalculatedResult(0);
        return 0;
      }

      setCalculatedResult(Math.max(0, Math.floor(result))); // Ensure non-negative integer
      return Math.max(0, Math.floor(result));
    } catch (error) {
      

      // Try to identify the error position
      let errorPos = 0;
      if (expression) {
        // Look for common error indicators
        const operators = ['+', '-', '*', '/'];
        for (let i = 0; i < expression.length; i++) {
          if (operators.includes(expression[i])) {
            // Check if operator is in invalid position
            if (i === 0 || operators.includes(expression[i-1]) || i === expression.length - 1) {
              errorPos = i;
              break;
            }
          }
        }
      }

      setCalculationError({
        message: 'Syntax error in expression',
        position: errorPos,
        length: 1,
        type: 'syntax_error'
      });
      setCalculatedResult(0);
      return 0;
    }
  };

  // Update calculated result whenever countQuantity changes
  useEffect(() => {
    evaluateExpression(countQuantity);
  }, [countQuantity]);

  useEffect(() => {
    if (!sessionId) return;
    fetchSessionData();
    const unsubscribe = subscribeToCounts();
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [sessionId]);

  // Load last selected location from localStorage
  useEffect(() => {
    if (sessionId) {
      const savedLocation = localStorage.getItem(`lastSelectedLocation_${sessionId}_${user?.id}`);
      if (savedLocation) {
        setLastSelectedLocation(savedLocation);
      }
    }
  }, [sessionId, user]);

  // Update editing state when location changes
  useEffect(() => {
    if (selectedItem && countLocation) {
      const itemCounts = counts[selectedItem.id] || [];
      const existingCount = itemCounts.find(c => c.location === countLocation);
      if (existingCount) {
        setIsEditing(true);
        setSelectedCountId(existingCount.id);
        // Show the stored calculation expression if available, otherwise show the result with + suffix
        const calculationExpr = existingCount.calculation || existingCount.countedQty.toString();
        setCountQuantity(calculationExpr.endsWith('+') ? calculationExpr : calculationExpr + '+');
      } else {
        setIsEditing(false);
        setSelectedCountId(null);
        setCountQuantity('+');
      }
    }
  }, [countLocation, selectedItem, counts]);

  // Realtime sync for calculation input (per item across session)
  useEffect(() => {
    const isEditorOpen = !!selectedItem;
    if (!isEditorOpen) {
      if (calcChannelRef.current) {
        try { supabase.removeChannel(calcChannelRef.current); } catch {}
        calcChannelRef.current = null;
      }
      setCalcConn('idle');
      return;
    }

    const channelName = getCalcChannelName(selectedItem);
    if (!channelName) return;

    setCalcConn('connecting');

    const ch = supabase.channel(channelName, {
      config: { broadcast: { ack: true }, presence: { key: clientIdRef.current } }
    });

    ch.on('broadcast', { event: 'calc_update' }, ({ payload }) => {
      if (payload?.clientId === clientIdRef.current) return;
      // Avoid blinking when local user is actively typing: defer remote updates during a short window
      const now = Date.now();
      if (isCalcInputFocusedRef.current && now - lastInputTsRef.current < 250) {
        return;
      }
      lastSenderRef.current = payload?.senderId;
      setCountQuantity(payload?.expr ?? '');
    });

    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        setCalcConn('subscribed');
        ch.track({
          sessionId: session.id,
          itemId: selectedItem.id,
          userId: user?.id || null,
          username: user?.username || null,
          clientId: clientIdRef.current
        }).catch(() => {});
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        setCalcConn('error');
      }
    });

    calcChannelRef.current = ch;

    return () => {
      try { supabase.removeChannel(ch); } catch {}
      calcChannelRef.current = null;
      setCalcConn('idle');
    };
  }, [selectedItem, session, user]);

  const fetchSessionData = async () => {
    try {
      setLoading(true);

      // First fetch the session data
      const { data: sessionData, error: sessionError } = await supabase
        .from('sessions')
        .select('*')
        .eq('id', sessionId)
        .single();

      if (sessionError) throw sessionError;
      setSession(sessionData);

      // Fetch session items with item details
      const { data: sessionItems, error: sessionItemsError } = await supabase
        .from('session_items')
        .select(`
          items (
            id,
            sku,
            item_code,
            item_name,
            uom,
            category,
            tags,
            internal_product_code
          )
        `)
        .eq('session_id', sessionId);

      if (sessionItemsError) throw sessionItemsError;

      const itemsData = sessionItems.map(si => si.items).filter(Boolean);
      setItems(itemsData);

      // Get unique categories from items
      const itemCategories = [...new Set(itemsData.map(item => item.category).filter(Boolean))];

      // Fetch existing counts for this session
      const { data: countsData, error: countsError } = await supabase
        .from('counts')
        .select(`
          *,
          items (
            id,
            item_name,
            sku
          ),
          locations (
            name
          )
        `)
        .eq('session_id', sessionId);

      if (countsError) throw countsError;

      // Group counts by item_id
      const countsByItem = {};
      countsData.forEach(count => {
        if (!countsByItem[count.item_id]) {
          countsByItem[count.item_id] = [];
        }
        countsByItem[count.item_id].push({
          location: count.locations?.name || 'Unknown',
          countedQty: count.counted_qty,
          calculation: count.counted_qty_calculation,
          timestamp: count.timestamp,
          id: count.id
        });
      });
      setCounts(countsByItem);

      // Fetch locations filtered by item categories
      if (itemCategories.length > 0) {
        // Get category IDs for the item categories
        const { data: categoriesData, error: categoriesError } = await supabase
          .from('categories')
          .select('id, name')
          .in('name', itemCategories);

        if (categoriesError) throw categoriesError;

        setCategories(categoriesData);
        const categoryIds = categoriesData.map(cat => cat.id);

        if (categoryIds.length > 0) {
          // Fetch locations that belong to the categories of items in this session
          const { data: locationsData, error: locationsError } = await supabase
            .from('locations')
            .select('*')
            .in('category_id', categoryIds)
            .eq('is_active', true)
            .order('name');

          if (!locationsError) {
            setLocations(locationsData || []);
          }
        } else {
          setLocations([]);
        }
      } else {
        setLocations([]);
      }
    } catch (err) {
      
    } finally {
      setLoading(false);
    }
  };

  // Fetch latest counts for a specific item from DB and update local state
  const refreshCountsForItem = async (itemId) => {
    try {
      const { data: countsData, error } = await supabase
        .from('counts')
        .select(`
          *,
          locations ( name )
        `)
        .eq('session_id', session.id)
        .eq('item_id', itemId);

      if (error) throw error;

      const updatedList = (countsData || []).map((count) => ({
        location: count.locations?.name || 'Unknown',
        countedQty: count.counted_qty,
        calculation: count.counted_qty_calculation,
        timestamp: count.timestamp,
        id: count.id,
      }));

      setCounts((prev) => ({
        ...prev,
        [itemId]: updatedList,
      }));
    } catch (e) {
      
    }
  };
 
  const subscribeToCounts = () => {
    const subscription = supabase
      .channel(`counts:${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'counts',
          filter: `session_id=eq.${sessionId}`
        },
        (payload) => {

          handleRealtimeCountChange(payload);
        }
      )
      .subscribe((status) => {

      });

    return () => {
      try {
        subscription.unsubscribe();
      } catch (e) {

      }
    };
  };


  const handleRealtimeCountChange = async (payload) => {
    const { eventType, new: newRecord, old: oldRecord } = payload;

    if (eventType === 'INSERT' && newRecord) {
      // Add new count from another user
      try {
        const { data: locationData } = await supabase
          .from('locations')
          .select('name')
          .eq('id', newRecord.location_id)
          .eq('is_active', true)
          .single();

        if (locationData) {
          setCounts(prevCounts => {
            const updatedCounts = { ...prevCounts };
            const itemId = newRecord.item_id;

            if (!updatedCounts[itemId]) {
              updatedCounts[itemId] = [];
            }

            const newCount = {
              location: locationData.name,
              countedQty: newRecord.counted_qty,
              calculation: newRecord.counted_qty_calculation,
              timestamp: newRecord.timestamp,
              id: newRecord.id
            };

            updatedCounts[itemId] = [...updatedCounts[itemId], newCount];
            return updatedCounts;
          });
        }
      } catch (error) {
        
      }
    } else if (eventType === 'UPDATE' && newRecord) {
      // Update existing count from another user
      setCounts(prevCounts => {
        const updatedCounts = { ...prevCounts };
        const itemId = newRecord.item_id;

        if (updatedCounts[itemId]) {
          updatedCounts[itemId] = updatedCounts[itemId].map(count =>
            count.id === newRecord.id
              ? { ...count, countedQty: newRecord.counted_qty, calculation: newRecord.counted_qty_calculation, timestamp: newRecord.timestamp }
              : count
          );
        }

        return updatedCounts;
      });
    } else if (eventType === 'DELETE' && oldRecord) {
      // Remove deleted count from another user
      setCounts(prevCounts => {
        const updatedCounts = { ...prevCounts };
        const itemId = oldRecord.item_id;

        if (updatedCounts[itemId]) {
          updatedCounts[itemId] = updatedCounts[itemId].filter(count => count.id !== oldRecord.id);
          if (updatedCounts[itemId].length === 0) {
            delete updatedCounts[itemId];
          }
        }

        return updatedCounts;
      });
    }
  };

  const filteredItems = useMemo(() => {
    return items.filter(item => {
      const matchesSearch =
        item.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.item_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.item_code.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (item.internal_product_code && item.internal_product_code.toLowerCase().includes(searchTerm.toLowerCase()));

      const itemCounts = counts[item.id] || [];
      const isCounted = itemCounts.length > 0;

      if (filterStatus === 'counted') return matchesSearch && isCounted;
      if (filterStatus === 'uncounted') return matchesSearch && !isCounted;
      return matchesSearch;
    });
  }, [items, searchTerm, filterStatus, counts]);

  const handleItemSelect = async (item) => {
    setSelectedItem(item);

    // Get filtered locations for this item
    const itemCategory = categories.find(cat => cat.name === item.category);
    const filteredLocations = itemCategory ? locations.filter(loc => loc.category_id === itemCategory.id) : [];

    // Set default location: use last selected location if it's in filtered, or fallback to first available
    const defaultLocation = lastSelectedLocation && filteredLocations.some(loc => loc.name === lastSelectedLocation)
      ? lastSelectedLocation
      : filteredLocations[0]?.name || '';

    setCountLocation(defaultLocation);

    // Open modal first, then request fresh counts for this item from DB
    setShowCountModal(true);
    refreshCountsForItem(item.id);
  };

  const handleLocationChange = (newLocation) => {
    setCountLocation(newLocation);

    // Save as last selected location if it's a valid location
    if (newLocation && locations.some(loc => loc.name === newLocation)) {
      setLastSelectedLocation(newLocation);
      localStorage.setItem(`lastSelectedLocation_${sessionId}_${user.id}`, newLocation);
    }
  };

  const handleItemClick = async (item) => {
    setSelectedItem(item);

    // Get filtered locations for this item
    const itemCategory = categories.find(cat => cat.name === item.category);
    const filteredLocations = itemCategory ? locations.filter(loc => loc.category_id === itemCategory.id) : [];

    // Set default location: use last selected location if it's in filtered, or fallback to first available
    const defaultLocation = lastSelectedLocation && filteredLocations.some(loc => loc.name === lastSelectedLocation)
      ? lastSelectedLocation
      : filteredLocations[0]?.name || '';

    setCountLocation(defaultLocation);

    // Open popup first, then request fresh counts for this item from DB
    setShowCalculationPopup(true);
    refreshCountsForItem(item.id);
  };

  const handleChevronClick = (e, itemId) => {
    e.stopPropagation();
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(itemId)) {
      newExpanded.delete(itemId);
    } else {
      newExpanded.add(itemId);
    }
    setExpandedItems(newExpanded);
  };

  const handleSaveCount = async () => {
    if (!selectedItem || !countLocation || !countQuantity || calculationError) {
      return;
    }

    // Validate session time window and status
    if (session) {
      const now = new Date();

      // Check if session is closed
      if (session.status === 'closed' || session.status === 'completed' || session.status === 'cancelled') {
        alert(`Cannot save count. Session is ${session.status}.`);
        return;
      }

      // Check if session is still scheduled (not yet active)
      if (session.status === 'scheduled') {
        alert('Cannot save count. Session is not yet active.');
        return;
      }

      // Check if session has time window restrictions
      if (session.valid_from && session.valid_until) {
        const validFrom = new Date(session.valid_from);
        const validUntil = new Date(session.valid_until);

        if (now < validFrom) {
          alert(`Session has not started yet. It will open at ${validFrom.toLocaleString()}`);
          return;
        }

        if (now > validUntil) {
          alert(`Session has expired. It closed at ${validUntil.toLocaleString()}`);
          return;
        }
      }
    }

    try {
      setSubmitting(true);

      if (isEditing) {
        // Update existing count
        const { error: countError } = await supabase
          .from('counts')
          .update({
            counted_qty: calculatedResult,
            counted_qty_calculation: countQuantity.trim()
          })
          .eq('id', selectedCountId);

        if (countError) throw countError;

        // Update local state immediately
        setCounts(prevCounts => {
          const updatedCounts = { ...prevCounts };
          const itemId = selectedItem.id;
          if (updatedCounts[itemId]) {
            updatedCounts[itemId] = updatedCounts[itemId].map(count =>
              count.id === selectedCountId
                ? { ...count, countedQty: calculatedResult, calculation: countQuantity.trim() }
                : count
            );
          }
          return updatedCounts;
        });
      } else {
        // Get location ID (only active locations)
        const { data: locationData, error: locationError } = await supabase
          .from('locations')
          .select('id')
          .eq('name', countLocation)
          .eq('is_active', true)
          .single();

        if (locationError) throw locationError;

        // Insert new count
        const { data: newCount, error: countError } = await supabase
          .from('counts')
          .insert({
            session_id: session.id,
            item_id: selectedItem.id,
            user_id: user.id,
            location_id: locationData.id,
            counted_qty: calculatedResult,
            counted_qty_calculation: countQuantity.trim()
          })
          .select()
          .single();

        if (countError) throw countError;

        // Update local state immediately with the new count
        if (newCount) {
          setCounts(prevCounts => {
            const updatedCounts = { ...prevCounts };
            const itemId = selectedItem.id;
            if (!updatedCounts[itemId]) {
              updatedCounts[itemId] = [];
            }

            const newCountData = {
              location: countLocation,
              countedQty: newCount.counted_qty,
              calculation: newCount.counted_qty_calculation,
              timestamp: newCount.timestamp,
              id: newCount.id
            };

            updatedCounts[itemId] = [...updatedCounts[itemId], newCountData];
            return updatedCounts;
          });
        }
      }

      setShowCountModal(false);
      setCountQuantity('');
      setSelectedItem(null);
      setIsEditing(false);
      setSelectedCountId(null);
      setCalculationError(null);
      setErrorPosition(null);
    } catch (err) {

      alert('Error saving count: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleScanSuccess = (parsedCode, originalScan) => {
    // Set the parsed code to search term to filter items
    setSearchTerm(parsedCode);

    // Find the item with matching internal_product_code
    const matchingItem = items.find(item =>
      item.internal_product_code === parsedCode
    );

    if (matchingItem) {
      // If item found and it's unique (only one match), open count modal directly
      handleItemSelect(matchingItem);
    } else {
      // If no item found or multiple matches, just show in search results
      // User can then select the appropriate item manually
      console.log('Scanned code not found in items:', parsedCode);
    }

    // Close scan modal
    setShowScanModal(false);
  };

  const handleScanError = (error) => {
    console.error('Scan error:', error);
    // Error is already handled in ScanModal component
  };


  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100">
        <div className="bg-white shadow-sm sticky top-0 z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center py-4">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => navigate('/sessions')}
                  className="text-gray-600 hover:text-gray-800 p-1 rounded-full hover:bg-gray-100"
                >
                  <ChevronLeft className="h-6 w-6" />
                </button>
                <div>
                  <h1 className="text-xl font-bold text-gray-900 truncate">
                    {session?.name || 'Loading session...'}
                  </h1>
                  <p className="text-gray-600 text-sm">
                    Loading items...
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-center py-8">
          <div className="spinner"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <div className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center gap-2">
              <button
                onClick={() => navigate('/sessions')}
                className="text-gray-600 hover:text-gray-800 p-1 rounded-full hover:bg-gray-100"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
              <div>
                <h1 className="text-xl font-bold text-gray-900 truncate">
                  {session?.name || 'Session'}
                </h1>
                <p className="text-gray-600 text-sm">
                  Items: {filteredItems.length} of {items.length}
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => navigate('/home')}
                className="text-blue-600 hover:text-blue-800 p-2"
                title="Go to Home"
              >
                <Home className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        {/* Search and Filter Bar */}
        <div className="bg-white p-4 rounded-lg shadow mb-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4 z-10" />
              <input
                type="text"
                placeholder="Search SKU, name, or code..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2 top-1/2 transform -translate-y-1/2 bg-gray-500 text-white p-1 rounded-md hover:bg-gray-600 flex items-center justify-center"
                  title="Clear search"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Items</option>
                <option value="counted">Counted</option>
                <option value="uncounted">Uncounted</option>
              </select>
              {isMobileDevice() && (
                <button
                  onClick={() => setShowScanModal(true)}
                  className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 flex items-center space-x-2"
                >
                  <QrCode className="h-4 w-4" />
                  <span>Scan</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Items Grid */}
        <div className="grid gap-4">
          {filteredItems.map((item) => {
            const itemCounts = counts[item.id] || [];
            const isCounted = itemCounts.length > 0;
            const totalCounted = itemCounts.reduce((acc, curr) => acc + curr.countedQty, 0);

            return (
              <div
                key={item.id}
                className={`bg-white rounded-lg shadow hover:shadow-md transition-all ${
                  isCounted ? 'border-l-4 border-green-500' : 'border-l-4 border-gray-300'
                }`}
              >
                <div
                  onClick={() => handleItemClick(item)}
                  className="p-3 hover:bg-gray-50 cursor-pointer flex justify-between items-start"
                >
                  <div className="flex-1">
                    <div className="flex items-center space-x-2 mb-1">
                      <span className="font-semibold text-gray-900">{item.sku}</span>
                      <span className="text-gray-500">|</span>
                      <span className="text-gray-600">{item.item_code}</span>
                      {isCounted ? (
                        <CheckCircle className="h-5 w-5 text-green-500" />
                      ) : (
                        <XCircle className="h-5 w-5 text-gray-400" />
                      )}
                    </div>
                    <h3 className="text-lg font-medium text-gray-900 mb-1">
                      {item.item_name}
                    </h3>
                    <div className="flex items-center space-x-4 text-sm text-gray-500 mb-2">
                       <div className="flex items-center space-x-1">
                         <Package className="h-4 w-4" />
                         <span>{item.uom}</span>
                       </div>
                       <div className="flex items-center space-x-1">
                         <Bookmark className="h-4 w-4" />
                         <span>{item.category}</span>
                       </div>
                       {isCounted && (
                         <span className="font-semibold text-green-600">
                           Total: {totalCounted} {item.uom}
                         </span>
                       )}
                     </div>

                  </div>
                  <div className="flex items-center space-x-2">
                    {expandedItems.has(item.id) ? (
                      <ChevronUp
                        className="h-5 w-5 text-gray-500 cursor-pointer hover:text-gray-700"
                        onClick={(e) => handleChevronClick(e, item.id)}
                      />
                    ) : (
                      <ChevronDown
                        className="h-5 w-5 text-gray-500 cursor-pointer hover:text-gray-700"
                        onClick={(e) => handleChevronClick(e, item.id)}
                      />
                    )}
                  </div>
                </div>
                {expandedItems.has(item.id) && (
                  <div className="p-3 border-t">
                    {isCounted && (
                      <div>
                        <div className="flex justify-between items-center mb-1">
                          <h4 className="font-semibold text-sm text-gray-700">
                            Total Counted: {totalCounted} {item.uom}
                          </h4>
                        </div>
                        <ul className="space-y-0.5 text-sm">
                          {itemCounts.map((count, index) => (
                            <li key={index} className="flex items-center bg-gray-50 p-1.5 rounded">
                              <MapPin className="h-4 w-4 text-gray-500 mr-2" />
                              <span className="font-medium text-gray-600">
                                {count.location}:
                              </span>
                              <span className="ml-2 text-green-700 font-bold">
                                {count.countedQty}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </main>

      {/* Count Modal */}
      {showCountModal && selectedItem && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white p-6 rounded-lg w-full max-w-md">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-base font-bold">{isEditing ? 'Edit Item Count' : 'Add Item Count'}</h3>
              <button
                onClick={() => {
                  setShowCountModal(false);
                  setIsEditing(false);
                  setSelectedCountId(null);
                  setCalculationError(null);
                  setErrorPosition(null);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <div className="mb-4">
              <p className="text-sm text-gray-600">SKU: {selectedItem.sku}</p>
              <p className="font-medium">{selectedItem.item_name}</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Location
                </label>
                <select
                  value={countLocation}
                  onChange={(e) => handleLocationChange(e.target.value)}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                >
                  <option value="">Select Location</option>
                  {(() => {
                    const itemCategory = categories.find(cat => cat.name === selectedItem.category);
                    const filteredLocations = itemCategory ? locations.filter(loc => loc.category_id === itemCategory.id) : [];
                    return filteredLocations.map(loc => (
                      <option key={loc.id} value={loc.name}>
                        {loc.name}
                      </option>
                    ));
                  })()}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Quantity Calculation
                </label>
                <div className="relative">
                  <div className="relative">
                    <textarea
                      value={countQuantity}
                      onChange={(e) => {
                        handleCountQuantityChange(e.target.value);
                        // Auto-resize and scroll to cursor position
                        setTimeout(() => {
                          e.target.style.height = 'auto';
                          e.target.style.height = e.target.scrollHeight + 'px';
                          // Scroll to make cursor visible
                          const cursorPosition = e.target.selectionStart;
                          const textBeforeCursor = e.target.value.substring(0, cursorPosition);
                          const lines = textBeforeCursor.split('\n');
                          const currentLine = lines.length;
                          const lineHeight = 24; // Approximate line height
                          e.target.scrollTop = Math.max(0, (currentLine - 2) * lineHeight);
                          e.target.scrollLeft = e.target.scrollWidth;
                        }, 0);
                      }}
                      onFocus={(e) => {
                        isCalcInputFocusedRef.current = true;
                        // Scroll to show cursor position
                        setTimeout(() => {
                          const cursorPosition = e.target.selectionStart;
                          const textBeforeCursor = e.target.value.substring(0, cursorPosition);
                          const lines = textBeforeCursor.split('\n');
                          const currentLine = lines.length;
                          const lineHeight = 24;
                          e.target.scrollTop = Math.max(0, (currentLine - 2) * lineHeight);
                          e.target.scrollLeft = e.target.scrollWidth;
                        }, 0);
                      }}
                      onClick={(e) => {
                        // Handle clicks to position cursor correctly
                        setTimeout(() => {
                          const cursorPosition = e.target.selectionStart;
                          const textBeforeCursor = e.target.value.substring(0, cursorPosition);
                          const lines = textBeforeCursor.split('\n');
                          const currentLine = lines.length;
                          const lineHeight = 24;
                          e.target.scrollTop = Math.max(0, (currentLine - 2) * lineHeight);
                        }, 0);
                      }}
                      onBlur={() => { isCalcInputFocusedRef.current = false; }}
                      placeholder="Enter expression (e.g., 5*10+5*20)"
                      className={`mt-1 block w-full px-3 py-3 pr-24 rounded-md focus:outline-none focus:ring-2 border-2 font-mono resize-none overflow-auto ${
                        calculationError
                          ? 'border-red-500 focus:ring-red-500'
                          : 'border-gray-400 focus:ring-blue-500'
                      }`}
                      required
                      rows={1}
                      style={{
                        minHeight: '3.5rem',
                        maxHeight: '8rem',
                        paddingRight: calculatedResult > 9999 ? '7rem' :
                                    calculatedResult > 999 ? '6rem' :
                                    calculatedResult > 99 ? '5.5rem' :
                                    calculatedResult > 9 ? '5rem' : '6rem',
                        wordBreak: 'break-all',
                        whiteSpace: 'pre-wrap',
                        overflowWrap: 'break-word'
                      }}
                      onInput={(e) => {
                        // Improved auto-resize with limits
                        e.target.style.height = 'auto';
                        const scrollHeight = e.target.scrollHeight;
                        const maxHeight = 128; // 8rem in pixels
                        e.target.style.height = Math.min(scrollHeight, maxHeight) + 'px';
                      }}
                    />
                  </div>
                  <div className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 pointer-events-none">
                    <Calculator className="h-4 w-4" />
                  </div>

                  {/* Error indicator */}
                  {calculationError && (
                    <div className="absolute -top-2 -right-2 w-3 h-3 bg-red-500 rounded-full pointer-events-none"></div>
                  )}

                  {/* Floating result inside input field */}
                  {countQuantity && !calculationError && (
                    <div className="absolute right-10 top-1/2 transform -translate-y-1/2 pointer-events-none">
                      <div className="bg-green-500 text-white px-2 py-1 rounded text-sm font-bold shadow-md">
                        {formatNumber(calculatedResult)}
                      </div>
                    </div>
                  )}
                </div>

                {/* Error message */}
                {calculationError && (
                  <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded-md">
                    <div className="text-sm text-red-600 flex items-center">
                      <span className="mr-2">⚠️</span>
                      <span>{calculationError.message}</span>
                    </div>
                  </div>
                )}

                {/* Always visible calculator */}
                <div className="mt-3">
                  <CalculatorComponent
                    value={countQuantity}
                    onChange={handleCountQuantityChange}
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end space-x-2 mt-6">
              <button
                onClick={() => {
                  setShowCountModal(false);
                  setCountQuantity('');
                  setSelectedItem(null);
                  setIsEditing(false);
                  setSelectedCountId(null);
                  setCalculationError(null);
                  setErrorPosition(null);
                }}
                className="px-4 py-2 text-gray-600 border rounded-md hover:bg-gray-50"
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveCount}
                disabled={!countLocation || !countQuantity || submitting || calculationError}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-blue-300 flex items-center space-x-2"
              >
                {submitting ? (
                  <div className="spinner w-4 h-4"></div>
                ) : (
                  <Save className="h-4 w-4" />
                )}
                <span>Save Count</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Calculation Popup */}
      {showCalculationPopup && selectedItem && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white p-6 rounded-lg w-full max-w-md">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold">{isEditing ? 'Edit Item Count' : 'Add Item Count'}</h3>
              <button
                onClick={() => {
                  setShowCalculationPopup(false);
                  setSelectedItem(null);
                  setCountQuantity('');
                  setIsEditing(false);
                  setSelectedCountId(null);
                  setCalculationError(null);
                  setErrorPosition(null);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <div className="mb-4">
              <p className="text-sm text-gray-600">SKU: {selectedItem.sku} | Code: {selectedItem.item_code}</p>
              <p className="font-medium">{selectedItem.item_name}</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Location
                </label>
                <select
                  value={countLocation}
                  onChange={(e) => handleLocationChange(e.target.value)}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                >
                  <option value="">Select Location</option>
                  {(() => {
                    const itemCategory = categories.find(cat => cat.name === selectedItem.category);
                    const filteredLocations = itemCategory ? locations.filter(loc => loc.category_id === itemCategory.id) : [];
                    return filteredLocations.map(loc => (
                      <option key={loc.id} value={loc.name}>
                        {loc.name}
                      </option>
                    ));
                  })()}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Quantity Calculation
                </label>
                <div className="relative">
                  <div className="relative">
                    <textarea
                      value={countQuantity}
                      onChange={(e) => {
                        handleCountQuantityChange(e.target.value);
                        // Auto-resize and scroll to cursor position
                        setTimeout(() => {
                          e.target.style.height = 'auto';
                          e.target.style.height = e.target.scrollHeight + 'px';
                          // Scroll to make cursor visible
                          const cursorPosition = e.target.selectionStart;
                          const textBeforeCursor = e.target.value.substring(0, cursorPosition);
                          const lines = textBeforeCursor.split('\n');
                          const currentLine = lines.length;
                          const lineHeight = 24; // Approximate line height
                          e.target.scrollTop = Math.max(0, (currentLine - 2) * lineHeight);
                          e.target.scrollLeft = e.target.scrollWidth;
                        }, 0);
                      }}
                      onFocus={(e) => {
                        isCalcInputFocusedRef.current = true;
                        // Scroll to show cursor position
                        setTimeout(() => {
                          const cursorPosition = e.target.selectionStart;
                          const textBeforeCursor = e.target.value.substring(0, cursorPosition);
                          const lines = textBeforeCursor.split('\n');
                          const currentLine = lines.length;
                          const lineHeight = 24;
                          e.target.scrollTop = Math.max(0, (currentLine - 2) * lineHeight);
                          e.target.scrollLeft = e.target.scrollWidth;
                        }, 0);
                      }}
                      onClick={(e) => {
                        // Handle clicks to position cursor correctly
                        setTimeout(() => {
                          const cursorPosition = e.target.selectionStart;
                          const textBeforeCursor = e.target.value.substring(0, cursorPosition);
                          const lines = textBeforeCursor.split('\n');
                          const currentLine = lines.length;
                          const lineHeight = 24;
                          e.target.scrollTop = Math.max(0, (currentLine - 2) * lineHeight);
                        }, 0);
                      }}
                      onBlur={() => { isCalcInputFocusedRef.current = false; }}
                      placeholder="Enter expression (e.g., 5*10+5*20)"
                      className={`mt-1 block w-full px-3 py-3 pr-24 rounded-md focus:outline-none focus:ring-2 border-2 font-mono resize-none overflow-auto ${
                        calculationError
                          ? 'border-red-500 focus:ring-red-500'
                          : 'border-gray-400 focus:ring-blue-500'
                      }`}
                      required
                      rows={1}
                      style={{
                        minHeight: '3.5rem',
                        maxHeight: '8rem',
                        paddingRight: calculatedResult > 9999 ? '7rem' :
                                    calculatedResult > 999 ? '6rem' :
                                    calculatedResult > 99 ? '5.5rem' :
                                    calculatedResult > 9 ? '5rem' : '6rem',
                        wordBreak: 'break-all',
                        whiteSpace: 'pre-wrap',
                        overflowWrap: 'break-word'
                      }}
                      onInput={(e) => {
                        // Improved auto-resize with limits
                        e.target.style.height = 'auto';
                        const scrollHeight = e.target.scrollHeight;
                        const maxHeight = 128; // 8rem in pixels
                        e.target.style.height = Math.min(scrollHeight, maxHeight) + 'px';
                      }}
                    />
                  </div>
                  <div className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 pointer-events-none">
                    <Calculator className="h-5 w-5" />
                  </div>

                  {/* Error indicator */}
                  {calculationError && (
                    <div className="absolute -top-2 -right-2 w-3 h-3 bg-red-500 rounded-full pointer-events-none"></div>
                  )}

                  {/* Floating result inside input field */}
                  {countQuantity && !calculationError && (
                    <div className="absolute right-10 top-1/2 transform -translate-y-1/2 pointer-events-none">
                      <div className="bg-green-500 text-white px-2 py-1 rounded text-sm font-bold shadow-md">
                        {formatNumber(calculatedResult)}
                      </div>
                    </div>
                  )}
                </div>

                {/* Error message */}
                {calculationError && (
                  <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded-md">
                    <div className="text-sm text-red-600 flex items-center">
                      <span className="mr-2">⚠️</span>
                      <span>{calculationError.message}</span>
                    </div>
                  </div>
                )}

                {/* Always visible calculator */}
                <div className="mt-3">
                  <CalculatorComponent
                    value={countQuantity}
                    onChange={handleCountQuantityChange}
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end space-x-2 mt-6">
              <button
                onClick={() => {
                  setShowCalculationPopup(false);
                  setCountQuantity('');
                  setSelectedItem(null);
                  setIsEditing(false);
                  setSelectedCountId(null);
                  setCalculationError(null);
                  setErrorPosition(null);
                  setCalculationError(null);
                  setErrorPosition(null);
                }}
                className="px-4 py-2 text-gray-600 border rounded-md hover:bg-gray-50"
                disabled={submitting}
              >
                Close
              </button>
              <button
                onClick={async () => {
                  if (!selectedItem || !countLocation || !countQuantity || calculationError) {
                    return;
                  }

                  try {
                    setSubmitting(true);

                    if (isEditing) {
                      // Update existing count
                      const { error: countError } = await supabase
                        .from('counts')
                        .update({
                          counted_qty: calculatedResult,
                          counted_qty_calculation: countQuantity.trim()
                        })
                        .eq('id', selectedCountId);

                      if (countError) throw countError;

                      // Update local state immediately
                      setCounts(prevCounts => {
                        const updatedCounts = { ...prevCounts };
                        const itemId = selectedItem.id;
                        if (updatedCounts[itemId]) {
                          updatedCounts[itemId] = updatedCounts[itemId].map(count =>
                            count.id === selectedCountId
                              ? { ...count, countedQty: calculatedResult, calculation: countQuantity.trim() }
                              : count
                          );
                        }
                        return updatedCounts;
                      });
                    } else {
                      // Get location ID (only active locations)
                      const { data: locationData, error: locationError } = await supabase
                        .from('locations')
                        .select('id')
                        .eq('name', countLocation)
                        .eq('is_active', true)
                        .single();

                      if (locationError) throw locationError;

                      // Insert new count
                      const { data: newCount, error: countError } = await supabase
                        .from('counts')
                        .insert({
                          session_id: session.id,
                          item_id: selectedItem.id,
                          user_id: user.id,
                          location_id: locationData.id,
                          counted_qty: calculatedResult,
                          counted_qty_calculation: countQuantity.trim()
                        })
                        .select()
                        .single();

                      if (countError) throw countError;

                      // Update local state immediately with the new count
                      if (newCount) {
                        setCounts(prevCounts => {
                          const updatedCounts = { ...prevCounts };
                          const itemId = selectedItem.id;
                          if (!updatedCounts[itemId]) {
                            updatedCounts[itemId] = [];
                          }

                          const newCountData = {
                            location: countLocation,
                            countedQty: newCount.counted_qty,
                            calculation: newCount.counted_qty_calculation,
                            timestamp: newCount.timestamp,
                            id: newCount.id
                          };

                          updatedCounts[itemId] = [...updatedCounts[itemId], newCountData];
                          return updatedCounts;
                        });
                      }
                    }

                    setShowCalculationPopup(false);
                    setCountQuantity('');
                    setSelectedItem(null);
                    setIsEditing(false);
                    setSelectedCountId(null);
                  } catch (err) {
                    
                    alert('Error saving count: ' + err.message);
                  } finally {
                    setSubmitting(false);
                  }
                }}
                disabled={!countLocation || !countQuantity || submitting || calculationError}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-blue-300 flex items-center space-x-2"
              >
                {submitting ? (
                  <div className="spinner w-4 h-4"></div>
                ) : (
                  <Save className="h-4 w-4" />
                )}
                <span>Save</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Scan Modal */}
      <ScanModal
        isOpen={showScanModal}
        onClose={() => setShowScanModal(false)}
        onScanSuccess={handleScanSuccess}
        onScanError={handleScanError}
      />
    </div>
  );
};

export default ItemsList;