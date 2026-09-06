// External classification is disabled: ambient credentials are not export consent.
// Keep the API shape so callers retain deterministic heuristic classifications.
export function resolveSmartProviderConfig() { return null; }
export async function refineWithSmart({ enabled } = {}) {
  return { applied: false, reason: enabled ? 'external LLM exports disabled by security policy' : 'disabled' };
}
