import { useState } from 'react';
import { Outlet, Navigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import UpdateNotification from '../UpdateNotification';
import { useAuth } from '../../context/AuthContext';

export default function Layout() {
  const { user, loading } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-teal-500"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="flex flex-col h-screen bg-slate-50 overflow-hidden selection:bg-teal-200 print:block print:h-auto print:overflow-visible print:bg-white">
      <UpdateNotification />

      {/* Full-Width Constant Header across the top */}
      <div className="print:hidden w-full shrink-0 z-30">
        <Topbar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />
      </div>

      {/* Below the Header: Sidebar + Main Content */}
      <div className="flex flex-1 min-h-0 relative overflow-hidden">
        <div className="print:hidden h-full shrink-0 z-20 w-0 md:w-16">
          <Sidebar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />
        </div>

        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-7 print:p-0 print:overflow-visible min-w-0">
          <div className="mx-auto w-full max-w-[1680px] animate-fade-in print:max-w-none print:mx-0">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
