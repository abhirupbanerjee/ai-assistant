import type { Kysely } from 'kysely';
import type { DB } from './db/db-types';
import type { CapabilityId } from './provider-registry';

export interface CapabilityRuntimeStatus {
  configured: boolean;
  runtimeAvailable: boolean;
  warnings: string[];
}

export type CapabilityStatusAdapterInput =
  | {
      kind: 'credential';
      configured: boolean;
      available: boolean;
    }
  | {
      kind: 'tavily';
      enabled: boolean;
      apiKeyAvailable: boolean;
    }
  | {
      kind: 'sonarcloud';
      enabled: boolean;
      tokenAvailable: boolean;
      organizationAvailable: boolean;
    }
  | {
      kind: 'k6';
      enabled: boolean;
      tokenAvailable: boolean;
      cliAvailable: boolean;
    }
  | {
      kind: 'website-analysis';
      enabled: boolean;
      apiKeyAvailable: boolean;
    }
  | {
      kind: 'podcast';
      enabled: boolean;
      providerSelected: boolean;
      providerEnabled: boolean;
      credentialAvailable: boolean;
    }
  | {
      kind: 'keyless';
      configured: boolean;
    };

/**
 * Pure presentation/status adapter shared by the API and unit tests. It
 * intentionally models runtime gates instead of treating every capability as
 * an API credential.
 */
export function evaluateCapabilityRuntime(
  input: CapabilityStatusAdapterInput
): CapabilityRuntimeStatus {
  switch (input.kind) {
    case 'credential':
      return {
        configured: input.configured,
        runtimeAvailable: input.configured && input.available,
        warnings: [],
      };
    case 'tavily':
      return {
        configured: input.enabled,
        runtimeAvailable: input.enabled && input.apiKeyAvailable,
        warnings: input.enabled && !input.apiKeyAvailable
          ? ['Tavily API key is not available for the effective organization mode']
          : [],
      };
    case 'sonarcloud': {
      const missing = [
        !input.tokenAvailable ? 'API token' : null,
        !input.organizationAvailable ? 'organization' : null,
      ].filter(Boolean);
      return {
        configured: input.enabled,
        runtimeAvailable: input.enabled && missing.length === 0,
        warnings: input.enabled && missing.length > 0
          ? [`SonarCloud is missing ${missing.join(' and ')}`]
          : [],
      };
    }
    case 'k6': {
      const warnings: string[] = [];
      if (input.enabled && !input.tokenAvailable) warnings.push('k6 Cloud API token is missing');
      if (input.enabled && !input.cliAvailable) warnings.push('k6 CLI is not installed on the server');
      return {
        configured: input.enabled,
        runtimeAvailable: input.enabled && input.tokenAvailable && input.cliAvailable,
        warnings,
      };
    }
    case 'website-analysis':
      return {
        configured: input.enabled,
        runtimeAvailable: input.enabled,
        warnings: input.enabled && !input.apiKeyAvailable
          ? ['Google PageSpeed API key is optional; unauthenticated rate limits apply']
          : [],
      };
    case 'podcast': {
      const runtimeAvailable =
        input.enabled &&
        input.providerSelected &&
        input.providerEnabled &&
        input.credentialAvailable;
      return {
        configured: input.enabled && input.providerSelected,
        runtimeAvailable,
        warnings: input.enabled && input.providerSelected && !runtimeAvailable
          ? ['Podcast provider is disabled or its effective credential is unavailable']
          : [],
      };
    }
    case 'keyless':
      return {
        configured: input.configured,
        runtimeAvailable: input.configured,
        warnings: [],
      };
  }
}

