'use client';

import { useState, useEffect, useCallback } from 'react';
import { Users, UserPlus, Shield, User, Trash2, FolderOpen, Tag, KeyRound, Lock } from 'lucide-react';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Spinner from '@/components/ui/Spinner';

interface AllowedUser {
  id?: number;
  email: string;
  name?: string;
  role: 'admin' | 'superuser' | 'user';
  addedAt: string;
  addedBy: string;
  subscriptions?: { categoryId: number; categoryName: string; isActive: boolean }[];
  assignedCategories?: { categoryId: number; categoryName: string }[];
  hasCredentials?: boolean;
  isRootAdmin?: boolean;
}

interface Category {
  id: number;
  name: string;
  slug: string;
}

type CategoryRole = 'none' | 'user' | 'superuser';

function deriveCategoryArrays(roleMap: Record<number, CategoryRole>) {
  const subscriptions: number[] = [];
  const assignedCategories: number[] = [];
  for (const [catIdStr, role] of Object.entries(roleMap)) {
    const catId = Number(catIdStr);
    if (role === 'user') subscriptions.push(catId);
    else if (role === 'superuser') assignedCategories.push(catId);
  }
  return { subscriptions, assignedCategories };
}

export default function UserManagement() {
  // Users state
  const [users, setUsers] = useState<AllowedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Categories for subscription management
  const [categories, setCategories] = useState<Category[]>([]);

  // Add user modal state
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserRole, setNewUserRole] = useState<'admin' | 'superuser' | 'user'>('user');
  const [newUserSubscriptions, setNewUserSubscriptions] = useState<number[]>([]);
  const [newUserAssignedCategories, setNewUserAssignedCategories] = useState<number[]>([]);
  const [newUserCategoryRoles, setNewUserCategoryRoles] = useState<Record<number, CategoryRole>>({});
  const [addingUser, setAddingUser] = useState(false);

  // Delete user modal state
  const [deleteUser, setDeleteUser] = useState<AllowedUser | null>(null);
  const [deletingUser, setDeletingUser] = useState(false);

  // Edit role modal state
  const [editingUser, setEditingUser] = useState<AllowedUser | null>(null);
  const [updatingRole, setUpdatingRole] = useState(false);

  // Manage subscriptions modal state
  const [managingUserSubs, setManagingUserSubs] = useState<AllowedUser | null>(null);
  const [editUserSubscriptions, setEditUserSubscriptions] = useState<number[]>([]);
  const [editUserAssignedCategories, setEditUserAssignedCategories] = useState<number[]>([]);
  const [editCategoryRoles, setEditCategoryRoles] = useState<Record<number, CategoryRole>>({});
  const [savingUserSubs, setSavingUserSubs] = useState(false);

  // Credentials modal state
  const [credentialsUser, setCredentialsUser] = useState<AllowedUser | null>(null);
  const [credentialsPassword, setCredentialsPassword] = useState('');
  const [savingCredentials, setSavingCredentials] = useState(false);
  const [credentialsError, setCredentialsError] = useState<string | null>(null);
  const [credentialsSuccess, setCredentialsSuccess] = useState<string | null>(null);

  // Load users
  const loadUsers = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/admin/users');
      if (!response.ok) throw new Error('Failed to load users');
      const data = await response.json();
      setUsers(data.users || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  // Load categories
  const loadCategories = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/categories');
      if (response.ok) {
        const data = await response.json();
        setCategories(data.categories || []);
      }
    } catch (err) {
      console.error('Failed to load categories:', err);
    }
  }, []);

  useEffect(() => {
    loadUsers();
    loadCategories();
  }, [loadUsers, loadCategories]);

  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  // Add user handler
  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserEmail.trim()) return;

    setAddingUser(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: newUserEmail.trim(),
          name: newUserName.trim() || undefined,
          role: newUserRole,
          subscriptions: newUserRole === 'user'
            ? newUserSubscriptions
            : newUserRole === 'superuser'
            ? deriveCategoryArrays(newUserCategoryRoles).subscriptions
            : undefined,
          assignedCategories: newUserRole === 'superuser'
            ? deriveCategoryArrays(newUserCategoryRoles).assignedCategories
            : undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to add user');
      }

      await loadUsers();
      setShowAddUser(false);
      setNewUserEmail('');
      setNewUserName('');
      setNewUserRole('user');
      setNewUserSubscriptions([]);
      setNewUserAssignedCategories([]);
      setNewUserCategoryRoles({});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add user');
    } finally {
      setAddingUser(false);
    }
  };

  // Delete user handler
  const handleDeleteUser = async () => {
    if (!deleteUser) return;

    setDeletingUser(true);
    try {
      const response = await fetch(`/api/admin/users?email=${encodeURIComponent(deleteUser.email)}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to remove user');
      }

      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove user');
    } finally {
      setDeletingUser(false);
      setDeleteUser(null);
    }
  };

  // Update role handler
  const handleUpdateRole = async (newRole: 'admin' | 'superuser' | 'user') => {
    if (!editingUser) return;

    setUpdatingRole(true);
    try {
      const response = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: editingUser.email,
          role: newRole,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update role');
      }

      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update role');
    } finally {
      setUpdatingRole(false);
      setEditingUser(null);
    }
  };

  // Manage subscriptions handler
  const handleManageUserSubs = (user: AllowedUser) => {
    setManagingUserSubs(user);
    if (user.role === 'user') {
      setEditUserSubscriptions(user.subscriptions?.map(s => s.categoryId) || []);
      setEditUserAssignedCategories([]);
      setEditCategoryRoles({});
    } else if (user.role === 'superuser') {
      setEditUserSubscriptions(user.subscriptions?.map(s => s.categoryId) || []);
      setEditUserAssignedCategories(user.assignedCategories?.map(c => c.categoryId) || []);
      const roleMap: Record<number, CategoryRole> = {};
      for (const cat of user.assignedCategories || []) {
        roleMap[cat.categoryId] = 'superuser';
      }
      for (const sub of user.subscriptions || []) {
        if (!roleMap[sub.categoryId]) {
          roleMap[sub.categoryId] = 'user';
        }
      }
      setEditCategoryRoles(roleMap);
    }
  };

  // Save subscriptions handler
  const handleSaveUserSubs = async () => {
    if (!managingUserSubs) return;

    setSavingUserSubs(true);
    setError(null);

    try {
      const userId = managingUserSubs.id;
      if (!userId) throw new Error('Could not find user ID');

      if (managingUserSubs.role === 'user') {
        const currentSubs = managingUserSubs.subscriptions?.map(s => s.categoryId) || [];
        const toAdd = editUserSubscriptions.filter(id => !currentSubs.includes(id));
        const toRemove = currentSubs.filter(id => !editUserSubscriptions.includes(id));

        for (const categoryId of toAdd) {
          const response = await fetch(`/api/admin/users/${userId}/subscriptions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ categoryId }),
          });
          if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to add subscription');
          }
        }

        for (const categoryId of toRemove) {
          const response = await fetch(`/api/admin/users/${userId}/subscriptions?categoryId=${categoryId}`, {
            method: 'DELETE',
          });
          if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to remove subscription');
          }
        }
      } else if (managingUserSubs.role === 'superuser') {
        const { subscriptions, assignedCategories } = deriveCategoryArrays(editCategoryRoles);

        // Bulk update assigned categories
        const response = await fetch(`/api/admin/super-users/${userId}/categories`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ categoryIds: assignedCategories }),
        });
        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to update assigned categories');
        }

        // Sync subscriptions
        const currentSubs = managingUserSubs.subscriptions?.map(s => s.categoryId) || [];
        const toAddSub = subscriptions.filter(id => !currentSubs.includes(id));
        const toRemoveSub = currentSubs.filter(id => !subscriptions.includes(id));

        for (const categoryId of toAddSub) {
          const resp = await fetch(`/api/admin/users/${userId}/subscriptions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ categoryId }),
          });
          if (!resp.ok) {
            const data = await resp.json();
            throw new Error(data.error || 'Failed to add subscription');
          }
        }

        for (const categoryId of toRemoveSub) {
          const resp = await fetch(`/api/admin/users/${userId}/subscriptions?categoryId=${categoryId}`, {
            method: 'DELETE',
          });
          if (!resp.ok) {
            const data = await resp.json();
            throw new Error(data.error || 'Failed to remove subscription');
          }
        }
      }

      await loadUsers();
      setManagingUserSubs(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setSavingUserSubs(false);
    }
  };

  // Set/update password handler
  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!credentialsUser?.id || !credentialsPassword) return;

    setSavingCredentials(true);
    setCredentialsError(null);
    setCredentialsSuccess(null);

    try {
      const response = await fetch(`/api/admin/users/${credentialsUser.id}/credentials`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: credentialsPassword }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to set password');
      }

      setCredentialsSuccess('Password set successfully');
      setCredentialsPassword('');
      await loadUsers();
    } catch (err) {
      setCredentialsError(err instanceof Error ? err.message : 'Failed to set password');
    } finally {
      setSavingCredentials(false);
    }
  };

  // Remove credentials handler
  const handleRemoveCredentials = async () => {
    if (!credentialsUser?.id) return;

    setSavingCredentials(true);
    setCredentialsError(null);
    setCredentialsSuccess(null);

    try {
      const response = await fetch(`/api/admin/users/${credentialsUser.id}/credentials`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to remove credentials');
      }

      setCredentialsSuccess('Credentials removed');
      await loadUsers();
    } catch (err) {
      setCredentialsError(err instanceof Error ? err.message : 'Failed to remove credentials');
    } finally {
      setSavingCredentials(false);
    }
  };

  const openCredentialsModal = (user: AllowedUser) => {
    setCredentialsUser(user);
    setCredentialsPassword('');
    setCredentialsError(null);
    setCredentialsSuccess(null);
  };

  return (
    <>
      <div className="bg-white rounded-lg border shadow-sm">
        <div className="px-6 py-4 border-b">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-gray-900">Allowed Users</h2>
              <p className="text-sm text-gray-500">
                {users.length} users with access
              </p>
            </div>
            <Button onClick={() => setShowAddUser(true)}>
              <UserPlus size={18} className="mr-2" />
              Add User
            </Button>
          </div>
        </div>

        {error && (
          <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
            <p className="text-sm text-red-700">{error}</p>
            <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">&times;</button>
          </div>
        )}

        {loading ? (
          <div className="px-6 py-12 flex justify-center">
            <Spinner size="lg" />
          </div>
        ) : users.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <Users className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No users yet</h3>
            <p className="text-gray-500 mb-4">
              Add users to grant them access to the application
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 text-left text-sm text-gray-600">
                <tr>
                  <th className="px-6 py-3 font-medium">User</th>
                  <th className="px-6 py-3 font-medium">Role</th>
                  <th className="px-6 py-3 font-medium">Categories</th>
                  <th className="px-6 py-3 font-medium">Added</th>
                  <th className="px-6 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {users.map((user) => (
                  <tr key={user.email} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                          user.role === 'admin' ? 'bg-purple-100' :
                          user.role === 'superuser' ? 'bg-orange-100' : 'bg-gray-100'
                        }`}>
                          {user.role === 'admin' ? (
                            <Shield size={16} className="text-purple-600" />
                          ) : user.role === 'superuser' ? (
                            <UserPlus size={16} className="text-orange-600" />
                          ) : (
                            <User size={16} className="text-gray-600" />
                          )}
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">
                            {user.name || user.email.split('@')[0]}
                          </p>
                          <p className="text-sm text-gray-500">{user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1.5">
                        <span className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded-full ${
                          user.role === 'admin'
                            ? 'bg-purple-100 text-purple-700'
                            : user.role === 'superuser'
                            ? 'bg-orange-100 text-orange-700'
                            : 'bg-gray-100 text-gray-700'
                        }`}>
                          {user.role === 'superuser' ? 'super user' : user.role}
                        </span>
                        {user.isRootAdmin && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium rounded bg-gray-200 text-gray-600" title="Defined in ADMIN_EMAILS env var">
                            <Lock size={9} />
                            root
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1">
                        {user.role === 'admin' ? (
                          <span className="text-gray-400 text-xs italic">All access</span>
                        ) : user.role === 'superuser' ? (
                          <>
                            {user.assignedCategories && user.assignedCategories.length > 0 ? (
                              user.assignedCategories.map(cat => (
                                <span
                                  key={`assigned-${cat.categoryId}`}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-orange-100 text-orange-700 text-xs rounded-full"
                                  title="Manages this category"
                                >
                                  <FolderOpen size={10} />
                                  {cat.categoryName}
                                </span>
                              ))
                            ) : null}
                            {user.subscriptions && user.subscriptions.length > 0 ? (
                              user.subscriptions.map(sub => (
                                <span
                                  key={`sub-${sub.categoryId}`}
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full ${
                                    sub.isActive ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
                                  }`}
                                  title="Subscribed (read access)"
                                >
                                  <Tag size={10} />
                                  {sub.categoryName}
                                </span>
                              ))
                            ) : null}
                            {(!user.assignedCategories || user.assignedCategories.length === 0) &&
                             (!user.subscriptions || user.subscriptions.length === 0) && (
                              <span className="text-gray-400 text-xs italic">No categories</span>
                            )}
                          </>
                        ) : (
                          user.subscriptions && user.subscriptions.length > 0 ? (
                            user.subscriptions.map(sub => (
                              <span
                                key={sub.categoryId}
                                className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full ${
                                  sub.isActive ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
                                }`}
                              >
                                <Tag size={10} />
                                {sub.categoryName}
                              </span>
                            ))
                          ) : (
                            <span className="text-gray-400 text-xs italic">No subscriptions</span>
                          )
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {formatDate(user.addedAt)}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-2">
                        {user.role !== 'admin' && (
                          <button
                            onClick={() => handleManageUserSubs(user)}
                            className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg"
                            title={user.role === 'superuser' ? 'Manage assigned categories' : 'Manage subscriptions'}
                          >
                            <FolderOpen size={16} />
                          </button>
                        )}
                        <button
                          onClick={() => openCredentialsModal(user)}
                          className={`p-2 rounded-lg ${
                            user.hasCredentials
                              ? 'text-amber-500 hover:text-amber-700 hover:bg-amber-50'
                              : 'text-gray-400 hover:text-amber-600 hover:bg-amber-50'
                          }`}
                          title={user.hasCredentials ? 'Manage credentials' : 'Set password'}
                        >
                          <KeyRound size={16} />
                        </button>
                        {user.isRootAdmin ? (
                          <span
                            className="p-2 text-gray-300 cursor-not-allowed"
                            title="Root admin — role is locked"
                          >
                            <Lock size={16} />
                          </span>
                        ) : (
                          <>
                            <button
                              onClick={() => setEditingUser(user)}
                              className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                              title="Change role"
                            >
                              <Shield size={16} />
                            </button>
                            <button
                              onClick={() => setDeleteUser(user)}
                              className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                              title="Remove user"
                            >
                              <Trash2 size={16} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add User Modal */}
      <Modal
        isOpen={showAddUser}
        onClose={() => setShowAddUser(false)}
        title="Add User"
      >
        <form onSubmit={handleAddUser}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={newUserEmail}
                onChange={(e) => setNewUserEmail(e.target.value)}
                placeholder="user@example.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name (optional)</label>
              <input
                type="text"
                value={newUserName}
                onChange={(e) => setNewUserName(e.target.value)}
                placeholder="John Doe"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
              <select
                value={newUserRole}
                onChange={(e) => setNewUserRole(e.target.value as 'admin' | 'superuser' | 'user')}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="user">User</option>
                <option value="superuser">Super User</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            {newUserRole === 'user' && categories.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Subscriptions</label>
                <div className="max-h-40 overflow-y-auto border border-gray-300 rounded-lg p-2 space-y-1">
                  {categories.map(cat => (
                    <label key={cat.id} className="flex items-center gap-2 p-1 hover:bg-gray-50 rounded cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newUserSubscriptions.includes(cat.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setNewUserSubscriptions([...newUserSubscriptions, cat.id]);
                          } else {
                            setNewUserSubscriptions(newUserSubscriptions.filter(id => id !== cat.id));
                          }
                        }}
                        className="rounded border-gray-300"
                      />
                      <span className="text-sm text-gray-700">{cat.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            {newUserRole === 'superuser' && categories.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category Access</label>
                <p className="text-xs text-gray-500 mb-2">Set access level for each category</p>
                <div className="max-h-48 overflow-y-auto border border-gray-300 rounded-lg p-2 space-y-1">
                  {categories.map(cat => (
                    <div key={cat.id} className="flex items-center justify-between p-1.5 hover:bg-gray-50 rounded">
                      <span className="text-sm text-gray-700">{cat.name}</span>
                      <select
                        value={newUserCategoryRoles[cat.id] || 'none'}
                        onChange={(e) => {
                          setNewUserCategoryRoles(prev => ({
                            ...prev,
                            [cat.id]: e.target.value as CategoryRole,
                          }));
                        }}
                        className="text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="none">None</option>
                        <option value="user">User (read)</option>
                        <option value="superuser">Super User (manage)</option>
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <Button variant="secondary" onClick={() => setShowAddUser(false)} type="button">
              Cancel
            </Button>
            <Button type="submit" loading={addingUser} disabled={!newUserEmail.trim()}>
              Add User
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete User Modal */}
      <Modal
        isOpen={!!deleteUser}
        onClose={() => setDeleteUser(null)}
        title="Remove User?"
      >
        <p className="text-gray-600 mb-4">
          Are you sure you want to remove <strong>{deleteUser?.email}</strong>?
        </p>
        <p className="text-sm text-gray-500 mb-6">
          This will revoke their access to the application.
        </p>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setDeleteUser(null)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDeleteUser} loading={deletingUser}>
            Remove User
          </Button>
        </div>
      </Modal>

      {/* Edit Role Modal */}
      <Modal
        isOpen={!!editingUser}
        onClose={() => setEditingUser(null)}
        title="Change User Role"
      >
        <p className="text-gray-600 mb-4">
          Select a new role for <strong>{editingUser?.email}</strong>
        </p>
        <div className="space-y-2 mb-6">
          {(['user', 'superuser', 'admin'] as const).map(role => (
            <button
              key={role}
              onClick={() => handleUpdateRole(role)}
              disabled={updatingRole || editingUser?.role === role}
              className={`w-full p-3 text-left rounded-lg border transition-colors ${
                editingUser?.role === role
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              } ${updatingRole ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <span className="font-medium capitalize">{role === 'superuser' ? 'Super User' : role}</span>
            </button>
          ))}
        </div>
        <div className="flex justify-end">
          <Button variant="secondary" onClick={() => setEditingUser(null)}>
            Cancel
          </Button>
        </div>
      </Modal>

      {/* Manage Subscriptions Modal */}
      <Modal
        isOpen={!!managingUserSubs}
        onClose={() => setManagingUserSubs(null)}
        title={managingUserSubs?.role === 'superuser' ? 'Manage Categories' : 'Manage Subscriptions'}
      >
        <p className="text-gray-600 mb-4">
          {managingUserSubs?.role === 'superuser'
            ? `Set access level per category for ${managingUserSubs?.email}`
            : `Select categories for ${managingUserSubs?.email} to access`}
        </p>
        {managingUserSubs?.role === 'superuser' ? (
          <div className="max-h-60 overflow-y-auto border border-gray-300 rounded-lg p-2 space-y-1 mb-6">
            {categories.map(cat => (
              <div key={cat.id} className="flex items-center justify-between p-2 hover:bg-gray-50 rounded">
                <span className="text-sm text-gray-700">{cat.name}</span>
                <select
                  value={editCategoryRoles[cat.id] || 'none'}
                  onChange={(e) => {
                    setEditCategoryRoles(prev => ({
                      ...prev,
                      [cat.id]: e.target.value as CategoryRole,
                    }));
                  }}
                  className="text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="none">None</option>
                  <option value="user">User (read)</option>
                  <option value="superuser">Super User (manage)</option>
                </select>
              </div>
            ))}
          </div>
        ) : (
          <div className="max-h-60 overflow-y-auto border border-gray-300 rounded-lg p-2 space-y-1 mb-6">
            {categories.map(cat => (
              <label key={cat.id} className="flex items-center gap-2 p-2 hover:bg-gray-50 rounded cursor-pointer">
                <input
                  type="checkbox"
                  checked={editUserSubscriptions.includes(cat.id)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setEditUserSubscriptions([...editUserSubscriptions, cat.id]);
                    } else {
                      setEditUserSubscriptions(editUserSubscriptions.filter(id => id !== cat.id));
                    }
                  }}
                  className="rounded border-gray-300"
                />
                <span className="text-sm text-gray-700">{cat.name}</span>
              </label>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setManagingUserSubs(null)}>
            Cancel
          </Button>
          <Button onClick={handleSaveUserSubs} loading={savingUserSubs}>
            Save Changes
          </Button>
        </div>
      </Modal>

      {/* Manage Credentials Modal */}
      <Modal
        isOpen={!!credentialsUser}
        onClose={() => setCredentialsUser(null)}
        title="Manage Credentials"
      >
        <p className="text-gray-600 mb-1">
          Email/password login for <strong>{credentialsUser?.email}</strong>
        </p>
        <p className="text-sm text-gray-500 mb-4">
          {credentialsUser?.hasCredentials
            ? 'This user has email/password login enabled.'
            : 'This user has no password set.'}
        </p>

        {credentialsError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-700">{credentialsError}</p>
          </div>
        )}
        {credentialsSuccess && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-sm text-green-700">{credentialsSuccess}</p>
          </div>
        )}

        <form onSubmit={handleSetPassword}>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {credentialsUser?.hasCredentials ? 'New Password' : 'Password'}
            </label>
            <input
              type="password"
              value={credentialsPassword}
              onChange={(e) => setCredentialsPassword(e.target.value)}
              placeholder="Enter password"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              minLength={8}
              required
            />
            <p className="text-xs text-gray-500 mt-1">Minimum 8 characters</p>
          </div>
          <div className="flex items-center justify-between">
            <div>
              {credentialsUser?.hasCredentials && (
                <Button
                  variant="danger"
                  onClick={handleRemoveCredentials}
                  loading={savingCredentials}
                  type="button"
                >
                  Remove Credentials
                </Button>
              )}
            </div>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => setCredentialsUser(null)} type="button">
                Close
              </Button>
              <Button type="submit" loading={savingCredentials} disabled={!credentialsPassword}>
                {credentialsUser?.hasCredentials ? 'Update Password' : 'Set Password'}
              </Button>
            </div>
          </div>
        </form>
      </Modal>
    </>
  );
}
