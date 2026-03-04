/**
 * Languages API
 *
 * Returns the list of enabled languages for translation.
 * Uses the existing translation tool configuration.
 */

import { NextResponse } from 'next/server';
import { getTranslationConfig, getEnabledLanguages } from '@/lib/translation/provider-factory';
import { isToolEnabled } from '@/lib/tools';

export async function GET() {
  try {
    // Check if translation tool is enabled
    if (!(await isToolEnabled('translation'))) {
      return NextResponse.json({
        languages: [{ code: 'en', name: 'English' }],
        translationEnabled: false,
      });
    }

    // Get translation config and enabled languages
    const config = await getTranslationConfig();
    const enabledLanguages = getEnabledLanguages(config);

    // Convert to array format for frontend
    const languages = Object.entries(enabledLanguages).map(([code, name]) => ({
      code,
      name,
    }));

    return NextResponse.json({
      languages,
      translationEnabled: true,
    });
  } catch (error) {
    console.error('[Languages API] Error fetching languages:', error);
    return NextResponse.json(
      { error: 'Failed to fetch languages' },
      { status: 500 }
    );
  }
}
