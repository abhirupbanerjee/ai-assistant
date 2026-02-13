'use client';

import { useState, useEffect, useCallback } from 'react';
import { Edit2, Save, RefreshCw, Wand2 } from 'lucide-react';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Spinner from '@/components/ui/Spinner';
import StarterPromptsEditor from '@/components/admin/StarterPromptsEditor';

interface Category {
  id: number;
  name: string;
  slug: string;
}

interface StarterPrompt {
  label: string;
  prompt: string;
}

interface CategoryPromptData {
  category: { id: number; name: string; slug: string };
  globalPrompt: string;
  categoryAddendum: string;
  starterPrompts: StarterPrompt[];
  welcomeTitle: string;
  welcomeMessage: string;
  combinedPrompt: string;
  charInfo: {
    globalLength: number;
    categoryLength: number;
    maxCombined: number;
    availableForCategory: number;
  };
  metadata?: {
    updatedAt: string;
    updatedBy: string;
  };
}

interface TokenLimits {
  maxStartersPerCategory: number;
  starterLabelMaxChars: number;
  starterPromptMaxChars: number;
}

interface OptimizationResult {
  optimized: string;
  original: string;
  improvement: string;
}

export default function CategoryPromptsSettings() {
  // Categories state
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Token limits (for StarterPromptsEditor)
  const [tokenLimits, setTokenLimits] = useState<TokenLimits | null>(null);

  // Category prompt modal state
  const [editingCategoryPrompt, setEditingCategoryPrompt] = useState<number | null>(null);
  const [categoryPromptData, setCategoryPromptData] = useState<CategoryPromptData | null>(null);
  const [categoryPromptLoading, setCategoryPromptLoading] = useState(false);
  const [editedCategoryAddendum, setEditedCategoryAddendum] = useState('');
  const [editedStarterPrompts, setEditedStarterPrompts] = useState<StarterPrompt[]>([]);
  const [editedWelcomeTitle, setEditedWelcomeTitle] = useState('');
  const [editedWelcomeMessage, setEditedWelcomeMessage] = useState('');
  const [savingCategoryPrompt, setSavingCategoryPrompt] = useState(false);
  const [categoryPromptModified, setCategoryPromptModified] = useState(false);
  const [starterPromptsModified, setStarterPromptsModified] = useState(false);
  const [welcomeModified, setWelcomeModified] = useState(false);

  // Prompt optimization state
  const [optimizing, setOptimizing] = useState(false);

  // Load categories
  const loadCategories = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/admin/categories');
      if (!response.ok) throw new Error('Failed to load categories');
      const data = await response.json();
      setCategories(data.categories || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load categories');
    } finally {
      setLoading(false);
    }
  }, []);

  // Load token limits for StarterPromptsEditor
  const loadTokenLimits = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/settings');
      if (!response.ok) return;
      const data = await response.json();
      if (data.tokenLimits) {
        setTokenLimits({
          maxStartersPerCategory: data.tokenLimits.maxStartersPerCategory,
          starterLabelMaxChars: data.tokenLimits.starterLabelMaxChars,
          starterPromptMaxChars: data.tokenLimits.starterPromptMaxChars,
        });
      }
    } catch {
      // Silently fail - limits are optional
    }
  }, []);

  useEffect(() => {
    loadCategories();
    loadTokenLimits();
  }, [loadCategories, loadTokenLimits]);

  // Load category prompt data
  const loadCategoryPrompt = async (categoryId: number) => {
    setCategoryPromptLoading(true);
    try {
      const response = await fetch(`/api/categories/${categoryId}/prompt`);
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to load category prompt');
      }
      const data = await response.json();
      setCategoryPromptData(data);
      setEditedCategoryAddendum(data.categoryAddendum || '');
      setEditedStarterPrompts(data.starterPrompts || []);
      setEditedWelcomeTitle(data.welcomeTitle || '');
      setEditedWelcomeMessage(data.welcomeMessage || '');
      setCategoryPromptModified(false);
      setStarterPromptsModified(false);
      setWelcomeModified(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load category prompt');
    } finally {
      setCategoryPromptLoading(false);
    }
  };

  const handleOpenCategoryPromptModal = async (categoryId: number) => {
    setEditingCategoryPrompt(categoryId);
    await loadCategoryPrompt(categoryId);
  };

  const handleCloseCategoryPromptModal = () => {
    setEditingCategoryPrompt(null);
    setCategoryPromptData(null);
    setEditedCategoryAddendum('');
    setEditedStarterPrompts([]);
    setEditedWelcomeTitle('');
    setEditedWelcomeMessage('');
    setCategoryPromptModified(false);
    setStarterPromptsModified(false);
    setWelcomeModified(false);
  };

  const handleCategoryAddendumChange = (value: string) => {
    setEditedCategoryAddendum(value);
    setCategoryPromptModified(value !== (categoryPromptData?.categoryAddendum || ''));
  };

  const handleStarterPromptsChange = (starters: StarterPrompt[]) => {
    setEditedStarterPrompts(starters);
    const original = categoryPromptData?.starterPrompts || [];
    setStarterPromptsModified(JSON.stringify(starters) !== JSON.stringify(original));
  };

  const handleWelcomeTitleChange = (value: string) => {
    setEditedWelcomeTitle(value);
    const originalTitle = categoryPromptData?.welcomeTitle || '';
    const originalMessage = categoryPromptData?.welcomeMessage || '';
    setWelcomeModified(value !== originalTitle || editedWelcomeMessage !== originalMessage);
  };

  const handleWelcomeMessageChange = (value: string) => {
    setEditedWelcomeMessage(value);
    const originalTitle = categoryPromptData?.welcomeTitle || '';
    const originalMessage = categoryPromptData?.welcomeMessage || '';
    setWelcomeModified(editedWelcomeTitle !== originalTitle || value !== originalMessage);
  };

  const handleSaveCategoryPrompt = async () => {
    if (!editingCategoryPrompt) return;

    setSavingCategoryPrompt(true);
    setError(null);

    try {
      const response = await fetch(`/api/categories/${editingCategoryPrompt}/prompt`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          promptAddendum: editedCategoryAddendum,
          starterPrompts: editedStarterPrompts.length > 0 ? editedStarterPrompts : null,
          welcomeTitle: editedWelcomeTitle || null,
          welcomeMessage: editedWelcomeMessage || null,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || data.details?.join(', ') || 'Failed to save category prompt');
      }

      const data = await response.json();
      setCategoryPromptData(prev => prev ? {
        ...prev,
        categoryAddendum: data.categoryAddendum || '',
        starterPrompts: data.starterPrompts || [],
        welcomeTitle: data.welcomeTitle || '',
        welcomeMessage: data.welcomeMessage || '',
        combinedPrompt: data.combinedPrompt,
        charInfo: data.charInfo,
        metadata: data.metadata,
      } : null);
      setCategoryPromptModified(false);
      setStarterPromptsModified(false);
      setWelcomeModified(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save category prompt');
    } finally {
      setSavingCategoryPrompt(false);
    }
  };

  const handleResetCategoryToGlobal = async () => {
    if (!editingCategoryPrompt) return;

    setSavingCategoryPrompt(true);
    setError(null);

    try {
      const response = await fetch(`/api/categories/${editingCategoryPrompt}/prompt`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to reset category prompt');
      }

      await loadCategoryPrompt(editingCategoryPrompt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset category prompt');
    } finally {
      setSavingCategoryPrompt(false);
    }
  };

  const handleOptimizePrompt = async () => {
    if (!editingCategoryPrompt || !editedCategoryAddendum.trim()) return;

    setOptimizing(true);
    setError(null);

    try {
      const response = await fetch(`/api/categories/${editingCategoryPrompt}/prompt/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryAddendum: editedCategoryAddendum }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to optimize prompt');
      }

      const result: OptimizationResult = await response.json();
      setEditedCategoryAddendum(result.optimized);
      setCategoryPromptModified(result.optimized !== (categoryPromptData?.categoryAddendum || ''));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to optimize prompt');
    } finally {
      setOptimizing(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <>
      <div className="bg-white rounded-lg border shadow-sm">
        {error && (
          <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
            <p className="text-sm text-red-700">{error}</p>
            <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">&times;</button>
          </div>
        )}

        <div className="px-6 py-4 border-b">
          <div>
            <h2 className="font-semibold text-gray-900">Category-Specific Prompts</h2>
            <p className="text-sm text-gray-500">
              Add custom prompt guidance for specific categories (appended to global prompt)
            </p>
          </div>
        </div>

        {loading ? (
          <div className="px-6 py-12 flex justify-center">
            <Spinner size="lg" />
          </div>
        ) : (
          <div className="p-6">
            {categories.length === 0 ? (
              <p className="text-gray-500 text-center py-4">
                No categories yet. Create categories first.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="pb-3 font-medium text-gray-700">Category</th>
                      <th className="pb-3 font-medium text-gray-700">Custom Prompt</th>
                      <th className="pb-3 font-medium text-gray-700 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {categories.map((cat) => (
                      <tr key={cat.id} className="hover:bg-gray-50">
                        <td className="py-3">
                          <span className="font-medium text-gray-900">{cat.name}</span>
                          <span className="ml-2 text-xs text-gray-400">({cat.slug})</span>
                        </td>
                        <td className="py-3">
                          <span className="text-gray-500 text-xs">Click Edit to configure</span>
                        </td>
                        <td className="py-3 text-right">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleOpenCategoryPromptModal(cat.id)}
                          >
                            <Edit2 size={14} className="mr-1" />
                            Edit
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Category Prompt Edit Modal */}
      <Modal
        isOpen={editingCategoryPrompt !== null}
        onClose={handleCloseCategoryPromptModal}
        title={`Edit Prompt: ${categoryPromptData?.category.name || 'Category'}`}
      >
        {categoryPromptLoading ? (
          <div className="py-12 flex justify-center">
            <Spinner size="lg" />
          </div>
        ) : categoryPromptData ? (
          <div className="space-y-6">
            {/* Global Prompt Preview (Read-only) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Global System Prompt
                <span className="ml-2 text-xs text-gray-400 font-normal">
                  ({categoryPromptData.charInfo.globalLength} chars)
                </span>
              </label>
              <div className="bg-gray-50 border rounded-lg p-3 max-h-40 overflow-y-auto">
                <pre className="text-xs text-gray-600 whitespace-pre-wrap font-mono">
                  {categoryPromptData.globalPrompt}
                </pre>
              </div>
            </div>

            {/* Category Addendum (Editable) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Category-Specific Addendum
                <span className="ml-2 text-xs text-gray-400 font-normal">
                  ({editedCategoryAddendum.length} / {categoryPromptData.charInfo.availableForCategory} chars available)
                </span>
              </label>
              <textarea
                value={editedCategoryAddendum}
                onChange={(e) => handleCategoryAddendumChange(e.target.value)}
                rows={6}
                className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm ${
                  editedCategoryAddendum.length > categoryPromptData.charInfo.availableForCategory
                    ? 'border-red-300 bg-red-50'
                    : ''
                }`}
                placeholder="Add category-specific guidance here (optional)..."
              />
              {editedCategoryAddendum.length > categoryPromptData.charInfo.availableForCategory && (
                <p className="mt-1 text-xs text-red-600">
                  Exceeds available character limit
                </p>
              )}
              <p className="mt-1 text-xs text-gray-500">
                This text will be appended to the global system prompt for this category.
              </p>
            </div>

            {/* Starter Prompts */}
            <div className="border-t pt-4">
              <StarterPromptsEditor
                starters={editedStarterPrompts}
                onChange={handleStarterPromptsChange}
                disabled={savingCategoryPrompt}
                maxStarters={tokenLimits?.maxStartersPerCategory}
                maxLabelLength={tokenLimits?.starterLabelMaxChars}
                maxPromptLength={tokenLimits?.starterPromptMaxChars}
              />
            </div>

            {/* Welcome Message Configuration */}
            <div className="border-t pt-4">
              <label className="block text-sm font-medium text-gray-700 mb-3">
                Welcome Screen (Optional)
              </label>
              <p className="text-xs text-gray-500 mb-3">
                Custom welcome message shown to users on the chat home screen for this category.
              </p>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Welcome Title
                    <span className="ml-1 text-gray-400 font-normal">
                      ({editedWelcomeTitle.length}/50 chars)
                    </span>
                  </label>
                  <input
                    type="text"
                    value={editedWelcomeTitle}
                    onChange={(e) => handleWelcomeTitleChange(e.target.value)}
                    maxLength={50}
                    className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm ${
                      editedWelcomeTitle.length > 50 ? 'border-red-300 bg-red-50' : ''
                    }`}
                    placeholder="e.g., Welcome to LEAPai"
                    disabled={savingCategoryPrompt}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Welcome Message
                    <span className="ml-1 text-gray-400 font-normal">
                      ({editedWelcomeMessage.length}/200 chars)
                    </span>
                  </label>
                  <textarea
                    value={editedWelcomeMessage}
                    onChange={(e) => handleWelcomeMessageChange(e.target.value)}
                    maxLength={200}
                    rows={2}
                    className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm ${
                      editedWelcomeMessage.length > 200 ? 'border-red-300 bg-red-50' : ''
                    }`}
                    placeholder="e.g., How can I help you with policy questions today?"
                    disabled={savingCategoryPrompt}
                  />
                </div>
              </div>
            </div>

            {/* Combined Preview (Read-only) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Combined Prompt Preview
                <span className="ml-2 text-xs text-gray-400 font-normal">
                  (Total: {categoryPromptData.charInfo.globalLength + (editedCategoryAddendum ? editedCategoryAddendum.length + 42 : 0)} / {categoryPromptData.charInfo.maxCombined} chars)
                </span>
              </label>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 max-h-48 overflow-y-auto">
                <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono">
                  {categoryPromptData.globalPrompt}
                  {editedCategoryAddendum && (
                    <>
                      {'\n\n--- Category-Specific Guidelines ---\n\n'}
                      <span className="text-blue-700">{editedCategoryAddendum}</span>
                    </>
                  )}
                </pre>
              </div>
            </div>

            {/* Metadata */}
            {categoryPromptData.metadata && (
              <p className="text-xs text-gray-500">
                Last updated: {formatDate(categoryPromptData.metadata.updatedAt)} by {categoryPromptData.metadata.updatedBy}
              </p>
            )}

            {/* Actions */}
            <div className="flex justify-between pt-4 border-t">
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={handleResetCategoryToGlobal}
                  disabled={savingCategoryPrompt || optimizing || !categoryPromptData.categoryAddendum}
                  className="text-orange-600 border-orange-300 hover:bg-orange-50"
                >
                  <RefreshCw size={16} className="mr-2" />
                  Reset to Global Only
                </Button>
                <Button
                  variant="secondary"
                  onClick={handleOptimizePrompt}
                  disabled={savingCategoryPrompt || optimizing || !editedCategoryAddendum.trim()}
                  loading={optimizing}
                  className="text-purple-600 border-purple-300 hover:bg-purple-50"
                >
                  <Wand2 size={16} className="mr-2" />
                  Optimize
                </Button>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={handleCloseCategoryPromptModal}
                  disabled={savingCategoryPrompt || optimizing}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSaveCategoryPrompt}
                  disabled={
                    (!categoryPromptModified && !starterPromptsModified && !welcomeModified) ||
                    savingCategoryPrompt ||
                    optimizing ||
                    editedCategoryAddendum.length > categoryPromptData.charInfo.availableForCategory
                  }
                  loading={savingCategoryPrompt}
                >
                  <Save size={16} className="mr-2" />
                  Save
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-gray-500 text-center py-8">Failed to load category prompt data</p>
        )}
      </Modal>
    </>
  );
}
