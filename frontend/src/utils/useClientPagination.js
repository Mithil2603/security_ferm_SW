import { useState, useEffect } from 'react';

// Pages a list that is already fully loaded in the browser (settings lists
// like salary structures, team members, categories, vendors). Returns the
// current page's slice plus a `pagination` object for <Pagination />.
// If the list shrinks (e.g. an item is removed), the page is pulled back so
// it never points past the end.
export default function useClientPagination(items, pageSize = 10) {
  const list = Array.isArray(items) ? items : [];
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(list.length / pageSize));

  useEffect(() => {
    if (page > pages) setPage(pages);
  }, [page, pages]);

  const current = Math.min(page, pages);
  return {
    pageItems: list.slice((current - 1) * pageSize, current * pageSize),
    setPage,
    pagination: { page: current, limit: pageSize, total: list.length, pages },
  };
}
