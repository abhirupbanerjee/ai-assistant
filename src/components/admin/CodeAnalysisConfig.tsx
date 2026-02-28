'use client';

import { useState } from 'react';
import { Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react';

/**
 * CodeAnalysisConfig - Admin UI configuration for Code Analysis (SonarCloud) tool
 */

interface PreConfiguredRepo {
  name: string;
  projectKey: string;
  githubUrl?: string;
  apiToken?: string;
  organization?: string;
}

interface CodeAnalysisConfigProps {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  disabled: boolean;
  hideSensitive?: boolean;
}

export default function CodeAnalysisConfig({
  config,
  onChange,
  disabled,
  hideSensitive,
}: CodeAnalysisConfigProps) {
  const [expandedRepo, setExpandedRepo] = useState<number | null>(null);

  const handleChange = (key: string, value: unknown) => {
    onChange({ ...config, [key]: value });
  };

  const repos = (config.preConfiguredRepos as PreConfiguredRepo[]) || [];

  const handleAddRepo = () => {
    const newRepo: PreConfiguredRepo = {
      name: '',
      projectKey: '',
      githubUrl: '',
      apiToken: '',
      organization: '',
    };
    handleChange('preConfiguredRepos', [...repos, newRepo]);
    setExpandedRepo(repos.length);
  };

  const handleRemoveRepo = (index: number) => {
    const newRepos = repos.filter((_, i) => i !== index);
    handleChange('preConfiguredRepos', newRepos);
    if (expandedRepo === index) {
      setExpandedRepo(null);
    } else if (expandedRepo !== null && expandedRepo > index) {
      setExpandedRepo(expandedRepo - 1);
    }
  };

  const handleRepoChange = (index: number, key: keyof PreConfiguredRepo, value: string) => {
    const newRepos = [...repos];
    newRepos[index] = { ...newRepos[index], [key]: value };
    handleChange('preConfiguredRepos', newRepos);
  };

  return (
    <div className="space-y-4">
      {/* API Token - hidden for superusers */}
      {!hideSensitive && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            SonarCloud API Token
          </label>
          <input
            type="password"
            value={(config.apiToken as string) || ''}
            onChange={(e) => handleChange('apiToken', e.target.value)}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="squ_..."
            disabled={disabled}
          />
          <p className="text-xs text-gray-500 mt-1">
            Default token for SonarCloud API access.{' '}
            <a
              href="https://sonarcloud.io/account/security"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline"
            >
              Generate token
            </a>
          </p>
        </div>
      )}

      {/* Organization */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Default Organization
        </label>
        <input
          type="text"
          value={(config.organization as string) || ''}
          onChange={(e) => handleChange('organization', e.target.value)}
          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          placeholder="my-organization"
          disabled={disabled}
        />
        <p className="text-xs text-gray-500 mt-1">
          SonarCloud organization key. Found in your SonarCloud URL.
        </p>
      </div>

      {/* Enable Dynamic Lookup */}
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          id="enableDynamicLookup"
          checked={config.enableDynamicLookup !== false}
          onChange={(e) => handleChange('enableDynamicLookup', e.target.checked)}
          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          disabled={disabled}
        />
        <label htmlFor="enableDynamicLookup" className="text-sm text-gray-700">
          Enable Dynamic Repository Lookup
        </label>
      </div>
      <p className="text-xs text-gray-500 -mt-2">
        Allow searching for any project in the organization by GitHub URL (requires API token).
      </p>

      {/* Pre-configured Repositories */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="block text-sm font-medium text-gray-700">
            Pre-configured Repositories
          </label>
          <button
            type="button"
            onClick={handleAddRepo}
            disabled={disabled}
            className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50"
          >
            <Plus size={16} />
            Add Repository
          </button>
        </div>

        {repos.length === 0 ? (
          <p className="text-sm text-gray-500 italic">
            No repositories configured. Add repositories for quick access by name.
          </p>
        ) : (
          <div className="space-y-2">
            {repos.map((repo, index) => (
              <div
                key={index}
                className="border rounded-lg overflow-hidden"
              >
                {/* Collapsed Header */}
                <div
                  className="flex items-center justify-between px-3 py-2 bg-gray-50 cursor-pointer"
                  onClick={() => setExpandedRepo(expandedRepo === index ? null : index)}
                >
                  <div className="flex items-center gap-2">
                    {expandedRepo === index ? (
                      <ChevronUp size={16} className="text-gray-500" />
                    ) : (
                      <ChevronDown size={16} className="text-gray-500" />
                    )}
                    <span className="text-sm font-medium">
                      {repo.name || repo.projectKey || 'New Repository'}
                    </span>
                    {repo.apiToken && (
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                        Custom Token
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveRepo(index);
                    }}
                    disabled={disabled}
                    className="text-red-500 hover:text-red-700 disabled:opacity-50"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>

                {/* Expanded Form */}
                {expandedRepo === index && (
                  <div className="p-3 space-y-3 border-t">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          Display Name *
                        </label>
                        <input
                          type="text"
                          value={repo.name}
                          onChange={(e) => handleRepoChange(index, 'name', e.target.value)}
                          className="w-full px-2 py-1.5 text-sm border rounded focus:ring-1 focus:ring-blue-500"
                          placeholder="My Project"
                          disabled={disabled}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          SonarCloud Project Key *
                        </label>
                        <input
                          type="text"
                          value={repo.projectKey}
                          onChange={(e) => handleRepoChange(index, 'projectKey', e.target.value)}
                          className="w-full px-2 py-1.5 text-sm border rounded focus:ring-1 focus:ring-blue-500"
                          placeholder="org_project-key"
                          disabled={disabled}
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        GitHub URL (optional)
                      </label>
                      <input
                        type="text"
                        value={repo.githubUrl || ''}
                        onChange={(e) => handleRepoChange(index, 'githubUrl', e.target.value)}
                        className="w-full px-2 py-1.5 text-sm border rounded focus:ring-1 focus:ring-blue-500"
                        placeholder="https://github.com/org/repo"
                        disabled={disabled}
                      />
                    </div>

                    {/* Credential overrides - hidden for superusers */}
                    {!hideSensitive && (
                      <div className="border-t pt-3 mt-3">
                        <p className="text-xs text-gray-500 mb-2">
                          Override credentials (leave empty to use defaults above)
                        </p>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              API Token Override
                            </label>
                            <input
                              type="password"
                              value={repo.apiToken || ''}
                              onChange={(e) => handleRepoChange(index, 'apiToken', e.target.value)}
                              className="w-full px-2 py-1.5 text-sm border rounded focus:ring-1 focus:ring-blue-500"
                              placeholder="squ_..."
                              disabled={disabled}
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              Organization Override
                            </label>
                            <input
                              type="text"
                              value={repo.organization || ''}
                              onChange={(e) => handleRepoChange(index, 'organization', e.target.value)}
                              className="w-full px-2 py-1.5 text-sm border rounded focus:ring-1 focus:ring-blue-500"
                              placeholder="other-org"
                              disabled={disabled}
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
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
          value={(config.cacheTTLSeconds as number) || 1800}
          onChange={(e) => handleChange('cacheTTLSeconds', parseInt(e.target.value) || 1800)}
          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          disabled={disabled}
        />
        <p className="text-xs text-gray-500 mt-1">
          How long to cache analysis results (1800 = 30 minutes). Reduces API calls for repeated queries.
        </p>
      </div>

      {/* Max Issues Per Category */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Max Issues Per Category
        </label>
        <input
          type="number"
          min={5}
          max={100}
          value={(config.maxIssuesPerCategory as number) || 25}
          onChange={(e) => handleChange('maxIssuesPerCategory', parseInt(e.target.value) || 25)}
          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          disabled={disabled}
        />
        <p className="text-xs text-gray-500 mt-1">
          Maximum number of issues to return per category (bugs, vulnerabilities, code smells).
        </p>
      </div>

      {/* Info box */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mt-4">
        <p className="text-sm text-blue-800">
          <strong>Metrics analyzed:</strong> Bugs, Vulnerabilities, Code Smells, Security Hotspots,
          Code Coverage, Duplications, and Technical Debt.
        </p>
      </div>
    </div>
  );
}
