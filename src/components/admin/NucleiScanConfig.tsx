'use client';

/**
 * NucleiScanConfig - Admin UI for Nuclei Scan tool configuration
 */

const TEMPLATE_OPTIONS = [
  { value: 'http/misconfiguration', label: 'HTTP Misconfigurations', description: 'Exposed panels, insecure configs' },
  { value: 'http/exposures', label: 'HTTP Exposures', description: 'Sensitive files, backup files, data leakage' },
  { value: 'http/technologies', label: 'Technology Fingerprint', description: 'Detect server/framework stack (info only)' },
  { value: 'ssl', label: 'SSL/TLS', description: 'Certificate issues, weak ciphers, expired certs' },
  { value: 'dns', label: 'DNS', description: 'DNS misconfigurations, zone transfer, takeover risks' },
  { value: 'cves', label: 'CVEs (All)', description: 'All known CVEs — significantly increases scan time' },
];

const SEVERITY_OPTIONS = ['info', 'low', 'medium', 'high', 'critical'];

interface NucleiScanConfigProps {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  disabled: boolean;
}

export default function NucleiScanConfig({ config, onChange, disabled }: NucleiScanConfigProps) {
  const handleChange = (key: string, value: unknown) => {
    onChange({ ...config, [key]: value });
  };

  const templateCategories: string[] = (config.templateCategories as string[]) || [
    'http/misconfiguration', 'http/exposures', 'ssl', 'dns',
  ];

  const severityFilter: string[] = (config.severityFilter as string[]) || [
    'medium', 'high', 'critical',
  ];

  const toggleTemplate = (value: string, checked: boolean) => {
    const updated = checked
      ? [...templateCategories, value]
      : templateCategories.filter((t) => t !== value);
    handleChange('templateCategories', updated);
  };

  const toggleSeverity = (value: string, checked: boolean) => {
    const updated = checked
      ? [...severityFilter, value]
      : severityFilter.filter((s) => s !== value);
    handleChange('severityFilter', updated);
  };

  return (
    <div className="space-y-5">

      {/* Binary Path */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Nuclei Binary Path
        </label>
        <input
          type="text"
          value={(config.binaryPath as string) || '/usr/local/bin/nuclei'}
          onChange={(e) => handleChange('binaryPath', e.target.value)}
          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 font-mono text-sm"
          placeholder="/usr/local/bin/nuclei"
          disabled={disabled}
        />
        <p className="text-xs text-gray-500 mt-1">
          Full path to nuclei binary on the server. Verify with: <code className="bg-gray-100 px-1 rounded">nuclei -version</code>
        </p>
      </div>

      {/* Template Categories */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Template Categories
        </label>
        <div className="space-y-2">
          {TEMPLATE_OPTIONS.map((opt) => (
            <div key={opt.value} className="flex items-start gap-2">
              <input
                type="checkbox"
                id={`template-${opt.value}`}
                checked={templateCategories.includes(opt.value)}
                onChange={(e) => toggleTemplate(opt.value, e.target.checked)}
                disabled={disabled}
                className="mt-0.5 rounded border-gray-300 text-blue-600"
              />
              <label htmlFor={`template-${opt.value}`} className="text-sm">
                <span className="font-medium text-gray-700">{opt.label}</span>
                <span className="text-gray-500 ml-1">— {opt.description}</span>
              </label>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-2">
          ⚠️ Adding CVEs significantly increases scan time (5–15 min). Use severity filter to reduce noise.
        </p>
      </div>

      {/* Severity Filter */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Severity Filter (report findings at these levels only)
        </label>
        <div className="flex flex-wrap gap-4">
          {SEVERITY_OPTIONS.map((s) => (
            <div key={s} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                id={`sev-${s}`}
                checked={severityFilter.includes(s)}
                onChange={(e) => toggleSeverity(s, e.target.checked)}
                disabled={disabled}
                className="rounded border-gray-300 text-blue-600"
              />
              <label htmlFor={`sev-${s}`} className="text-sm capitalize text-gray-700">{s}</label>
            </div>
          ))}
        </div>
      </div>

      {/* Numeric Settings */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Daily Scan Limit</label>
          <input
            type="number" min={1} max={50}
            value={(config.rateLimitPerDay as number) || 10}
            onChange={(e) => handleChange('rateLimitPerDay', parseInt(e.target.value) || 10)}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
            disabled={disabled}
          />
          <p className="text-xs text-gray-500 mt-1">Nuclei runs on the VM — limits protect server resources</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Max Requests/Second</label>
          <input
            type="number" min={1} max={150}
            value={(config.maxRatePerSecond as number) || 10}
            onChange={(e) => handleChange('maxRatePerSecond', parseInt(e.target.value) || 10)}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
            disabled={disabled}
          />
          <p className="text-xs text-gray-500 mt-1">Rate of requests sent to the target URL</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Per-Request Timeout (s)</label>
          <input
            type="number" min={10} max={120}
            value={(config.timeoutSeconds as number) || 30}
            onChange={(e) => handleChange('timeoutSeconds', parseInt(e.target.value) || 30)}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
            disabled={disabled}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Cache Duration (seconds)</label>
          <input
            type="number" min={3600} max={86400}
            value={(config.cacheTTLSeconds as number) || 21600}
            onChange={(e) => handleChange('cacheTTLSeconds', parseInt(e.target.value) || 21600)}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
            disabled={disabled}
          />
          <p className="text-xs text-gray-500 mt-1">21600 = 6 hours, 86400 = 24 hours</p>
        </div>
      </div>

      {/* Info Box */}
      <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 mt-4">
        <p className="text-sm text-orange-800">
          <strong>About:</strong> Powered by{' '}
          <a
            href="https://github.com/projectdiscovery/nuclei"
            target="_blank"
            rel="noopener noreferrer"
            className="text-orange-600 hover:underline"
          >
            ProjectDiscovery Nuclei
          </a>{' '}
          (free, self-hosted). Runs locally on the server — zero data leaves your infrastructure.
          Findings are annotated with OWASP Top 10, PCI-DSS, and ISO 27001 references.
          Restricted to <strong>superuser</strong> role only.
        </p>
      </div>

    </div>
  );
}
