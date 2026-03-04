import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { setPWASettings, getPWASettings } from '@/lib/db/compat';
import type { ApiError } from '@/types';

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const ICON_DIR = path.join(process.cwd(), 'public', 'icons');

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json<ApiError>(
        { error: 'Unauthorized', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    if (!user.isAdmin) {
      return NextResponse.json<ApiError>(
        { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const size = formData.get('size') as string; // '192' or '512'

    if (!file || !size) {
      return NextResponse.json<ApiError>(
        { error: 'File and size required', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    if (!['192', '512'].includes(size)) {
      return NextResponse.json<ApiError>(
        { error: 'Size must be 192 or 512', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json<ApiError>(
        { error: 'Invalid file type. Use PNG, JPEG, or WebP', code: 'INVALID_FILE_TYPE' },
        { status: 400 }
      );
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json<ApiError>(
        { error: 'File too large. Max 5MB', code: 'FILE_TOO_LARGE' },
        { status: 413 }
      );
    }

    // Ensure icons directory exists
    if (!existsSync(ICON_DIR)) {
      await mkdir(ICON_DIR, { recursive: true });
    }

    // Always save as PNG for consistency
    const filename = `icon-${size}x${size}.png`;
    const filepath = path.join(ICON_DIR, filename);
    const buffer = Buffer.from(await file.arrayBuffer());

    await writeFile(filepath, buffer);

    // Update PWA settings with new icon path
    const iconPath = `/icons/${filename}`;
    const currentSettings = await getPWASettings();

    if (size === '192') {
      await setPWASettings({ ...currentSettings, icon192Path: iconPath }, user.email);
    } else {
      await setPWASettings({ ...currentSettings, icon512Path: iconPath }, user.email);
    }

    return NextResponse.json({
      success: true,
      path: iconPath,
      size: `${size}x${size}`,
    });
  } catch (error) {
    console.error('Icon upload error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to upload icon',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json<ApiError>(
        { error: 'Unauthorized', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    if (!user.isAdmin) {
      return NextResponse.json<ApiError>(
        { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    const settings = await getPWASettings();
    return NextResponse.json({
      icon192Path: settings.icon192Path,
      icon512Path: settings.icon512Path,
      themeColor: settings.themeColor,
      backgroundColor: settings.backgroundColor,
    });
  } catch (error) {
    console.error('Get PWA settings error:', error);
    return NextResponse.json<ApiError>(
      { error: 'Failed to get PWA settings', code: 'SERVICE_ERROR' },
      { status: 500 }
    );
  }
}
