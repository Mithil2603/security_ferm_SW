import { useState, useEffect } from 'react';
import { Zap, Bell, Settings, Play, Pause, Plus, Eye, X, Check, Trash2, AlertTriangle, CheckCircle, Info } from 'lucide-react';
import api from '../services/api';
import TableSkeleton from '../components/TableSkeleton';
import { toast, confirmDialog } from '../context/ToastContext';

const TYPE_ICONS = { info: Info, warning: AlertTriangle, success: CheckCircle, alert: AlertTriangle, reminder: Bell, error: AlertTriangle };
const TYPE_COLORS = { info: 'blue', warning: 'amber', success: 'emerald', alert: 'red', reminder: 'purple', error: 'red' };

export default function Workflows() {
  const [tab, setTab] = useState('rules'); // rules | notifications | approvals | logs
  const [rules, setRules] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [approvals, setApprovals] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [createRule, setCreateRule] = useState(false);
  const [ruleForm, setRuleForm] = useState({
    name: '', trigger_entity: 'invoice', trigger_event: 'overdue',
    action_type: 'send_notification', priority: 5,
    condition: { field: '', operator: '>=', value: '' },
    action_config: { message: '' },
  });

  const fetchRules = async () => { try { setLoading(true); const r = await api.get('/workflows/rules'); setRules(r.data || []); } catch {} finally { setLoading(false); } };
  const fetchNotifications = async () => { try { setLoading(true); const r = await api.get('/workflows/notifications'); setNotifications(r.data || []); setUnreadCount(r.unread_count || 0); } catch {} finally { setLoading(false); } };
  const fetchApprovals = async () => { try { setLoading(true); const r = await api.get('/workflows/auto-approvals'); setApprovals(r.data || []); } catch {} finally { setLoading(false); } };
  const fetchLogs = async () => { try { setLoading(true); const r = await api.get('/workflows/logs?limit=50'); setLogs(r.data || []); } catch {} finally { setLoading(false); } };

  useEffect(() => {
    if (tab === 'rules') fetchRules();
    else if (tab === 'notifications') fetchNotifications();
    else if (tab === 'approvals') fetchApprovals();
    else fetchLogs();
  }, [tab]);

  const handleCreateRule = async (e) => {
    e.preventDefault();
    try {
      await api.post('/workflows/rules', ruleForm);
      toast.success('Workflow rule created successfully');
      setCreateRule(false);
      setRuleForm({
        name: '', trigger_entity: 'invoice', trigger_event: 'overdue',
        action_type: 'send_notification', priority: 5,
        condition: { field: '', operator: '>=', value: '' },
        action_config: { message: '' },
      });
      fetchRules();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to create rule');
    }
  };

  const scanOverdue = async () => {
    try {
      const r = await api.post('/workflows/scan-overdue');
      toast.success(`Scanned ${r.data?.scanned ?? 0} invoices. ${r.data?.reminders_created ?? 0} new reminders created.`);
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to scan overdue invoices');
    }
  };

  const markAllRead = async () => {
    try { await api.post('/workflows/notifications/read-all'); fetchNotifications(); } catch {}
  };

  const markRead = async (id) => {
    try { await api.post(`/workflows/notifications/${id}/read`); fetchNotifications(); } catch {}
  };

  const toggleRule = async (id, currentActive) => {
    try {
      await api.put(`/workflows/rules/${id}`, { is_active: currentActive ? 0 : 1 });
      toast.success(currentActive ? 'Rule deactivated' : 'Rule activated');
      fetchRules();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to update rule');
    }
  };

  const handleDeleteRule = async (id, name) => {
    const confirmed = await confirmDialog({
      title: 'Delete Workflow Rule',
      message: `Are you sure you want to delete rule "${name}"? This action cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      variant: 'danger'
    });
    if (!confirmed) return;

    try {
      await api.delete(`/workflows/rules/${id}`);
      toast.success('Workflow rule deleted successfully');
      fetchRules();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to delete rule');
    }
  };

  const handleDeleteApproval = async (id, name) => {
    const confirmed = await confirmDialog({
      title: 'Delete Auto-Approval Rule',
      message: `Are you sure you want to delete "${name}"?`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      variant: 'danger'
    });
    if (!confirmed) return;

    try {
      await api.delete(`/workflows/auto-approvals/${id}`);
      toast.success('Auto-approval rule deleted successfully');
      fetchApprovals();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to delete auto-approval rule');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Zap className="w-6 h-6 text-amber-600" /> Workflows & Automation
          </h1>
          <p className="text-slate-500 mt-1">Rules engine, notifications, auto-approvals & reminders</p>
        </div>
        <div className="flex gap-2">
          {tab === 'rules' && (
            <>
              <button type="button" onClick={scanOverdue} className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-lg font-medium transition-colors text-sm">
                <Play className="w-4 h-4" /> Scan Overdue
              </button>
              <button type="button" onClick={() => setCreateRule(true)} className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg font-medium transition-colors text-sm">
                <Plus className="w-4 h-4" /> New Rule
              </button>
            </>
          )}
          {tab === 'notifications' && unreadCount > 0 && (
            <button type="button" onClick={markAllRead} className="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-colors text-sm font-medium">
              <Check className="w-4 h-4" /> Mark All Read
            </button>
          )}
        </div>
      </div>

      <div className="flex bg-white rounded-lg p-1 w-fit">
        {[
          { id: 'rules', label: 'Workflow Rules', icon: Settings },
          { id: 'notifications', label: `Notifications${unreadCount > 0 ? ` (${unreadCount})` : ''}`, icon: Bell },
          { id: 'approvals', label: 'Auto-Approvals', icon: CheckCircle },
          { id: 'logs', label: 'Execution Logs', icon: Eye },
        ].map(t => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${tab === t.id ? 'bg-teal-600 text-white' : 'text-slate-500 hover:text-slate-900'}`}>
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {/* ═══ Rules Tab ═══ */}
      {tab === 'rules' && (loading ? <TableSkeleton /> : (
        <div className="bg-white shadow-sm border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="text-slate-500 border-b border-slate-200">
              <th className="text-left p-4 font-medium">Rule</th>
              <th className="text-left p-4 font-medium">Trigger</th>
              <th className="text-left p-4 font-medium">Action</th>
              <th className="text-center p-4 font-medium">Priority</th>
              <th className="text-center p-4 font-medium">Executions</th>
              <th className="text-center p-4 font-medium">Status</th>
              <th className="text-right p-4 font-medium">Actions</th>
            </tr></thead>
            <tbody>
              {rules.length === 0 ? (
                <tr><td colSpan="7" className="p-8 text-center text-slate-400">No workflow rules configured.</td></tr>
              ) : rules.map(r => (
                <tr key={r.id} className="border-b border-slate-200 hover:bg-slate-50">
                  <td className="p-4">
                    <div className="font-medium text-slate-900">{r.name}</div>
                    {r.description && <div className="text-xs text-slate-400 mt-0.5">{r.description}</div>}
                  </td>
                  <td className="p-4">
                    <span className="text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded">{r.trigger_entity}</span>
                    <span className="text-slate-400 mx-1">→</span>
                    <span className="text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded">{r.trigger_event}</span>
                  </td>
                  <td className="p-4"><span className="text-xs bg-amber-500/20 text-amber-600 px-2 py-0.5 rounded">{r.action_type}</span></td>
                  <td className="p-4 text-center text-slate-900">{r.priority}</td>
                  <td className="p-4 text-center text-slate-700">{r.execution_count}</td>
                  <td className="p-4 text-center">
                    <button
                      type="button"
                      onClick={() => toggleRule(r.id, r.is_active)}
                      className={`text-xs px-2.5 py-1 rounded-full font-medium cursor-pointer transition-colors ${r.is_active ? 'bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/25' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                      title={r.is_active ? 'Click to deactivate' : 'Click to activate'}
                    >
                      {r.is_active ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td className="p-4 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => toggleRule(r.id, r.is_active)}
                        className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-colors"
                        title={r.is_active ? 'Pause / Deactivate' : 'Activate'}
                      >
                        {r.is_active ? <Pause className="w-4 h-4 text-amber-600" /> : <Play className="w-4 h-4 text-emerald-600" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteRule(r.id, r.name)}
                        className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600 transition-colors"
                        title="Delete Rule"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {/* ═══ Notifications Tab ═══ */}
      {tab === 'notifications' && (loading ? <TableSkeleton /> : (
        <div className="space-y-2">
          {notifications.length === 0 ? (
            <div className="bg-white shadow-sm border border-slate-200 rounded-xl p-12 text-center text-slate-400">No notifications.</div>
          ) : notifications.map(n => {
            const Icon = TYPE_ICONS[n.type] || Info;
            const color = TYPE_COLORS[n.type] || 'blue';
            return (
              <div key={n.id} className={`flex items-start gap-3 p-4 rounded-xl border transition-colors ${n.is_read ? 'bg-white/20 border-slate-200' : `bg-${color}-500/5 border-${color}-500/20`}`}>
                <Icon className={`w-5 h-5 mt-0.5 text-${color}-400 shrink-0`} />
                <div className="flex-1 min-w-0">
                  <p className={`font-medium ${n.is_read ? 'text-slate-500' : 'text-slate-900'}`}>{n.title}</p>
                  <p className="text-sm text-slate-400 mt-0.5">{n.message}</p>
                  <p className="text-xs text-gray-600 mt-1">{new Date(n.created_at).toLocaleString()}</p>
                </div>
                {!n.is_read && (
                  <button type="button" onClick={() => markRead(n.id)} className="text-slate-400 hover:text-slate-900 p-1"><Check className="w-4 h-4" /></button>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {/* ═══ Auto-Approvals Tab ═══ */}
      {tab === 'approvals' && (loading ? <TableSkeleton /> : (
        <div className="bg-white shadow-sm border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="text-slate-500 border-b border-slate-200">
              <th className="text-left p-4 font-medium">Name</th>
              <th className="text-left p-4 font-medium">Entity</th>
              <th className="text-right p-4 font-medium">Max Amount</th>
              <th className="text-center p-4 font-medium">Approvals</th>
              <th className="text-center p-4 font-medium">Status</th>
              <th className="text-right p-4 font-medium">Actions</th>
            </tr></thead>
            <tbody>
              {approvals.length === 0 ? (
                <tr><td colSpan="6" className="p-8 text-center text-slate-400">No auto-approval rules configured.</td></tr>
              ) : approvals.map(a => (
                <tr key={a.id} className="border-b border-slate-200 hover:bg-slate-50">
                  <td className="p-4 text-slate-900 font-medium">{a.name}</td>
                  <td className="p-4"><span className="text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded">{a.entity_type}</span></td>
                  <td className="p-4 text-right text-slate-900">{a.max_amount ? `₹${Number(a.max_amount).toLocaleString('en-IN')}` : 'No limit'}</td>
                  <td className="p-4 text-center text-slate-700">{a.approval_count}</td>
                  <td className="p-4 text-center"><span className={`text-xs px-2 py-0.5 rounded ${a.is_active ? 'bg-emerald-500/20 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>{a.is_active ? 'Active' : 'Inactive'}</span></td>
                  <td className="p-4 text-right">
                    <button
                      type="button"
                      onClick={() => handleDeleteApproval(a.id, a.name)}
                      className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600 transition-colors"
                      title="Delete Auto-Approval Rule"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {/* ═══ Logs Tab ═══ */}
      {tab === 'logs' && (loading ? <TableSkeleton /> : (
        <div className="bg-white shadow-sm border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="text-slate-500 border-b border-slate-200">
              <th className="text-left p-4 font-medium">Rule</th>
              <th className="text-center p-4 font-medium">Condition</th>
              <th className="text-center p-4 font-medium">Status</th>
              <th className="text-left p-4 font-medium">Result</th>
              <th className="text-left p-4 font-medium">Time</th>
            </tr></thead>
            <tbody>
              {logs.length === 0 ? (
                <tr><td colSpan="5" className="p-8 text-center text-slate-400">No execution logs yet.</td></tr>
              ) : logs.map(l => (
                <tr key={l.id} className="border-b border-slate-200 hover:bg-slate-50">
                  <td className="p-4 text-slate-900 font-medium">{l.rule_name}</td>
                  <td className="p-4 text-center">{l.condition_result ? <CheckCircle className="w-4 h-4 text-emerald-600 inline" /> : <X className="w-4 h-4 text-slate-400 inline" />}</td>
                  <td className="p-4 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded ${l.status === 'success' ? 'bg-emerald-500/20 text-emerald-600' : l.status === 'failed' ? 'bg-red-500/20 text-red-600' : 'bg-slate-100 text-slate-400'}`}>{l.status}</span>
                  </td>
                  <td className="p-4 text-slate-500 text-xs max-w-xs truncate">{l.action_result}</td>
                  <td className="p-4 text-slate-400 text-xs">{new Date(l.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {/* ═══ Create Rule Modal ═══ */}
      {createRule && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 w-full max-w-md">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-slate-900">New Workflow Rule</h2>
              <button type="button" onClick={() => setCreateRule(false)} className="text-slate-500 hover:text-slate-900"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleCreateRule} className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Name *</label>
                <input type="text" value={ruleForm.name} onChange={e => setRuleForm({...ruleForm, name: e.target.value})} required className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Trigger Entity *</label>
                  <select value={ruleForm.trigger_entity} onChange={e => setRuleForm({...ruleForm, trigger_entity: e.target.value})} className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-sm">
                    {['invoice','expense','payroll','attendance','employee','pf','gst'].map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Trigger Event *</label>
                  <select value={ruleForm.trigger_event} onChange={e => setRuleForm({...ruleForm, trigger_event: e.target.value})} className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-sm">
                    {['created','updated','status_changed','overdue','approaching_due','amount_exceeded','monthly_cycle','approval_required'].map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Action Type *</label>
                <select value={ruleForm.action_type} onChange={e => setRuleForm({...ruleForm, action_type: e.target.value})} className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-sm">
                  {['send_notification','auto_approve','escalate','create_reminder','update_status'].map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Action Message</label>
                <input type="text" value={ruleForm.action_config.message} onChange={e => setRuleForm({...ruleForm, action_config: {...ruleForm.action_config, message: e.target.value}})} className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-sm" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setCreateRule(false)} className="flex-1 px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-colors text-sm font-medium">Cancel</button>
                <button type="submit" className="flex-1 bg-teal-600 hover:bg-teal-700 text-white py-2 rounded-lg font-medium transition-colors text-sm">Create Rule</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
