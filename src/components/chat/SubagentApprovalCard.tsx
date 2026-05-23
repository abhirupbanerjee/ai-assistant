/**
 * Subagent Approval Card
 *
 * HITL UI for approving/denying/modifying subagent tool executions.
 * Displays tool name, arguments, reasoning, and risk level.
 */

'use client';

import { useState } from 'react';
import { AlertTriangle, CheckCircle, XCircle, Edit3, Shield } from 'lucide-react';

export interface SubagentApprovalCardProps {
  taskId: number;
  toolName: string;
  args: Record<string, unknown>;
  reasoning: string;
  riskLevel: 'low' | 'medium' | 'high';
  onApprove: (taskId: number) => void;
  onDeny: (taskId: number) => void;
  onModify: (taskId: number, modifiedArgs: Record<string, unknown>) => void;
}

function getRiskColor(riskLevel: string) {
  switch (riskLevel) {
    case 'high':
      return 'bg-red-50 border-red-200 text-red-700';
    case 'medium':
      return 'bg-amber-50 border-amber-200 text-amber-700';
    default:
      return 'bg-blue-50 border-blue-200 text-blue-700';
  }
}

function getRiskIcon(riskLevel: string) {
  switch (riskLevel) {
    case 'high':
      return <AlertTriangle size={18} className="text-red-500" />;
    case 'medium':
      return <Shield size={18} className="text-amber-500" />;
    default:
      return <Shield size={18} className="text-blue-500" />;
  }
}

export default function SubagentApprovalCard({
  taskId,
  toolName,
  args,
  reasoning,
  riskLevel,
  onApprove,
  onDeny,
  onModify,
}: SubagentApprovalCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedArgs, setEditedArgs] = useState(JSON.stringify(args, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);

  const handleModify = () => {
    try {
      const parsed = JSON.parse(editedArgs);
      setParseError(null);
      onModify(taskId, parsed);
    } catch {
      setParseError('Invalid JSON. Please fix the syntax.');
    }
  };

  return (
    <div className={`rounded-xl border p-4 shadow-sm ${getRiskColor(riskLevel)}`}>
      <div className="flex items-center gap-2 mb-3">
        {getRiskIcon(riskLevel)}
        <span className="font-semibold text-sm">Subagent Tool Approval</span>
        <span className={`ml-auto px-2 py-0.5 rounded text-xs font-medium uppercase ${
          riskLevel === 'high' ? 'bg-red-100 text-red-700' :
          riskLevel === 'medium' ? 'bg-amber-100 text-amber-700' :
          'bg-blue-100 text-blue-700'
        }`}>
          {riskLevel} risk
        </span>
      </div>

      <div className="space-y-2 text-sm">
        <div>
          <span className="font-medium">Tool:</span>{' '}
          <code className="px-1.5 py-0.5 rounded bg-black/5 text-xs">{toolName}</code>
        </div>

        {reasoning && (
          <div className="text-gray-600 italic">
            &ldquo;{reasoning}&rdquo;
          </div>
        )}

        {isEditing ? (
          <div>
            <label className="block text-xs font-medium mb-1">Modified Arguments (JSON)</label>
            <textarea
              value={editedArgs}
              onChange={(e) => { setEditedArgs(e.target.value); setParseError(null); }}
              className="w-full h-32 px-2 py-1.5 text-xs font-mono border rounded focus:ring-2 focus:ring-blue-500 bg-white"
            />
            {parseError && <p className="text-xs text-red-600 mt-1">{parseError}</p>}
          </div>
        ) : (
          <div className="bg-white/60 rounded p-2">
            <span className="text-xs font-medium text-gray-500">Arguments:</span>
            <pre className="text-xs font-mono mt-1 overflow-x-auto">
              {JSON.stringify(args, null, 2)}
            </pre>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 mt-4">
        <button
          onClick={() => onApprove(taskId)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-green-600 text-white hover:bg-green-700 transition-colors"
        >
          <CheckCircle size={14} /> Approve
        </button>
        <button
          onClick={() => onDeny(taskId)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
        >
          <XCircle size={14} /> Deny
        </button>
        {isEditing ? (
          <button
            onClick={handleModify}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            <CheckCircle size={14} /> Save & Approve
          </button>
        ) : (
          <button
            onClick={() => setIsEditing(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
          >
            <Edit3 size={14} /> Modify
          </button>
        )}
      </div>
    </div>
  );
}
