const safeIdentifier = /^[A-Za-z0-9_-]+$/;

export interface ExpectedOutputPath {
  sourceOrigin: string;
  slug: string;
  jobId: string;
}

export function extractOutputId(downloadUrl: string, expected: ExpectedOutputPath): string | null {
  if (!safeIdentifier.test(expected.slug) || !safeIdentifier.test(expected.jobId)) return null;

  let parsed: URL;
  let normalizedOrigin: string;
  try {
    parsed = new URL(downloadUrl, expected.sourceOrigin);
    normalizedOrigin = new URL(expected.sourceOrigin).origin;
  } catch {
    return null;
  }

  if (parsed.origin !== normalizedOrigin || parsed.search !== "" || parsed.hash !== "") return null;

  const segments = parsed.pathname.split("/").filter(Boolean).map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return "";
    }
  });
  if (
    segments.length !== 8 ||
    segments[0] !== "api" ||
    segments[1] !== "agent-bots" ||
    segments[2] !== expected.slug ||
    segments[3] !== "jobs" ||
    segments[4] !== expected.jobId ||
    segments[5] !== "outputs" ||
    segments[7] !== "download"
  ) {
    return null;
  }

  const outputId = segments[6];
  return outputId && safeIdentifier.test(outputId) ? outputId : null;
}
