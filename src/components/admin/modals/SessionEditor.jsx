import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import {
  Package, Users, Building, ClipboardList, Plus, Search, Edit, Trash2, Save, X,
  ChevronDown, AlertCircle, Calendar, Clock, UserPlus, UserMinus, Download,
  CheckCircle, Tag, Hash, Code, Folder, Layers
} from 'lucide-react';
import { supabase, checkCategoryUsage, checkLocationUsage, softDeleteLocation, reactivateLocation } from '../../../lib/supabase';
import * as XLSX from 'xlsx';
const SessionEditor = React.memo(({ session, onClose, onSave }) => {
  const { user } = useAuth();
  const [formData, setFormData] = useState({
    name: session?.name || '',
    status: session?.status || 'draft',
    sessionType: session?.is_recurring_template ? 'recurring' : session?.is_scheduled ? 'scheduled' : 'regular',
    // Time fields
    validFromTime: session?.valid_from ? new Date(session.valid_from).toTimeString().slice(0, 5) : '08:00',
    validUntilTime: session?.valid_until ? new Date(session.valid_until).toTimeString().slice(0, 5) : '17:00',
    // Scheduled session
    scheduledDate: session?.scheduled_date || '',
    // Recurring config
    recurrenceType: session?.recurring_config?.type || 'daily',
    weeklyDays: session?.recurring_config?.days || [],
    monthlyDates: session?.recurring_config?.dates || []
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const sessionData = {
        name: formData.name,
        status: formData.status
      };

      // Add recurring/scheduled fields
      if (formData.sessionType === 'recurring') {
        sessionData.is_recurring_template = true;
        sessionData.is_scheduled = false;

        // Build recurring config
        const config = { type: formData.recurrenceType };
        if (formData.recurrenceType === 'weekly') {
          config.days = formData.weeklyDays;
        } else if (formData.recurrenceType === 'monthly') {
          config.dates = formData.monthlyDates;
        }
        sessionData.recurring_config = config;

        // Set time windows (use today as placeholder date)
        const today = new Date().toISOString().split('T')[0];
        sessionData.valid_from = `${today}T${formData.validFromTime}:00`;
        sessionData.valid_until = `${today}T${formData.validUntilTime}:00`;

      } else if (formData.sessionType === 'scheduled') {
        sessionData.is_scheduled = true;
        sessionData.is_recurring_template = false;
        sessionData.scheduled_date = formData.scheduledDate;

        // Set full datetime for scheduled session
        sessionData.valid_from = `${formData.scheduledDate}T${formData.validFromTime}:00`;
        sessionData.valid_until = `${formData.scheduledDate}T${formData.validUntilTime}:00`;

      } else {
        // Regular session
        sessionData.is_recurring_template = false;
        sessionData.is_scheduled = false;
      }

      if (session) {
        // Update
        const { error: updateError } = await supabase
          .from('sessions')
          .update(sessionData)
          .eq('id', session.id);

        if (updateError) throw updateError;

        // If updating a recurring template, update future sessions
        if (session.is_recurring_template && formData.sessionType === 'recurring') {
          const { error: updateFutureError } = await supabase
            .rpc('update_future_sessions_from_template', {
              p_master_session_id: session.id
            });

          if (updateFutureError) {
            console.warn('Error updating future sessions:', updateFutureError);
          }
        }
      } else {
        // Create
        const { data: newSession, error: insertError } = await supabase
          .from('sessions')
          .insert([{
            ...sessionData,
            type: 'inventory',
            created_by: user.id
          }])
          .select()
          .single();

        if (insertError) throw insertError;

        // If recurring template, generate sessions for next 30 days
        if (formData.sessionType === 'recurring') {
          const { error: generateError } = await supabase
            .rpc('generate_recurring_sessions', {
              p_master_session_id: newSession.id,
              p_days_ahead: 30
            });

          if (generateError) {
            console.warn('Error generating recurring sessions:', generateError);
          }
        }
      }

      onSave();
      onClose();
    } catch (err) {
      console.error('Error saving session:', err);
      setError(err.message || 'Failed to save session');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const handleWeeklyDayToggle = (day) => {
    setFormData(prev => ({
      ...prev,
      weeklyDays: prev.weeklyDays.includes(day)
        ? prev.weeklyDays.filter(d => d !== day)
        : [...prev.weeklyDays, day].sort()
    }));
  };

  const handleMonthlyDateToggle = (date) => {
    setFormData(prev => ({
      ...prev,
      monthlyDates: prev.monthlyDates.includes(date)
        ? prev.monthlyDates.filter(d => d !== date)
        : [...prev.monthlyDates, date].sort((a, b) => a - b)
    }));
  };

  const weekDays = [
    { value: 0, label: 'Sun' },
    { value: 1, label: 'Mon' },
    { value: 2, label: 'Tue' },
    { value: 3, label: 'Wed' },
    { value: 4, label: 'Thu' },
    { value: 5, label: 'Fri' },
    { value: 6, label: 'Sat' }
  ];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-lg w-full max-w-2xl flex flex-col my-8">
        <div className="p-4 border-b flex justify-between items-center sticky top-0 bg-white rounded-t-lg z-10">
          <h3 className="text-xl font-bold">
            {session ? 'Edit Session' : 'Create New Session'}
          </h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X className="h-6 w-6" />
          </button>
        </div>
        <div className="p-6 overflow-y-auto">
          {error && (
            <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Session Name *
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

            {/* Session Type Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Session Type *
              </label>
              <div className="space-y-2">
                <label className="flex items-center">
                  <input
                    type="radio"
                    name="sessionType"
                    value="regular"
                    checked={formData.sessionType === 'regular'}
                    onChange={handleChange}
                    className="mr-2"
                  />
                  <span className="text-sm">Regular Session (One-time, immediate)</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="radio"
                    name="sessionType"
                    value="scheduled"
                    checked={formData.sessionType === 'scheduled'}
                    onChange={handleChange}
                    className="mr-2"
                  />
                  <span className="text-sm">Scheduled Session (One-time, future date)</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="radio"
                    name="sessionType"
                    value="recurring"
                    checked={formData.sessionType === 'recurring'}
                    onChange={handleChange}
                    className="mr-2"
                  />
                  <span className="text-sm">Recurring Template (Auto-generate daily/weekly/monthly)</span>
                </label>
              </div>
            </div>

            {/* Scheduled Session: Date */}
            {formData.sessionType === 'scheduled' && (
              <div className="p-4 bg-blue-50 rounded-lg space-y-3">
                <h4 className="font-medium text-sm text-blue-900">Scheduled Session Settings</h4>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Scheduled Date *
                  </label>
                  <input
                    type="date"
                    name="scheduledDate"
                    value={formData.scheduledDate}
                    onChange={handleChange}
                    min={new Date().toISOString().split('T')[0]}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>
              </div>
            )}

            {/* Recurring Template: Recurrence Settings */}
            {formData.sessionType === 'recurring' && (
              <div className="p-4 bg-purple-50 rounded-lg space-y-3">
                <h4 className="font-medium text-sm text-purple-900">Recurring Template Settings</h4>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Recurrence Pattern *
                  </label>
                  <select
                    name="recurrenceType"
                    value={formData.recurrenceType}
                    onChange={handleChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>

                {/* Weekly: Select Days */}
                {formData.recurrenceType === 'weekly' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Select Days *
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {weekDays.map(day => (
                        <button
                          key={day.value}
                          type="button"
                          onClick={() => handleWeeklyDayToggle(day.value)}
                          className={`px-3 py-2 rounded-md text-sm font-medium ${
                            formData.weeklyDays.includes(day.value)
                              ? 'bg-purple-600 text-white'
                              : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          {day.label}
                        </button>
                      ))}
                    </div>
                    {formData.weeklyDays.length === 0 && (
                      <p className="text-xs text-red-600 mt-1">Please select at least one day</p>
                    )}
                  </div>
                )}

                {/* Monthly: Select Dates */}
                {formData.recurrenceType === 'monthly' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Select Dates *
                    </label>
                    <div className="grid grid-cols-7 gap-1">
                      {Array.from({ length: 31 }, (_, i) => i + 1).map(date => (
                        <button
                          key={date}
                          type="button"
                          onClick={() => handleMonthlyDateToggle(date)}
                          className={`px-2 py-2 rounded text-sm font-medium ${
                            formData.monthlyDates.includes(date)
                              ? 'bg-purple-600 text-white'
                              : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          {date}
                        </button>
                      ))}
                    </div>
                    {formData.monthlyDates.length === 0 && (
                      <p className="text-xs text-red-600 mt-1">Please select at least one date</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Time Window (for scheduled and recurring) */}
            {(formData.sessionType === 'scheduled' || formData.sessionType === 'recurring') && (
              <div className="p-4 bg-green-50 rounded-lg space-y-3">
                <h4 className="font-medium text-sm text-green-900">Time Window</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Valid From (Time) *
                    </label>
                    <input
                      type="time"
                      name="validFromTime"
                      value={formData.validFromTime}
                      onChange={handleChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Valid Until (Time) *
                    </label>
                    <input
                      type="time"
                      name="validUntilTime"
                      value={formData.validUntilTime}
                      onChange={handleChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>
                </div>
                <p className="text-xs text-gray-600">
                  Sessions can only be filled between these times. Sessions will auto-close after the end time.
                </p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Status *
              </label>
              <select
                name="status"
                value={formData.status}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              >
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
                <option value="closed">Closed</option>
              </select>
            </div>

            <div className="text-sm text-gray-600 bg-gray-50 p-3 rounded">
              <p><strong>Note:</strong> User assignments and item selections for this session are managed separately after creation.</p>
              {formData.sessionType === 'recurring' && (
                <p className="mt-2"><strong>Recurring:</strong> Creating this template will auto-generate sessions for the next 30 days based on your schedule.</p>
              )}
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
    </div>
  );
});


export default SessionEditor;
