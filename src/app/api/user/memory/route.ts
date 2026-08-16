import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  addPersonalInterest,
  clearAllPersonalMemory,
  clearInferredPersonalMemory,
  clearPersonalInterests,
  deletePersonalInterest,
  getMemorySettings,
  getOrCreatePersonalPreferenceProfile,
  getUserByEmail,
  listPersonalInterests,
  listPendingPersonalPreferenceCandidates,
  resetPersonalPreferences,
  setPersonalInterestActive,
  setPersonalMemoryLearning,
  resolvePendingPersonalPreferenceCandidate,
  updatePersonalPreferenceProfile,
  validatePersonalPreferencePatch,
  type PersonalPreferencePatch,
} from '@/lib/db/compat';
import type { ApiError, ErrorCode } from '@/types';

function isUnsupportedSurface(request: NextRequest): boolean {
  return Boolean(request.headers.get('x-agent-bot-api-key') || request.headers.get('x-workspace-slug'));
}

function downloadResponse(content: string, filename: string, contentType: string) {
  return new NextResponse(content, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}

function formatPersonalMemoryText(input: {
  exportedAt: string;
  profile: Awaited<ReturnType<typeof getOrCreatePersonalPreferenceProfile>>;
  interests: Awaited<ReturnType<typeof listPersonalInterests>>;
  pendingPreferences: Awaited<ReturnType<typeof listPendingPersonalPreferenceCandidates>>;
}): string {
  const preferenceEntries = Object.entries(input.profile)
    .filter(([key]) => !['userId', 'sources', 'createdAt', 'updatedAt'].includes(key))
    .map(([key, value]) => `${key}: ${value === null ? 'default / unset' : String(value)}`);
  const interests = input.interests.length
    ? input.interests.map((interest) => `- ${interest.topic} (${interest.source}, ${interest.isActive ? 'active' : 'disabled'}, confidence ${interest.confidence})`)
    : ['- None'];
  const pending = input.pendingPreferences.length
    ? input.pendingPreferences.map((candidate) => `- ${candidate.field}: ${String(candidate.value)} (confidence ${candidate.confidence})`)
    : ['- None'];
  return [
    'Personal Memory Export',
    `Exported: ${input.exportedAt}`,
    '',
    'Preferences',
    ...preferenceEntries,
    '',
    'Topics of interest',
    ...interests,
    '',
    'Pending learned preferences',
    ...pending,
    '',
  ].join('\n');
}

async function getAuthenticatedDbUser() {
  const sessionUser = await getCurrentUser();
  if (!sessionUser) return null;
  return getUserByEmail(sessionUser.email);
}

function error(message: string, code: ErrorCode, status: number) {
  return NextResponse.json<ApiError>({ error: message, code }, { status });
}

export async function GET(request: NextRequest) {
  try {
    if (isUnsupportedSurface(request)) return error('Main chat user session required', 'ACCESS_DENIED', 403);
    const user = await getAuthenticatedDbUser();
    if (!user) return error('Unauthorized', 'AUTH_REQUIRED', 401);
    const [profile, interests, pendingPreferences, settings] = await Promise.all([
      getOrCreatePersonalPreferenceProfile(user.id),
      listPersonalInterests(user.id),
      listPendingPersonalPreferenceCandidates(user.id),
      getMemorySettings(),
    ]);
    const payload = {
      profile,
      interests,
      pendingPreferences,
      limits: { maxInterests: settings.maxInterestsPerUser },
      categoryMemory: { enabled: settings.categoryMemoryEnabled },
    };
    const format = request.nextUrl.searchParams.get('format');
    if (format === 'json' || format === 'text') {
      const exportedAt = new Date().toISOString();
      const exportPayload = { exportedAt, profile, interests, pendingPreferences };
      const date = exportedAt.slice(0, 10);
      return format === 'json'
        ? downloadResponse(`${JSON.stringify(exportPayload, null, 2)}\n`, `personal-memory-${date}.json`, 'application/json; charset=utf-8')
        : downloadResponse(formatPersonalMemoryText(exportPayload), `personal-memory-${date}.txt`, 'text/plain; charset=utf-8');
    }
    if (format) return error('Format must be json or text', 'VALIDATION_ERROR', 400);
    return NextResponse.json(payload);
  } catch (cause) {
    console.error('Get personal memory error:', cause);
    return error('Failed to get personal memory', 'SERVICE_ERROR', 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    if (isUnsupportedSurface(request)) return error('Main chat user session required', 'ACCESS_DENIED', 403);
    const user = await getAuthenticatedDbUser();
    if (!user) return error('Unauthorized', 'AUTH_REQUIRED', 401);
    const body = await request.json() as { action?: string; topic?: string };
    if (body.action !== 'add_interest' || typeof body.topic !== 'string' || !body.topic.trim()) {
      return error('A non-empty interest topic is required', 'VALIDATION_ERROR', 400);
    }
    const settings = await getMemorySettings();
    const interest = await addPersonalInterest(user.id, body.topic, 'user_set', 1, settings.maxInterestsPerUser);
    if (!interest) return error(`A maximum of ${settings.maxInterestsPerUser} interests is allowed`, 'VALIDATION_ERROR', 409);
    return NextResponse.json({ interest }, { status: 201 });
  } catch (cause) {
    console.error('Add personal interest error:', cause);
    return error(cause instanceof Error ? cause.message : 'Failed to add interest', 'SERVICE_ERROR', 500);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    if (isUnsupportedSurface(request)) return error('Main chat user session required', 'ACCESS_DENIED', 403);
    const user = await getAuthenticatedDbUser();
    if (!user) return error('Unauthorized', 'AUTH_REQUIRED', 401);
    const body = await request.json() as {
      action?: string;
      preferences?: PersonalPreferencePatch;
      learningEnabled?: boolean;
      interestId?: number;
      active?: boolean;
      candidateId?: number;
      replacement?: PersonalPreferencePatch;
    };
    switch (body.action) {
      case 'update_preferences':
        {
          const validated = validatePersonalPreferencePatch(body.preferences);
          if (!validated.ok) return error(validated.error, 'VALIDATION_ERROR', 400);
          return NextResponse.json({ profile: await updatePersonalPreferenceProfile(user.id, validated.value) });
        }
      case 'set_learning':
        if (typeof body.learningEnabled !== 'boolean') return error('learningEnabled must be boolean', 'VALIDATION_ERROR', 400);
        return NextResponse.json({ profile: await setPersonalMemoryLearning(user.id, body.learningEnabled) });
      case 'set_interest_active':
        if (!Number.isInteger(body.interestId) || typeof body.active !== 'boolean') return error('interestId and active are required', 'VALIDATION_ERROR', 400);
        if (!await setPersonalInterestActive(user.id, body.interestId!, body.active)) return error('Interest not found', 'NOT_FOUND', 404);
        return NextResponse.json({ success: true });
      case 'accept_pending_preference':
      case 'reject_pending_preference':
        if (!Number.isInteger(body.candidateId) || body.candidateId! <= 0) return error('Valid candidateId is required', 'VALIDATION_ERROR', 400);
        if (body.action === 'reject_pending_preference' && body.replacement !== undefined) return error('Reject does not accept a replacement', 'VALIDATION_ERROR', 400);
        if (!await resolvePendingPersonalPreferenceCandidate(
          user.id,
          body.candidateId!,
          body.action === 'accept_pending_preference' ? 'accept' : 'reject',
          body.action === 'accept_pending_preference' ? body.replacement : undefined,
        )) return error('Pending preference not found', 'NOT_FOUND', 404);
        return NextResponse.json({ success: true });
      default:
        return error('Unsupported memory action', 'VALIDATION_ERROR', 400);
    }
  } catch (cause) {
    console.error('Update personal memory error:', cause);
    if (cause instanceof RangeError) return error(cause.message, 'VALIDATION_ERROR', 400);
    return error(cause instanceof Error ? cause.message : 'Failed to update personal memory', 'SERVICE_ERROR', 500);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    if (isUnsupportedSurface(request)) return error('Main chat user session required', 'ACCESS_DENIED', 403);
    const user = await getAuthenticatedDbUser();
    if (!user) return error('Unauthorized', 'AUTH_REQUIRED', 401);
    const { searchParams } = new URL(request.url);
    const scope = searchParams.get('scope') ?? 'all';
    if (scope === 'interest') {
      const id = Number(searchParams.get('id'));
      if (!Number.isInteger(id)) return error('Valid interest id is required', 'VALIDATION_ERROR', 400);
      if (!await deletePersonalInterest(user.id, id)) return error('Interest not found', 'NOT_FOUND', 404);
    } else if (scope === 'inferred') {
      await clearInferredPersonalMemory(user.id);
    } else if (scope === 'preferences') {
      await resetPersonalPreferences(user.id);
    } else if (scope === 'interests') {
      await clearPersonalInterests(user.id, false);
    } else if (scope === 'all') {
      await clearAllPersonalMemory(user.id);
    } else {
      return error('Invalid clear scope', 'VALIDATION_ERROR', 400);
    }
    return NextResponse.json({ success: true });
  } catch (cause) {
    console.error('Clear personal memory error:', cause);
    return error('Failed to clear personal memory', 'SERVICE_ERROR', 500);
  }
}
