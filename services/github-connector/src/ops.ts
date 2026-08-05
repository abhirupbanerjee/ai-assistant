/**
 * GitHub API operations — implementations of each tool.
 *
 * Each function follows the OpResult<T> pattern for consistent error handling.
 * All calls use per-user GitHub access tokens fetched from the host app vault.
 */

import { AppConfig } from './config';
import { getJson, postJson, HttpError } from './http';
import { getUserToken, invalidateUserToken, RECONNECT_REQUIRED, VaultProvider } from './vault';
import { logger } from './logger';

const PROVIDER: VaultProvider = 'github';

export interface OpResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  code?: string;
  status?: number;
}

export function ok<T>(data: T): OpResult<T> {
  return { ok: true, data };
}

export function fail<T = unknown>(error: string, status?: number, code?: string): OpResult<T> {
  return { ok: false, error, status, code };
}

/** Common headers for GitHub API requests. */
const GITHUB_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'ai-assistant-github-connector',
};

/**
 * Resolve per-user auth for a tool call.
 */
async function resolveAuth(
  cfg: AppConfig,
  userId: string | undefined
): Promise<OpResult<{ token: string }>> {
  if (!userId) {
    return fail('No user identity provided.', 401, 'IDENTITY_REQUIRED');
  }

  const vaultToken = await getUserToken(cfg, userId, PROVIDER);
  if (vaultToken === RECONNECT_REQUIRED) {
    return fail(
      'GitHub account needs reconnection. Visit Settings → Connected Accounts.',
      401,
      'RECONNECT_REQUIRED'
    );
  }
  if (!vaultToken) {
    return fail(
      'No GitHub account connected. Visit Settings → Connected Accounts.',
      401,
      'NOT_CONNECTED'
    );
  }

  return ok({ token: vaultToken.accessToken });
}

/**
 * Build auth headers for a GitHub API call.
 */
function authHeaders(token: string): Record<string, string> {
  return {
    ...GITHUB_HEADERS,
    Authorization: `Bearer ${token}`,
  };
}

/**
 * Handle common GitHub API errors.
 */
function handleApiError(err: unknown, userId: string | undefined): OpResult {
  if (err instanceof HttpError) {
    if (err.status === 401) {
      if (userId) invalidateUserToken(userId, PROVIDER);
      return fail(
        'GitHub token expired or revoked. Reconnect in Settings → Connected Accounts.',
        401,
        'RECONNECT_REQUIRED'
      );
    }
    if (err.status === 403) {
      if (err.body.includes('rate limit')) {
        return fail('GitHub API rate limit exceeded. Please wait and try again.', 429, 'RATE_LIMITED');
      }
      return fail('Access denied. Check repository permissions or OAuth scopes.', 403, 'ACCESS_DENIED');
    }
    if (err.status === 404) {
      return fail('Resource not found. Check the owner, repo, or path.', 404, 'NOT_FOUND');
    }
    if (err.status === 422) {
      return fail(`GitHub validation error: ${err.body.slice(0, 300)}`, 422, 'VALIDATION_ERROR');
    }
    return fail(`GitHub API error: ${err.message}`, err.status);
  }
  return fail(err instanceof Error ? err.message : 'GitHub API call failed');
}

// ============================================================================
// Repos
// ============================================================================

async function githubListRepos(
  cfg: AppConfig,
  args: { visibility?: string; type?: string; sort?: string; per_page?: number; userId?: string }
): Promise<OpResult<unknown>> {
  const auth = await resolveAuth(cfg, args.userId);
  if (!auth.ok) return auth;
  const { token } = auth.data!;

  const params = new URLSearchParams();
  if (args.visibility && args.visibility !== 'all') params.set('visibility', args.visibility);
  if (args.type && args.type !== 'all') params.set('type', args.type);
  if (args.sort) params.set('sort', args.sort);
  if (args.per_page) params.set('per_page', String(args.per_page));

  try {
    const data = await getJson(
      `https://api.github.com/user/repos?${params.toString()}`,
      authHeaders(token),
      cfg.githubTimeoutMs
    );
    return ok(data);
  } catch (err) {
    return handleApiError(err, args.userId);
  }
}

async function githubGetRepo(
  cfg: AppConfig,
  args: { owner: string; repo: string; userId?: string }
): Promise<OpResult<unknown>> {
  const auth = await resolveAuth(cfg, args.userId);
  if (!auth.ok) return auth;
  const { token } = auth.data!;

  try {
    const data = await getJson(
      `https://api.github.com/repos/${encodeURIComponent(args.owner)}/${encodeURIComponent(args.repo)}`,
      authHeaders(token),
      cfg.githubTimeoutMs
    );
    return ok(data);
  } catch (err) {
    return handleApiError(err, args.userId);
  }
}

