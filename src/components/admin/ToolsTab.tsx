'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Globe,
  Settings,
  Power,
  PowerOff,
  AlertCircle,
  CheckCircle,
  RefreshCw,
  Save,
  TestTube,
  Info,
  ChevronDown,
  ChevronUp,
  Clock,
  Palette,
  Building2,
  FileText,
  Database,
  Zap,
  Route,
  Wrench,
  ImageIcon,
  Languages,
  Activity,
  Code,
  Gauge,
  Shield,
  Lock,
  Server,
  Cookie,
  ArrowRightLeft,
  KeyRound,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import Modal from '@/components/ui/Modal';
import DataSourcesTab from './DataSourcesTab';
import FunctionAPITab from './FunctionAPITab';
// ToolRoutingTab is deprecated - tool routing now handled via Skills
import ImageGenConfig from './ImageGenConfig';
import TranslationConfig from './TranslationConfig';
import PodcastGenConfig from './PodcastGenConfig';
import WebsiteAnalysisConfig from './WebsiteAnalysisConfig';
import CodeAnalysisConfig from './CodeAnalysisConfig';
import LoadTestConfig from './LoadTestConfig';
import SecurityScanConfig from './SecurityScanConfig';
import { ToolDependencyPanel } from './ToolDependencyPanel';
import KeywordConflictAnalyzer from './KeywordConflictAnalyzer';

// Tool interface matching API response
interface Tool {
  name: string;
  displayName: string;
  description: string;
  category: 'autonomous' | 'processor';
  enabled: boolean;
  config: Record<string, unknown>;
  configSchema: Record<string, unknown>;
  defaultConfig: Record<string, unknown>;
  descriptionOverride: string | null;
  defaultDescription: string;
  isTerminal: boolean;
  isHybrid: boolean;
  metadata: {
    id: string;
    createdAt: string;
    updatedAt: string;
    updatedBy: string;
  } | null;
}

// Tool category/type explanations for tooltips
const TOOL_EXPLANATIONS = {
  autonomous: {
    title: 'Autonomous Tool',
    description: 'LLM-triggered via function calling. The AI decides when to invoke this tool based on user queries.',
  },
  processor: {
    title: 'Processor Tool',
    description: 'Post-response output processor. Applied after the AI generates a response to transform or enhance the output.',
  },
  hybrid: {
    title: 'Hybrid Tool',
    description: 'Functions both as autonomous (LLM can call it) AND as a processor (system auto-applies based on settings).',
  },
  terminal: {
    title: 'Terminal Tool',
    description: 'Produces final outputs (images, documents, charts). When successful, the tool loop stops and an LLM summary is generated.',
  },
};

interface AuditEntry {
  id: number;
  toolName: string;
  operation: 'create' | 'update' | 'delete';
  oldConfig: Record<string, unknown> | null;
  newConfig: Record<string, unknown> | null;
  changedBy: string;
  changedAt: string;
}

interface TestResult {
  tool: string;
  success: boolean;
  message: string;
  latency?: number;
  testedAt: string;
  testedBy: string;
}

// Superuser mode interfaces
interface AssignedCategory {
  id: number;
  name: string;
  slug: string;
}

interface CategoryToolStatus {
  categoryId: number;
  categoryName: string;
  categorySlug: string;
  isEnabled: boolean | null; // null = inherit
  effectiveEnabled: boolean;
  branding: BrandingConfig | null;
}

interface SuperuserTool {
  name: string;
  displayName: string;
  description: string;
  category: string;
  globalEnabled: boolean;
  isTerminal: boolean;
  isHybrid: boolean;
  categories: CategoryToolStatus[];
}

interface BrandingConfig {
  enabled: boolean;
  logoUrl: string;
  organizationName: string;
  primaryColor: string;
  fontFamily: string;
  header: { enabled: boolean; content: string };
  footer: { enabled: boolean; content: string; includePageNumber: boolean };
}

/**
 * Get icon for a tool based on its name
 */
function getToolIcon(toolName: string) {
  switch (toolName) {
    case 'web_search':
      return Globe;
    case 'doc_gen':
      return FileText;
    case 'data_source':
      return Database;
    case 'function_api':
      return Zap;
    case 'image_gen':
      return ImageIcon;
    case 'translation':
      return Languages;
    case 'website_analysis':
      return Activity;
    case 'code_analysis':
      return Code;
    case 'load_testing':
      return Gauge;
    case 'security_scan':
      return Shield;
    case 'ssl_scan':
      return Lock;
    case 'dns_scan':
      return Server;
    case 'cookie_audit':
      return Cookie;
    case 'redirect_audit':
      return ArrowRightLeft;
    default:
      return Settings;
  }
}

/**
 * Format date for display
 */
function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString();
}

/**
 * WebSearchConfig component - Configuration form for web_search tool
 */
