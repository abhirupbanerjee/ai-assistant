'use client';

/**
 * WebsiteAnalysisConfig - Admin UI configuration for Website Analysis (PageSpeed) tool
 */

interface WebsiteAnalysisConfigProps {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  disabled: boolean;
  hideSensitive?: boolean;
}

export default function WebsiteAnalysisConfig({
  config,
  onChange,
  disabled,
  hideSensitive,
}: WebsiteAnalysisConfigProps) {
  const handleChange = (key: string, value: unknown) => {
    onChange({ ...config, [key]: value });
  };

  return (
    <div className="space-y-4">
      {/* API Key - hidden for superusers */}
      {!hideSensitive && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Google API Key
          </label>
          <input
            type="password"
            value={(config.apiKey as string) || ''}
            onChange={(e) => handleChange('apiKey', e.target.value)}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="AIza..."
            disabled={disabled}
          />
          <p className="text-xs text-gray-500 mt-1">
            Optional but recommended for higher rate limits.{' '}
            <a
              href="https://console.cloud.google.com/apis/credentials"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline"
            >
              Get API key
            </a>
          </p>
        </div>
      )}

      {/* Default Strategy */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Default Strategy
        </label>
        <select
          value={(config.defaultStrategy as string) || 'mobile'}
          onChange={(e) => handleChange('defaultStrategy', e.target.value)}
          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          disabled={disabled}
        >
          <option value="mobile">Mobile (recommended for SEO)</option>
          <option value="desktop">Desktop</option>
        </select>
        <p className="text-xs text-gray-500 mt-1">
          Device type used for analysis. Mobile is typically more important for SEO rankings.
        </p>
      </div>

      {/* Cache Duration */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Cache Duration (seconds)
        </label>
        <input
          type="number"
          min={60}
          max={86400}
          value={(config.cacheTTLSeconds as number) || 3600}
          onChange={(e) => handleChange('cacheTTLSeconds', parseInt(e.target.value) || 3600)}
          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          disabled={disabled}
        />
        <p className="text-xs text-gray-500 mt-1">
          How long to cache analysis results (3600 = 1 hour). Reduces API calls for repeated queries.
        </p>
      </div>

      {/* Include Options */}
      <div className="space-y-3">
        <label className="block text-sm font-medium text-gray-700">
          Include in Results
        </label>

        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id="includeOpportunities"
            checked={config.includeOpportunities !== false}
            onChange={(e) => handleChange('includeOpportunities', e.target.checked)}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            disabled={disabled}
          />
          <label htmlFor="includeOpportunities" className="text-sm text-gray-700">
            Include Optimization Opportunities
          </label>
        </div>
        <p className="text-xs text-gray-500 ml-6 -mt-1">
          Actionable suggestions to improve performance (e.g., image optimization, caching).
        </p>

        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id="includeDiagnostics"
            checked={config.includeDiagnostics !== false}
            onChange={(e) => handleChange('includeDiagnostics', e.target.checked)}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            disabled={disabled}
          />
          <label htmlFor="includeDiagnostics" className="text-sm text-gray-700">
            Include Diagnostics
          </label>
        </div>
        <p className="text-xs text-gray-500 ml-6 -mt-1">
          Detailed diagnostic information about page performance issues.
        </p>
      </div>

      {/* Info box */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mt-4">
        <p className="text-sm text-blue-800">
          <strong>Metrics analyzed:</strong> Performance score, Accessibility, Best Practices, SEO,
          and Core Web Vitals (LCP, FID, CLS, FCP, TTFB).
        </p>
      </div>
    </div>
  );
}
