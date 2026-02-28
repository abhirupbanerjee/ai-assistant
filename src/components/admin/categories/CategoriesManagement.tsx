'use client';

import { useState, useEffect, useCallback } from 'react';
import { FolderOpen, Plus, Edit2, Trash2, Search, Download } from 'lucide-react';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Spinner from '@/components/ui/Spinner';

interface Category {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  created_by: string;
  created_at: string;
  documentCount: number;
  superUserCount: number;
  subscriberCount: number;
}

export default function CategoriesManagement() {
  // Categories state
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add category modal state
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryDescription, setNewCategoryDescription] = useState('');
  const [addingCategory, setAddingCategory] = useState(false);

  // Delete category modal state
  const [deleteCategory, setDeleteCategory] = useState<Category | null>(null);
  const [deletingCategory, setDeletingCategory] = useState(false);

  // Edit category modal state
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [editCategoryName, setEditCategoryName] = useState('');
  const [editCategoryDescription, setEditCategoryDescription] = useState('');
  const [updatingCategory, setUpdatingCategory] = useState(false);

  // Search state
  const [searchTerm, setSearchTerm] = useState('');

  // Selection state for export
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<Set<number>>(new Set());

  // Load categories
  const loadCategories = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/admin/categories');
      if (!response.ok) throw new Error('Failed to load categories');
      const data = await response.json();
      setCategories(data.categories || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load categories');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  // Add category handler
  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;

    setAddingCategory(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newCategoryName.trim(),
          description: newCategoryDescription.trim() || undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create category');
      }

      await loadCategories();
      setShowAddCategory(false);
      setNewCategoryName('');
      setNewCategoryDescription('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create category');
    } finally {
      setAddingCategory(false);
    }
  };

  // Delete category handler
  const handleDeleteCategory = async () => {
    if (!deleteCategory) return;

    setDeletingCategory(true);
    try {
      const response = await fetch(`/api/admin/categories/${deleteCategory.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete category');
      }

      await loadCategories();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete category');
    } finally {
      setDeletingCategory(false);
      setDeleteCategory(null);
    }
  };

  // Edit category handler
  const handleEditCategory = (category: Category) => {
    setEditingCategory(category);
    setEditCategoryName(category.name);
    setEditCategoryDescription(category.description || '');
  };

  // Update category handler
  const handleUpdateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCategory || !editCategoryName.trim()) return;

    setUpdatingCategory(true);
    setError(null);

    try {
      const response = await fetch(`/api/admin/categories/${editingCategory.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editCategoryName.trim(),
          description: editCategoryDescription.trim() || null,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update category');
      }

      await loadCategories();
      setEditingCategory(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update category');
    } finally {
      setUpdatingCategory(false);
    }
  };

  // Fuzzy match - checks if search chars appear in order
  const fuzzyMatch = (text: string, search: string): boolean => {
    const searchLower = search.toLowerCase();
    const textLower = text.toLowerCase();
    let searchIdx = 0;
    for (let i = 0; i < textLower.length && searchIdx < searchLower.length; i++) {
      if (textLower[i] === searchLower[searchIdx]) {
        searchIdx++;
      }
    }
    return searchIdx === searchLower.length;
  };

  // Filter categories based on search
  const filteredCategories = categories.filter(cat => {
    if (!searchTerm.trim()) return true;
    return (
      fuzzyMatch(cat.name, searchTerm) ||
      fuzzyMatch(cat.slug, searchTerm) ||
      (cat.description && fuzzyMatch(cat.description, searchTerm))
    );
  });

  // Selection handlers
  const toggleCategorySelection = (id: number) => {
    setSelectedCategoryIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const toggleAllCategorySelection = () => {
    if (selectedCategoryIds.size === filteredCategories.length) {
      setSelectedCategoryIds(new Set());
    } else {
      setSelectedCategoryIds(new Set(filteredCategories.map(c => c.id)));
    }
  };

  // Export functions
  const exportCategoriesToMarkdown = (categoriesToExport: Category[]) => {
    const lines: string[] = [
      '# Categories Export',
      '',
      `**Exported:** ${new Date().toLocaleString()}`,
      `**Total Categories:** ${categoriesToExport.length}`,
      '',
      '| Name | Slug | Description | Documents | Super Users | Subscribers |',
      '|------|------|-------------|-----------|-------------|-------------|',
    ];
    categoriesToExport.forEach(cat => {
      const desc = cat.description?.replace(/\|/g, '\\|') || '-';
      lines.push(`| ${cat.name} | \`${cat.slug}\` | ${desc} | ${cat.documentCount} | ${cat.superUserCount} | ${cat.subscriberCount} |`);
    });
    return lines.join('\n');
  };

  const exportCategoriesToJson = (categoriesToExport: Category[]) => {
    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      totalCategories: categoriesToExport.length,
      categories: categoriesToExport.map(cat => ({
        name: cat.name,
        slug: cat.slug,
        description: cat.description,
        documentCount: cat.documentCount,
        superUserCount: cat.superUserCount,
        subscriberCount: cat.subscriberCount,
        createdBy: cat.created_by,
        createdAt: cat.created_at,
      }))
    }, null, 2);
  };

  const downloadFile = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExport = (scope: 'selected' | 'all', format: 'md' | 'json') => {
    const categoriesToExport = scope === 'selected'
      ? categories.filter(c => selectedCategoryIds.has(c.id))
      : filteredCategories;

    if (categoriesToExport.length === 0) return;

    const dateStr = new Date().toISOString().split('T')[0];
    if (format === 'md') {
      const content = exportCategoriesToMarkdown(categoriesToExport);
      downloadFile(content, `categories-export-${dateStr}.md`, 'text/markdown');
    } else {
      const content = exportCategoriesToJson(categoriesToExport);
      downloadFile(content, `categories-export-${dateStr}.json`, 'application/json');
    }
  };

  return (
    <>
      <div className="bg-white rounded-lg border shadow-sm">
        <div className="px-6 py-4 border-b">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-gray-900">Document Categories</h2>
              <p className="text-sm text-gray-500">
                {categories.length} categories defined
              </p>
            </div>
            <Button onClick={() => setShowAddCategory(true)}>
              <Plus size={18} className="mr-2" />
              Add Category
            </Button>
          </div>
        </div>

        {/* Search and Export row */}
        <div className="px-6 py-3 border-b bg-gray-50 flex items-center gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search categories..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          {/* Export dropdown */}
          <div className="relative group">
            <Button variant="secondary" title="Export categories">
              <Download size={16} className="mr-2" />
              Export
            </Button>
            <div className="absolute right-0 mt-1 w-52 bg-white border rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10">
              <div className="px-3 py-2 text-xs text-gray-500 font-medium border-b">
                Selected ({selectedCategoryIds.size})
              </div>
              <button
                onClick={() => handleExport('selected', 'md')}
                disabled={selectedCategoryIds.size === 0}
                className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Export as Markdown
              </button>
              <button
                onClick={() => handleExport('selected', 'json')}
                disabled={selectedCategoryIds.size === 0}
                className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed border-b"
              >
                Export as JSON
              </button>
              <div className="px-3 py-2 text-xs text-gray-500 font-medium border-b">
                All ({filteredCategories.length})
              </div>
              <button
                onClick={() => handleExport('all', 'md')}
                disabled={filteredCategories.length === 0}
                className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Export as Markdown
              </button>
              <button
                onClick={() => handleExport('all', 'json')}
                disabled={filteredCategories.length === 0}
                className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed rounded-b-lg"
              >
                Export as JSON
              </button>
            </div>
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
        ) : categories.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <FolderOpen className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No categories yet</h3>
            <p className="text-gray-500 mb-4">
              Create categories to organize documents and control user access
            </p>
          </div>
        ) : filteredCategories.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <Search className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No matching categories</h3>
            <p className="text-gray-500 mb-4">
              Try adjusting your search term
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 text-left text-sm text-gray-600">
                <tr>
                  <th className="px-3 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={filteredCategories.length > 0 && selectedCategoryIds.size === filteredCategories.length}
                      onChange={toggleAllCategorySelection}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      title="Select all"
                    />
                  </th>
                  <th className="px-6 py-3 font-medium">Category</th>
                  <th className="px-6 py-3 font-medium">Slug</th>
                  <th className="px-6 py-3 font-medium">Documents</th>
                  <th className="px-6 py-3 font-medium">Super Users</th>
                  <th className="px-6 py-3 font-medium">Subscribers</th>
                  <th className="px-6 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredCategories.map((cat) => (
                  <tr key={cat.id} className="hover:bg-gray-50">
                    <td className="px-3 py-4">
                      <input
                        type="checkbox"
                        checked={selectedCategoryIds.has(cat.id)}
                        onChange={() => toggleCategorySelection(cat.id)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <FolderOpen className="w-5 h-5 text-blue-600" />
                        <div>
                          <span className="font-medium text-gray-900">{cat.name}</span>
                          {cat.description && (
                            <p className="text-sm text-gray-500">{cat.description}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-gray-600 font-mono text-sm">
                      {cat.slug}
                    </td>
                    <td className="px-6 py-4 text-gray-600">{cat.documentCount}</td>
                    <td className="px-6 py-4 text-gray-600">{cat.superUserCount}</td>
                    <td className="px-6 py-4 text-gray-600">{cat.subscriberCount}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleEditCategory(cat)}
                          className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                          title="Edit"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={() => setDeleteCategory(cat)}
                          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                          title="Delete"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Category Modal */}
      <Modal
        isOpen={showAddCategory}
        onClose={() => setShowAddCategory(false)}
        title="Add Category"
      >
        <form onSubmit={handleAddCategory}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
              <input
                type="text"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="Category name"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description (optional)</label>
              <textarea
                value={newCategoryDescription}
                onChange={(e) => setNewCategoryDescription(e.target.value)}
                placeholder="Brief description of this category"
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <Button variant="secondary" onClick={() => setShowAddCategory(false)} type="button">
              Cancel
            </Button>
            <Button type="submit" loading={addingCategory} disabled={!newCategoryName.trim()}>
              Create Category
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Category Modal */}
      <Modal
        isOpen={!!deleteCategory}
        onClose={() => setDeleteCategory(null)}
        title="Delete Category?"
      >
        <div className="space-y-4">
          <p className="text-gray-600">
            Are you sure you want to delete <strong>{deleteCategory?.name}</strong>?
          </p>
          {deleteCategory && deleteCategory.documentCount > 0 && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-700 text-sm">
                <strong>Warning:</strong> This category contains {deleteCategory.documentCount} document(s).
                Documents exclusively in this category will be permanently deleted.
                Documents also tagged to other categories will be kept.
              </p>
            </div>
          )}
          <p className="text-sm text-gray-500">
            This action cannot be undone.
          </p>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <Button variant="secondary" onClick={() => setDeleteCategory(null)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDeleteCategory} loading={deletingCategory}>
            Delete Category
          </Button>
        </div>
      </Modal>

      {/* Edit Category Modal */}
      <Modal
        isOpen={!!editingCategory}
        onClose={() => setEditingCategory(null)}
        title="Edit Category"
      >
        <form onSubmit={handleUpdateCategory}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
              <input
                type="text"
                value={editCategoryName}
                onChange={(e) => setEditCategoryName(e.target.value)}
                placeholder="Category name"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description (optional)</label>
              <textarea
                value={editCategoryDescription}
                onChange={(e) => setEditCategoryDescription(e.target.value)}
                placeholder="Brief description of this category"
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <Button variant="secondary" onClick={() => setEditingCategory(null)} type="button">
              Cancel
            </Button>
            <Button type="submit" loading={updatingCategory} disabled={!editCategoryName.trim()}>
              Save Changes
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
