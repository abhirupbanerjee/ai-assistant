'use client';

import { useState } from 'react';
import { Plus, Trash2, GripVertical, AlertCircle } from 'lucide-react';
import Button from '@/components/ui/Button';

export interface StarterPrompt {
  label: string;
  prompt: string;
}

interface StarterPromptsEditorProps {
  starters: StarterPrompt[];
  onChange: (starters: StarterPrompt[]) => void;
  disabled?: boolean;
  maxStarters?: number;
  maxLabelLength?: number;
  maxPromptLength?: number;
}

// Default values (used when props not provided)
const DEFAULT_MAX_STARTERS = 6;
const DEFAULT_MAX_LABEL_LENGTH = 30;
const DEFAULT_MAX_PROMPT_LENGTH = 500;

export default function StarterPromptsEditor({
  starters,
  onChange,
  disabled = false,
  maxStarters = DEFAULT_MAX_STARTERS,
  maxLabelLength = DEFAULT_MAX_LABEL_LENGTH,
  maxPromptLength = DEFAULT_MAX_PROMPT_LENGTH,
}: StarterPromptsEditorProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const addStarter = () => {
    if (starters.length >= maxStarters) return;
    onChange([...starters, { label: '', prompt: '' }]);
  };

  const removeStarter = (index: number) => {
    onChange(starters.filter((_, i) => i !== index));
  };

  const updateStarter = (index: number, field: 'label' | 'prompt', value: string) => {
    const updated = [...starters];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };

  const handleDragStart = (index: number) => {
    setDragIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === index) return;

    const updated = [...starters];
    const [removed] = updated.splice(dragIndex, 1);
    updated.splice(index, 0, removed);
    onChange(updated);
    setDragIndex(index);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-medium text-gray-700">Starter Prompts</h4>
          <p className="text-xs text-gray-500">
            Quick-action buttons shown when users start a new thread ({starters.length}/{maxStarters})
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={addStarter}
          disabled={disabled || starters.length >= maxStarters}
        >
          <Plus size={14} className="mr-1" />
          Add Starter
        </Button>
      </div>

      {starters.length === 0 ? (
        <div className="text-center py-6 bg-gray-50 rounded-lg border-2 border-dashed border-gray-200">
          <p className="text-sm text-gray-500">No starter prompts configured</p>
          <p className="text-xs text-gray-400 mt-1">
            Add prompts to help users get started quickly
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {starters.map((starter, index) => (
            <div
              key={index}
              draggable={!disabled}
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragEnd={handleDragEnd}
              className={`border rounded-lg p-3 bg-white ${
                dragIndex === index ? 'opacity-50 border-blue-400' : 'border-gray-200'
              } ${!disabled ? 'cursor-move' : ''}`}
            >
              <div className="flex items-start gap-3">
                {!disabled && (
                  <div className="pt-2 text-gray-400">
                    <GripVertical size={16} />
                  </div>
                )}

                <div className="flex-1 space-y-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Button Label ({starter.label.length}/{maxLabelLength})
                    </label>
                    <input
                      type="text"
                      value={starter.label}
                      onChange={(e) => updateStarter(index, 'label', e.target.value)}
                      placeholder="e.g., Check Leave Policy"
                      maxLength={maxLabelLength}
                      disabled={disabled}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Full Prompt ({starter.prompt.length}/{maxPromptLength})
                    </label>
                    <textarea
                      value={starter.prompt}
                      onChange={(e) => updateStarter(index, 'prompt', e.target.value)}
                      placeholder="e.g., What is the annual leave policy for permanent employees?"
                      maxLength={maxPromptLength}
                      rows={2}
                      disabled={disabled}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 resize-none"
                    />
                  </div>
                </div>

                {!disabled && (
                  <button
                    onClick={() => removeStarter(index)}
                    className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    title="Remove starter"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>

              {(starter.label.trim() === '' || starter.prompt.trim() === '') && (
                <div className="flex items-center gap-1 mt-2 text-amber-600 text-xs">
                  <AlertCircle size={12} />
                  <span>Both label and prompt are required</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {starters.length > 0 && (
        <p className="text-xs text-gray-400">
          Drag to reorder. Starters appear as clickable buttons when users create a thread with this category.
        </p>
      )}
    </div>
  );
}
