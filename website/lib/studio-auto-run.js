export function createStudioAutoRunGate() {
  let hasClaimed = false;

  return (rawUrl) => {
    if (hasClaimed || typeof rawUrl !== 'string' || !rawUrl.trim()) return null;
    hasClaimed = true;
    return rawUrl;
  };
}
