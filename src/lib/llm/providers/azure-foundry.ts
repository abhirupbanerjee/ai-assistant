/**
 * Azure AI Foundry Provider
 *
 * Route 5 aggregator gateway provider. Uses OpenAI-compatible API
 * with Azure-specific endpoint and API key.
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
    client = new OpenAI({
      apiKey,
      baseURL: apiBase.replace(/\/$/, '') + '/v1',
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