async function githubGetReadme(
  cfg: AppConfig,
  args: { owner: string; repo: string; userId?: string }
): Promise<OpResult<unknown>> {
  const auth = await resolveAuth(cfg, args.userId);
  if (!auth.ok) return auth;
  const { token } = auth.data!;

  try {
    const data = await getJson(
      `https://api.github.com/repos/${encodeURIComponent(args.owner)}/${encodeURIComponent(args.repo)}/readme`,
      authHeaders(token),
      cfg.githubTimeoutMs
    );
    return ok(data);
  } catch (err) {
    return handleApiError(err, args.userId);
  }
}

// ============================================================================
// Search
// ============================================================================

async function githubSearchRepos(
  cfg: AppConfig,
  args: { q: string; sort?: string; per_page?: number; userId?: string }
): Promise<OpResult<unknown>> {
  const auth = await resolveAuth(cfg, args.userId);
  if (!auth.ok) return auth;
  const { token } = auth.data!;

  const params = new URLSearchParams();
  params.set('q', args.q);
  if (args.sort) params.set('sort', args.sort);
  if (args.per_page) params.set('per_page', String(args.per_page));

  try {
    const data = await getJson(
      `https://api.github.com/search/repositories?${params.toString()}`,
      authHeaders(token),
      cfg.githubTimeoutMs
    );
    return ok(data);
  } catch (err) {
    return handleApiError(err, args.userId);
  }
}

async function githubSearchCode(
  cfg: AppConfig,
  args: { q: string; per_page?: number; userId?: string }
): Promise<OpResult<unknown>> {
  const auth = await resolveAuth(cfg, args.userId);
  if (!auth.ok) return auth;
  const { token } = auth.data!;

  const params = new URLSearchParams();
  params.set('q', args.q);
  if (args.per_page) params.set('per_page', String(args.per_page));

  try {
    const data = await getJson(
      `https://api.github.com/search/code?${params.toString()}`,
      authHeaders(token),
      cfg.githubTimeoutMs
    );
    return ok(data);
  } catch (err) {
    return handleApiError(err, args.userId);
  }
}

// ============================================================================
// Code
// ============================================================================

async function githubGetFile(
  cfg: AppConfig,
  args: { owner: string; repo: string; path: string; ref?: string; userId?: string }
): Promise<OpResult<unknown>> {
  const auth = await resolveAuth(cfg, args.userId);
  if (!auth.ok) return auth;
  const { token } = auth.data!;

  const params = new URLSearchParams();
  if (args.ref) params.set('ref', args.ref);

  try {
    const data = await getJson(
      `https://api.github.com/repos/${encodeURIComponent(args.owner)}/${encodeURIComponent(args.repo)}/contents/${encodeURIComponent(args.path)}?${params.toString()}`,
      authHeaders(token),
      cfg.githubTimeoutMs
    );
    return ok(data);
  } catch (err) {
    return handleApiError(err, args.userId);
  }
}

async function githubListDir(
  cfg: AppConfig,
  args: { owner: string; repo: string; path?: string; ref?: string; userId?: string }
): Promise<OpResult<unknown>> {
  const auth = await resolveAuth(cfg, args.userId);
  if (!auth.ok) return auth;
  const { token } = auth.data!;

  const dirPath = args.path || '';
  const params = new URLSearchParams();
  if (args.ref) params.set('ref', args.ref);

  try {
    const data = await getJson(
      `https://api.github.com/repos/${encodeURIComponent(args.owner)}/${encodeURIComponent(args.repo)}/contents/${encodeURIComponent(dirPath)}?${params.toString()}`,
      authHeaders(token),
      cfg.githubTimeoutMs
    );
    return ok(data);
  } catch (err) {
    return handleApiError(err, args.userId);
  }
}

async function githubListCommits(
  cfg: AppConfig,
  args: { owner: string; repo: string; sha?: string; per_page?: number; userId?: string }
): Promise<OpResult<unknown>> {
  const auth = await resolveAuth(cfg, args.userId);
  if (!auth.ok) return auth;
  const { token } = auth.data!;

  const params = new URLSearchParams();
  if (args.sha) params.set('sha', args.sha);
  if (args.per_page) params.set('per_page', String(args.per_page));

  try {
    const data = await getJson(
      `https://api.github.com/repos/${encodeURIComponent(args.owner)}/${encodeURIComponent(args.repo)}/commits?${params.toString()}`,
      authHeaders(token),
      cfg.githubTimeoutMs
    );
    return ok(data);
  } catch (err) {
    return handleApiError(err, args.userId);
  }
}

