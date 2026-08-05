import type { ConnectedAccountProvider } from '@/types/connected-accounts';

export interface ConnectorProviderMeta {
  provider: ConnectedAccountProvider;
  label: string;
  description: string;
  oauthStartPath: string;
  oauthDisconnectPath: string;
  icon: string;           // lucide-react icon name
  accentColor: string;    // tailwind color class
  serviceName: string;    // docker service name
  healthUrl: string;      // internal health endpoint
  toolsUrl: string;       // GET /tools endpoint
  scopes: string[];       // OAuth scopes
  tokenExpires: boolean;
  refreshable: boolean;
}

export const CONNECTOR_PROVIDERS: ConnectorProviderMeta[] = [
  {
    provider: 'google',
    label: 'Google Drive',
    description: 'Access Google Drive, Sheets, Docs, and Slides',
    oauthStartPath: '/api/connectors/google/start',
    oauthDisconnectPath: '/api/connectors/google/disconnect',
    icon: 'HardDrive',
    accentColor: 'text-blue-600',
    serviceName: 'drive-connector',
    healthUrl: 'http://drive-connector:8090/health',
    toolsUrl: 'http://drive-connector:8090/tools',
    scopes: ['drive.file', 'spreadsheets', 'documents', 'presentations'],
    tokenExpires: true,
    refreshable: true,
  },
  {
    provider: 'microsoft',
    label: 'OneDrive',
    description: 'Access OneDrive, Excel, and SharePoint files',
    oauthStartPath: '/api/connectors/microsoft/start',
    oauthDisconnectPath: '/api/connectors/microsoft/disconnect',
    icon: 'HardDrive',
    accentColor: 'text-sky-600',
    serviceName: 'drive-connector',
    healthUrl: 'http://drive-connector:8090/health',
    toolsUrl: 'http://drive-connector:8090/tools',
    scopes: ['Files.Read', 'Files.ReadWrite', 'Sites.Read.All'],
    tokenExpires: true,
    refreshable: true,
  },
  {
    provider: 'github',
    label: 'GitHub',
    description: 'Access repositories, issues, PRs, and code search',
    oauthStartPath: '/api/connectors/github/start',
    oauthDisconnectPath: '/api/connectors/github/disconnect',
    icon: 'Github',
    accentColor: 'text-purple-600',
    serviceName: 'github-connector',
    healthUrl: 'http://github-connector:8091/health',
    toolsUrl: 'http://github-connector:8091/tools',
    scopes: ['repo', 'read:org', 'workflow', 'user:email'],
    tokenExpires: false,
    refreshable: false,
  },
  {
    provider: 'notion',
    label: 'Notion',
    description: 'Access Notion pages, databases, and search',
    oauthStartPath: '/api/connectors/notion/start',
    oauthDisconnectPath: '/api/connectors/notion/disconnect',
    icon: 'FileText',
    accentColor: 'text-gray-900',
    serviceName: 'notion-connector',
    healthUrl: 'http://notion-connector:8092/health',
    toolsUrl: 'http://notion-connector:8092/tools',
    scopes: ['read content', 'read comments', 'read user'],
    tokenExpires: false,
    refreshable: false,
  },
  {
    provider: 'slack',
    label: 'Slack',
    description: 'Access Slack messages, channels, and users',
    oauthStartPath: '/api/connectors/slack/start',
    oauthDisconnectPath: '/api/connectors/slack/disconnect',
    icon: 'MessageSquare',
    accentColor: 'text-green-600',
    serviceName: 'slack-connector',
    healthUrl: 'http://slack-connector:8093/health',
    toolsUrl: 'http://slack-connector:8093/tools',
    scopes: ['channels:read', 'channels:history', 'search:read', 'users:read'],
    tokenExpires: false,
    refreshable: false,
  },
  {
    provider: 'gitbook',
    label: 'GitBook',
    description: 'Access GitBook spaces, pages, and reader comments',
    oauthStartPath: '/api/connectors/gitbook/start',
    oauthDisconnectPath: '/api/connectors/gitbook/disconnect',
    icon: 'BookOpen',
    accentColor: 'text-indigo-600',
    serviceName: 'gitbook-connector',
    healthUrl: 'http://gitbook-connector:8094/health',
    toolsUrl: 'http://gitbook-connector:8094/tools',
    scopes: ['read:spaces', 'read:content', 'read:comments'],
    tokenExpires: true,
    refreshable: true,
  },
];
