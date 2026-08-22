/**
 * Azure AI Foundry Provider (Serverless via Foundry SDK)
 *
 * Route 5 aggregator gateway provider. Uses the Microsoft Foundry SDK
 * (@azure/ai-projects) to access ALL catalog models without deployments.
 *
 * Auth: Entra ID via DefaultAzureCredential (reads AZURE_CLIENT_ID,
 * AZURE_CLIENT_SECRET, AZURE_TENANT_ID from environment).
 *
 * The project endpoint is the single entry point for all models.
 * getOpenAIClient() returns a standard OpenAI SDK client that routes
 * through the project endpoint for serverless model access.
 */

import OpenAI from 'openai';
import { resolveProviderCredentialForRequest, sharedProviderClientFactory } from '../../provider-credential';

/**
 * Strip the azure-foundry/ prefix to get the bare model deployment name.
 */
export function stripAzureFoundryPrefix(modelId: string): string {
  return modelId.replace(/^azure-foundry\//, '');
}

export function resetAzureFoundryClient(): void {
  sharedProviderClientFactory.clear();
}

export async function getAzureFoundryClient(): Promise<OpenAI> {
  const cred = await resolveProviderCredentialForRequest('azure-foundry');
  if (!cred.apiBase) {
    throw new Error('Azure AI Foundry not configured (AZURE_FOUNDRY_ENDPOINT required)');
  }
  const built = sharedProviderClientFactory.getClient({
    providerId: 'azure-foundry',
    credentialId: cred.credentialId,
    credentialVersion: cred.credentialVersion,
    apiKey: cred.apiKey,
    apiBase: cred.apiBase,
  });
  if (built.kind !== 'openai') {
    throw new Error('ProviderClientFactory returned a non-OpenAI client for azure-foundry');
  }
  return built.client;
}

/**
 * Check if a model belongs to Azure AI Foundry
 */
export function isAzureFoundryModel(model: string): boolean {
  return model.startsWith('azure-foundry/');
}
