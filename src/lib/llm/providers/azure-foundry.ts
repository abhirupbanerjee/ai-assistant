/**
 * Azure AI Foundry Provider
 *
 * Route 5 aggregator gateway provider. Uses Azure AI Foundry endpoints
 * with the OpenAI SDK. For project endpoints (services.ai.azure.com/api/projects/...),
 * the base URL is used directly without appending /v1 since the project endpoint
 * already contains the full API path.
 */

import OpenAI from 'openai';
import { getApiKey, getApiBase } from '@/lib/provider-helpers';

let client: OpenAI | null = null;

export async function getAzureFoundryClient(): Promise<OpenAI> {
  if (!client) {
    const apiKey = await getApiKey('azure-foundry');
    const apiBase = await getApiBase('azure-foundry');
    if (!apiKey || !apiBase) {
      throw new Error('Azure AI Foundry not configured (AZURE_FOUNDRY_API_KEY + AZURE_FOUNDRY_ENDPOINT required)');
    }
    // Use endpoint as-is without appending /v1 — project endpoints already include
    // the full API path (e.g. /api/projects/{name}). For standard Azure OpenAI endpoints
    // (e.g. https://x.openai.azure.com), the caller should set the endpoint to include
    // the /openai/v1 suffix in AZURE_FOUNDRY_ENDPOINT.
    const baseURL = apiBase.replace(/\/$/, '');
    client = new OpenAI({
      apiKey,
      baseURL,
      defaultHeaders: {
        'api-key': apiKey, // Azure AI Foundry uses api-key header, not Authorization: Bearer
      },
      timeout: 300 * 1000, // 5 minutes — matches other providers
    });
  }
  return client;
}

/**
 * Check if a model belongs to Azure AI Foundry
 */
export function isAzureFoundryModel(model: string): boolean {
  return model.startsWith('azure-foundry/');
}
