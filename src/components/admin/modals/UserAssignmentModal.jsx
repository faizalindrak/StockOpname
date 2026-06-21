import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import {
  Package, Users, Building, ClipboardList, Plus, Search, Edit, Trash2, Save, X,
  ChevronDown, AlertCircle, Calendar, Clock, UserPlus, UserMinus, Download,
  CheckCircle, Tag, Hash, Code, Folder, Layers
} from 'lucide-react';
import { supabase, checkCategoryUsage, checkLocationUsage, softDeleteLocation, reactivateLocation } from '../../../lib/supabase';
import * as XLSX from 'xlsx';
const UserAssignmentModal = React.memo(({ session, onClose, onSave }) => {
  const [availableUsers, setAvailableUsers] = useState([]);
  const [assignedUsers, setAssignedUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(false);

  useEffect(() => {
    if (session) {
      fetchUsers();
    }
  }, [session]);

  const fetchUsers = async () => {
    try {
      setLoading(true);

      // Fetch all users
      const { data: allUsers, error: usersError } = await supabase
        .from('profiles')
        .select('id, name, username')
        .order('name');

      if (usersError) throw usersError;

      // Fetch currently assigned users
      const { data: assigned, error: assignedError } = await supabase
        .from('session_users')
        .select('user_id')
        .eq('session_id', session.id);

      if (assignedError) throw assignedError;

      const assignedUserIds = new Set(assigned.map(a => a.user_id));

      // Separate available and assigned users
      const available = allUsers.filter(user => !assignedUserIds.has(user.id));
      const assignedList = allUsers.filter(user => assignedUserIds.has(user.id));

      setAvailableUsers(available);
      setAssignedUsers(assignedList);
    } catch (err) {
      console.error('Error fetching users:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAssignUser = async (userId) => {
    try {
      setAssigning(true);
      const { error } = await supabase
        .from('session_users')
        .insert([{ session_id: session.id, user_id: userId }]);

      if (error) throw error;

      // Update state incrementally instead of full re-fetch
      const userToMove = availableUsers.find(user => user.id === userId);
      if (userToMove) {
        setAvailableUsers(prev => prev.filter(user => user.id !== userId));
        setAssignedUsers(prev => [...prev, userToMove].sort((a, b) => a.name.localeCompare(b.name)));
      }
    } catch (err) {
      console.error('Error assigning user:', err);
    } finally {
      setAssigning(false);
    }
  };

  const handleUnassignUser = async (userId) => {
    try {
      setAssigning(true);
      const { error } = await supabase
        .from('session_users')
        .delete()
        .eq('session_id', session.id)
        .eq('user_id', userId);

      if (error) throw error;

      // Update state incrementally instead of full re-fetch
      const userToMove = assignedUsers.find(user => user.id === userId);
      if (userToMove) {
        setAssignedUsers(prev => prev.filter(user => user.id !== userId));
        setAvailableUsers(prev => [...prev, userToMove].sort((a, b) => a.name.localeCompare(b.name)));
      }
    } catch (err) {
      console.error('Error unassigning user:', err);
    } finally {
      setAssigning(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-4 border-b flex justify-between items-center">
          <h3 className="text-xl font-bold">
            Manage Users for Session: {session?.name}
          </h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="p-6 flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="spinner"></div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Available Users */}
              <div>
                <h4 className="text-lg font-semibold mb-4 text-gray-700">Available Users</h4>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {availableUsers.length === 0 ? (
                    <p className="text-gray-500 text-sm">No available users</p>
                  ) : (
                    availableUsers.map(user => (
                      <div key={user.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div>
                          <p className="font-medium text-gray-900">{user.name}</p>
                          <p className="text-sm text-gray-500">@{user.username}</p>
                        </div>
                        <button
                          onClick={() => handleAssignUser(user.id)}
                          disabled={assigning}
                          className="text-blue-600 hover:text-blue-800 disabled:opacity-50"
                          title="Assign User"
                        >
                          <UserPlus className="h-5 w-5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Assigned Users */}
              <div>
                <h4 className="text-lg font-semibold mb-4 text-gray-700">Assigned Users ({assignedUsers.length})</h4>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {assignedUsers.length === 0 ? (
                    <p className="text-gray-500 text-sm">No users assigned</p>
                  ) : (
                    assignedUsers.map(user => (
                      <div key={user.id} className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                        <div>
                          <p className="font-medium text-gray-900">{user.name}</p>
                          <p className="text-sm text-gray-500">@{user.username}</p>
                        </div>
                        <button
                          onClick={() => handleUnassignUser(user.id)}
                          disabled={assigning}
                          className="text-red-600 hover:text-red-800 disabled:opacity-50"
                          title="Unassign User"
                        >
                          <UserMinus className="h-5 w-5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
});

// Item Selection Modal Component

export default UserAssignmentModal;
