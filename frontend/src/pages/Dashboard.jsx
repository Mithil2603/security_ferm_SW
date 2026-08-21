import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { 
  Users, 
  Building2, 
  Wallet, 
  TrendingUp, 
  ArrowUpRight, 
  ArrowDownRight, 
  FileText, 
  Clock, 
  CreditCard, 
  AlertCircle, 
  RefreshCw, 
  AlertTriangle,
  PlusCircle, 
  CheckSquare, 
  Receipt, 
  UserPlus
} from 'lucide-react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  BarChart, 
  Bar 
} from 'recharts';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';

const StatCard = ({ title, value, icon: Icon, trend, trendValue, isCurrency = false, subtitle }) => (
  <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm hover:shadow-md transition-shadow">
    <div className="flex justify-between items-start">
      <div>
        <p className="text-sm font-medium text-slate-500 mb-1">{title}</p>
        <h3 className="text-2xl font-bold text-slate-800">
          {isCurrency ? `₹${(value || 0).toLocaleString('en-IN')}` : (value ?? 0)}
        </h3>
        {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
      <div className="p-3 bg-slate-50 rounded-lg">
        <Icon className="w-5 h-5 text-teal-600" />
      </div>
    </div>
    {trend && trendValue && (
      <div className="mt-4 flex items-center text-sm">
        {trend === 'up' ? (
          <ArrowUpRight className="w-4 h-4 text-emerald-500 mr-1" />
        ) : (
          <ArrowDownRight className="w-4 h-4 text-red-500 mr-1" />
        )}
        <span className={trend === 'up' ? 'text-emerald-600 font-medium' : 'text-red-600 font-medium'}>
          {trendValue}
        </span>
        <span className="text-slate-400 ml-2">vs last month</span>
      </div>
    )}
  </div>
);

export default function Dashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState(null);

  const fetchDashboard = useCallback(async (isManualRefresh = false) => {
    if (isManualRefresh) setRefreshing(true);
    setFetchError(null);
    try {
      const response = await api.get('/dashboard');
      if (response?.data) {
        setData(response.data);
      } else if (response?.kpis) {
        setData(response);
      }
    } catch (error) {
      console.error('Failed to fetch dashboard data', error);
      setFetchError(error.message || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();

    // Auto-refresh every 5 minutes
    const interval = setInterval(() => {
      fetchDashboard(false);
    }, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, [fetchDashboard]);

  if (loading) {
    return (
      <div className="flex h-64 w-full items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-teal-500"></div>
      </div>
    );
  }

  if (fetchError || !data) {
    return (
      <div className="flex flex-col h-72 items-center justify-center gap-4 bg-white rounded-xl border border-slate-200 p-6 text-center shadow-sm">
        <div className="p-3 bg-red-50 text-red-500 rounded-full">
          <AlertTriangle className="w-8 h-8" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-slate-800">Failed to Load Dashboard</h3>
          <p className="text-sm text-slate-500 mt-1 max-w-md">
            {fetchError || 'Could not fetch dashboard metrics. Please check your network connection and server status.'}
          </p>
        </div>
        <button
          onClick={() => {
            setLoading(true);
            fetchDashboard();
          }}
          className="px-5 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          Retry Connection
        </button>
      </div>
    );
  }

  const { kpis, revenue_trend = [], recent_invoices = [], top_clients = [], expense_by_category = [] } = data;

  // Real trend computation from revenue_trend data
  const lastTwoMonths = (revenue_trend || []).slice(-2);
  let trendPct = null;
  let trendDir = 'up';
  if (lastTwoMonths.length === 2) {
    const prevBilled = parseFloat(lastTwoMonths[0]?.billed) || 0;
    const currBilled = parseFloat(lastTwoMonths[1]?.billed) || 0;
    if (prevBilled > 0) {
      const diff = ((currBilled - prevBilled) / prevBilled) * 100;
      trendPct = `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%`;
      trendDir = diff >= 0 ? 'up' : 'down';
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard Overview</h1>
          <p className="text-slate-500 text-sm mt-1">
            Welcome back, {user?.full_name || 'Admin'}. Here's what's happening today.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchDashboard(true)}
            disabled={refreshing}
            className="text-sm font-medium text-slate-600 bg-white hover:bg-slate-50 px-3.5 py-2 rounded-lg border border-slate-200 shadow-sm flex items-center gap-1.5 transition-colors disabled:opacity-50"
            title="Refresh Dashboard"
          >
            <RefreshCw className={`w-4 h-4 text-teal-600 ${refreshing ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
          <div className="text-sm font-medium text-slate-500 bg-white px-4 py-2 rounded-lg border border-slate-200 shadow-sm flex items-center gap-2">
            <Clock className="w-4 h-4 text-slate-400" />
            {format(new Date(), 'EEEE, MMMM d, yyyy')}
          </div>
        </div>
      </div>

      {/* KPI Cards - Row 1 (Primary Financial & Operational) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard 
          title="Total Revenue (This Month)" 
          value={kpis?.revenue?.billed || 0} 
          icon={Wallet} 
          isCurrency={true}
          trend={trendPct ? trendDir : undefined}
          trendValue={trendPct}
        />
        <StatCard 
          title="Pending Collections" 
          value={kpis?.revenue?.outstanding || 0} 
          icon={TrendingUp} 
          isCurrency={true}
          subtitle={`${kpis?.revenue?.overdue_count || 0} overdue invoices`}
        />
        <StatCard 
          title="Total Expenses (This Month)" 
          value={kpis?.expenses || 0} 
          icon={CreditCard} 
          isCurrency={true}
        />
        <StatCard 
          title="Pending Payroll" 
          value={kpis?.payroll?.pending_amount || 0} 
          icon={AlertCircle} 
          isCurrency={true}
          subtitle={`${kpis?.payroll?.pending_count || 0} pending payments`}
        />
      </div>

      {/* KPI Cards - Row 2 (Staff & Clients) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <StatCard 
          title="Active Watchmen & Employees" 
          value={kpis?.employees?.active ?? 0} 
          icon={Users} 
          subtitle={`Total Registered: ${kpis?.employees?.total ?? 0}`}
        />
        <StatCard 
          title="Active Client Sites" 
          value={kpis?.clients?.active ?? 0} 
          icon={Building2} 
          subtitle={`Total Contracts: ${kpis?.clients?.total ?? 0}`}
        />
      </div>

      {/* Quick Actions */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <h3 className="text-sm font-bold text-slate-800 mb-4 uppercase tracking-wider">Quick Actions</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Link to="/invoices" className="flex flex-col items-center justify-center p-4 rounded-xl border border-slate-100 bg-slate-50 hover:bg-teal-50 hover:border-teal-100 hover:text-teal-700 transition-colors group">
            <PlusCircle className="w-6 h-6 text-slate-400 group-hover:text-teal-600 mb-2" />
            <span className="text-sm font-medium">Create Invoice</span>
          </Link>
          <Link to="/attendance" className="flex flex-col items-center justify-center p-4 rounded-xl border border-slate-100 bg-slate-50 hover:bg-teal-50 hover:border-teal-100 hover:text-teal-700 transition-colors group">
            <CheckSquare className="w-6 h-6 text-slate-400 group-hover:text-teal-600 mb-2" />
            <span className="text-sm font-medium">Mark Attendance</span>
          </Link>
          <Link to="/employees" className="flex flex-col items-center justify-center p-4 rounded-xl border border-slate-100 bg-slate-50 hover:bg-teal-50 hover:border-teal-100 hover:text-teal-700 transition-colors group">
            <UserPlus className="w-6 h-6 text-slate-400 group-hover:text-teal-600 mb-2" />
            <span className="text-sm font-medium">Add Watchman</span>
          </Link>
          <Link to="/expenses" className="flex flex-col items-center justify-center p-4 rounded-xl border border-slate-100 bg-slate-50 hover:bg-teal-50 hover:border-teal-100 hover:text-teal-700 transition-colors group">
            <Receipt className="w-6 h-6 text-slate-400 group-hover:text-teal-600 mb-2" />
            <span className="text-sm font-medium">Record Expense</span>
          </Link>
        </div>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Revenue Chart */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-800 mb-6">Revenue Trend (Last 6 Months)</h3>
          <div className="h-72 w-full">
            {revenue_trend.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={revenue_trend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorBilled" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#14b8a6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} tickFormatter={(val) => `₹${val >= 1000 ? (val/1000).toFixed(0) + 'k' : val}`} />
                  <Tooltip 
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    formatter={(value) => [`₹${Number(value).toLocaleString('en-IN')}`, 'Billed']}
                  />
                  <Area type="monotone" dataKey="billed" stroke="#14b8a6" strokeWidth={3} fillOpacity={1} fill="url(#colorBilled)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-400 text-sm">
                No revenue history available yet
              </div>
            )}
          </div>
        </div>

        {/* Expenses by Category Chart */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-800 mb-6">Expenses by Category</h3>
          <div className="h-72 w-full">
            {expense_by_category.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={expense_by_category} layout="vertical" margin={{ top: 0, right: 0, left: 20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                  <XAxis type="number" hide />
                  <YAxis dataKey="category" type="category" axisLine={false} tickLine={false} tick={{fill: '#475569', fontSize: 12}} width={100} />
                  <Tooltip 
                    cursor={{fill: '#f1f5f9'}}
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    formatter={(value) => [`₹${Number(value).toLocaleString('en-IN')}`, 'Amount']}
                  />
                  <Bar dataKey="total" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={24} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-400 text-sm">
                No expenses recorded this month
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Two Column Section: Recent Invoices & Top Clients */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Invoices Table (2 cols) */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-200 flex justify-between items-center bg-slate-50/50">
            <h3 className="text-lg font-semibold text-slate-800">Recent Invoices</h3>
            <Link to="/invoices" className="text-sm font-medium text-teal-600 hover:text-teal-700">
              View All
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-4 font-semibold">Invoice #</th>
                  <th className="px-6 py-4 font-semibold">Client</th>
                  <th className="px-6 py-4 font-semibold">Date</th>
                  <th className="px-6 py-4 font-semibold">Amount</th>
                  <th className="px-6 py-4 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {recent_invoices.map((inv) => {
                  const dateStr = inv.invoice_date ? (inv.invoice_date.includes('T') ? inv.invoice_date : `${inv.invoice_date}T00:00:00`) : null;
                  return (
                    <tr key={inv.invoice_number} className="bg-white border-b border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 font-medium text-slate-900 flex items-center gap-2">
                        <FileText className="w-4 h-4 text-slate-400" />
                        {inv.invoice_number}
                      </td>
                      <td className="px-6 py-4 text-slate-600">{inv.client_name}</td>
                      <td className="px-6 py-4 text-slate-600">
                        {dateStr ? format(new Date(dateStr), 'MMM dd, yyyy') : 'N/A'}
                      </td>
                      <td className="px-6 py-4 font-medium text-slate-900">
                        ₹{parseFloat(inv.final_amount || 0).toLocaleString('en-IN')}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-medium capitalize
                          ${inv.status === 'paid' ? 'bg-emerald-100 text-emerald-700' : 
                            inv.status === 'overdue' ? 'bg-red-100 text-red-700' : 
                            inv.status === 'sent' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-700'}`}>
                          {(inv.status || 'draft').replace('_', ' ')}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {recent_invoices.length === 0 && (
                  <tr>
                    <td colSpan="5" className="px-6 py-8 text-center text-slate-500">
                      No recent invoices found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Top Clients by Revenue (1 col) */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          <div className="px-6 py-5 border-b border-slate-200 flex justify-between items-center bg-slate-50/50">
            <h3 className="text-lg font-semibold text-slate-800">Top Clients</h3>
            <Link to="/clients" className="text-sm font-medium text-teal-600 hover:text-teal-700">
              View All
            </Link>
          </div>
          <div className="p-6 flex-1 flex flex-col justify-between">
            {top_clients.length > 0 ? (
              <div className="space-y-4">
                {top_clients.map((client, idx) => (
                  <div key={idx} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-teal-50 text-teal-700 flex items-center justify-center font-bold text-xs">
                        {idx + 1}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-800">{client.name}</p>
                        <p className="text-xs text-slate-400">{client.city || 'Office'}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-slate-900">₹{parseFloat(client.revenue || 0).toLocaleString('en-IN')}</p>
                      <p className="text-xs text-slate-400">collected</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-400 text-sm">
                No revenue records found
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
