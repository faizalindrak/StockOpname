import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Package, Users, Settings, LogOut, Calculator, AlertTriangle } from 'lucide-react';

const Home = () => {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (err) {
      console.error('Sign out error:', err);
    }
  };

  const handleCycleCount = () => {
    navigate('/sessions');
  };

  const handleAdminPage = () => {
    navigate('/admin/sessions');
  };

  const handleReportStatus = () => {
    navigate('/reportstatus');
  };

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <div className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center gap-3">
              <div className="inline-flex items-center justify-center w-10 h-10 bg-blue-100 rounded-full">
                <Package className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Warehouse Cycle Count</h1>
                <p className="text-gray-600">Welcome back, {user?.name || user?.email}</p>
              </div>
            </div>
            <button
              onClick={handleSignOut}
              className="text-red-600 hover:text-red-800 flex items-center space-x-1"
              title="Logout"
            >
              <LogOut className="h-5 w-5" />
              <span className="hidden sm:block">Logout</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto py-8 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <h2 className="text-3xl font-bold text-gray-900 mb-8">Dashboard</h2>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {/* Cycle Count Card */}
            <div
              onClick={handleCycleCount}
              className="bg-white overflow-hidden shadow rounded-lg hover:shadow-md transition-shadow cursor-pointer"
            >
              <div className="p-6">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 bg-blue-500 rounded-md flex items-center justify-center">
                      <Calculator className="h-5 w-5 text-white" />
                    </div>
                  </div>
                  <div className="ml-4 flex-1">
                    <h3 className="text-lg font-medium text-gray-900">Cycle Count</h3>
                    <p className="text-sm text-gray-500">Start counting items in sessions</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Report Status Raw Material Card */}
            <div
              onClick={handleReportStatus}
              className="bg-white overflow-hidden shadow rounded-lg hover:shadow-md transition-shadow cursor-pointer"
            >
              <div className="p-6">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 bg-red-500 rounded-md flex items-center justify-center">
                      <AlertTriangle className="h-5 w-5 text-white" />
                    </div>
                  </div>
                  <div className="ml-4 flex-1">
                    <h3 className="text-lg font-medium text-gray-900">Report Status Raw Mat</h3>
                    <p className="text-sm text-gray-500">Report and monitor raw material inventory status</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Admin Page Card - Only show for admin users */}
            {profile?.role === 'admin' && (
              <div
                onClick={handleAdminPage}
                className="bg-white overflow-hidden shadow rounded-lg hover:shadow-md transition-shadow cursor-pointer"
              >
                <div className="p-6">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <div className="w-8 h-8 bg-red-500 rounded-md flex items-center justify-center">
                        <Settings className="h-5 w-5 text-white" />
                      </div>
                    </div>
                    <div className="ml-4 flex-1">
                      <h3 className="text-lg font-medium text-gray-900">Admin Page</h3>
                      <p className="text-sm text-gray-500">Manage sessions, items, users, and settings</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* User Info Card */}
            <div className="bg-white overflow-hidden shadow rounded-lg">
              <div className="p-6">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 bg-green-500 rounded-md flex items-center justify-center">
                      <Users className="h-5 w-5 text-white" />
                    </div>
                  </div>
                  <div className="ml-4 flex-1">
                    <h3 className="text-lg font-medium text-gray-900">User Information</h3>
                    <p className="text-sm text-gray-500">
                      Role: <span className="capitalize font-medium">{profile?.role === 'user' ? 'Counter' : profile?.role || 'user'}</span>
                    </p>
                    <p className="text-sm text-gray-500">
                      Status: <span className={`font-medium ${profile?.status === 'active' ? 'text-green-600' : 'text-yellow-600'}`}>
                        {profile?.status || 'inactive'}
                      </span>
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Home;