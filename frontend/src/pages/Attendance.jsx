import { useState, useEffect, useRef } from 'react';
import { CalendarCheck, CalendarDays, Check, X, Clock, AlertCircle, Users, X as XIcon, Upload, FileSpreadsheet } from 'lucide-react';
import api from '../services/api';
import { format } from 'date-fns';
import AttendanceImportModal from '../components/AttendanceImportModal';

export default function Attendance() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [employees, setEmployees] = useState([]);
  const [bulkRecords, setBulkRecords] = useState([]);
  const [bulkDate, setBulkDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [submitting, setSubmitting] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);
  const [uploadingCsv, setUploadingCsv] = useState(false);
  const fileInputRef = useRef(null);

  const fetchAttendance = async () => {
    try {
      setLoading(true);
      const response = await api.get(`/attendance?from_date=${dateFilter}&to_date=${dateFilter}`);
      setRecords(response.data || []);
    } catch (err) {
      console.error('Failed to fetch attendance', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAttendance(); }, [dateFilter]);

  const openBulkModal = async () => {
    setBulkResult(null);
    setBulkDate(dateFilter);
    try {
      const response = await api.get('/employees?is_active=true&limit=200');
      const emps = response.data || [];
      setEmployees(emps);
      setBulkRecords(emps.map(emp => ({
        employee_id: emp.id,
        employee_name: emp.full_name,
        emp_code: emp.employee_id,
        client_name: emp.client_name || 'Unassigned',
        status: 'present',
        check_in_time: '08:00',
        check_out_time: '20:00',
        notes: ''
      })));
      setIsBulkModalOpen(true);
    } catch (err) {
      console.error('Failed to fetch employees', err);
    }
  };

  const updateBulkRecord = (index, field, value) => {
    const updated = [...bulkRecords];
    updated[index] = { ...updated[index], [field]: value };
    setBulkRecords(updated);
  };

  const handleBulkSubmit = async () => {
    setSubmitting(true);
    setBulkResult(null);
    try {
      const payload = bulkRecords.map(r => ({
        employee_id: r.employee_id,
        attendance_date: bulkDate,
        status: r.status,
        check_in_time: r.status === 'present' || r.status === 'half_day' ? r.check_in_time : null,
        check_out_time: r.status === 'present' || r.status === 'half_day' ? r.check_out_time : null,
        notes: r.notes,
      }));
      const response = await api.post('/attendance/bulk', { records: payload });
      setBulkResult({ success: true, message: response.message || `${payload.length} records marked` });
      setDateFilter(bulkDate);
      setTimeout(() => {
        setIsBulkModalOpen(false);
        fetchAttendance();
      }, 1500);
    } catch (err) {
      setBulkResult({ success: false, message: err.message || 'Failed to submit bulk attendance' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCSVUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploadingCsv(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await api.post('/attendance/bulk-upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      alert(response.message || 'Upload successful');
      fetchAttendance();
    } catch (err) {
      alert(err.message || 'Failed to upload CSV');
    } finally {
      setUploadingCsv(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const statusColors = {
    present: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    absent: 'bg-red-50 text-red-700 border-red-200',
    leave: 'bg-amber-50 text-amber-700 border-amber-200',
    half_day: 'bg-blue-50 text-blue-700 border-blue-200',
    holiday: 'bg-purple-50 text-purple-700 border-purple-200',
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <CalendarCheck className="w-6 h-6 text-teal-600" />
            Attendance Tracker
          </h1>
          <p className="text-slate-500 text-sm mt-1">Daily check-in and shift tracking for all personnel.</p>
        </div>
        <div className="flex items-center gap-3">
          <input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:ring-2 focus:ring-teal-500 outline-none" />
          
          <button 
            onClick={() => setIsUploadModalOpen(true)} 
            className="bg-white border border-slate-200 hover:bg-slate-50 hover:border-teal-200 hover:text-teal-700 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm flex items-center gap-2"
          >
            <FileSpreadsheet className="w-4 h-4 text-teal-600" />
            Upload Attendance (Excel / CSV)
          </button>

          <button onClick={openBulkModal} className="bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm flex items-center gap-2">
            <Users className="w-4 h-4" />
            Mark Bulk Attendance
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-6 py-4 font-semibold">Employee</th>
                <th className="px-6 py-4 font-semibold">Location</th>
                <th className="px-6 py-4 font-semibold">Shift Timing</th>
                <th className="px-6 py-4 font-semibold">Total Hours</th>
                <th className="px-6 py-4 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan="5" className="px-6 py-12 text-center text-slate-500">
                  <div className="flex justify-center mb-2"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-teal-500"></div></div>Loading records...
                </td></tr>
              ) : records.length === 0 ? (
                <tr><td colSpan="5" className="px-6 py-12 text-center text-slate-500">
                  <div className="flex justify-center mb-3"><CalendarDays className="w-10 h-10 text-slate-300" /></div>
                  <p className="font-medium text-slate-600 mb-1">No attendance records found for this date</p>
                  <p className="text-xs">Click "Mark Bulk Attendance" to add records.</p>
                </td></tr>
              ) : (
                records.map((record) => (
                  <tr key={record.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-semibold text-slate-900">{record.employee_name}</div>
                      <div className="text-slate-500 text-xs mt-0.5">{record.emp_id}</div>
                    </td>
                    <td className="px-6 py-4 text-slate-600 font-medium">{record.client_name || 'Standby'}</td>
                    <td className="px-6 py-4">
                      {record.check_in_time && record.check_out_time ? (
                        <div className="flex items-center gap-1.5 text-slate-700">
                          <Clock className="w-4 h-4 text-slate-400" />
                          <span>{record.check_in_time.substring(0, 5)} - {record.check_out_time.substring(0, 5)}</span>
                        </div>
                      ) : (
                        <span className="text-slate-400 italic">Not logged</span>
                      )}
                    </td>
                    <td className="px-6 py-4 font-medium text-slate-800">{record.hours_worked ? `${record.hours_worked} hrs` : '-'}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium capitalize border ${statusColors[record.status] || statusColors.present}`}>
                        {record.status === 'present' && <Check className="w-3 h-3" />}
                        {record.status === 'absent' && <X className="w-3 h-3" />}
                        {record.status === 'leave' && <AlertCircle className="w-3 h-3" />}
                        {record.status.replace('_', ' ')}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bulk Attendance Modal */}
      {isBulkModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl overflow-hidden animate-slide-up max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <CalendarCheck className="w-5 h-5 text-teal-600" />
                Mark Bulk Attendance
              </h3>
              <div className="flex items-center gap-3">
                <input type="date" value={bulkDate} onChange={(e) => setBulkDate(e.target.value)}
                  className="border border-slate-200 rounded-lg px-3 py-2 text-sm" />
                <button onClick={() => setIsBulkModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                  <XIcon className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="overflow-y-auto flex-1 p-4 min-h-0">
              {bulkResult && (
                <div className={`mb-4 p-3 rounded-lg text-sm ${bulkResult.success ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                  {bulkResult.message}
                </div>
              )}

              {bulkRecords.length === 0 ? (
                <p className="text-center text-slate-500 py-8">No active employees found.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3 text-left">Employee</th>
                      <th className="px-4 py-3 text-left">Site</th>
                      <th className="px-4 py-3 text-center">Status</th>
                      <th className="px-4 py-3 text-center">Check In</th>
                      <th className="px-4 py-3 text-center">Check Out</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {bulkRecords.map((record, idx) => (
                      <tr key={record.employee_id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-800">{record.employee_name}</div>
                          <div className="text-xs text-slate-400 font-mono">{record.emp_code}</div>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600">{record.client_name}</td>
                        <td className="px-4 py-3 text-center">
                          <select value={record.status} onChange={(e) => updateBulkRecord(idx, 'status', e.target.value)}
                            className={`px-2 py-1 rounded-lg text-xs font-medium border ${statusColors[record.status]} cursor-pointer`}>
                            <option value="present">Present</option>
                            <option value="absent">Absent</option>
                            <option value="leave">Leave</option>
                            <option value="half_day">Half Day</option>
                            <option value="holiday">Holiday</option>
                          </select>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <input type="time" value={record.check_in_time}
                            onChange={(e) => updateBulkRecord(idx, 'check_in_time', e.target.value)}
                            disabled={record.status === 'absent' || record.status === 'leave' || record.status === 'holiday'}
                            className="border border-slate-200 rounded-lg px-2 py-1 text-xs w-24 disabled:opacity-40" />
                        </td>
                        <td className="px-4 py-3 text-center">
                          <input type="time" value={record.check_out_time}
                            onChange={(e) => updateBulkRecord(idx, 'check_out_time', e.target.value)}
                            disabled={record.status === 'absent' || record.status === 'leave' || record.status === 'holiday'}
                            className="border border-slate-200 rounded-lg px-2 py-1 text-xs w-24 disabled:opacity-40" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex justify-between items-center shrink-0">
              <p className="text-xs text-slate-500">{bulkRecords.length} employees</p>
              <div className="flex gap-3">
                <button onClick={() => setIsBulkModalOpen(false)} className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors">Cancel</button>
                <button onClick={handleBulkSubmit} disabled={submitting || bulkRecords.length === 0}
                  className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors shadow-sm disabled:opacity-50">
                  {submitting ? 'Submitting...' : 'Submit Attendance'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Attendance Import Modal (Excel .xlsx / CSV) */}
      <AttendanceImportModal 
        isOpen={isUploadModalOpen} 
        onClose={() => setIsUploadModalOpen(false)} 
        onImportSuccess={() => {
          fetchAttendance();
        }} 
      />
    </div>
  );
}
