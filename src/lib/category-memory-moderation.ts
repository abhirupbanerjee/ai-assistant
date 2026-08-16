export interface CategoryMemoryCandidate {
  id: number;
  title: string;
  content: string;
  status?: string;
}

export interface CategoryMemoryAdvisoryFlag {
  kind: 'near_duplicate' | 'possible_contradiction';
  itemId: number;
  title: string;
  score: number;
  reason: string;
}

const NEGATIONS = new Set(['no', 'not', 'never', 'none', 'cannot', "can't", 'without', 'disabled', 'prohibited', 'forbidden']);
const STOP_WORDS = new Set(['a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'with']);

export function normalizeCategoryMemoryText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

function tokens(value: string): Set<string> {
  return new Set(normalizeCategoryMemoryText(value).split(' ').filter((token) => token.length > 1 && !STOP_WORDS.has(token)));
}

export function lexicalSimilarity(left: string, right: string): number {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size && !b.size) return 1;
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function hasNegation(value: string): boolean {
  return normalizeCategoryMemoryText(value).split(' ').some((token) => NEGATIONS.has(token));
}

/** Deterministic, advisory-only checks. They never decide moderation outcomes. */
export function detectCategoryMemoryAdvisories(
  input: Pick<CategoryMemoryCandidate, 'title' | 'content'>,
  existing: CategoryMemoryCandidate[],
): CategoryMemoryAdvisoryFlag[] {
  const normalizedTitle = normalizeCategoryMemoryText(input.title);
  const normalizedContent = normalizeCategoryMemoryText(input.content);
  const inputNegated = hasNegation(input.content);

  return existing.flatMap((item) => {
    const titleScore = lexicalSimilarity(normalizedTitle, item.title);
    const contentScore = lexicalSimilarity(normalizedContent, item.content);
    const flags: CategoryMemoryAdvisoryFlag[] = [];
    if (titleScore >= 0.65 || contentScore >= 0.72) {
      flags.push({
        kind: 'near_duplicate', itemId: item.id, title: item.title,
        score: Math.max(titleScore, contentScore), reason: 'Substantial lexical overlap with an existing category-memory item.',
      });
    }
    const oppositePolarity = inputNegated !== hasNegation(item.content);
    if (oppositePolarity && (titleScore >= 0.5 || contentScore >= 0.45)) {
      flags.push({
        kind: 'possible_contradiction', itemId: item.id, title: item.title,
        score: Math.max(titleScore, contentScore), reason: 'Similar subject language uses opposite explicit negation polarity.',
      });
    }
    return flags;
  }).sort((a, b) => b.score - a.score).slice(0, 10);
}
