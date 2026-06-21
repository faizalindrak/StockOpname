import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  Package, Users, Building, ClipboardList, Plus, Search, Edit, Trash2, Save, X,
  ChevronDown, AlertCircle, Calendar, Clock, UserPlus, UserMinus, Download,
  CheckCircle, Tag, Hash, Code, Folder, Layers
} from 'lucide-react';
import { supabase, checkCategoryUsage, checkLocationUsage, softDeleteLocation, reactivateLocation } from '../../lib/supabase';
import * as XLSX from 'xlsx';
import SessionEditor from './modals/SessionEditor.jsx';
import UserAssignmentModal from './modals/UserAssignmentModal.jsx';
import ItemSelectionModal from './modals/ItemSelectionModal.jsx';
const SessionsManager = React.memo(({ sessions, setSessions, onDataChange }) => {
  const [showEditor, setShowEditor] = useState(false);
  const [editingSession, setEditingSession] = useState(null);
  const [showUserAssignment, setShowUserAssignment] = useState(false);
  const [showItemSelection, setShowItemSelection] = useState(false);
  const [selectedSessionForAssignment, setSelectedSessionForAssignment] = useState(null);
  const [selectedSessionForItems, setSelectedSessionForItems] = useState(null);

  // Refresh only sessions data (not all dashboard data)
  const refreshSessions = async () => {
    try {
      const { data: sessionsData, error } = await supabase
        .from('sessions')
        .select(`*, session_users (user_id)`)
        .order('created_date', { ascending: false });

      if (error) throw error;

      // Fetch user profiles for assigned users
      if (sessionsData) {
        const userIds = [...new Set(sessionsData.flatMap(session =>
          session.session_users?.map(su => su.user_id) || []
        ))];

        if (userIds.length > 0) {
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, name, username')
            .in('id', userIds);

          const profileMap = {};
          profiles?.forEach(profile => {
            profileMap[profile.id] = profile;
          });

          sessionsData.forEach(session => {
            session.session_users?.forEach(su => {
              su.profiles = profileMap[su.user_id];
            });
          });
        }
      }

      setSessions(sessionsData || []);
    } catch (err) {
      console.error('Error refreshing sessions:', err);
    }
  };

  const handleCreateSession = () => {
    setEditingSession(null);
    setShowEditor(true);
  };

  const handleEditSession = (session) => {
    setEditingSession(session);
    setShowEditor(true);
  };

  const handleDeleteSession = async (sessionId) => {
    if (!window.confirm('Are you sure you want to delete this session? All count data will be lost.')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('sessions')
        .delete()
        .eq('id', sessionId);

      if (error) throw error;

      await refreshSessions(); // Only refresh sessions, not all data
    } catch (err) {
      console.error('Error deleting session:', err);
    }
  };

  const handleManageUsers = (session) => {
    setSelectedSessionForAssignment(session);
    setShowUserAssignment(true);
  };

  const handleManageItems = (session) => {
    setSelectedSessionForItems(session);
    setShowItemSelection(true);
  };

  const formatDate = (date) => {
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
  };

  const exportReport = async (session) => {
    try {
      // Fetch session items with counts
      const { data: sessionItems, error: sessionItemsError } = await supabase
        .from('session_items')
        .select(`
          items (
            id,
            sku,
            item_name,
            internal_product_code
          )
        `)
        .eq('session_id', session.id);

      if (sessionItemsError) throw sessionItemsError;

      const itemIds = sessionItems.map(si => si.items.id);

      // Fetch counts for this session
      const { data: countsData, error: countsError } = await supabase
        .from('counts')
        .select(`
          *,
          items (
            sku,
            item_name
          ),
          locations (
            name
          )
        `)
        .eq('session_id', session.id);

      if (countsError) throw countsError;

      // Fetch user profiles
      const userIds = [...new Set(countsData.map(c => c.user_id))];
      const { data: profilesData, error: profilesError } = await supabase
        .from('profiles')
        .select('id, name')
        .in('id', userIds);

      if (profilesError) throw profilesError;

      const profileMap = {};
      profilesData?.forEach(profile => {
        profileMap[profile.id] = profile.name;
      });

      const csvContent = "data:text/csv;charset=utf-8,Session,SKU,Item Name,Internal Product Code,Location,Counted Qty,User,Timestamp\n";

      const reportData = countsData.map(count => ({
        sessionName: session.name,
        sku: count.items?.sku || '',
        itemName: count.items?.item_name || '',
        internalProductCode: count.items?.internal_product_code || '',
        location: count.locations?.name || '',
        quantity: count.counted_qty,
        userName: profileMap[count.user_id] || '',
        timestamp: formatDate(count.timestamp)
      }));

      const csvRows = reportData.map(row =>
        `${row.sessionName},"${row.sku}","${row.itemName}","${row.internalProductCode}",${row.location},${row.quantity},"${row.userName}","${row.timestamp}"`
      ).join('\n');

      const finalContent = csvContent + csvRows;

      const encodedUri = encodeURI(finalContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", `${session.name}_report.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('Error exporting report:', err);
      alert('Error exporting report: ' + err.message);
    }
  };


  return (
    <div>
      <div className="mb-6">
        <button
          onClick={handleCreateSession}
          className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 flex items-center space-x-2"
        >
          <Plus className="h-4 w-4" />
          <span>Create Session</span>
        </button>
      </div>

      <div className="bg-white shadow overflow-hidden sm:rounded-md">
        <ul className="divide-y divide-gray-200">
          {sessions.map((session) => (
            <li key={session.id} className="px-6 py-4">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-medium text-gray-900">
                      {session.name}
                    </h3>
                    {session.is_recurring_template && (
                      <span className="px-2 py-1 bg-purple-100 text-purple-800 text-xs font-semibold rounded-full">
                        RECURRING TEMPLATE
                      </span>
                    )}
                    {session.is_scheduled && (
                      <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs font-semibold rounded-full">
                        SCHEDULED
                      </span>
                    )}
                    {session.parent_session_id && (
                      <span className="px-2 py-1 bg-gray-100 text-gray-700 text-xs font-semibold rounded-full">
                        AUTO-GENERATED
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
                    <span className="flex items-center">
                      <ClipboardList className="h-4 w-4 mr-1" />
                      {session.type}
                    </span>
                    <span className="flex items-center">
                      <Users className="h-4 w-4 mr-1" />
                      {session.session_users?.length || 0} Counter(s)
                    </span>
                    <span className="flex items-center">
                      <Calendar className="h-4 w-4 mr-1" />
                      {session.scheduled_date ? new Date(session.scheduled_date).toLocaleDateString() : new Date(session.created_date).toLocaleDateString()}
                    </span>
                    {session.valid_from && session.valid_until && (
                      <span className="flex items-center">
                        <Clock className="h-4 w-4 mr-1" />
                        {new Date(session.valid_from).toLocaleTimeString('en-US', {hour: '2-digit', minute: '2-digit'})} - {new Date(session.valid_until).toLocaleTimeString('en-US', {hour: '2-digit', minute: '2-digit'})}
                      </span>
                    )}
                    <span className={`px-2 py-1 rounded-full text-xs ${
                      session.status === 'active' ? 'bg-green-100 text-green-800' :
                      session.status === 'completed' ? 'bg-blue-100 text-blue-800' :
                      session.status === 'closed' ? 'bg-red-100 text-red-800' :
                      session.status === 'scheduled' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {session.status}
                    </span>
                  </div>
                  {session.recurring_config && (
                    <div className="mt-2 text-xs text-gray-600">
                      <strong>Recurrence:</strong> {session.recurring_config.type}
                      {session.recurring_config.type === 'weekly' && session.recurring_config.days && (
                        <span> (Days: {session.recurring_config.days.map(d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ')})</span>
                      )}
                      {session.recurring_config.type === 'monthly' && session.recurring_config.dates && (
                        <span> (Dates: {session.recurring_config.dates.join(', ')})</span>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => handleManageUsers(session)}
                    className="text-blue-600 hover:text-blue-800 p-2"
                    title="Manage Users"
                  >
                    <Users className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() => handleManageItems(session)}
                    className="text-green-600 hover:text-green-800 p-2"
                    title="Manage Items"
                  >
                    <Package className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() => handleEditSession(session)}
                    className="text-indigo-600 hover:text-indigo-800 p-2"
                    title="Edit Session"
                  >
                    <Edit className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() => exportReport(session)}
                    className="text-green-600 hover:text-green-800 p-2"
                    title="Export Report"
                  >
                    <Download className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() => handleDeleteSession(session.id)}
                    className="text-red-600 hover:text-red-800 p-2"
                    title="Delete Session"
                  >
                    <Trash2 className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {showEditor && (
        <SessionEditor
          session={editingSession}
          onClose={() => setShowEditor(false)}
          onSave={refreshSessions} // Only refresh sessions, not all data
        />
      )}

      {showUserAssignment && (
        <UserAssignmentModal
          session={selectedSessionForAssignment}
          onClose={() => {
            setShowUserAssignment(false);
            setSelectedSessionForAssignment(null);
            refreshSessions(); // Only refresh sessions, not all data
          }}
          onSave={refreshSessions} // Only refresh sessions, not all data
        />
      )}

      {showItemSelection && (
        <ItemSelectionModal
          session={selectedSessionForItems}
          onClose={() => {
            setShowItemSelection(false);
            setSelectedSessionForItems(null);
            refreshSessions(); // Only refresh sessions, not all data
          }}
          onSave={refreshSessions} // Only refresh sessions, not all data
          onDataChange={refreshSessions} // Only refresh sessions, not all data
        />
      )}
    </div>
  );
});

// Item Groups Manager Component

export default SessionsManager;
