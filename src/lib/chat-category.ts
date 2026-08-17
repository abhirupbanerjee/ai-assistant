interface CategorizedThread {
  categories?: Array<{ id: number }>;
}

/**
 * Prefer the synchronously returned thread when a message creates a thread.
 * React parent state may not contain that thread until after the first request.
 */
export function resolveChatCategoryId(
  createdThread: CategorizedThread | null,
  activeThread: CategorizedThread | null | undefined,
): number | undefined {
  return createdThread?.categories?.[0]?.id ?? activeThread?.categories?.[0]?.id;
}
