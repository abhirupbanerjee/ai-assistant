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
import { AIProjectClient } from '@azure/ai-projects';
import { DefaultAzureCredential } from '@azure/identity';
import { getApiBase } from '@/lib/provider-helpers';

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
    const apiBase = await getApiBase('azure-foundry');
    if (!apiBase) {
      throw new Error('Azure AI Foundry not configured (AZURE_FOUNDRY_ENDPOINT required)');
    }
    const project = new AIProjectClient(
      apiBase.replace(/\/$/, ''),
      new DefaultAzureCredential(),
    );
    // Returns a standard openai client (from the 'openai' package).
    // Supports .chat.completions.create() — all dispatch sites unchanged.
    client = project.getOpenAIClient();
  }
  return client;
}

/**
 * Check if a model belongs to Azure AI Foundry
 */
export function isAzureFoundryModel(model: string): boolean {
  return model.startsWith('azure-foundry/');
}