function WebSearchConfig({
  config,
  onChange,
  disabled,
  hideSensitive,
}: {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  disabled: boolean;
  hideSensitive?: boolean;
}) {
  const handleChange = (key: string, value: unknown) => {
    onChange({ ...config, [key]: value });
  };

  const handleArrayChange = (key: string, value: string) => {
    // Convert comma-separated string to array
    const arr = value.split(',').map(s => s.trim()).filter(Boolean);
    onChange({ ...config, [key]: arr });
  };

  return (
    <div className="space-y-4">
      {/* API Key Status - managed in Settings → API Keys */}
      {!hideSensitive && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Tavily API Key
          </label>
          <p className="text-sm text-gray-600 mb-2">
            {(config.apiKey as string) && !(config.apiKey as string).includes('••') ? (
              <span className="text-green-600 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                Configured
              </span>
            ) : (config.apiKey as string)?.includes('••') ? (
              <span className="text-green-600 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                Configured
              </span>
            ) : (
              <span className="text-gray-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 inline-block" />
                Not configured
              </span>
            )}
          </p>
          <div className="p-2.5 bg-blue-50 border border-blue-100 rounded-lg flex items-center gap-2">
            <KeyRound size={14} className="text-blue-600 flex-shrink-0" />
            <p className="text-xs text-blue-800">
              API keys are managed in{' '}
              <a href="/admin?tab=settings&section=api-keys" className="text-blue-600 font-medium hover:underline">
                Settings &rarr; API Keys
              </a>
            </p>
          </div>
        </div>
      )}

      {/* Default Topic */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Default Search Topic
        </label>
        <select
          value={(config.defaultTopic as string) || 'general'}
          onChange={(e) => handleChange('defaultTopic', e.target.value)}
          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          disabled={disabled}
        >
          <option value="general">General</option>
          <option value="news">News</option>
          <option value="finance">Finance</option>
        </select>
      </div>

      {/* Search Depth */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Search Depth
        </label>
        <select
          value={(config.defaultSearchDepth as string) || 'basic'}
          onChange={(e) => handleChange('defaultSearchDepth', e.target.value)}
          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          disabled={disabled}
        >
          <option value="basic">Basic (faster, 3-5 results)</option>
          <option value="advanced">Advanced (comprehensive, 10+ results)</option>
        </select>
      </div>

      {/* Max Results */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Max Results per Query
        </label>
        <input
          type="number"
          min={1}
          max={10}
          value={(config.maxResults as number) || 5}
          onChange={(e) => handleChange('maxResults', parseInt(e.target.value) || 5)}
          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          disabled={disabled}
        />
        <p className="text-xs text-gray-500 mt-1">Between 1 and 10</p>
      </div>

      {/* Include Domains */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Include Domains (optional)
        </label>
        <input
          type="text"
          value={((config.includeDomains as string[]) || []).join(', ')}
          onChange={(e) => handleArrayChange('includeDomains', e.target.value)}
          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          placeholder="example.com, news.site.com"
          disabled={disabled}
        />
        <p className="text-xs text-gray-500 mt-1">Comma-separated list of domains to search</p>
      </div>

      {/* Exclude Domains */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Exclude Domains (optional)
        </label>
        <input
          type="text"
          value={((config.excludeDomains as string[]) || []).join(', ')}
          onChange={(e) => handleArrayChange('excludeDomains', e.target.value)}
          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          placeholder="spam.com, unwanted.site"
          disabled={disabled}
        />
        <p className="text-xs text-gray-500 mt-1">Comma-separated list of domains to exclude</p>
      </div>

      {/* Cache TTL */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Cache Duration (seconds)
        </label>
        <input
          type="number"
          min={60}
          max={2592000}
          value={(config.cacheTTLSeconds as number) || 3600}
          onChange={(e) => handleChange('cacheTTLSeconds', parseInt(e.target.value) || 3600)}
          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          disabled={disabled}
        />
        <p className="text-xs text-gray-500 mt-1">
          How long to cache search results (3600 = 1 hour)
        </p>
      </div>
    </div>
  );
}

/**
 * DocGenConfig component - Configuration form for doc_gen tool
 */
function DocGenConfig({
  config,
  onChange,
  disabled,
}: {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  disabled: boolean;
}) {
  const handleChange = (key: string, value: unknown) => {
    onChange({ ...config, [key]: value });
  };

  const handleBrandingChange = (key: string, value: unknown) => {
    const branding = (config.branding as Record<string, unknown>) || {};
    onChange({
      ...config,
      branding: { ...branding, [key]: value },
    });
  };

  const handleHeaderChange = (key: string, value: unknown) => {
    const branding = (config.branding as Record<string, unknown>) || {};
    const header = (branding.header as Record<string, unknown>) || {};
    onChange({
      ...config,
      branding: {
        ...branding,
        header: { ...header, [key]: value },
      },
    });
  };

  const handleFooterChange = (key: string, value: unknown) => {
    const branding = (config.branding as Record<string, unknown>) || {};
    const footer = (branding.footer as Record<string, unknown>) || {};
    onChange({
      ...config,
      branding: {
        ...branding,
        footer: { ...footer, [key]: value },
      },
    });
  };

  const handleFormatToggle = (format: string, checked: boolean) => {
    const formats = ((config.enabledFormats as string[]) || ['pdf', 'docx']).slice();
    if (checked && !formats.includes(format)) {
      formats.push(format);
    } else if (!checked) {
      const idx = formats.indexOf(format);
      if (idx !== -1) formats.splice(idx, 1);
    }
    onChange({ ...config, enabledFormats: formats });
  };

  const branding = (config.branding as Record<string, unknown>) || {};
  const header = (branding.header as Record<string, unknown>) || {};
  const footer = (branding.footer as Record<string, unknown>) || {};

  return (
    <div className="space-y-4">
      {/* Default Format */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Default Format
        </label>
        <select
          value={(config.defaultFormat as string) || 'pdf'}
          onChange={(e) => handleChange('defaultFormat', e.target.value)}
          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          disabled={disabled}
        >
          <option value="pdf">PDF</option>
          <option value="docx">Word Document (DOCX)</option>
          <option value="md">Markdown (MD)</option>
        </select>
      </div>

      {/* Enabled Formats */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Enabled Formats
        </label>
        <div className="flex gap-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={((config.enabledFormats as string[]) || ['pdf', 'docx']).includes('pdf')}
              onChange={(e) => handleFormatToggle('pdf', e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              disabled={disabled}
            />
            <span className="text-sm">PDF</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={((config.enabledFormats as string[]) || ['pdf', 'docx']).includes('docx')}
              onChange={(e) => handleFormatToggle('docx', e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              disabled={disabled}
            />
            <span className="text-sm">DOCX</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={((config.enabledFormats as string[]) || ['pdf', 'docx', 'md']).includes('md')}
              onChange={(e) => handleFormatToggle('md', e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              disabled={disabled}
            />
            <span className="text-sm">Markdown</span>
          </label>
        </div>
      </div>

      {/* Expiration Days */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Document Expiration (days)
        </label>
        <input
          type="number"
          min={0}
          max={365}
          value={(config.expirationDays as number) || 30}
          onChange={(e) => handleChange('expirationDays', parseInt(e.target.value) || 30)}
          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          disabled={disabled}
        />
        <p className="text-xs text-gray-500 mt-1">
          Days until documents expire (0 = never expire)
        </p>
      </div>

      {/* Max Document Size */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Max Document Size (MB)
        </label>
        <input
          type="number"
          min={1}
          max={100}
          value={(config.maxDocumentSizeMB as number) || 50}
          onChange={(e) => handleChange('maxDocumentSizeMB', parseInt(e.target.value) || 50)}
          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          disabled={disabled}
        />
      </div>

      {/* Branding Section */}
      <div className="border-t pt-4 mt-4">
        <h4 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
          <Palette size={16} />
          Default Branding
        </h4>

        {/* Enable Branding */}
        <div className="flex items-center gap-3 mb-4">
          <input
            type="checkbox"
            id="branding-enabled-admin"
            checked={!!branding.enabled}
            onChange={(e) => handleBrandingChange('enabled', e.target.checked)}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            disabled={disabled}
          />
          <label htmlFor="branding-enabled-admin" className="text-sm text-gray-700">
            Enable branding on documents
          </label>
        </div>

        {!!branding.enabled && (
          <div className="space-y-3 pl-6 border-l-2 border-blue-200">
            {/* Organization Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Organization Name
              </label>
              <input
                type="text"
                value={(branding.organizationName as string) || ''}
                onChange={(e) => handleBrandingChange('organizationName', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="Your Organization"
                disabled={disabled}
              />
            </div>

            {/* Logo URL */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Logo URL
              </label>
              <input
                type="text"
                value={(branding.logoUrl as string) || ''}
                onChange={(e) => handleBrandingChange('logoUrl', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="https://example.com/logo.png"
                disabled={disabled}
              />
            </div>

            {/* Primary Color */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Primary Color
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={(branding.primaryColor as string) || '#003366'}
                  onChange={(e) => handleBrandingChange('primaryColor', e.target.value)}
                  className="h-10 w-16 border rounded cursor-pointer"
                  disabled={disabled}
                />
                <input
                  type="text"
                  value={(branding.primaryColor as string) || '#003366'}
                  onChange={(e) => handleBrandingChange('primaryColor', e.target.value)}
                  className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="#003366"
                  disabled={disabled}
                />
              </div>
            </div>

            {/* Font Family */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Font Family
              </label>
              <select
                value={(branding.fontFamily as string) || 'Calibri'}
                onChange={(e) => handleBrandingChange('fontFamily', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                disabled={disabled}
              >
                <option value="Calibri">Calibri</option>
                <option value="Arial">Arial</option>
                <option value="Times New Roman">Times New Roman</option>
                <option value="Helvetica">Helvetica</option>
                <option value="Georgia">Georgia</option>
              </select>
            </div>

            {/* Header Settings */}
            <div className="border rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <input
                  type="checkbox"
                  id="header-enabled-admin"
                  checked={!!header.enabled}
                  onChange={(e) => handleHeaderChange('enabled', e.target.checked)}
                  className="rounded border-gray-300 text-blue-600"
                  disabled={disabled}
                />
                <label htmlFor="header-enabled-admin" className="text-sm font-medium text-gray-700">
                  Custom Header
                </label>
              </div>
              {!!header.enabled && (
                <input
                  type="text"
                  value={(header.content as string) || ''}
                  onChange={(e) => handleHeaderChange('content', e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="Header text"
                  disabled={disabled}
                />
              )}
            </div>

            {/* Footer Settings */}
            <div className="border rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <input
                  type="checkbox"
                  id="footer-enabled-admin"
                  checked={!!footer.enabled}
                  onChange={(e) => handleFooterChange('enabled', e.target.checked)}
                  className="rounded border-gray-300 text-blue-600"
                  disabled={disabled}
                />
                <label htmlFor="footer-enabled-admin" className="text-sm font-medium text-gray-700">
                  Custom Footer
                </label>
              </div>
              {!!footer.enabled && (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={(footer.content as string) || ''}
                    onChange={(e) => handleFooterChange('content', e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="Footer text"
                    disabled={disabled}
                  />
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="footer-page-admin"
                      checked={footer.includePageNumber !== false}
                      onChange={(e) => handleFooterChange('includePageNumber', e.target.checked)}
                      className="rounded border-gray-300 text-blue-600"
                      disabled={disabled}
                    />
                    <label htmlFor="footer-page-admin" className="text-sm text-gray-600">
                      Include page numbers
                    </label>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Generic tool config renderer for tools without custom forms
 */
function GenericToolConfig({
  config,
  schema,
  onChange,
  disabled,
}: {
  config: Record<string, unknown>;
  schema: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  disabled: boolean;
}) {
  const properties = (schema as { properties?: Record<string, { type: string; title?: string; description?: string; enum?: string[]; default?: unknown; minimum?: number; maximum?: number }> }).properties || {};

  return (
    <div className="space-y-4">
      {Object.entries(properties).map(([key, prop]) => (
        <div key={key}>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {prop.title || key}
          </label>
          {/* Dropdown for enum properties */}
          {prop.enum && Array.isArray(prop.enum) ? (
            <select
              value={String(config[key] ?? prop.default ?? '')}
              onChange={(e) => onChange({ ...config, [key]: e.target.value })}
              disabled={disabled}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
            >
              {/* Show "Use default" option only if default is empty string */}
              {prop.default === '' && <option value="">Use default LLM settings</option>}
              {prop.enum.map((option: string) => (
                <option key={option} value={option}>
                  {option === 'auto' ? 'Auto (use default LLM provider)' : option.charAt(0).toUpperCase() + option.slice(1)}
                </option>
              ))}
            </select>
          ) : prop.type === 'boolean' ? (
            <input
              type="checkbox"
              checked={!!config[key]}
              onChange={(e) => onChange({ ...config, [key]: e.target.checked })}
              disabled={disabled}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
          ) : prop.type === 'number' ? (
            <>
              <input
                type="number"
                min={prop.minimum}
                max={prop.maximum}
                value={(config[key] as number) ?? (prop.default as number) ?? 0}
                onChange={(e) => onChange({ ...config, [key]: parseInt(e.target.value) })}
                disabled={disabled}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
              />
              {(prop.minimum !== undefined || prop.maximum !== undefined) && (
                <p className="text-xs text-gray-500 mt-1">
                  {prop.minimum !== undefined && prop.maximum !== undefined
                    ? `Between ${prop.minimum} and ${prop.maximum}`
                    : prop.minimum !== undefined
                      ? `Minimum: ${prop.minimum}`
                      : `Maximum: ${prop.maximum}`}
                </p>
              )}
            </>
          ) : (
            <input
              type="text"
              value={(config[key] as string) ?? (prop.default as string) ?? ''}
              onChange={(e) => onChange({ ...config, [key]: e.target.value })}
              disabled={disabled}
              placeholder={prop.default === '' ? 'Leave empty to use default' : undefined}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          )}
          {prop.description && (
            <p className="text-xs text-gray-500 mt-1">{prop.description}</p>
          )}
        </div>
      ))}
    </div>
  );
}

interface AvailableModel {
  id: string;
  name: string;
  description: string;
  provider: 'openai' | 'mistral' | 'gemini' | 'ollama';
  defaultMaxTokens: number;
}

/**
 * Custom config component for Compliance Checker tool
 * Handles dynamic model dropdown based on selected provider
 */
function ComplianceCheckerConfig({
  config,
  onChange,
  disabled,
}: {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  disabled: boolean;
}) {
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(true);

  // Fetch available models from settings API
  useEffect(() => {
    const fetchModels = async () => {
      try {
        const res = await fetch('/api/admin/settings');
        if (res.ok) {
          const data = await res.json();
          setAvailableModels((data.availableModels || []).filter(Boolean));
        }
      } catch (err) {
        console.error('Failed to fetch available models:', err);
      } finally {
        setLoadingModels(false);
      }
    };
    fetchModels();
  }, []);

  const provider = (config.clarificationProvider as string) || 'auto';

  // Filter models by selected provider
  const modelsForProvider = availableModels.filter(m => m.provider === provider);

  return (
    <div className="space-y-4">
      {/* Enable Compliance Checking */}
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="compliance_enabled"
          checked={config.enabled !== false}
          onChange={(e) => onChange({ ...config, enabled: e.target.checked })}
          disabled={disabled}
          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        <label htmlFor="compliance_enabled" className="text-sm font-medium text-gray-700">
          Enable Compliance Checking
        </label>
      </div>
      <p className="text-xs text-gray-500 -mt-2 ml-6">
        Enable or disable compliance validation globally. When enabled, only skills with compliance explicitly enabled will be checked.
      </p>

      {/* Thresholds */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Pass Threshold</label>
          <input
            type="number"
            min={0}
            max={100}
            value={(config.passThreshold as number) ?? 80}
            onChange={(e) => onChange({ ...config, passThreshold: parseInt(e.target.value) })}
            disabled={disabled}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-gray-500 mt-1">Recommended: 70-80</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Warning Threshold</label>
          <input
            type="number"
            min={0}
            max={100}
            value={(config.warnThreshold as number) ?? 50}
            onChange={(e) => onChange({ ...config, warnThreshold: parseInt(e.target.value) })}
            disabled={disabled}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-gray-500 mt-1">Recommended: 40-60. Below this triggers HITL.</p>
        </div>
      </div>

      {/* HITL Options */}
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="enableHitl"
          checked={config.enableHitl !== false}
          onChange={(e) => onChange({ ...config, enableHitl: e.target.checked })}
          disabled={disabled}
          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        <label htmlFor="enableHitl" className="text-sm font-medium text-gray-700">
          Enable Human-in-the-Loop
        </label>
      </div>
      <p className="text-xs text-gray-500 -mt-2 ml-6">
        Show clarification dialog when compliance score is below warning threshold.
      </p>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="useWeightedScoring"
          checked={config.useWeightedScoring !== false}
          onChange={(e) => onChange({ ...config, useWeightedScoring: e.target.checked })}
          disabled={disabled}
          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        <label htmlFor="useWeightedScoring" className="text-sm font-medium text-gray-700">
          Use Weighted Scoring
        </label>
      </div>
      <p className="text-xs text-gray-500 -mt-2 ml-6">
        Weight checks by importance: artifact failures=30%, tool errors=25%, empty results=25%, missing sections=20%.
      </p>

      {/* Clarification LLM Settings */}
      <div className="border-t pt-4 mt-4">
        <h4 className="font-medium text-gray-900 mb-3">Clarification LLM Settings</h4>

        <div className="space-y-4">
          {/* Provider Dropdown */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Provider</label>
            <select
              value={provider}
              onChange={(e) => onChange({ ...config, clarificationProvider: e.target.value, clarificationModel: '' })}
              disabled={disabled}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="auto">Auto (use default LLM provider)</option>
              <option value="openai">OpenAI</option>
              <option value="gemini">Google Gemini</option>
              <option value="mistral">Mistral</option>
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Provider for generating clarification questions.
            </p>
          </div>

          {/* Model Dropdown - Dynamic based on provider */}
          {provider !== 'auto' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Model</label>
              {loadingModels ? (
                <div className="px-3 py-2 text-sm text-gray-500">Loading models...</div>
              ) : (
                <select
                  value={(config.clarificationModel as string) || ''}
                  onChange={(e) => onChange({ ...config, clarificationModel: e.target.value })}
                  disabled={disabled}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="">Use default from LLM Settings</option>
                  {modelsForProvider.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name} - {model.description}
                    </option>
                  ))}
                </select>
              )}
              <p className="text-xs text-gray-500 mt-1">
                Tip: Use cheaper/faster models for cost savings. Clarifications are simple tasks.
              </p>
            </div>
          )}

          {provider === 'auto' && (
            <p className="text-xs text-gray-500 bg-blue-50 p-2 rounded">
              Using &quot;Auto&quot; will use the same provider and model configured in your main LLM Settings.
            </p>
          )}

          {/* Use LLM Clarifications */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="useLlmClarifications"
              checked={config.useLlmClarifications !== false}
              onChange={(e) => onChange({ ...config, useLlmClarifications: e.target.checked })}
              disabled={disabled}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="useLlmClarifications" className="text-sm font-medium text-gray-700">
              Use LLM Clarifications
            </label>
          </div>
          <p className="text-xs text-gray-500 -mt-2 ml-6">
            Generate contextual questions using LLM. When disabled, uses pre-defined templates.
          </p>

          {/* Timeout */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Clarification Timeout (ms)</label>
            <input
              type="number"
              min={1000}
              max={30000}
              step={500}
              value={(config.clarificationTimeout as number) ?? 5000}
              onChange={(e) => onChange({ ...config, clarificationTimeout: parseInt(e.target.value) })}
              disabled={disabled}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              Recommended: 3000-5000ms. Falls back to templates if exceeded.
            </p>
          </div>

          {/* Fallback to Templates */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="fallbackToTemplates"
              checked={config.fallbackToTemplates !== false}
              onChange={(e) => onChange({ ...config, fallbackToTemplates: e.target.checked })}
              disabled={disabled}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="fallbackToTemplates" className="text-sm font-medium text-gray-700">
              Fallback to Templates
            </label>
          </div>
          <p className="text-xs text-gray-500 -mt-2 ml-6">
            If LLM clarification fails or times out, show template questions. Templates exist for: empty search results, failed charts, missing sections, failed document/image generation, data source errors, and general tool errors.
          </p>

          {/* Allow Accept Flagged */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="allowAcceptFlagged"
              checked={config.allowAcceptFlagged !== false}
              onChange={(e) => onChange({ ...config, allowAcceptFlagged: e.target.checked })}
              disabled={disabled}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="allowAcceptFlagged" className="text-sm font-medium text-gray-700">
              Allow &quot;Accept &amp; Flag&quot;
            </label>
          </div>
          <p className="text-xs text-gray-500 -mt-2 ml-6">
            Show &quot;Accept but flag for review&quot; option in HITL dialog. Lets users accept responses despite issues while marking them for admin review later.
          </p>
        </div>
      </div>

      {/* Pre-flight Clarification Defaults */}
      <div className="border rounded-lg p-4 bg-gray-50">
        <h4 className="text-sm font-semibold text-gray-800 mb-3">Pre-flight Clarification Defaults</h4>
        <p className="text-xs text-gray-500 mb-3">
          When enabled, ambiguous queries to preflight-enabled skills trigger clarification questions <em>before</em> generating a response. Per-skill opt-in is still required.
        </p>
        <div className="space-y-3">
          {/* Global Enable */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="preflightEnabled"
              checked={config.preflightEnabled === true}
              onChange={(e) => onChange({ ...config, preflightEnabled: e.target.checked })}
              disabled={disabled}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="preflightEnabled" className="text-sm font-medium text-gray-700">
              Enable Pre-flight Clarification
            </label>
          </div>

          {/* Timeout */}
          <div>
            <label htmlFor="preflightDefaultTimeoutMs" className="block text-sm font-medium text-gray-700 mb-1">
              Default Timeout
            </label>
            <select
              id="preflightDefaultTimeoutMs"
              value={Number(config.preflightDefaultTimeoutMs) || 300000}
              onChange={(e) => onChange({ ...config, preflightDefaultTimeoutMs: Number(e.target.value) })}
              disabled={disabled || config.preflightEnabled !== true}
              className="w-48 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm disabled:opacity-50"
            >
              <option value={60000}>1 minute</option>
              <option value={120000}>2 minutes</option>
              <option value={180000}>3 minutes</option>
              <option value={300000}>5 minutes</option>
              <option value={600000}>10 minutes</option>
              <option value={900000}>15 minutes</option>
            </select>
            <p className="text-xs text-gray-500 mt-1">
              How long to wait for user response before auto-skipping.
            </p>
          </div>

          {/* Max Questions */}
          <div>
            <label htmlFor="preflightMaxQuestions" className="block text-sm font-medium text-gray-700 mb-1">
              Max Questions
            </label>
            <input
              type="number"
              id="preflightMaxQuestions"
              value={Number(config.preflightMaxQuestions) || 2}
              onChange={(e) => {
                const val = Math.max(1, Math.min(4, Number(e.target.value) || 2));
                onChange({ ...config, preflightMaxQuestions: val });
              }}
              min={1}
              max={4}
              disabled={disabled || config.preflightEnabled !== true}
              className="w-20 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm disabled:opacity-50"
            />
            <p className="text-xs text-gray-500 mt-1">
              Maximum clarification questions per query (1-4).
            </p>
          </div>

          {/* Skip on Follow-up */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="preflightSkipOnFollowUp"
              checked={config.preflightSkipOnFollowUp !== false}
              onChange={(e) => onChange({ ...config, preflightSkipOnFollowUp: e.target.checked })}
              disabled={disabled || config.preflightEnabled !== true}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="preflightSkipOnFollowUp" className="text-sm font-medium text-gray-700">
              Skip on Follow-up Messages
            </label>
          </div>
          <p className="text-xs text-gray-500 -mt-2 ml-6">
            Don&apos;t trigger pre-flight clarification when the user&apos;s message appears to be a follow-up to an existing conversation.
          </p>
        </div>
      </div>
    </div>
  );
}

type ToolsSubTab = 'management' | 'dependencies' | 'routing' | 'conflicts';

interface ToolsTabProps {
  /** If true, shows read-only view (for superusers in legacy mode) */
  readOnly?: boolean;
  /** If true, shows superuser mode with category selection and per-category config */
  isSuperuser?: boolean;
  /** Optional controlled sub-tab from sidebar. When provided, hides internal tab UI */
  activeSubTab?: 'management' | 'dependencies' | 'routing' | 'conflicts';
}

/**
 * ToolsTab - Admin interface for managing tools
 * @param readOnly - If true, hides all edit controls (for superuser view)
 * @param isSuperuser - If true, shows superuser mode with category-level config
 */
export default function ToolsTab({ readOnly = false, isSuperuser = false, activeSubTab: controlledSubTab }: ToolsTabProps) {
  // Sub-tab state (only for admin mode when not controlled from sidebar)
  const [internalSubTab, setInternalSubTab] = useState<ToolsSubTab>('management');

  // Use controlled sub-tab from sidebar if provided, otherwise use internal state
  const activeSubTab = controlledSubTab ?? internalSubTab;
  const isControlled = controlledSubTab !== undefined;

  // Admin mode state
  const [tools, setTools] = useState<Tool[]>([]);

  // Superuser mode state
  const [superuserTools, setSuperuserTools] = useState<SuperuserTool[]>([]);
  const [assignedCategories, setAssignedCategories] = useState<AssignedCategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);

  // Common state
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Tool call limits accordion
  const [limitsOpen, setLimitsOpen] = useState(false);
  const [limitsSettings, setLimitsSettings] = useState({ maxTotalToolCalls: 50, maxPerToolCalls: 10 });
  const [limitsSaving, setLimitsSaving] = useState(false);

  // Expanded tool state
  const [expandedTool, setExpandedTool] = useState<string | null>(null);
  const [editedConfig, setEditedConfig] = useState<Record<string, unknown>>({});

  // Branding editor state (superuser mode)
  const [editingBranding, setEditingBranding] = useState<string | null>(null); // tool name
  const [brandingConfig, setBrandingConfig] = useState<BrandingConfig | null>(null);

  // Modal states
  const [testingTool, setTestingTool] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [auditHistory, setAuditHistory] = useState<AuditEntry[]>([]);
  const [auditToolName, setAuditToolName] = useState<string>('');

  // Description override state
  const [showDescriptionEditor, setShowDescriptionEditor] = useState<string | null>(null);
  const [editedDescription, setEditedDescription] = useState<string>('');
  const [savingDescription, setSavingDescription] = useState(false);

  // Fetch tools for admin mode
  const fetchTools = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/tools');
      if (!response.ok) throw new Error('Failed to fetch tools');

      const data = await response.json();
      setTools(data.tools || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tools');
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch tool call limits from settings
  useEffect(() => {
    if (readOnly || isSuperuser) return;
    fetch('/api/admin/settings')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.limits) {
          setLimitsSettings({
            maxTotalToolCalls: data.limits.maxTotalToolCalls ?? 50,
            maxPerToolCalls: data.limits.maxPerToolCalls ?? 10,
          });
        }
      })
      .catch(() => {/* ignore */});
  }, [readOnly, isSuperuser]);

  const handleSaveLimits = async () => {
    setLimitsSaving(true);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'limits', settings: limitsSettings }),
      });
      if (!res.ok) throw new Error('Failed to save');
      setSuccess('Tool call limits saved');
      setTimeout(() => setSuccess(null), 3000);
    } catch {
      setError('Failed to save tool call limits');
    } finally {
      setLimitsSaving(false);
    }
  };

  // Fetch tools for superuser mode
  const fetchSuperuserTools = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/superuser/tools');
      if (!response.ok) throw new Error('Failed to fetch tools');

      const data = await response.json();
      setSuperuserTools(data.tools || []);
      setAssignedCategories(data.assignedCategories || []);

      // Auto-select first category if none selected
      if (data.assignedCategories?.length > 0) {
        setSelectedCategory((prev) => prev ?? data.assignedCategories[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tools');
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch tools on mount
  useEffect(() => {
    if (isSuperuser) {
      fetchSuperuserTools();
    } else {
      fetchTools();
    }
  }, [isSuperuser, fetchTools, fetchSuperuserTools]);

  // Toggle category tool enabled state (superuser)
  const handleToggleCategoryEnabled = async (toolName: string, currentEnabled: boolean | null) => {
    if (!selectedCategory) return;

    setSaving(true);
    try {
      // Toggle logic: null -> true, true -> false, false -> null (inherit)
      let newEnabled: boolean | null;
      if (currentEnabled === null) {
        newEnabled = true;
      } else if (currentEnabled === true) {
        newEnabled = false;
      } else {
        newEnabled = null; // Reset to inherit
      }

      const response = await fetch(`/api/superuser/tools/${toolName}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categoryId: selectedCategory,
          isEnabled: newEnabled,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update tool');
      }

      const statusText = newEnabled === null ? 'reset to inherit' : newEnabled ? 'enabled' : 'disabled';
      setSuccess(`Tool ${statusText} for this category`);
      setTimeout(() => setSuccess(null), 3000);
      fetchSuperuserTools();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update tool');
    } finally {
      setSaving(false);
    }
  };

  // Save branding config (superuser)
  const handleSaveBranding = async (toolName: string) => {
    if (!selectedCategory || !brandingConfig) return;

    setSaving(true);
    try {
      const response = await fetch(`/api/superuser/tools/${toolName}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categoryId: selectedCategory,
          branding: brandingConfig,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save branding');
      }

      setSuccess('Branding configuration saved');
      setTimeout(() => setSuccess(null), 3000);
      setEditingBranding(null);
      setBrandingConfig(null);
      fetchSuperuserTools();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save branding');
    } finally {
      setSaving(false);
    }
  };

  // Get category status for a tool
  const getCategoryStatus = (tool: SuperuserTool): CategoryToolStatus | undefined => {
    if (!selectedCategory) return undefined;
    return tool.categories.find(c => c.categoryId === selectedCategory);
  };

  // Toggle tool enabled state
  const handleToggleEnabled = async (tool: Tool) => {
    setSaving(true);
    try {
      const response = await fetch(`/api/admin/tools/${tool.name}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !tool.enabled }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update tool');
      }

      setSuccess(`${tool.displayName} ${tool.enabled ? 'disabled' : 'enabled'} successfully`);
      setTimeout(() => setSuccess(null), 3000);
      fetchTools();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update tool');
    } finally {
      setSaving(false);
    }
  };

  // Save tool configuration
  const handleSaveConfig = async (toolName: string) => {
    setSaving(true);
    try {
      const response = await fetch(`/api/admin/tools/${toolName}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: editedConfig }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save configuration');
      }

      setSuccess('Configuration saved successfully');
      setTimeout(() => setSuccess(null), 3000);
      setExpandedTool(null);
      setEditedConfig({});
      fetchTools();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  // Save description override
  const handleSaveDescription = async (toolName: string) => {
    setSavingDescription(true);
    try {
      const response = await fetch(`/api/admin/tools/${toolName}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          descriptionOverride: editedDescription.trim() || null,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save description');
      }

      setSuccess('LLM prompt instructions updated successfully');
      setTimeout(() => setSuccess(null), 3000);
      setShowDescriptionEditor(null);
      setEditedDescription('');
      fetchTools();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save description');
    } finally {
      setSavingDescription(false);
    }
  };

  // Test tool connection
  const handleTestTool = async (toolName: string) => {
    setTestingTool(toolName);
    setTestResult(null);
    try {
      const response = await fetch(`/api/admin/tools/${toolName}/test`, {
        method: 'POST',
      });

      const data = await response.json();
      setTestResult(data);
    } catch (err) {
      setTestResult({
        tool: toolName,
        success: false,
        message: err instanceof Error ? err.message : 'Test failed',
        testedAt: new Date().toISOString(),
        testedBy: 'unknown',
      });
    } finally {
      setTestingTool(null);
    }
  };

  // View audit history
  const handleViewAudit = async (toolName: string) => {
    setAuditToolName(toolName);
    try {
      const response = await fetch(`/api/admin/tools/${toolName}`);
      if (!response.ok) throw new Error('Failed to fetch audit history');

      const data = await response.json();
      setAuditHistory(data.auditHistory || []);
      setShowAuditModal(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit history');
    }
  };

  // Expand/collapse tool
  const toggleExpand = (tool: Tool) => {
    if (expandedTool === tool.name) {
      setExpandedTool(null);
      setEditedConfig({});
    } else {
      setExpandedTool(tool.name);
      setEditedConfig(tool.config);
    }
  };

  // Render config form based on tool type
  const renderConfigForm = (tool: Tool, forSuperuser: boolean = false) => {
    switch (tool.name) {
      case 'web_search':
        return (
          <WebSearchConfig
            config={editedConfig}
            onChange={setEditedConfig}
            disabled={saving}
            hideSensitive={forSuperuser}
          />
        );
      case 'doc_gen':
        return (
          <DocGenConfig
            config={editedConfig}
            onChange={setEditedConfig}
            disabled={saving}
          />
        );
      case 'data_source':
        // Data source has its own management UI
        // Use superuser API paths if in superuser mode
        return (
          <DataSourcesTab
            apiBasePath={forSuperuser ? '/api/superuser/data-sources' : '/api/admin/data-sources'}
            categoriesPath={forSuperuser ? '/api/superuser/data-sources' : '/api/admin/categories'}
          />
        );
      case 'function_api':
        // Function API has its own management UI
        return (
          <FunctionAPITab
            apiBasePath="/api/admin/function-apis"
            categoriesPath="/api/admin/categories"
          />
        );
      case 'image_gen':
        return (
          <ImageGenConfig
            config={editedConfig}
            onChange={setEditedConfig}
            disabled={saving}
          />
        );
      case 'translation':
        return (
          <TranslationConfig
            config={editedConfig}
            onChange={setEditedConfig}
            disabled={saving}
          />
        );
      case 'compliance_checker':
        return (
          <ComplianceCheckerConfig
            config={editedConfig}
            onChange={setEditedConfig}
            disabled={saving}
          />
        );
      case 'podcast_gen':
        return (
          <PodcastGenConfig
            config={editedConfig}
            onChange={setEditedConfig}
            disabled={saving}
          />
        );
      case 'website_analysis':
        return (
          <WebsiteAnalysisConfig
            config={editedConfig}
            onChange={setEditedConfig}
            disabled={saving}
            hideSensitive={forSuperuser}
          />
        );
      case 'code_analysis':
        return (
          <CodeAnalysisConfig
            config={editedConfig}
            onChange={setEditedConfig}
            disabled={saving}
            hideSensitive={forSuperuser}
          />
        );
      case 'load_testing':
        return (
          <LoadTestConfig
            config={editedConfig}
            onChange={setEditedConfig}
            disabled={saving}
            hideSensitive={forSuperuser}
          />
        );
      case 'security_scan':
        return (
          <SecurityScanConfig
            config={editedConfig}
            onChange={setEditedConfig}
            disabled={saving}
          />
        );
      default:
        return (
          <GenericToolConfig
            config={editedConfig}
            schema={tool.configSchema}
            onChange={setEditedConfig}
            disabled={saving}
          />
        );
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Messages */}
      {error && (
        <div className="p-4 bg-red-50 text-red-600 rounded-lg flex items-center gap-3">
          <AlertCircle size={20} />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">&times;</button>
        </div>
      )}
      {success && (
        <div className="p-4 bg-green-50 text-green-600 rounded-lg flex items-center gap-3">
          <CheckCircle size={20} />
          <span>{success}</span>
        </div>
      )}

      {/* Sub-tabs (admin mode only, hidden when controlled from sidebar) */}
      {!readOnly && !isSuperuser && !isControlled && (
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex gap-6">
            <button
              onClick={() => setInternalSubTab('management')}
              className={`flex items-center gap-2 py-3 px-1 border-b-2 text-sm font-medium transition-colors ${
                activeSubTab === 'management'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <Wrench size={16} />
              Tools Management
            </button>
            <button
              onClick={() => setInternalSubTab('dependencies')}
              className={`flex items-center gap-2 py-3 px-1 border-b-2 text-sm font-medium transition-colors ${
                activeSubTab === 'dependencies'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <AlertCircle size={16} />
              Dependencies
            </button>
            <button
              onClick={() => setInternalSubTab('routing')}
              className={`flex items-center gap-2 py-3 px-1 border-b-2 text-sm font-medium transition-colors ${
                activeSubTab === 'routing'
                  ? 'border-amber-500 text-amber-600'
                  : 'border-transparent text-gray-400 hover:text-gray-600 hover:border-gray-300'
              }`}
            >
              <Route size={16} />
              <span className="flex items-center gap-1">
                Tool Routing
                <span className="px-1.5 py-0.5 text-xs bg-amber-100 text-amber-700 rounded">Moved</span>
              </span>
            </button>
            <button
              onClick={() => setInternalSubTab('conflicts')}
              className={`flex items-center gap-2 py-3 px-1 border-b-2 text-sm font-medium transition-colors ${
                activeSubTab === 'conflicts'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <AlertCircle size={16} />
              Keyword Conflicts
            </button>
          </nav>
        </div>
      )}

      {/* Tool Dependencies Sub-tab */}
      {!readOnly && !isSuperuser && activeSubTab === 'dependencies' && (
        <ToolDependencyPanel />
      )}

      {/* Tool Routing Sub-tab - DEPRECATED */}
      {!readOnly && !isSuperuser && activeSubTab === 'routing' && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-6 text-center">
          <Route size={48} className="mx-auto text-amber-500 mb-4" />
          <h3 className="text-lg font-semibold text-amber-800 mb-2">
            Tool Routing Has Moved
          </h3>
          <p className="text-amber-700 mb-4">
            Tool routing is now unified with Skills. Configure keyword-triggered tool actions
            in the <strong>Prompts → Skills</strong> tab using the &quot;Tool Action&quot; section.
          </p>
          <p className="text-sm text-amber-600">
            When creating or editing a keyword-triggered skill, you can now optionally
            force a specific tool to be called when the keywords match.
          </p>
        </div>
      )}

      {/* Keyword Conflicts Sub-tab */}
      {!readOnly && !isSuperuser && activeSubTab === 'conflicts' && (
        <KeywordConflictAnalyzer />
      )}

      {/* Tools Management Header - only show when on management tab or in superuser/readOnly mode */}
      {(readOnly || isSuperuser || activeSubTab === 'management') && (
        <>
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                {isSuperuser ? 'Category Tools' : readOnly ? 'Available Tools' : 'Tools Management'}
              </h2>
              <p className="text-sm text-gray-500">
                {isSuperuser
                  ? 'Configure tool availability and branding for your categories'
                  : readOnly
                    ? 'View available AI-powered tools and their status'
                    : 'Configure AI-powered tools and integrations'
                }
              </p>
            </div>
            <div className="flex items-center gap-3">
              {/* Category Selector (superuser mode) */}
              {isSuperuser && assignedCategories.length > 0 && (
                <select
                  value={selectedCategory || ''}
                  onChange={(e) => setSelectedCategory(Number(e.target.value))}
                  className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  {assignedCategories.map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              )}
              {!readOnly && !isSuperuser && (
                <Button variant="secondary" onClick={fetchTools} disabled={loading}>
                  <RefreshCw size={16} className={`mr-2 ${loading ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
              )}
              {isSuperuser && (
                <Button variant="secondary" onClick={fetchSuperuserTools} disabled={loading}>
                  <RefreshCw size={16} className={`mr-2 ${loading ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
              )}
            </div>
          </div>

      {/* Tool Call Limits Accordion — admin mode only */}
      {!readOnly && !isSuperuser && (
        <div className="bg-white rounded-lg border shadow-sm">
          <button
            onClick={() => setLimitsOpen(prev => !prev)}
            className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-4">
              <div className="p-2 rounded-lg bg-blue-100">
                <Gauge size={24} className="text-blue-600" />
              </div>
              <div className="text-left">
                <h3 className="font-semibold text-gray-900">Tool Call Limits</h3>
                <p className="text-sm text-gray-500">
                  Max total: {limitsSettings.maxTotalToolCalls} calls · Per-tool max: {limitsSettings.maxPerToolCalls} calls
                </p>
              </div>
            </div>
            {limitsOpen ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
          </button>

          {limitsOpen && (
            <div className="border-t border-gray-200 px-6 py-4 space-y-4">
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Max Total Tool Calls
                    <span className="ml-1 text-gray-400 font-normal">(5–200)</span>
                  </label>
                  <input
                    type="number"
                    min={5}
                    max={200}
                    value={limitsSettings.maxTotalToolCalls}
                    onChange={e => setLimitsSettings(prev => ({ ...prev, maxTotalToolCalls: Number(e.target.value) }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">Combined limit across all tools per chat</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Per-Tool Max Calls
                    <span className="ml-1 text-gray-400 font-normal">(1–50)</span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={limitsSettings.maxPerToolCalls}
                    onChange={e => setLimitsSettings(prev => ({ ...prev, maxPerToolCalls: Number(e.target.value) }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">e.g. web_search can be called max N times per chat</p>
                </div>
              </div>
              <div className="flex justify-end">
                <Button onClick={handleSaveLimits} disabled={limitsSaving}>
                  {limitsSaving ? <Spinner size="sm" className="mr-2" /> : <Save size={16} className="mr-2" />}
                  Save Limits
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tools List - Superuser Mode */}
      {isSuperuser && (
        <div className="space-y-4">
          {assignedCategories.length === 0 ? (
            <div className="bg-white rounded-lg border p-8 text-center text-gray-500">
              No categories assigned. Contact an administrator to get category access.
            </div>
          ) : superuserTools.length === 0 ? (
            <div className="bg-white rounded-lg border p-8 text-center text-gray-500">
              No tools available. Tools will appear here when configured.
            </div>
          ) : (
            superuserTools.map((tool) => {
              const Icon = getToolIcon(tool.name);
              const catStatus = getCategoryStatus(tool);
              const effectiveEnabled = catStatus?.effectiveEnabled ?? tool.globalEnabled;
              const isOverridden = catStatus?.isEnabled !== null && catStatus?.isEnabled !== undefined;

              return (
                <div key={tool.name} className="bg-white rounded-lg border shadow-sm">
                  {/* Tool Header */}
                  <div className="px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={`p-2 rounded-lg ${effectiveEnabled ? 'bg-blue-100' : 'bg-gray-100'}`}>
                        <Icon size={24} className={effectiveEnabled ? 'text-blue-600' : 'text-gray-400'} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-gray-900">{tool.displayName}</h3>
                          <span
                            className={`px-2 py-0.5 text-xs rounded-full cursor-help ${
                              tool.category === 'autonomous'
                                ? 'bg-purple-100 text-purple-700'
                                : 'bg-blue-100 text-blue-700'
                            }`}
                            title={`${TOOL_EXPLANATIONS[tool.category as keyof typeof TOOL_EXPLANATIONS]?.title || tool.category}: ${TOOL_EXPLANATIONS[tool.category as keyof typeof TOOL_EXPLANATIONS]?.description || ''}`}
                          >
                            {tool.category}
                          </span>
                          {tool.isHybrid && (
                            <span
                              className="px-2 py-0.5 text-xs rounded-full bg-teal-100 text-teal-700 cursor-help"
                              title={`${TOOL_EXPLANATIONS.hybrid.title}: ${TOOL_EXPLANATIONS.hybrid.description}`}
                            >
                              hybrid
                            </span>
                          )}
                          {tool.isTerminal && (
                            <span
                              className="px-2 py-0.5 text-xs rounded-full bg-amber-100 text-amber-700 cursor-help"
                              title={`${TOOL_EXPLANATIONS.terminal.title}: ${TOOL_EXPLANATIONS.terminal.description}`}
                            >
                              terminal
                            </span>
                          )}
                          {/* Global status indicator */}
                          <span className={`px-2 py-0.5 text-xs rounded-full ${
                            tool.globalEnabled ? 'bg-green-50 text-green-600' : 'bg-gray-50 text-gray-500'
                          }`}>
                            Global: {tool.globalEnabled ? 'On' : 'Off'}
                          </span>
                        </div>
                        <p className="text-sm text-gray-500">{tool.description}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Status indicator */}
                      <div className="flex items-center gap-2 mr-2">
                        <span className={`px-3 py-1 text-sm rounded-full ${
                          effectiveEnabled
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-500'
                        }`}>
                          {isOverridden ? (
                            catStatus?.isEnabled ? 'Enabled' : 'Disabled'
                          ) : (
                            `Inherited (${effectiveEnabled ? 'On' : 'Off'})`
                          )}
                        </span>
                      </div>

                      {/* Enable/Disable Toggle for category */}
                      <Button
                        variant={effectiveEnabled ? 'primary' : 'secondary'}
                        size="sm"
                        onClick={() => handleToggleCategoryEnabled(tool.name, catStatus?.isEnabled ?? null)}
                        disabled={saving}
                        title={
                          catStatus?.isEnabled === null
                            ? 'Click to enable for this category'
                            : catStatus?.isEnabled
                              ? 'Click to disable'
                              : 'Click to inherit from global'
                        }
                      >
                        {effectiveEnabled ? <Power size={16} /> : <PowerOff size={16} />}
                      </Button>

                      {/* Branding button (only for doc_gen tool) */}
                      {tool.name === 'doc_gen' && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setEditingBranding(tool.name);
                            setBrandingConfig(catStatus?.branding || {
                              enabled: false,
                              logoUrl: '',
                              organizationName: '',
                              primaryColor: '#003366',
                              fontFamily: 'Calibri',
                              header: { enabled: false, content: '' },
                              footer: { enabled: true, content: '', includePageNumber: true },
                            });
                          }}
                          title="Configure branding"
                        >
                          <Palette size={16} />
                        </Button>
                      )}

                      {/* Expand button for data_source tool */}
                      {tool.name === 'data_source' && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setExpandedTool(expandedTool === tool.name ? null : tool.name)}
                          title="Manage data sources"
                        >
                          {expandedTool === tool.name ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Branding indicator */}
                  {tool.name === 'doc_gen' && catStatus?.branding?.enabled && (
                    <div className="px-6 py-2 border-t bg-blue-50">
                      <div className="flex items-center gap-2 text-sm text-blue-700">
                        <Building2 size={14} />
                        <span>Custom branding: {catStatus.branding.organizationName || 'Configured'}</span>
                      </div>
                    </div>
                  )}

                  {/* Expanded data sources panel (superuser mode) */}
                  {tool.name === 'data_source' && expandedTool === tool.name && (
                    <div className="px-6 py-4 border-t bg-gray-50">
                      {renderConfigForm({ name: tool.name } as Tool, true)}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Tools List - Admin/ReadOnly Mode */}
      {!isSuperuser && (
        <div className="space-y-4">
          {tools.length === 0 ? (
            <div className="bg-white rounded-lg border p-8 text-center text-gray-500">
              No tools configured. Tools will appear here when available.
            </div>
          ) : (
            tools.map((tool) => {
              const Icon = getToolIcon(tool.name);
              const isExpanded = expandedTool === tool.name;

              return (
                <div key={tool.name} className="bg-white rounded-lg border shadow-sm">
                  {/* Tool Header */}
                  <div className="px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={`p-2 rounded-lg ${tool.enabled ? 'bg-blue-100' : 'bg-gray-100'}`}>
                        <Icon size={24} className={tool.enabled ? 'text-blue-600' : 'text-gray-400'} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-gray-900">{tool.displayName}</h3>
                          <span
                            className={`px-2 py-0.5 text-xs rounded-full cursor-help ${
                              tool.category === 'autonomous'
                                ? 'bg-purple-100 text-purple-700'
                                : 'bg-blue-100 text-blue-700'
                            }`}
                            title={`${TOOL_EXPLANATIONS[tool.category].title}: ${TOOL_EXPLANATIONS[tool.category].description}`}
                          >
                            {tool.category}
                          </span>
                          {tool.isHybrid && (
                            <span
                              className="px-2 py-0.5 text-xs rounded-full bg-teal-100 text-teal-700 cursor-help"
                              title={`${TOOL_EXPLANATIONS.hybrid.title}: ${TOOL_EXPLANATIONS.hybrid.description}`}
                            >
                              hybrid
                            </span>
                          )}
                          {tool.isTerminal && (
                            <span
                              className="px-2 py-0.5 text-xs rounded-full bg-amber-100 text-amber-700 cursor-help"
                              title={`${TOOL_EXPLANATIONS.terminal.title}: ${TOOL_EXPLANATIONS.terminal.description}`}
                            >
                              terminal
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-500">{tool.description}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Status Badge (read-only mode) */}
                      {readOnly ? (
                        <span className={`px-3 py-1 text-sm rounded-full ${
                          tool.enabled
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-500'
                        }`}>
                          {tool.enabled ? 'Enabled' : 'Disabled'}
                        </span>
                      ) : (
                        <>
                          {/* Test Button */}
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleTestTool(tool.name)}
                            disabled={testingTool === tool.name}
                            title="Test connection"
                          >
                            {testingTool === tool.name ? (
                              <Spinner size="sm" />
                            ) : (
                              <TestTube size={16} />
                            )}
                          </Button>

                          {/* Audit History */}
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleViewAudit(tool.name)}
                            title="View history"
                          >
                            <Clock size={16} />
                          </Button>

                          {/* Enable/Disable Toggle */}
                          <Button
                            variant={tool.enabled ? 'primary' : 'secondary'}
                            size="sm"
                            onClick={() => handleToggleEnabled(tool)}
                            disabled={saving}
                            title={tool.enabled ? 'Disable tool' : 'Enable tool'}
                          >
                            {tool.enabled ? <Power size={16} /> : <PowerOff size={16} />}
                          </Button>

                          {/* Expand/Collapse */}
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => toggleExpand(tool)}
                          >
                            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Test Result Banner */}
                  {testResult && testResult.tool === tool.name && (
                    <div className={`px-6 py-3 border-t ${
                      testResult.success ? 'bg-green-50' : 'bg-red-50'
                    }`}>
                      <div className="flex items-center gap-2">
                        {testResult.success ? (
                          <CheckCircle size={16} className="text-green-600" />
                        ) : (
                          <AlertCircle size={16} className="text-red-600" />
                        )}
                        <span className={testResult.success ? 'text-green-700' : 'text-red-700'}>
                          {testResult.message}
                        </span>
                        {testResult.latency && (
                          <span className="text-gray-500 text-sm ml-2">
                            ({testResult.latency}ms)
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Expanded Configuration */}
                  {isExpanded && (
                    <div className={`px-6 py-4 border-t bg-gray-50 ${tool.name === 'data_source' ? '' : ''}`}>
                      <div className={tool.name === 'data_source' ? '' : 'max-w-2xl'}>
                        {renderConfigForm(tool)}

                        {/* Metadata and Save - not shown for data_source and function_api which have their own UI */}
                        {tool.name !== 'data_source' && tool.name !== 'function_api' && (
                          <>
                            {/* LLM Prompt Instructions (Description Override) */}
                            <div className="mt-6 pt-4 border-t">
                              <button
                                onClick={() => {
                                  if (showDescriptionEditor === tool.name) {
                                    setShowDescriptionEditor(null);
                                    setEditedDescription('');
                                  } else {
                                    setShowDescriptionEditor(tool.name);
                                    setEditedDescription(tool.descriptionOverride || '');
                                  }
                                }}
                                className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900"
                              >
                                {showDescriptionEditor === tool.name ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                <span>LLM Prompt Instructions</span>
                                {tool.descriptionOverride && (
                                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">Customized</span>
                                )}
                              </button>

                              {showDescriptionEditor === tool.name && (
                                <div className="mt-3 space-y-3">
                                  {/* Default description (readonly reference) */}
                                  <div>
                                    <label className="block text-xs text-gray-500 mb-1">Default Description (from code)</label>
                                    <pre className="text-xs bg-gray-100 p-2 rounded border overflow-auto max-h-32 whitespace-pre-wrap">
                                      {tool.defaultDescription}
                                    </pre>
                                  </div>

                                  {/* Override textarea */}
                                  <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                      Custom Description Override
                                    </label>
                                    <textarea
                                      value={editedDescription}
                                      onChange={(e) => setEditedDescription(e.target.value)}
                                      placeholder="Leave empty to use default description..."
                                      className="w-full h-48 p-2 border rounded text-sm font-mono resize-y"
                                    />
                                    <p className="text-xs text-gray-500 mt-1">
                                      This description is sent to the LLM to guide when and how to use this tool.
                                      Clear the field and save to revert to default.
                                    </p>
                                  </div>

                                  {/* Save/Clear buttons */}
                                  <div className="flex gap-2">
                                    <Button
                                      onClick={() => handleSaveDescription(tool.name)}
                                      disabled={savingDescription}
                                    >
                                      {savingDescription ? <Spinner size="sm" className="mr-2" /> : <Save size={16} className="mr-2" />}
                                      Save Instructions
                                    </Button>
                                    {tool.descriptionOverride && (
                                      <Button
                                        variant="secondary"
                                        onClick={() => {
                                          setEditedDescription('');
                                          handleSaveDescription(tool.name);
                                        }}
                                        disabled={savingDescription}
                                      >
                                        Reset to Default
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* Metadata */}
                            {tool.metadata && (
                              <div className="mt-4 pt-4 border-t text-xs text-gray-500">
                                <div className="flex items-center gap-1">
                                  <Info size={12} />
                                  <span>
                                    Last updated: {formatDate(tool.metadata.updatedAt)} by {tool.metadata.updatedBy}
                                  </span>
                                </div>
                              </div>
                            )}

                            {/* Save Button */}
                            <div className="mt-4 flex justify-end gap-2">
                              <Button
                                variant="secondary"
                                onClick={() => {
                                  setExpandedTool(null);
                                  setEditedConfig({});
                                }}
                              >
                                Cancel
                              </Button>
                              <Button
                                onClick={() => handleSaveConfig(tool.name)}
                                disabled={saving}
                              >
                                {saving ? <Spinner size="sm" className="mr-2" /> : <Save size={16} className="mr-2" />}
                                Save Configuration
                              </Button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
        </>
      )}

      {/* Audit History Modal */}
      <Modal
        isOpen={showAuditModal}
        onClose={() => {
          setShowAuditModal(false);
          setAuditHistory([]);
        }}
        title={`Configuration History - ${auditToolName}`}
      >
        <div className="space-y-4 max-h-96 overflow-y-auto">
          {auditHistory.length === 0 ? (
            <p className="text-gray-500 text-center py-4">No history available</p>
          ) : (
            auditHistory.map((entry) => (
              <div key={entry.id} className="border rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className={`px-2 py-0.5 text-xs rounded-full ${
                    entry.operation === 'create' ? 'bg-green-100 text-green-700' :
                    entry.operation === 'update' ? 'bg-blue-100 text-blue-700' :
                    'bg-red-100 text-red-700'
                  }`}>
                    {entry.operation}
                  </span>
                  <span className="text-xs text-gray-500">{formatDate(entry.changedAt)}</span>
                </div>
                <p className="text-sm text-gray-600">Changed by: {entry.changedBy}</p>
                {entry.operation === 'update' && entry.oldConfig && entry.newConfig && (
                  <details className="mt-2">
                    <summary className="text-xs text-blue-600 cursor-pointer">View changes</summary>
                    <div className="mt-2 text-xs font-mono bg-gray-50 p-2 rounded overflow-x-auto">
                      <pre>{JSON.stringify({ old: entry.oldConfig, new: entry.newConfig }, null, 2)}</pre>
                    </div>
                  </details>
                )}
              </div>
            ))
          )}
        </div>
      </Modal>

      {/* Branding Editor Modal (Superuser mode) */}
      <Modal
        isOpen={!!editingBranding}
        onClose={() => {
          setEditingBranding(null);
          setBrandingConfig(null);
        }}
        title="Document Branding Configuration"
      >
        {brandingConfig && (
          <div className="space-y-4">
            {/* Enable Branding */}
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="branding-enabled"
                checked={brandingConfig.enabled}
                onChange={(e) => setBrandingConfig({
                  ...brandingConfig,
                  enabled: e.target.checked,
                })}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="branding-enabled" className="text-sm font-medium text-gray-700">
                Enable custom branding for documents
              </label>
            </div>

            {brandingConfig.enabled && (
              <>
                {/* Organization Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    <Building2 size={14} className="inline mr-1" />
                    Organization Name
                  </label>
                  <input
                    type="text"
                    value={brandingConfig.organizationName}
                    onChange={(e) => setBrandingConfig({
                      ...brandingConfig,
                      organizationName: e.target.value,
                    })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="Your Organization"
                  />
                </div>

                {/* Logo URL */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Logo URL
                  </label>
                  <input
                    type="text"
                    value={brandingConfig.logoUrl}
                    onChange={(e) => setBrandingConfig({
                      ...brandingConfig,
                      logoUrl: e.target.value,
                    })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="https://example.com/logo.png"
                  />
                  <p className="text-xs text-gray-500 mt-1">URL to your organization logo (PNG, JPG)</p>
                </div>

                {/* Primary Color */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    <Palette size={14} className="inline mr-1" />
                    Primary Color
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={brandingConfig.primaryColor}
                      onChange={(e) => setBrandingConfig({
                        ...brandingConfig,
                        primaryColor: e.target.value,
                      })}
                      className="h-10 w-16 border rounded cursor-pointer"
                    />
                    <input
                      type="text"
                      value={brandingConfig.primaryColor}
                      onChange={(e) => setBrandingConfig({
                        ...brandingConfig,
                        primaryColor: e.target.value,
                      })}
                      className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="#003366"
                    />
                  </div>
                </div>

                {/* Font Family */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Font Family
                  </label>
                  <select
                    value={brandingConfig.fontFamily}
                    onChange={(e) => setBrandingConfig({
                      ...brandingConfig,
                      fontFamily: e.target.value,
                    })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="Calibri">Calibri</option>
                    <option value="Arial">Arial</option>
                    <option value="Times New Roman">Times New Roman</option>
                    <option value="Helvetica">Helvetica</option>
                    <option value="Georgia">Georgia</option>
                  </select>
                </div>

                {/* Header Section */}
                <div className="border rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      type="checkbox"
                      id="header-enabled"
                      checked={brandingConfig.header.enabled}
                      onChange={(e) => setBrandingConfig({
                        ...brandingConfig,
                        header: { ...brandingConfig.header, enabled: e.target.checked },
                      })}
                      className="rounded border-gray-300 text-blue-600"
                    />
                    <label htmlFor="header-enabled" className="text-sm font-medium text-gray-700">
                      <FileText size={14} className="inline mr-1" />
                      Custom Header
                    </label>
                  </div>
                  {brandingConfig.header.enabled && (
                    <input
                      type="text"
                      value={brandingConfig.header.content}
                      onChange={(e) => setBrandingConfig({
                        ...brandingConfig,
                        header: { ...brandingConfig.header, content: e.target.value },
                      })}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="Header text for documents"
                    />
                  )}
                </div>

                {/* Footer Section */}
                <div className="border rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      type="checkbox"
                      id="footer-enabled"
                      checked={brandingConfig.footer.enabled}
                      onChange={(e) => setBrandingConfig({
                        ...brandingConfig,
                        footer: { ...brandingConfig.footer, enabled: e.target.checked },
                      })}
                      className="rounded border-gray-300 text-blue-600"
                    />
                    <label htmlFor="footer-enabled" className="text-sm font-medium text-gray-700">
                      Custom Footer
                    </label>
                  </div>
                  {brandingConfig.footer.enabled && (
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={brandingConfig.footer.content}
                        onChange={(e) => setBrandingConfig({
                          ...brandingConfig,
                          footer: { ...brandingConfig.footer, content: e.target.value },
                        })}
                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                        placeholder="Footer text for documents"
                      />
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id="footer-page-number"
                          checked={brandingConfig.footer.includePageNumber}
                          onChange={(e) => setBrandingConfig({
                            ...brandingConfig,
                            footer: { ...brandingConfig.footer, includePageNumber: e.target.checked },
                          })}
                          className="rounded border-gray-300 text-blue-600"
                        />
                        <label htmlFor="footer-page-number" className="text-sm text-gray-600">
                          Include page numbers
                        </label>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Save/Cancel Buttons */}
            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button
                variant="secondary"
                onClick={() => {
                  setEditingBranding(null);
                  setBrandingConfig(null);
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={() => editingBranding && handleSaveBranding(editingBranding)}
                disabled={saving}
              >
                {saving ? <Spinner size="sm" className="mr-2" /> : <Save size={16} className="mr-2" />}
                Save Branding
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
