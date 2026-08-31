import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';

export default function Pagination({ pagination, onPageChange }) {
  if (!pagination) return null;

  const totalRecords = parseInt(pagination.total || 0);
  const limit = parseInt(pagination.limit || 20);
  const page = parseInt(pagination.page || 1);
  const totalPages = parseInt(pagination.pages) || Math.ceil(totalRecords / limit) || 1;

  if (totalPages <= 1 && totalRecords <= limit) return null;
  
  // Calculate page window
  const getPageNumbers = () => {
    const pages = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      if (page <= 4) {
        for (let i = 1; i <= 5; i++) pages.push(i);
        pages.push('...', totalPages);
      } else if (page >= totalPages - 3) {
        pages.push(1, '...');
        for (let i = totalPages - 4; i <= totalPages; i++) pages.push(i);
      } else {
        pages.push(1, '...', page - 1, page, page + 1, '...', totalPages);
      }
    }
    return pages;
  };

  const startRecord = (page - 1) * limit + 1;
  const endRecord = Math.min(page * limit, totalRecords);

  return (
    <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 sm:px-6 mt-4">
      <div className="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-slate-500">
            Showing <span className="font-medium text-slate-800">{startRecord}</span> to <span className="font-medium text-slate-800">{endRecord}</span> of{' '}
            <span className="font-medium text-slate-800">{totalRecords}</span> results
          </p>
        </div>
        <div>
          <nav className="isolate inline-flex -space-x-px rounded-md shadow-sm" aria-label="Pagination">
            <button
              onClick={() => onPageChange(page - 1)}
              disabled={page === 1}
              className="relative inline-flex items-center rounded-l-md px-2 py-2 text-slate-400 ring-1 ring-inset ring-slate-300 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed focus:z-20 focus:outline-offset-0"
            >
              <span className="sr-only">Previous</span>
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </button>
            
            {getPageNumbers().map((pageNum, idx) => (
              pageNum === '...' ? (
                <span key={`ellipsis-${idx}`} className="relative inline-flex items-center px-4 py-2 text-sm font-semibold text-slate-400 ring-1 ring-inset ring-slate-300 focus:outline-offset-0">
                  <MoreHorizontal className="h-4 w-4" />
                </span>
              ) : (
                <button
                  key={`page-${pageNum}`}
                  onClick={() => onPageChange(pageNum)}
                  className={`relative inline-flex items-center px-4 py-2 text-sm font-semibold focus:z-20 focus:outline-offset-0 ring-1 ring-inset ring-slate-300 ${
                    page === pageNum
                      ? 'z-10 bg-teal-500 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-500'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {pageNum}
                </button>
              )
            ))}

            <button
              onClick={() => onPageChange(page + 1)}
              disabled={page === totalPages}
              className="relative inline-flex items-center rounded-r-md px-2 py-2 text-slate-400 ring-1 ring-inset ring-slate-300 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed focus:z-20 focus:outline-offset-0"
            >
              <span className="sr-only">Next</span>
              <ChevronRight className="h-5 w-5" aria-hidden="true" />
            </button>
          </nav>
        </div>
      </div>
    </div>
  );
}
