// Shared Playwright browser-launch path.
//
// Remote browser connections are deliberately disabled: this process cannot
// enforce its private-network egress policy on a browser running elsewhere.
// Use bundled Chromium on Vercel/Lambda, or a bare local launch in development.

export async function getLocalBrowserOptions() {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const chromium = (await import('@sparticuz/chromium')).default;
    return {
      executablePath: await chromium.executablePath(),
      browserArgs: chromium.args,
    };
  }
  return {};
}

export async function getBrowserOptions() {
  return getLocalBrowserOptions();
}

// Open only a browser whose network boundary this process controls.
export async function openBrowser(chromium, opts) {
  if (opts.wsEndpoint) {
    throw new Error('Remote browser endpoints are disabled because private-network egress cannot be enforced');
  }
  if (opts.executablePath) return chromium.launch({ executablePath: opts.executablePath, args: opts.browserArgs || [] });
  return chromium.launch();
}
