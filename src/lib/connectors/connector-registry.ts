/**
 * Connector Registry — Auto-registration of connector tools at startup.
 *
 * Pings each connector's /health and /tools endpoints, then upserts
 * function_api_configs rows so connector tools appear in the tool registry
 * without manual configuration.
 */
import { CONNECTOR_PROVIDERS } from './provider-meta';
import {
  getFunctionAPIConfigByName,
  createFunctionAPIConfig,
  updateFunctionAPIConfig,
} from '@/lib/db/compat/function-api-config';
import { toolsLogger as logger } from '@/lib/logger';
import type { EndpointMapping } from '@/types/function-api';
import type OpenAI from 'openai';

interface ConnectorToolsResponse {
  ok: boolean;
  tools: OpenAI.Chat.ChatCompletionFunctionTool[];
  count: number;
}

/**
 * Sync all connector tools into the function_api_configs table.
 * Called once at app startup from initializeTools().
 */
export async function syncConnectorTools(): Promise<void> {
  logger.info('Syncing connector tools…');

  for (const meta of CONNECTOR_PROVIDERS) {
    try {
      // 1. Health check
      let healthy = false;
      try {
        const healthRes = await fetch(meta.healthUrl, { signal: AbortSignal.timeout(5000) });
        healthy = healthRes.ok;
      } catch {
        // health endpoint unreachable
      }

      if (!healthy) {
        logger.warn(`Connector ${meta.provider} health check failed, skipping`, {
          healthUrl: meta.healthUrl,
        });
        continue;
      }

      // 2. Fetch tools
      const toolsRes = await fetch(meta.toolsUrl, { signal: AbortSignal.timeout(10000) });
      if (!toolsRes.ok) {
        logger.warn(`Connector ${meta.provider} /tools returned ${toolsRes.status}, skipping`);
        continue;
      }

      const toolsData: ConnectorToolsResponse = await toolsRes.json();
      if (!toolsData.ok || !Array.isArray(toolsData.tools)) {
        logger.warn(`Connector ${meta.provider} /tools response invalid, skipping`);
        continue;
      }

      // 3. Build endpoint mappings from tool names
      const endpointMappings: Record<string, EndpointMapping> = {};
      for (const tool of toolsData.tools) {
        const toolName = tool.function?.name;
        if (toolName) {
          endpointMappings[toolName] = {
            method: 'POST',
            path: `/${toolName}`,
          };
        }
      }

      const configName = `${meta.label} Connector`;

      // 4. Look up existing config
      const existing = await getFunctionAPIConfigByName(configName);

      if (existing) {
        // Check if tools schema changed
        const existingSchema = JSON.stringify(existing.toolsSchema);
        const newSchema = JSON.stringify(toolsData.tools);

        if (existingSchema !== newSchema) {
          await updateFunctionAPIConfig(
            existing.id,
            {
              toolsSchema: toolsData.tools,
              endpointMappings,
              status: 'active',
            },
            'system'
          );
          logger.info(`Updated connector tools for ${meta.provider}`, {
            toolCount: toolsData.count,
          });
        } else {
          logger.debug(`Connector ${meta.provider} tools unchanged, skipping update`);
        }
      } else {
        // 5. Create new config
        const bearerToken =
          process.env[`${meta.provider.toUpperCase()}_CONNECTOR_BEARER_TOKEN`] || '';

        await createFunctionAPIConfig(
          {
            name: configName,
            description: meta.description,
            baseUrl: meta.toolsUrl.replace('/tools', ''),
            authType: 'bearer',
            authHeader: 'Authorization',
            authCredentials: bearerToken,
            toolsSchema: toolsData.tools,
            endpointMappings,
            timeoutSeconds: 30,
            cacheTTLSeconds: 3600,
            isEnabled: true,
            // Empty array = no category restrictions (available to ALL categories).
            // getFunctionAPIConfigsForCategories uses LEFT JOIN + IS NULL to
            // include unrestricted configs in every category-scoped query.
            categoryIds: [],
          },
          'system'
        );
        logger.info(`Registered new connector: ${meta.provider}`, {
          toolCount: toolsData.count,
        });
      }
    } catch (error) {
      logger.error(`Failed to sync connector ${meta.provider}`, {
        error: String(error),
      });
    }
  }

  logger.info('Connector tool sync complete');
}
