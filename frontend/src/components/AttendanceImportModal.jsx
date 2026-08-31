import { useState, useRef } from 'react';
import { Upload, X, FileSpreadsheet, CheckCircle2, AlertCircle, Download, FileText, Check, Clock } from 'lucide-react';
import * as XLSX from 'xlsx';
import api from '../services/api';

export default function AttendanceImportModal({ isOpen, onClose, onImportSuccess }) {
  const [file, setFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [previewRows, setPreviewRows] = useState([]);
  const fileInputRef = useRef(null);

  if (!isOpen) return null;

  const sampleData = [
    {
      "Employee ID": "EMP001",
      "Employee Name": "Rajesh Kumar",
      "Date": new Date().toISOString().split('T')[0],
      "Status": "present",
      "Check In": "09:00",
      "Check Out": "18:00",
      "Notes": "Day Shift"
    },
    {
      "Employee ID": "EMP002",
      "Employee Name": "Vikram Singh",
      "Date": new Date().toISOString().split('T')[0],
      "Status": "present",
      "Check In": "20:00",
      "Check Out": "08:00",
      "Notes": "Night Shift"
    },
    {
      "Employee ID": "EMP003",
      "Employee Name": "Amit Patel",
      "Date": new Date().toISOString().split('T')[0],
      "Status": "half_day",
      "Check In": "09:00",
      "Check Out": "13:30",
      "Notes": "Half Day Leave"
    },
    {
      "Employee ID": "EMP004",
      "Employee Name": "Suresh Verma",
      "Date": new Date().toISOString().split('T')[0],
      "Status": "absent",
      "Check In": "",
      "Check Out": "",
      "Notes": "Uninformed"
    }
  ];

  const handleDownloadSampleExcel = () => {
    const worksheet = XLSX.utils.json_to_sheet(sampleData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Attendance_Sample");
    XLSX.writeFile(workbook, "Sample_Attendance_Upload_Template.xlsx");
  };

  const handleDownloadSampleCSV = () => {
    const worksheet = XLSX.utils.json_to_sheet(sampleData);
    const csvOutput = XLSX.utils.sheet_to_csv(worksheet);
    const blob = new Blob([csvOutput], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", "Sample_Attendance_Upload_Template.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleFileChange = (e) => {
    const selected = e.target.files[0];
    if (selected && selected.name.match(/\.(xlsx|xls|csv)$/i)) {
      setFile(selected);
      setError('');
      setResult(null);

      // Client-side quick preview
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const data = evt.target.result;
          const workbook = XLSX.read(data, { type: 'binary' });
          const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
          if (rows && rows.length > 1) {
            setPreviewRows(rows.slice(0, 5)); // first 5 rows
          } else {
            setPreviewRows([]);
          }
        } catch (_) {
          setPreviewRows([]);
        }
      };
      reader.readAsBinaryString(selected);
    } else {
      setFile(null);
      setPreviewRows([]);
      setError('Please select a valid Excel (.xlsx, .xls) or CSV (.csv) file.');
    }
  };

  const handleUpload = async () => {
    if (!file) {
      setError('Please select an Excel or CSV file first.');
      return;
    }

    setIsUploading(true);
    setError('');
    
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await api.post('/attendance/bulk-upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      
      if (res.data.success) {
        setResult(res.data);
        if (onImportSuccess) onImportSuccess();
      } else {
        setError(res.data.message || 'Upload failed');
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to upload file');
    } finally {
      setIsUploading(false);
    }
  };

  const resetForm = () => {
    setFile(null);
    setResult(null);
    setError('');
    setPreviewRows([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl border border-slate-100 overflow-hidden my-8 animate-slide-up">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-600 shadow-sm">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-800">Upload Attendance Data</h3>
              <p className="text-xs text-slate-500">Bulk import personnel daily attendance via Excel or CSV</p>
            </div>
          </div>
          <button 
            onClick={() => { resetForm(); onClose(); }}
            className="text-slate-400 hover:text-slate-600 hover:bg-slate-200/50 p-2 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5">
          {/* Download Sample File Card */}
          <div className="bg-emerald-50/70 border border-emerald-200/70 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-emerald-100 text-emerald-700 rounded-lg shrink-0 mt-0.5">
                <FileText className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-emerald-900">Need the template format?</h4>
                <p className="text-xs text-emerald-700 mt-0.5">Download our pre-formatted template with employee columns and sample data.</p>
              </div>
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
              <button
                type="button"
                onClick={handleDownloadSampleExcel}
                className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Excel (.xlsx)
              </button>
              <button
                type="button"
                onClick={handleDownloadSampleCSV}
                className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 bg-white border border-emerald-300 hover:bg-emerald-100 text-emerald-800 rounded-lg text-xs font-semibold shadow-sm transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                CSV (.csv)
              </button>
            </div>
          </div>

          {/* Success or Error Banners */}
          {error && (
            <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl flex items-start gap-3 text-sm animate-fade-in">
              <AlertCircle className="w-5 h-5 shrink-0 text-red-500 mt-0.5" />
              <div className="flex-1 font-medium">{error}</div>
            </div>
          )}

          {result && (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-900 space-y-2 animate-fade-in">
              <div className="flex items-center gap-2 font-bold text-emerald-800">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                {result.message || 'Import completed successfully!'}
              </div>
              <div className="text-xs text-emerald-700">
                Processed <strong>{result.successCount ?? 0}</strong> record(s) successfully.
              </div>
              {result.errors && result.errors.length > 0 && (
                <div className="mt-3 pt-3 border-t border-emerald-200/60 max-h-36 overflow-y-auto space-y-1">
                  <div className="text-xs font-semibold text-red-700">Row Issues:</div>
                  {result.errors.map((e, idx) => (
                    <div key={idx} className="text-xs text-red-600 flex items-center gap-1">
                      <span>• Line {e.line || idx + 1}:</span> {e.error}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Upload Area */}
          {!result && (
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                Select Attendance File
              </label>
              <div 
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all duration-200 ${
                  file 
                    ? 'border-teal-500 bg-teal-50/40' 
                    : 'border-slate-300 hover:border-teal-400 hover:bg-slate-50'
                }`}
              >
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileChange} 
                  accept=".xlsx, .xls, .csv" 
                  className="hidden" 
                />
                <div className="flex flex-col items-center">
                  <div className={`p-3 rounded-full mb-3 ${file ? 'bg-teal-100 text-teal-700' : 'bg-slate-100 text-slate-500'}`}>
                    <Upload className="w-6 h-6" />
                  </div>
                  {file ? (
                    <div>
                      <p className="font-bold text-slate-800 text-sm">{file.name}</p>
                      <p className="text-xs text-slate-500 mt-1">{(file.size / 1024).toFixed(1)} KB • Ready to process</p>
                    </div>
                  ) : (
                    <div>
                      <p className="font-semibold text-slate-700 text-sm">Click to browse or drag and drop</p>
                      <p className="text-xs text-slate-400 mt-1">Supports Excel (.xlsx, .xls) and CSV (.csv)</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Quick File Preview */}
          {!result && previewRows.length > 0 && (
            <div className="border border-slate-200 rounded-xl overflow-hidden text-xs">
              <div className="bg-slate-100 px-3 py-2 font-bold text-slate-700 flex justify-between items-center">
                <span>File Preview (First {previewRows.length - 1} rows)</span>
                <span className="text-slate-500 font-normal">Auto-detected headers</span>
              </div>
              <div className="overflow-x-auto max-h-36">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                    <tr>
                      {previewRows[0]?.map((h, i) => (
                        <th key={i} className="px-3 py-2 font-semibold truncate max-w-[120px]">{String(h || '')}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {previewRows.slice(1).map((r, ri) => (
                      <tr key={ri} className="hover:bg-slate-50">
                        {r.map((c, ci) => (
                          <td key={ci} className="px-3 py-1.5 text-slate-700 truncate max-w-[120px]">{String(c || '')}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Instructions Box */}
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-200/80 text-xs text-slate-600 space-y-1.5">
            <div className="font-bold text-slate-700 uppercase tracking-wide text-[11px]">Supported Column Headers:</div>
            <p>• <strong>Employee:</strong> <code className="bg-white px-1.5 py-0.5 rounded border">Employee ID</code> (e.g. EMP001) or <code className="bg-white px-1.5 py-0.5 rounded border">Employee Name</code></p>
            <p>• <strong>Date:</strong> <code className="bg-white px-1.5 py-0.5 rounded border">Date</code> (e.g. YYYY-MM-DD or DD-MM-YYYY)</p>
            <p>• <strong>Status:</strong> <code className="bg-white px-1.5 py-0.5 rounded border">Status</code> (present, absent, half_day, leave, holiday)</p>
            <p>• <strong>Timings:</strong> <code className="bg-white px-1.5 py-0.5 rounded border">Check In</code> & <code className="bg-white px-1.5 py-0.5 rounded border">Check Out</code> (e.g. 09:00, 18:00)</p>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3 bg-slate-50">
          <button
            type="button"
            onClick={() => { resetForm(); onClose(); }}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-xl transition-colors shadow-sm"
          >
            {result ? 'Close' : 'Cancel'}
          </button>
          
          {!result && (
            <button
              type="button"
              onClick={handleUpload}
              disabled={!file || isUploading}
              className="px-5 py-2 text-sm font-bold text-white bg-teal-600 hover:bg-teal-700 rounded-xl shadow-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isUploading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  Processing...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  Upload & Process
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
