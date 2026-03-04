/**
 * Image Capabilities API
 *
 * Returns current image processing capabilities for the frontend.
 * Used to show/hide upload buttons and display appropriate warnings.
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getLlmSettings } from '@/lib/db/compat';
import { getImageCapabilities, type ImageCapabilities } from '@/lib/config-capability-checker';

export async function GET(): Promise<NextResponse<ImageCapabilities | { error: string }>> {
  try {
    // Check authentication
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get current model and check capabilities
    const llmSettings = await getLlmSettings();
    const capabilities = await getImageCapabilities(llmSettings.model);

    return NextResponse.json(capabilities);
  } catch (error) {
    console.error('Error getting image capabilities:', error);
    return NextResponse.json(
      { error: 'Failed to check image capabilities' },
      { status: 500 }
    );
  }
}
