/**
 * Azure AI Foundry Provider (via Azure OpenAI endpoint)
 *
 * Route 5 aggregator gateway provider. Uses the Azure OpenAI-compatible API
 * with the standard OpenAI SDK.
 *
 * The endpoint is user-configurable via AZURE_FOUNDRY_ENDPOINT env var or
 * Admin → Settings → API Keys. Set it to the full base URL including the
 * /openai/v1 path (e.g. https://<resource>.openai.azure.com/openai/v1).
 *
 * Auth uses standard Authorization: Bearer (OpenAI SDK default).
 * Model name goes in the request body.
 */

import OpenAI from 'openai';
import { getApiKey, getApiBase } from '@/lib/provider-helpers';

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
    // Use the endpoint as-is. SDK appends /chat/completions.
    // Standard Azure OpenAI endpoint: https://<resource>.openai.azure.com/openai/v1
    const trimmed = apiBase.replace(/\/$/, '');
    client = new OpenAI({
      apiKey,
      baseURL: trimmed,
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
