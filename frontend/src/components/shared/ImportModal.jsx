import { useState } from 'react';
import { Upload, X, FileSpreadsheet, CheckCircle2, AlertCircle, Download } from 'lucide-react';
import * as XLSX from 'xlsx';
import api from '../../services/api';

export default function ImportModal({ isOpen, onClose, entityName, endpoint, onImportSuccess }) {
  const [file, setFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  if (!isOpen) return null;

  const handleDownloadSample = () => {
    let sampleData = [];
    let fileName = `Sample_${entityName || 'Import'}_Template.xlsx`;

    if (entityName?.toLowerCase().includes('client')) {
      fileName = 'Sample_Clients_Import_Template.xlsx';
      sampleData = [
        {
          "Name": "Royal Residency Ltd",
          "Address": "123 SG Highway",
          "City": "Ahmedabad",
          "Phone": "9876543210",
          "Email": "contact@royalresidency.com",
          "Monthly Rate": 55000
        },
        {
          "Name": "Green Heights Complex",
          "Address": "45 CG Road",
          "City": "Ahmedabad",
          "Phone": "9876543211",
          "Email": "info@greenheights.com",
          "Monthly Rate": 48000
        }
      ];
    } else if (entityName?.toLowerCase().includes('employee')) {
      fileName = 'Sample_Employees_Import_Template.xlsx';
      sampleData = [
        {
          "Full Name": "Rajesh Kumar",
          "Phone": "9876500001",
          "Email": "rajesh.kumar@example.com",
          "Address": "12 Station Road",
          "City": "Ahmedabad"
        },
        {
          "Full Name": "Vikram Singh",
          "Phone": "9876500002",
          "Email": "vikram.singh@example.com",
          "Address": "45 Green Park",
          "City": "Ahmedabad"
        }
      ];
    } else {
      sampleData = [
        { "Name": "Sample Name", "Phone": "9876543210", "Email": "sample@example.com", "Address": "Sample Address", "City": "Sample City" }
      ];
    }

    const worksheet = XLSX.utils.json_to_sheet(sampleData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, entityName || "Template");
    XLSX.writeFile(workbook, fileName);
  };

  const handleFileChange = (e) => {
    const selected = e.target.files[0];
    if (selected && selected.name.match(/\.(xlsx|xls|csv)$/i)) {
      setFile(selected);
      setError('');
      setResult(null);
    } else {
      setFile(null);
      setError('Please select a valid Excel or CSV file.');
    }
  };

  const handleUpload = async () => {
    if (!file) {
      setError('Please select a file first.');
      return;
    }

    setIsUploading(true);
    setError('');
    
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await api.post(endpoint, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      
      if (res.data.success) {
        setResult(res.data);
        if (onImportSuccess) onImportSuccess();
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Upload failed. Please check the file format.');
    } finally {
      setIsUploading(false);
    }
  };

  const closeModal = () => {
    setFile(null);
    setError('');
    setResult(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50/50">
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Upload className="w-5 h-5 text-indigo-600" />
            Import {entityName}
          </h2>
          <button onClick={closeModal} className="p-2 rounded-lg hover:bg-slate-200 text-slate-500 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto">
          {!result ? (
            <>
              <p className="text-sm text-slate-600 mb-4">
                Upload an Excel file (.xlsx) or CSV containing {entityName.toLowerCase()} data. 
                Ensure the first row contains headers.
              </p>

              <div className="flex items-center justify-between mb-5 p-3.5 bg-indigo-50/70 border border-indigo-100 rounded-xl">
                <div className="text-xs text-indigo-900 font-medium">
                  Need a pre-formatted template?
                </div>
                <button
                  type="button"
                  onClick={handleDownloadSample}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm shrink-0"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download Sample
                </button>
              </div>

              <div className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center bg-slate-50 hover:bg-slate-100 transition-colors">
                <input 
                  type="file" 
                  id="file-upload" 
                  className="hidden" 
                  accept=".xlsx, .xls, .csv" 
                  onChange={handleFileChange}
                />
                <label htmlFor="file-upload" className="cursor-pointer flex flex-col items-center">
                  <FileSpreadsheet className="w-12 h-12 text-slate-400 mb-3" />
                  <span className="text-sm font-medium text-indigo-600 hover:text-indigo-700">Browse files</span>
                  <span className="text-xs text-slate-500 mt-1">
                    {file ? file.name : "or drag and drop"}
                  </span>
                </label>
              </div>

              {error && (
                <div className="mt-4 p-3 bg-red-50 text-red-600 border border-red-200 rounded-lg text-sm flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  {error}
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-6">
              <CheckCircle2 className="w-16 h-16 text-emerald-500 mx-auto mb-4" />
              <h3 className="text-lg font-bold text-slate-800 mb-2">Import Complete!</h3>
              <p className="text-slate-600 text-sm mb-4">{result.message}</p>
              
              <div className="flex gap-4 justify-center mt-6">
                <div className="bg-emerald-50 rounded-lg p-3 w-28 border border-emerald-100">
                  <div className="text-2xl font-black text-emerald-600">{result.data?.imported || 0}</div>
                  <div className="text-[10px] uppercase font-bold text-emerald-800/60 mt-1">Imported</div>
                </div>
                <div className="bg-amber-50 rounded-lg p-3 w-28 border border-amber-100">
                  <div className="text-2xl font-black text-amber-600">{result.data?.skipped || 0}</div>
                  <div className="text-[10px] uppercase font-bold text-amber-800/60 mt-1">Skipped</div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="p-5 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3">
          {!result ? (
            <>
              <button 
                onClick={closeModal}
                className="px-4 py-2 font-medium text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors text-sm"
              >
                Cancel
              </button>
              <button 
                onClick={handleUpload}
                disabled={!file || isUploading}
                className="px-4 py-2 font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 text-sm flex items-center gap-2"
              >
                {isUploading ? (
                  <><span className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></span> Uploading...</>
                ) : (
                  <><Upload className="w-4 h-4" /> Import Data</>
                )}
              </button>
            </>
          ) : (
            <button 
              onClick={closeModal}
              className="px-4 py-2 font-medium text-white bg-slate-800 rounded-lg hover:bg-slate-900 transition-colors text-sm w-full"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
