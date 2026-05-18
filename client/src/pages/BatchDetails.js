import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { XMarkIcon, ArrowLeftIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { uploadService, paymentService, formatCurrency } from '../services/api';
import LoadingSpinner from '../components/LoadingSpinner';

const BATCH_COLORS = { validating: 'bg-yellow-50 text-yellow-700', validated: 'bg-blue-50 text-blue-700', processing: 'bg-purple-50 text-purple-700', completed: 'bg-green-50 text-green-700', partial: 'bg-orange-50 text-orange-700', failed: 'bg-red-50 text-red-700', cancelled: 'bg-gray-50 text-gray-700' };
const PAY_COLORS = { pending: 'bg-gray-100 text-gray-700', processing: 'bg-purple-50 text-purple-700', completed: 'bg-green-50 text-green-700', failed: 'bg-red-50 text-red-700', cancelled: 'bg-gray-50 text-gray-700' };

const Badge = ({ status, map }) => (
  <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${map[status] || 'bg-gray-100 text-gray-700'}`}>{status}</span>
);

const BatchDetails = ({ batch: batchProp, onClose, onRefresh }) => {
  const { batchId: routeId } = useParams();
  const isModal = Boolean(onClose);
  const batchId = batchProp?.batchId || routeId;
  const [batch, setBatch] = useState(batchProp || null);
  const [payments, setPayments] = useState([]);
  const [validationErrors, setValidationErrors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [processing, setProcessing] = useState(false);

  const load = useCallback(async () => {
    if (!batchId) return;
    try {
      setLoading(true);
      setError(null);
      const res = await uploadService.getBatch(batchId);
      const data = res?.data || res;
      setBatch(data.batch);
      setPayments(data.payments || []);
      setValidationErrors(data.validationErrors || []);
    } catch (err) {
      setError(err.message || 'Failed to load batch');
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  useEffect(() => { load(); }, [load]);

  const run = async (fn, msg) => {
    try {
      setProcessing(true);
      await fn();
      toast.success(msg);
      await load();
      onRefresh?.();
    } catch (err) {
      toast.error(err.message || 'Action failed');
    } finally {
      setProcessing(false);
    }
  };

  const filtered = statusFilter ? payments.filter((p) => p.status === statusFilter) : payments;
  const statuses = [...new Set(payments.map((p) => p.status))].filter(Boolean);

  const body = loading ? (
    <div className="flex justify-center py-12"><LoadingSpinner text="Loading batch details..." /></div>
  ) : error ? (
    <p className="py-8 text-center text-red-600">{error}</p>
  ) : !batch ? (
    <p className="py-8 text-center text-gray-500">Batch not found</p>
  ) : (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">{batch.batchId}</h2>
          <p className="text-sm text-gray-600">{batch.originalFileName}</p>
          <div className="mt-2"><Badge status={batch.status} map={BATCH_COLORS} /></div>
        </div>
        <div className="flex flex-wrap gap-2">
          {batch.status === 'validated' && (
            <button type="button" disabled={processing} onClick={() => window.confirm('Process batch?') && run(() => paymentService.processBatch(batchId), 'Processing started')} className="px-4 py-2 text-sm text-white bg-green-600 rounded-md disabled:opacity-50">Process</button>
          )}
          {(batch.status === 'completed' || batch.status === 'partial') && batch.failedRows > 0 && (
            <button type="button" disabled={processing} onClick={() => window.confirm('Retry failed?') && run(() => paymentService.retryBatch(batchId), 'Retry done')} className="px-4 py-2 text-sm text-white bg-orange-600 rounded-md disabled:opacity-50">Retry failed</button>
          )}
          {['validating', 'validated'].includes(batch.status) && (
            <button type="button" onClick={() => window.confirm('Cancel batch?') && run(() => uploadService.cancelBatch(batchId), 'Cancelled')} className="px-4 py-2 text-sm text-red-700 bg-red-50 rounded-md">Cancel</button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[['Total rows', batch.totalRows], ['Successful', batch.successfulRows], ['Failed', batch.failedRows], ['Amount', formatCurrency(batch.totalAmount || 0)]].map(([l, v]) => (
          <div key={l} className="bg-gray-50 rounded-lg p-4"><p className="text-xs text-gray-500 uppercase">{l}</p><p className="text-lg font-semibold">{v ?? 0}</p></div>
        ))}
      </div>
      {validationErrors.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <h3 className="text-sm font-medium text-amber-800 mb-2">Validation errors ({validationErrors.length})</h3>
          <ul className="text-sm text-amber-900 max-h-32 overflow-y-auto space-y-1">
            {validationErrors.slice(0, 15).map((e, i) => <li key={i}>Row {e.row}: {e.message || e.error || 'Error'}</li>)}
          </ul>
        </div>
      )}
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b flex flex-wrap justify-between gap-2 items-center">
          <h3 className="text-sm font-medium">Payments ({filtered.length})</h3>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="text-sm border rounded-md px-2 py-1">
            <option value="">All</option>
            {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="overflow-x-auto max-h-96">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50"><tr>
              {['Row', 'Reference', 'Phone', 'Amount', 'Status', 'M-Pesa', 'Error'].map((h) => (
                <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
              ))}
            </tr></thead>
            <tbody className="divide-y divide-gray-200">
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-500 text-sm">No payments</td></tr>
              ) : filtered.map((p) => (
                <tr key={p._id || p.rowNumber} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-sm">{p.rowNumber}</td>
                  <td className="px-3 py-2 text-sm">{p.internalReference}</td>
                  <td className="px-3 py-2 text-sm">{p.phoneNumber}</td>
                  <td className="px-3 py-2 text-sm">{formatCurrency(p.amount || 0)}</td>
                  <td className="px-3 py-2"><Badge status={p.status} map={PAY_COLORS} /></td>
                  <td className="px-3 py-2 text-sm text-gray-500">{p.mpesaTransactionId || '—'}</td>
                  <td className="px-3 py-2 text-sm text-red-600 truncate max-w-[120px]" title={p.errorMessage}>{p.errorMessage || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  if (isModal) {
    return (
      <div className="fixed inset-0 z-50 overflow-y-auto">
        <div className="fixed inset-0 bg-gray-500/75" onClick={onClose} aria-hidden="true" />
        <div className="flex min-h-full items-center justify-center p-4">
          <div className="relative bg-white rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] overflow-y-auto">
            <button type="button" onClick={onClose} className="absolute right-4 top-4 text-gray-400 hover:text-gray-600 z-10"><XMarkIcon className="h-6 w-6" /></button>
            <div className="p-6">{body}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="py-4">
      <Link to="/batches" className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900 mb-4">
        <ArrowLeftIcon className="h-4 w-4 mr-1" /> Back to batches
      </Link>
      <div className="bg-white shadow rounded-lg p-6">{body}</div>
    </div>
  );
};

export default BatchDetails;