// ============================================================================
// Issues
// ============================================================================

async function githubListIssues(
  cfg: AppConfig,
  args: { owner: string; repo: string; state?: string; labels?: string; assignee?: string; per_page?: number; userId?: string }
): Promise<OpResult<unknown>> {
  const auth = await resolveAuth(cfg, args.userId);
  if (!auth.ok) return auth;
  const { token } = auth.data!;

  const params = new URLSearchParams();
  if (args.state) params.set('state', args.state);
  if (args.labels) params.set('labels', args.labels);
  if (args.assignee) params.set('assignee', args.assignee);
  if (args.per_page) params.set('per_page', String(args.per_page));

  try {
    const data = await getJson(
      `https://api.github.com/repos/${encodeURIComponent(args.owner)}/${encodeURIComponent(args.repo)}/issues?${params.toString()}`,
      authHeaders(token),
      cfg.githubTimeoutMs
    );
    return ok(data);
  } catch (err) {
    return handleApiError(err, args.userId);
  }
}

async function githubGetIssue(
  cfg: AppConfig,
  args: { owner: string; repo: string; issue_number: number; userId?: string }
): Promise<OpResult<unknown>> {
  const auth = await resolveAuth(cfg, args.userId);
  if (!auth.ok) return auth;
  const { token } = auth.data!;

  try {
    const data = await getJson(
      `https://api.github.com/repos/${encodeURIComponent(args.owner)}/${encodeURIComponent(args.repo)}/issues/${args.issue_number}`,
      authHeaders(token),
      cfg.githubTimeoutMs
    );
    return ok(data);
  } catch (err) {
    return handleApiError(err, args.userId);
  }
}

async function githubCreateIssue(
  cfg: AppConfig,
  args: { owner: string; repo: string; title: string; body?: string; labels?: string[]; assignees?: string[]; userId?: string }
): Promise<OpResult<unknown>> {
  const auth = await resolveAuth(cfg, args.userId);
  if (!auth.ok) return auth;
  const { token } = auth.data!;

  const body: Record<string, unknown> = { title: args.title };
  if (args.body) body.body = args.body;
  if (args.labels) body.labels = args.labels;
  if (args.assignees) body.assignees = args.assignees;

  try {
    const data = await postJson(
      `https://api.github.com/repos/${encodeURIComponent(args.owner)}/${encodeURIComponent(args.repo)}/issues`,
      body,
      authHeaders(token),
      cfg.githubTimeoutMs
    );
    return ok(data);
  } catch (err) {
    return handleApiError(err, args.userId);
  }
}

// ============================================================================
// Pull Requests
// ============================================================================

async function githubListPrs(
  cfg: AppConfig,
  args: { owner: string; repo: string; state?: string; per_page?: number; userId?: string }
): Promise<OpResult<unknown>> {
  const auth = await resolveAuth(cfg, args.userId);
  if (!auth.ok) return auth;
  const { token } = auth.data!;

  const params = new URLSearchParams();
  if (args.state) params.set('state', args.state);
  if (args.per_page) params.set('per_page', String(args.per_page));

  try {
    const data = await getJson(
      `https://api.github.com/repos/${encodeURIComponent(args.owner)}/${encodeURIComponent(args.repo)}/pulls?${params.toString()}`,
      authHeaders(token),
      cfg.githubTimeoutMs
    );
    return ok(data);
  } catch (err) {
    return handleApiError(err, args.userId);
  }
}

// ============================================================================
// OP_HANDLERS map
// ============================================================================

export type OpHandler = (
  cfg: AppConfig,
  args: Record<string, unknown>
) => Promise<OpResult<unknown>>;

export const OP_HANDLERS: Record<string, OpHandler> = {
  github_list_repos: githubListRepos as OpHandler,
  github_get_repo: githubGetRepo as OpHandler,
  github_get_readme: githubGetReadme as OpHandler,
  github_search_repos: githubSearchRepos as OpHandler,
  github_search_code: githubSearchCode as OpHandler,
  github_get_file: githubGetFile as OpHandler,
  github_list_dir: githubListDir as OpHandler,
  github_list_commits: githubListCommits as OpHandler,
  github_list_issues: githubListIssues as OpHandler,
  github_get_issue: githubGetIssue as OpHandler,
  github_create_issue: githubCreateIssue as OpHandler,
  github_list_prs: githubListPrs as OpHandler,
};
