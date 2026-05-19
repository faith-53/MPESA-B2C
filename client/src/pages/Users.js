import React, { useState, useEffect, useCallback } from 'react';
import { PlusIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { usersService, formatDate } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import LoadingSpinner from '../components/LoadingSpinner';

const ROLES = [
  { value: 'admin', label: 'Administrator' },
  { value: 'finance_officer', label: 'Finance Officer' },
  { value: 'user', label: 'User' },
];

const emptyForm = { firstName: '', lastName: '', email: '', password: '', role: 'user', isActive: true };

const Users = () => {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ search: '', role: '', isActive: '' });
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [resetModal, setResetModal] = useState(null);
  const [newPassword, setNewPassword] = useState('');

  const fetchUsers = useCallback(async (page = 1) => {
    try {
      setLoading(true);
      const params = { page, limit: 20 };
      if (filters.search) params.search = filters.search;
      if (filters.role) params.role = filters.role;
      if (filters.isActive !== '') params.isActive = filters.isActive;
      const res = await usersService.getUsers(params);
      const data = res?.data || res;
      setUsers(data.users || []);
      setPagination(data.pagination || { page: 1, pages: 1, total: 0 });
    } catch (err) {
      toast.error(err.message || 'Failed to load users');
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [filters.search, filters.role, filters.isActive]); // Add dependencies

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const openCreate = () => {
    setEditingUser(null);
    setForm(emptyForm);
    setModalOpen(true);
  };

  const openEdit = (u) => {
    setEditingUser(u);
    setForm({
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      password: '',
      role: u.role,
      isActive: u.isActive,
    });
    setModalOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      setSaving(true);
      if (editingUser) {
        const payload = {
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email,
          role: form.role,
          isActive: form.isActive,
        };
        await usersService.updateUser(editingUser._id, payload);
        toast.success('User updated');
      } else {
        await usersService.createUser({
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email,
          password: form.password,
          role: form.role,
        });
        toast.success('User created');
      }
      setModalOpen(false);
      fetchUsers(pagination.page);
    } catch (err) {
      toast.error(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (u) => {
    if (!window.confirm(`Delete ${u.email}?`)) return;
    try {
      await usersService.deleteUser(u._id);
      toast.success('User deleted');
      fetchUsers(pagination.page);
    } catch (err) {
      toast.error(err.message || 'Delete failed');
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (!resetModal) return;
    try {
      setSaving(true);
      await usersService.resetPassword(resetModal._id, { newPassword });
      toast.success('Password reset');
      setResetModal(null);
      setNewPassword('');
    } catch (err) {
      toast.error(err.message || 'Reset failed');
    } finally {
      setSaving(false);
    }
  };

  const applyFilters = () => {
    fetchUsers(1);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">User Management</h1>
          <p className="text-gray-600">Manage system users and roles</p>
        </div>
        <button type="button" onClick={openCreate} className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700">
          <PlusIcon className="h-5 w-5 mr-2" /> Add user
        </button>
      </div>

      <div className="bg-white shadow rounded-lg p-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <input type="text" placeholder="Search..." value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} className="border border-gray-300 rounded-md px-3 py-2 text-sm" />
          <select value={filters.role} onChange={(e) => setFilters({ ...filters, role: e.target.value })} className="border border-gray-300 rounded-md px-3 py-2 text-sm">
            <option value="">All roles</option>
            {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <select value={filters.isActive} onChange={(e) => setFilters({ ...filters, isActive: e.target.value })} className="border border-gray-300 rounded-md px-3 py-2 text-sm">
            <option value="">All status</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
          <button type="button" onClick={applyFilters} className="px-4 py-2 text-sm font-medium text-white bg-gray-800 rounded-md hover:bg-gray-900">Apply filters</button>
        </div>
      </div>

      <div className="bg-white shadow rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-8 flex justify-center"><LoadingSpinner /></div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last login</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {users.length === 0 ? (
                <tr><td colSpan={6} className="px-6 py-8 text-center text-gray-500">No users found</td></tr>
              ) : users.map((u) => (
                <tr key={u._id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">{u.firstName} {u.lastName}</td>
                  <td className="px-6 py-4 text-sm text-gray-900">{u.email}</td>
                  <td className="px-6 py-4 text-sm text-gray-500">{u.role}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${u.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                      {u.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">{u.lastLogin ? formatDate(u.lastLogin) : '—'}</td>
                  <td className="px-6 py-4 text-right text-sm space-x-2">
                    <button type="button" onClick={() => openEdit(u)} className="text-blue-600 hover:text-blue-900"><PencilIcon className="h-4 w-4 inline" /></button>
                    <button type="button" onClick={() => setResetModal(u)} className="text-gray-600 hover:text-gray-900 text-xs">Reset pwd</button>
                    {currentUser?.id !== u._id && currentUser?._id !== u._id && (
                      <button type="button" onClick={() => handleDelete(u)} className="text-red-600 hover:text-red-900"><TrashIcon className="h-4 w-4 inline" /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {pagination.pages > 1 && (
          <div className="px-6 py-3 border-t flex justify-between items-center text-sm text-gray-600">
            <span>Page {pagination.page} of {pagination.pages} ({pagination.total} users)</span>
            <div className="space-x-2">
              <button type="button" disabled={pagination.page <= 1} onClick={() => fetchUsers(pagination.page - 1)} className="px-3 py-1 border rounded disabled:opacity-50">Previous</button>
              <button type="button" disabled={pagination.page >= pagination.pages} onClick={() => fetchUsers(pagination.page + 1)} className="px-3 py-1 border rounded disabled:opacity-50">Next</button>
            </div>
          </div>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="fixed inset-0 bg-gray-500/75" onClick={() => setModalOpen(false)} />
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
              <h2 className="text-lg font-medium mb-4">{editingUser ? 'Edit user' : 'Create user'}</h2>
              <form onSubmit={handleSave} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">First name</label>
                    <input required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} className="w-full border rounded-md px-3 py-2 text-sm" /></div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Last name</label>
                    <input required value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} className="w-full border rounded-md px-3 py-2 text-sm" /></div>
                </div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full border rounded-md px-3 py-2 text-sm" /></div>
                {!editingUser && (
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                    <input type="password" required={!editingUser} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="w-full border rounded-md px-3 py-2 text-sm" /></div>
                )}
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                  <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="w-full border rounded-md px-3 py-2 text-sm">
                    {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select></div>
                {editingUser && (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
                    Active account
                  </label>
                )}
                <div className="flex justify-end gap-2 pt-2">
                  <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm border rounded-md">Cancel</button>
                  <button type="submit" disabled={saving} className="px-4 py-2 text-sm text-white bg-primary-600 rounded-md disabled:opacity-50">{saving ? 'Saving...' : 'Save'}</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {resetModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="fixed inset-0 bg-gray-500/75" onClick={() => setResetModal(null)} />
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-6">
              <h2 className="text-lg font-medium mb-2">Reset password</h2>
              <p className="text-sm text-gray-600 mb-4">{resetModal.email}</p>
              <form onSubmit={handleResetPassword} className="space-y-4">
                <input type="password" required value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="New password" className="w-full border rounded-md px-3 py-2 text-sm" />
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setResetModal(null)} className="px-4 py-2 text-sm border rounded-md">Cancel</button>
                  <button type="submit" disabled={saving} className="px-4 py-2 text-sm text-white bg-primary-600 rounded-md">{saving ? '...' : 'Reset'}</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Users;