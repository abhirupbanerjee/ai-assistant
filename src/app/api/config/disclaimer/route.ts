/**
 * AI Disclaimer Configuration API
 *
 * Returns disclaimer configuration for client-side components
 * (chart exports, diagram exports, etc.)
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  getDisclaimerConfig,
  isDisclaimerEnabled,
  type DisclaimerConfig,
} from '@/lib/disclaimer';

interface DisclaimerResponse {
  enabled: boolean;
  config?: DisclaimerConfig;
}

export async function GET(): Promise<NextResponse<DisclaimerResponse | { error: string }>> {
  try {
    // Check authentication
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Check if disclaimers are enabled
    const enabled = await isDisclaimerEnabled();
    if (!enabled) {
      return NextResponse.json({ enabled: false });
    }

    // Get full configuration
    const config = await getDisclaimerConfig();
    return NextResponse.json({
      enabled: true,
      config,
    });
  } catch (error) {
    console.error('Error getting disclaimer config:', error);
    return NextResponse.json(
      { error: 'Failed to get disclaimer configuration' },
      { status: 500 }
    );
  }
}
