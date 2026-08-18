import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './DeveloperConsole.css';

const DeveloperConsole = () => {
  console.log('Developer Console Loaded - Passcode included');
  const [errors, setErrors] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState({
    severity: 'all',
    category: 'all',
    is_resolved: 'unresolved',
    search: ''
  });
  const [stats, setStats] = useState({
    total: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0
  });
  const [selectedError, setSelectedError] = useState(null);
  const [page, setPage] = useState(1);

  // Fetch errors
  useEffect(() => {
    fetchErrors();
    const intervalId = setInterval(() => fetchErrors(true), 3000); // Auto-refresh every 5s
    return () => clearInterval(intervalId);
  }, [filter, page]);

  const fetchErrors = async (isAutoRefresh = false) => {
    try {
      if (!isAutoRefresh) setLoading(true);
      const params = new URLSearchParams({
        is_resolved: filter.is_resolved === 'all' ? '' : filter.is_resolved,
        page,
        limit: 50
      });

      if (filter.severity !== 'all') params.append('severity', filter.severity);
      if (filter.category !== 'all') params.append('category', filter.category);
      if (filter.search) params.append('search', filter.search);

      const response = await axios.get(
        `http://localhost:3000/api/errors?${params}`,
        {
          headers: { 
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
            'x-master-passcode': 'M$sterC0de'
          }
        }
      );

      setErrors(response.data.data);
      calculateStats(response.data.data);
    } catch (error) {
      console.error('Failed to fetch errors:', error);
      if (error.response?.status === 403) {
        alert("Developer Console is forbidden. Please ensure your backend is restarted and you have hard-refreshed the page.");
      }
    } finally {
      setLoading(false);
    }
  };

  const calculateStats = (errorList) => {
    const stats = {
      total: errorList.length,
      critical: errorList.filter(e => e.severity === 'critical').length,
      high: errorList.filter(e => e.severity === 'high').length,
      medium: errorList.filter(e => e.severity === 'medium').length,
      low: errorList.filter(e => e.severity === 'low').length
    };
    setStats(stats);
  };

  const resolveError = async (errorId) => {
    try {
      await axios.patch(
        `http://localhost:3000/api/errors/${errorId}/resolve`,
        {},
        { 
          headers: { 
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
            'x-master-passcode': 'M$sterC0de'
          } 
        }
      );
      fetchErrors();
      setSelectedError(null);
    } catch (error) {
      console.error('Failed to resolve error:', error);
    }
  };

  const getSeverityColor = (severity) => {
    const colors = {
      critical: '#e74c3c',
      high: '#e67e22',
      medium: '#f39c12',
      low: '#3498db',
      info: '#2ecc71'
    };
    return colors[severity] || '#95a5a6';
  };

  const formatDate = (date) => {
    return new Date(date).toLocaleString();
  };

  return (
    <div className="developer-console">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #30363d', marginBottom: '20px', paddingBottom: '10px' }}>
        <h1 style={{ borderBottom: 'none', margin: 0, padding: 0 }}>dY"  Developer Console - Error Tracking</h1>
        {loading && <span style={{ color: '#58a6ff', fontSize: '14px' }}>Refreshing...</span>}
      </div>

      {/* Stats Dashboard */}
      <div className="stats-grid">
        <div className="stat-card">
          <h3>Total Errors</h3>
          <p className="stat-number">{stats.total}</p>
        </div>
        <div className="stat-card critical">
          <h3>Critical</h3>
          <p className="stat-number">{stats.critical}</p>
        </div>
        <div className="stat-card high">
          <h3>High</h3>
          <p className="stat-number">{stats.high}</p>
        </div>
        <div className="stat-card medium">
          <h3>Medium</h3>
          <p className="stat-number">{stats.medium}</p>
        </div>
        <div className="stat-card low">
          <h3>Low</h3>
          <p className="stat-number">{stats.low}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="filters">
        <select 
          value={filter.severity}
          onChange={(e) => setFilter({...filter, severity: e.target.value})}
        >
          <option value="all">All Severities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>

        <select 
          value={filter.is_resolved}
          onChange={(e) => setFilter({...filter, is_resolved: e.target.value})}
        >
          <option value="unresolved">Unresolved</option>
          <option value="resolved">Resolved</option>
          <option value="all">All</option>
        </select>

        <input 
          type="text"
          placeholder="Search errors..."
          value={filter.search}
          onChange={(e) => setFilter({...filter, search: e.target.value})}
        />
      </div>

      {/* Errors Table */}
      <div className="errors-table">
        <table>
          <thead>
            <tr>
              <th>Severity</th>
              <th>Error Message</th>
              <th>Feature</th>
              <th>Endpoint</th>
              <th>User</th>
              <th>Time</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {errors.length === 0 && !loading ? (
              <tr><td colSpan="8" style={{textAlign: 'center', padding: '20px'}}>No errors found</td></tr>
            ) : (
              errors.map(error => (
                <tr key={error.id} className={`severity-${error.severity}`}>
                  <td>
                    <span 
                      className="severity-badge"
                      style={{ backgroundColor: getSeverityColor(error.severity) }}
                    >
                      {error.severity?.toUpperCase()}
                    </span>
                  </td>
                  <td 
                    onClick={() => setSelectedError(error)}
                    className="error-message-cell"
                    title={error.error_message}
                  >
                    {error.error_message.substring(0, 50)}...
                  </td>
                  <td>{error.feature || 'N/A'}</td>
                  <td className="endpoint">{error.endpoint || 'N/A'}</td>
                  <td>{error.user_name || 'Anonymous'}</td>
                  <td>{formatDate(error.created_at)}</td>
                  <td>{error.is_resolved ? '✅ Resolved' : '🔴 Active'}</td>
                  <td>
                    <button 
                      onClick={() => resolveError(error.id)}
                      disabled={error.is_resolved}
                      className="btn-resolve"
                    >
                      Resolve
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Error Detail Modal */}
      {selectedError && (
        <div className="modal-overlay" onClick={() => setSelectedError(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Error Details</h2>
            <div className="error-detail">
              <p><strong>Type:</strong> {selectedError.error_type}</p>
              <p><strong>Message:</strong> {selectedError.error_message}</p>
              <p><strong>Severity:</strong> {selectedError.severity}</p>
              <p><strong>Feature:</strong> {selectedError.feature || 'N/A'}</p>
              <p><strong>Endpoint:</strong> {selectedError.endpoint}</p>
              <p><strong>Method:</strong> {selectedError.method}</p>
              <p><strong>User:</strong> {selectedError.user_name || 'Anonymous'}</p>
              <p><strong>IP:</strong> {selectedError.client_ip}</p>
              <p><strong>Time:</strong> {formatDate(selectedError.created_at)}</p>

              {selectedError.stack_trace && (
                <div className="stack-trace">
                  <h4>Stack Trace:</h4>
                  <pre>{selectedError.stack_trace}</pre>
                </div>
              )}

              {selectedError.additional_data && (
                <div className="additional-data">
                  <h4>Additional Data:</h4>
                  <pre>{JSON.stringify(JSON.parse(selectedError.additional_data), null, 2)}</pre>
                </div>
              )}

              <div className="modal-actions">
                <button 
                  onClick={() => resolveError(selectedError.id)}
                  disabled={selectedError.is_resolved}
                  className="btn-primary"
                >
                  Mark as Resolved
                </button>
                <button 
                  onClick={() => setSelectedError(null)}
                  className="btn-secondary"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DeveloperConsole;
