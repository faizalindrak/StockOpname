import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import {
  Home,
  LogOut,
  Calendar,
  AlertTriangle,
  TrendingUp,
  Clock,
  CheckCircle,
  PlayCircle,
  FileText,
  ClockIcon,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { BarChart, Bar, CartesianGrid, XAxis, LabelList } from "recharts"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"

const HistoryPage = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  // Calculate default date range (1 month back)
  const getDefaultDateRange = () => {
    const today = new Date();
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(today.getMonth() - 1);

    return {
      startDate: oneMonthAgo.toISOString().split('T')[0],
      endDate: today.toISOString().split('T')[0]
    };
  };

  const defaultRange = getDefaultDateRange();
  const [startDate, setStartDate] = useState(defaultRange.startDate);
  const [endDate, setEndDate] = useState(defaultRange.endDate);
  const [loading, setLoading] = useState(true);
  const [historyData, setHistoryData] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortColumn, setSortColumn] = useState('created_at');
  const [sortDirection, setSortDirection] = useState('desc');
  const [statistics, setStatistics] = useState({
    totalEvents: 0,
    criticalItems: 0,
    overItems: 0,
    openItems: 0,
    onProgressItems: 0,
    closedItems: 0,
    avgCompletionTime: 0
  });
  const [userProfiles, setUserProfiles] = useState({});

  // Fetch user profiles for displaying names
  const fetchUserProfiles = async (userIds) => {
    try {
      const uniqueUserIds = [...new Set(userIds.filter(id => id))];
      if (uniqueUserIds.length === 0) return {};

      const { data, error } = await supabase
        .from('profiles')
        .select('id, name, username')
        .in('id', uniqueUserIds);

      if (error) throw error;

      const profilesMap = {};
      data.forEach(profile => {
        profilesMap[profile.id] = profile;
      });

      return profilesMap;
    } catch (error) {
      console.error('Error fetching user profiles:', error);
      return {};
    }
  };

  // Calculate average completion time in hours
  const calculateAvgCompletionTime = (closedReports) => {
    if (closedReports.length === 0) return 0;

    const completionTimes = closedReports.map(report => {
      const created = new Date(report.created_at);
      const updated = new Date(report.updated_at);
      return (updated - created) / (1000 * 60 * 60); // Convert to hours
    });

    const avgHours = completionTimes.reduce((sum, time) => sum + time, 0) / completionTimes.length;
    return avgHours;
  };

  // Format completion time to readable format
  const formatCompletionTime = (hours) => {
    if (hours < 1) {
      return `${Math.round(hours * 60)} menit`;
    } else if (hours < 24) {
      return `${hours.toFixed(1)} jam`;
    } else {
      const days = Math.floor(hours / 24);
      const remainingHours = Math.round(hours % 24);
      return `${days} hari ${remainingHours} jam`;
    }
  };

  // Fetch history data
  const fetchHistoryData = async () => {
    try {
      setLoading(true);

      // Fetch reports within date range
      const { data: reports, error } = await supabase
        .from('report_status_raw_mat')
        .select('*')
        .gte('created_at', `${startDate}T00:00:00`)
        .lte('created_at', `${endDate}T23:59:59`)
        .order('created_at', { ascending: false });

      if (error) throw error;

      setHistoryData(reports || []);

      // Calculate statistics
      const stats = {
        totalEvents: reports.length,
        criticalItems: reports.filter(r => r.inventory_status === 'kritis').length,
        overItems: reports.filter(r => r.inventory_status === 'over').length,
        openItems: reports.filter(r => r.follow_up_status === 'open').length,
        onProgressItems: reports.filter(r => r.follow_up_status === 'on_progress').length,
        closedItems: reports.filter(r => r.follow_up_status === 'closed').length,
        avgCompletionTime: calculateAvgCompletionTime(
          reports.filter(r => r.follow_up_status === 'closed')
        )
      };

      setStatistics(stats);

      // Fetch user profiles
      const userIds = [
        ...reports.map(r => r.user_report),
        ...reports.map(r => r.user_follow_up)
      ];
      const profiles = await fetchUserProfiles(userIds);
      setUserProfiles(profiles);

    } catch (error) {
      console.error('Error fetching history data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistoryData();
  }, [startDate, endDate]);

  // Handle logout
  const handleLogout = async () => {
    await signOut();
    navigate('/');
  };

  // Get status badge class
  const getStatusBadgeClass = (status) => {
    switch (status) {
      case 'open':
        return 'bg-red-100 text-red-700';
      case 'on_progress':
        return 'bg-yellow-100 text-yellow-700';
      case 'closed':
        return 'bg-green-100 text-green-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  // Get inventory status badge class
  const getInventoryStatusBadgeClass = (status) => {
    switch (status) {
      case 'kritis':
        return 'bg-red-100 text-red-700';
      case 'over':
        return 'bg-purple-100 text-purple-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  // Format date time
  const formatDateTime = (dateString) => {
    if (!dateString) return { date: '-', time: '' };
    const dateObj = new Date(dateString);

    const date = dateObj.toLocaleDateString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: '2-digit'
    });

    const time = dateObj.toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit'
    });

    return { date, time };
  };

  // Get user name
  const getUserName = (userId) => {
    if (!userId) return '-';
    const profile = userProfiles[userId];
    return profile ? profile.name : 'Unknown';
  };

  // Handle sort
  const handleSort = (column) => {
    if (sortColumn === column) {
      // Toggle direction if same column
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // Set new column and default to ascending
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  // Get sort icon
  const getSortIcon = (column) => {
    if (sortColumn !== column) {
      return <ArrowUpDown className="h-3 w-3 ml-1 inline-block opacity-50" />;
    }
    return sortDirection === 'asc'
      ? <ArrowUp className="h-3 w-3 ml-1 inline-block" />
      : <ArrowDown className="h-3 w-3 ml-1 inline-block" />;
  };

  // Filter and sort data
  const filteredHistoryData = historyData
    .filter((record) => {
      if (!searchQuery) return true;

      const query = searchQuery.toLowerCase();
      return (
        record.sku?.toLowerCase().includes(query) ||
        record.internal_product_code?.toLowerCase().includes(query) ||
        record.item_name?.toLowerCase().includes(query) ||
        record.inventory_status?.toLowerCase().includes(query) ||
        record.follow_up_status?.toLowerCase().includes(query) ||
        getUserName(record.user_report)?.toLowerCase().includes(query) ||
        getUserName(record.user_follow_up)?.toLowerCase().includes(query) ||
        record.remarks?.toLowerCase().includes(query)
      );
    })
    .sort((a, b) => {
      let aValue, bValue;

      switch (sortColumn) {
        case 'date_input':
          aValue = new Date(a.date_input);
          bValue = new Date(b.date_input);
          break;
        case 'sku':
          aValue = a.sku?.toLowerCase() || '';
          bValue = b.sku?.toLowerCase() || '';
          break;
        case 'item_name':
          aValue = a.item_name?.toLowerCase() || '';
          bValue = b.item_name?.toLowerCase() || '';
          break;
        case 'inventory_status':
          aValue = a.inventory_status || '';
          bValue = b.inventory_status || '';
          break;
        case 'follow_up_status':
          aValue = a.follow_up_status || '';
          bValue = b.follow_up_status || '';
          break;
        case 'qty':
          aValue = a.qty || 0;
          bValue = b.qty || 0;
          break;
        case 'user_report':
          aValue = getUserName(a.user_report)?.toLowerCase() || '';
          bValue = getUserName(b.user_report)?.toLowerCase() || '';
          break;
        case 'created_at':
          aValue = new Date(a.created_at);
          bValue = new Date(b.created_at);
          break;
        case 'user_follow_up':
          aValue = getUserName(a.user_follow_up)?.toLowerCase() || '';
          bValue = getUserName(b.user_follow_up)?.toLowerCase() || '';
          break;
        case 'updated_at':
          aValue = new Date(a.updated_at);
          bValue = new Date(b.updated_at);
          break;
        default:
          return 0;
      }

      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

  // Prepare chart data - group by date and inventory status
  const prepareChartData = () => {
    // Create a map to hold dates and their counts
    const dateMap = {};

    // Generate all dates in range
    const start = new Date(startDate);
    const end = new Date(endDate);

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      dateMap[dateStr] = {
        date: dateStr,
        kritis: 0,
        over: 0
      };
    }

    // Count reports by date and status
    historyData.forEach(report => {
      const dateStr = new Date(report.created_at).toISOString().split('T')[0];
      if (dateMap[dateStr]) {
        if (report.inventory_status === 'kritis') {
          dateMap[dateStr].kritis += 1;
        } else if (report.inventory_status === 'over') {
          dateMap[dateStr].over += 1;
        }
      }
    });

    // Convert to array and sort by date
    return Object.values(dateMap).sort((a, b) => new Date(a.date) - new Date(b.date));
  };

  const chartData = prepareChartData();

  // Chart configuration for shadcn/ui
  const chartConfig = {
    over: {
      label: "Over",
      color: "#6b21a8", // purple-800
    },
    kritis: {
      label: "Kritis",
      color: "#dc2626", // red-600
    },
  };

  // Custom label renderer untuk menampilkan total
  const renderCustomLabel = (props) => {
    // Untuk stacked bar, gunakan index untuk mendapatkan data yang tepat
    const { x, y, width, index } = props;

    // Check if index is valid and data exists
    if (index === undefined || !chartData[index]) return null;

    const data = chartData[index];
    const total = (data.kritis || 0) + (data.over || 0);

    // Hanya tampilkan label jika total > 0
    if (total === 0) return null;

    return (
      <text
        x={x + width / 2}
        y={y - 5}
        fill="#374151"
        textAnchor="middle"
        fontSize={12}
        fontWeight={600}
      >
        {total}
      </text>
    );
  };

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <div className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-3">
            <div className="flex items-center gap-3">
              <div className="inline-flex items-center justify-center w-10 h-10 bg-blue-100 rounded-full">
                <FileText className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">History Report Status</h1>
                <p className="text-gray-600">Riwayat dan Statistik Report</p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-gray-600 hidden sm:block">
                Welcome, {user?.name || user?.email}
              </span>
              <button
                onClick={() => navigate('/reportstatus')}
                className="text-blue-600 hover:text-blue-800"
                title="Back to Report Status"
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

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Date Range Picker */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="flex items-center gap-4 flex-wrap">
            <Calendar className="h-5 w-5 text-gray-500" />
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">Dari:</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                max={endDate}
                className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 p-2"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">Sampai:</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                min={startDate}
                max={new Date().toISOString().split('T')[0]}
                className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 p-2"
              />
            </div>
            <button
              onClick={() => {
                const range = getDefaultDateRange();
                setStartDate(range.startDate);
                setEndDate(range.endDate);
              }}
              className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 text-sm font-medium transition-colors"
            >
              Reset ke 1 Bulan
            </button>
          </div>
        </div>

        {/* Statistics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {/* Total Events */}
          <div className="bg-white rounded-lg shadow-sm p-6 border-l-4 border-blue-500">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600 mb-1">Total Events</p>
                <p className="text-3xl font-bold text-gray-900">{statistics.totalEvents}</p>
              </div>
              <div className="bg-blue-100 p-3 rounded-lg">
                <FileText className="h-6 w-6 text-blue-600" />
              </div>
            </div>
          </div>

          {/* Critical Items */}
          <div className="bg-white rounded-lg shadow-sm p-6 border-l-4 border-red-500">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600 mb-1">Items Kritis</p>
                <p className="text-3xl font-bold text-gray-900">{statistics.criticalItems}</p>
              </div>
              <div className="bg-red-100 p-3 rounded-lg">
                <AlertTriangle className="h-6 w-6 text-red-600" />
              </div>
            </div>
          </div>

          {/* Over Items */}
          <div className="bg-white rounded-lg shadow-sm p-6 border-l-4 border-purple-500">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600 mb-1">Items Over</p>
                <p className="text-3xl font-bold text-gray-900">{statistics.overItems}</p>
              </div>
              <div className="bg-purple-100 p-3 rounded-lg">
                <TrendingUp className="h-6 w-6 text-purple-600" />
              </div>
            </div>
          </div>

          {/* Average Completion Time */}
          <div className="bg-white rounded-lg shadow-sm p-6 border-l-4 border-green-500">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600 mb-1">Rata-rata Penyelesaian</p>
                <p className="text-xl font-bold text-gray-900">
                  {statistics.avgCompletionTime > 0
                    ? formatCompletionTime(statistics.avgCompletionTime)
                    : '-'}
                </p>
              </div>
              <div className="bg-green-100 p-3 rounded-lg">
                <ClockIcon className="h-6 w-6 text-green-600" />
              </div>
            </div>
          </div>

          {/* Open Items */}
          <div className="bg-white rounded-lg shadow-sm p-6 border-l-4 border-red-400">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600 mb-1">Status Open</p>
                <p className="text-3xl font-bold text-gray-900">{statistics.openItems}</p>
              </div>
              <div className="bg-red-50 p-3 rounded-lg">
                <Clock className="h-6 w-6 text-red-400" />
              </div>
            </div>
          </div>

          {/* On Progress Items */}
          <div className="bg-white rounded-lg shadow-sm p-6 border-l-4 border-yellow-500">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600 mb-1">Status On Progress</p>
                <p className="text-3xl font-bold text-gray-900">{statistics.onProgressItems}</p>
              </div>
              <div className="bg-yellow-100 p-3 rounded-lg">
                <PlayCircle className="h-6 w-6 text-yellow-600" />
              </div>
            </div>
          </div>

          {/* Closed Items */}
          <div className="bg-white rounded-lg shadow-sm p-6 border-l-4 border-green-500">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600 mb-1">Status Closed</p>
                <p className="text-3xl font-bold text-gray-900">{statistics.closedItems}</p>
              </div>
              <div className="bg-green-100 p-3 rounded-lg">
                <CheckCircle className="h-6 w-6 text-green-600" />
              </div>
            </div>
          </div>
        </div>

        {/* Stacked Bar Chart */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Grafik Event Report per Hari</CardTitle>
            <CardDescription>
              Jumlah event report Over dan Kritis berdasarkan tanggal
            </CardDescription>
          </CardHeader>
          <CardContent className="pb-2">
            <ChartContainer config={chartConfig} className="h-[300px] w-full">
              <BarChart
                accessibilityLayer
                data={chartData}
                margin={{ top: 30, right: 30, left: 20, bottom: 5 }}
              >
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  tickMargin={10}
                  axisLine={false}
                  angle={-45}
                  textAnchor="end"
                  height={80}
                  tickFormatter={(value) => {
                    const date = new Date(value);
                    return date.toLocaleDateString('id-ID', {
                      day: '2-digit',
                      month: 'short'
                    });
                  }}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(value) => {
                        const date = new Date(value);
                        return date.toLocaleDateString('id-ID', {
                          day: '2-digit',
                          month: 'long',
                          year: 'numeric'
                        });
                      }}
                    />
                  }
                />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar
                  dataKey="over"
                  stackId="a"
                  fill="var(--color-over)"
                  radius={[0, 0, 4, 4]}
                />
                <Bar
                  dataKey="kritis"
                  stackId="a"
                  fill="var(--color-kritis)"
                  radius={[4, 4, 0, 0]}
                >
                  <LabelList content={renderCustomLabel} />
                </Bar>
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* History Table */}
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Riwayat Report</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Menampilkan {filteredHistoryData.length} dari {historyData.length} records
                </p>
              </div>
              <div className="relative flex-shrink-0 w-64">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Cari item, SKU, kode, status..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                />
              </div>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
          ) : historyData.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500">Tidak ada data dalam rentang tanggal ini</p>
            </div>
          ) : filteredHistoryData.length === 0 ? (
            <div className="text-center py-12">
              <Search className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500">Tidak ada hasil untuk pencarian "{searchQuery}"</p>
              <button
                onClick={() => setSearchQuery('')}
                className="mt-4 text-blue-600 hover:text-blue-700 text-sm font-medium"
              >
                Reset pencarian
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th
                      className="px-1 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-24 cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('date_input')}
                    >
                      Tgl Input{getSortIcon('date_input')}
                    </th>
                    <th
                      className="px-1 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('sku')}
                    >
                      SKU / Kode{getSortIcon('sku')}
                    </th>
                    <th
                      className="px-1.5 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('item_name')}
                    >
                      Nama Item{getSortIcon('item_name')}
                    </th>
                    <th
                      className="px-0.5 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-20 cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('inventory_status')}
                    >
                      Status Inv{getSortIcon('inventory_status')}
                    </th>
                    <th
                      className="px-0.5 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-24 cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('follow_up_status')}
                    >
                      Status F/U{getSortIcon('follow_up_status')}
                    </th>
                    <th
                      className="px-0.5 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-14 cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('qty')}
                    >
                      Qty{getSortIcon('qty')}
                    </th>
                    <th
                      className="px-1 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('user_report')}
                    >
                      Dibuat Oleh{getSortIcon('user_report')}
                    </th>
                    <th
                      className="px-1 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-24 cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('created_at')}
                    >
                      Waktu Dibuat{getSortIcon('created_at')}
                    </th>
                    <th
                      className="px-1 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('user_follow_up')}
                    >
                      Follow Up Oleh{getSortIcon('user_follow_up')}
                    </th>
                    <th
                      className="px-1 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-24 cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('updated_at')}
                    >
                      Waktu Update{getSortIcon('updated_at')}
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredHistoryData.map((record) => {
                    const createdDateTime = formatDateTime(record.created_at);
                    const updatedDateTime = formatDateTime(record.updated_at);

                    return (
                      <tr key={record.id} className="hover:bg-gray-50">
                        <td className="px-1 py-1.5 whitespace-nowrap text-xs text-gray-900">
                          {new Date(record.date_input).toLocaleDateString('id-ID', {
                            day: '2-digit',
                            month: 'short',
                            year: '2-digit'
                          })}
                        </td>
                        <td className="px-1 py-1.5 whitespace-nowrap">
                          <div className="text-xs font-medium text-gray-900">{record.sku}</div>
                          <div className="text-xs text-gray-500">{record.internal_product_code}</div>
                        </td>
                        <td className="px-1.5 py-1.5 min-w-[180px]">
                          <div className="text-xs text-gray-900" title={record.item_name}>
                            {record.item_name}
                          </div>
                        </td>
                        <td className="px-0.5 py-1.5 whitespace-nowrap">
                          <span className={`px-1.5 py-0.5 inline-flex text-xs leading-4 font-semibold rounded ${getInventoryStatusBadgeClass(record.inventory_status)}`}>
                            {record.inventory_status === 'kritis' ? 'Kritis' : 'Over'}
                          </span>
                        </td>
                        <td className="px-0.5 py-1.5 whitespace-nowrap">
                          <span className={`px-1.5 py-0.5 inline-flex text-xs leading-4 font-semibold rounded ${getStatusBadgeClass(record.follow_up_status)}`}>
                            {record.follow_up_status === 'open' ? 'Open' : record.follow_up_status === 'on_progress' ? 'Progress' : 'Closed'}
                          </span>
                        </td>
                        <td className="px-0.5 py-1.5 whitespace-nowrap text-xs text-gray-900 text-center">
                          {record.qty || '-'}
                        </td>
                        <td className="px-1 py-1.5 whitespace-nowrap text-xs text-gray-900">
                          {getUserName(record.user_report)}
                        </td>
                        <td className="px-1 py-1.5 whitespace-nowrap">
                          <div className="text-xs text-gray-900 font-medium leading-tight">{createdDateTime.date}</div>
                          <div className="text-xs text-gray-500 leading-tight">{createdDateTime.time}</div>
                        </td>
                        <td className="px-1 py-1.5 whitespace-nowrap text-xs text-gray-900">
                          {getUserName(record.user_follow_up)}
                        </td>
                        <td className="px-1 py-1.5 whitespace-nowrap">
                          <div className="text-xs text-gray-900 font-medium leading-tight">{updatedDateTime.date}</div>
                          <div className="text-xs text-gray-500 leading-tight">{updatedDateTime.time}</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default HistoryPage;