/** Resolve one catalog capability using the same settings and fallbacks as its runtime tool. */
export async function resolveCapabilityRuntimeStatus(
  db: Kysely<DB>,
  orgId: number,
  capabilityId: CapabilityId
): Promise<{
  providerId: string | null;
  status: CapabilityRuntimeStatus;
}> {
  const { resolveCapability } = await import('./capability-resolver');
  const resolved = await resolveCapability(db, orgId, capabilityId);
  const configured = resolved.health !== 'NOT_CONFIGURED';

  if (capabilityId === 'web-search') {
    const [{ getWebSearchConfig }, { resolveProviderCredential }, { resolveTavilyApiKey }] =
      await Promise.all([
        import('./db/compat/tool-config'),
        import('./provider-credential'),
        import('./tools/tavily'),
      ]);
    const [tool, credential] = await Promise.all([
      getWebSearchConfig(),
      resolveProviderCredential(db, orgId, 'tavily'),
    ]);
    const apiKey = await resolveTavilyApiKey(credential);
    return {
      providerId: resolved.providerId ?? 'tavily',
      status: evaluateCapabilityRuntime({
        kind: 'tavily', enabled: tool.enabled, apiKeyAvailable: !!apiKey,
      }),
    };
  }

  if (capabilityId === 'code-analysis') {
    const { getCodeAnalysisConfig } = await import('./tools/sonarcloud');
    const tool = await getCodeAnalysisConfig();
    return {
      providerId: resolved.providerId ?? 'sonarcloud',
      status: evaluateCapabilityRuntime({
        kind: 'sonarcloud',
        enabled: tool.enabled,
        tokenAvailable: !!(tool.config.apiToken || process.env.SONARCLOUD_TOKEN),
        organizationAvailable: !!(tool.config.organization || process.env.SONARCLOUD_ORGANIZATION),
      }),
    };
  }

  if (capabilityId === 'load-testing') {
    const { getLoadTestConfig, checkK6Installed } = await import('./tools/loadtest');
    const tool = await getLoadTestConfig();
    const tokenAvailable = !!(tool.config.apiToken || process.env.K6_CLOUD_API_TOKEN);
    const cliAvailable = tool.enabled && tokenAvailable ? await checkK6Installed() : false;
    return {
      providerId: resolved.providerId ?? 'k6',
      status: evaluateCapabilityRuntime({
        kind: 'k6', enabled: tool.enabled, tokenAvailable, cliAvailable,
      }),
    };
  }

  if (capabilityId === 'website-analysis') {
    const { getWebsiteAnalysisConfig } = await import('./tools/pagespeed');
    const tool = await getWebsiteAnalysisConfig();
    return {
      providerId: resolved.providerId ?? 'lighthouse',
      status: evaluateCapabilityRuntime({
        kind: 'website-analysis',
        enabled: tool.enabled,
        apiKeyAvailable: !!tool.config.apiKey,
      }),
    };
  }

  if (capabilityId === 'podcast-audio') {
    const [{ getEffectivePodcastGenConfig, isPodcastGenEnabled }, { resolveProviderCredential }] =
      await Promise.all([import('./tools/podcast-gen'), import('./provider-credential')]);
    const [toolEnabled, tool] = await Promise.all([isPodcastGenEnabled(), getEffectivePodcastGenConfig(orgId)]);
    const providerId = resolved.providerId ?? (tool.activeProvider === 'none' ? null : tool.activeProvider);
    const provider = providerId === 'openai' || providerId === 'gemini'
      ? tool.providers[providerId]
      : null;
    const credential = providerId ? await resolveProviderCredential(db, orgId, providerId) : null;
    return {
      providerId,
      status: evaluateCapabilityRuntime({
        kind: 'podcast',
        enabled: toolEnabled,
        providerSelected: !!providerId,
        providerEnabled: !!provider?.enabled,
        credentialAvailable: !!credential?.available,
      }),
    };
  }

  if (capabilityId === 'reranking' && resolved.providerId === 'bge') {
    return {
      providerId: resolved.providerId,
      status: evaluateCapabilityRuntime({ kind: 'keyless', configured }),
    };
  }

  return {
    providerId: resolved.providerId,
    status: evaluateCapabilityRuntime({
      kind: 'credential', configured, available: resolved.available,
    }),
  };
}
