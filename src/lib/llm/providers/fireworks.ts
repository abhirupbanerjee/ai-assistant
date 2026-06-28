/**
 * Fireworks AI Provider
 *
 * Route 5 aggregator gateway provider. Uses OpenAI-compatible API
 * with Fireworks-specific base URL.
 */

import OpenAI from 'openai';
import { getApiKey } from '@/lib/provider-helpers';

let client: OpenAI | null = null;

export async function getFireworksClient(): Promise<OpenAI> {
  if (!client) {
    const apiKey = await getApiKey('fireworks');
    client = new OpenAI({
      apiKey: apiKey || undefined,
      baseURL: 'https://api.fireworks.ai/inference/v1',
      timeout: 300 * 1000, // 5 minutes — matches LiteLLM/OpenAI/Anthropic timeout
    });
  }
  return client;
}
