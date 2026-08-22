/**
 * Fireworks AI Provider
 *
 * Route 5 aggregator gateway provider. Uses OpenAI-compatible API
 * with Fireworks-specific base URL.
 */

import OpenAI from 'openai';
import { resolveProviderCredentialForRequest, sharedProviderClientFactory } from '../../provider-credential';

export async function getFireworksClient(): Promise<OpenAI> {
  const cred = await resolveProviderCredentialForRequest('fireworks');
  const built = sharedProviderClientFactory.getClient({
    providerId: 'fireworks',
    credentialId: cred.credentialId,
    credentialVersion: cred.credentialVersion,
    apiKey: cred.apiKey,
    apiBase: 'https://api.fireworks.ai/inference/v1',
    timeoutMs: 300 * 1000, // 5 minutes — matches LiteLLM/OpenAI/Anthropic timeout
  });
  if (built.kind !== 'openai') {
    throw new Error('ProviderClientFactory returned a non-OpenAI client for fireworks');
  }
  return built.client;
}
