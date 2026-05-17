/**
 * Moonshot Configuration
 *
 * Centralized source for Moonshot API base URL and related constants.
 * Reads from provider DB config so admins can override; falls back to
 * the international endpoint default.
 */

import { getProviderApiBase } from '@/lib/db/compat/llm-providers';

export const DEFAULT_MOONSHOT_BASE_URL = 'https://api.moonshot.ai/v1';

export async function getMoonshotBaseUrl(): Promise<string> {
  const configured = await getProviderApiBase('moonshot');
  return configured || DEFAULT_MOONSHOT_BASE_URL;
}
