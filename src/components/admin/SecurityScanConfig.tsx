'use client';

/**
 * SecurityScanConfig - Admin UI configuration for Security Scan (Mozilla Observatory) tool
 */

interface SecurityScanConfigProps {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  disabled: boolean;
}

export default function SecurityScanConfig({
  config,
  onChange,
  disabled,
}: SecurityScanConfigProps) {
  const handleChange = (key: string, value: unknown) => {
    onChange({ ...config, [key]: value });
  };

  return (
    <div className="space-y-4">
      {/* Minimum Score Threshold */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Minimum Acceptable Score
        </label>
        <input
          type="number"
          min={0}
          max={115}
          value={(config.minAcceptableScore as number) || 70}
          onChange={(e) => handleChange('minAcceptableScore', parseInt(e.target.value) || 70)}
          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          disabled={disabled}
        />
        <p className="text-xs text-gray-500 mt-1">
          Alert if score below threshold (A+ = 105, A = 90, B = 70, C = 50)
        </p>
      </div>

      {/* Rate Limits */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Daily Scan Limit
          </label>
          <input
            type="number"
            min={1}
            max={100}
            value={(config.rateLimitPerDay as number) || 20}
            onChange={(e) => handleChange('rateLimitPerDay', parseInt(e.target.value) || 20)}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            disabled={disabled}
          />
          <p className="text-xs text-gray-500 mt-1">Max scans per 24 hours</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Weekly Scan Limit
          </label>
          <input
            type="number"
            min={5}
            max={500}
            value={(config.rateLimitPerWeek as number) || 100}
            onChange={(e) => handleChange('rateLimitPerWeek', parseInt(e.target.value) || 100)}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            disabled={disabled}
          />
          <p className="text-xs text-gray-500 mt-1">Max scans per week</p>
        </div>
      </div>

      {/* Cache Duration */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Cache Duration (seconds)
        </label>
        <input
          type="number"
          min={300}
          max={86400}
          value={(config.cacheTTLSeconds as number) || 3600}
          onChange={(e) => handleChange('cacheTTLSeconds', parseInt(e.target.value) || 3600)}
          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          disabled={disabled}
        />
        <p className="text-xs text-gray-500 mt-1">
          How long to cache results (3600 = 1 hour). Reduces API calls for repeated queries.
        </p>
      </div>

      {/* Info Box */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mt-4">
        <p className="text-sm text-blue-800">
          <strong>About:</strong> Powered by Mozilla HTTP Observatory (free, no API key).
          Tests 10+ security controls: CSP, HSTS, X-Frame-Options, cookies, CORS, and more.{' '}
          <a
            href="https://developer.mozilla.org/en-US/observatory"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
          >
            Learn more
          </a>
        </p>
      </div>
    </div>
  );
}
