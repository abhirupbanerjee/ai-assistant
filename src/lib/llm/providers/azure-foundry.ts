/**
 * Azure AI Foundry Provider
 *
 * Route 5 aggregator gateway provider. Uses the Azure AI Model Inference API
 * with the OpenAI SDK.
 *
 * Endpoint pattern:
 *   POST {base}/models/chat/completions?api-version=2024-05-01-preview
 *
 * The SDK's baseURL must end in /models so the SDK appends /chat/completions.
 * Model name goes in the request body (standard OpenAI SDK behavior).
 * Auth uses the api-key header (not Authorization: Bearer).
 */

import OpenAI from 'openai';
import { getApiKey, getApiBase } from '@/lib/provider-helpers';

const API_VERSION = '2024-05-01-preview';

let client: OpenAI | null = null;

/**
 * Strip the azure-foundry/ prefix to get the bare model deployment name.
 */
export function stripAzureFoundryPrefix(modelId: string): string {
  return modelId.replace(/^azure-foundry\//, '');
}

export function resetAzureFoundryClient(): void {
  client = null;
}

export async function getAzureFoundryClient(): Promise<OpenAI> {
  if (!client) {
    const apiKey = await getApiKey('azure-foundry');
    const apiBase = await getApiBase('azure-foundry');
    if (!apiKey || !apiBase) {
      throw new Error('Azure AI Foundry not configured (AZURE_FOUNDRY_API_KEY + AZURE_FOUNDRY_ENDPOINT required)');
    }
    // Validate endpoint is the root URL, not already including /models
    const trimmed = apiBase.replace(/\/$/, '');
    if (trimmed.endsWith('/models')) {
      throw new Error(
        'AZURE_FOUNDRY_ENDPOINT should be the root URL (e.g. https://<resource>.services.ai.azure.com). ' +
        'Do not include /models — the client appends it automatically.'
      );
    }
    // SDK appends /chat/completions → final URL: {base}/models/chat/completions?api-version=...
    client = new OpenAI({
      apiKey,
      baseURL: `${trimmed}/models`,
      defaultQuery: { 'api-version': API_VERSION },
      defaultHeaders: { 'api-key': apiKey },
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
