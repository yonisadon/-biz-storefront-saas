const routes = [
  '/register',
  '/login',
  '/account',
  '/forgot-password',
  '/reset-password?token=integration-test-token',
  '/verify-email?token=integration-test-token',
  '/platform-legal',
  '/platform-admin',
];

(async () => {
  const { chromium } = await import('playwright');
  const { AxeBuilder } = await import('@axe-core/playwright');
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const failures = [];
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
      await page.setViewportSize(viewport);
      for (const route of routes) {
        const response = await page.goto(`http://localhost:3000${route}`, { waitUntil: 'domcontentloaded' });
        if (!response || response.status() >= 500) {
          failures.push({ route, viewport, error: `page returned HTTP ${response?.status() ?? 'no response'}` });
          continue;
        }
        await page.locator('main').first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();
        if (results.violations.length) {
          failures.push({
            route,
            viewport,
            violations: results.violations.map((violation) => ({
              id: violation.id,
              impact: violation.impact,
              description: violation.description,
              nodes: violation.nodes.map((node) => ({
                target: node.target,
                summary: node.failureSummary,
              })),
            })),
          });
        }
      }
    }
  } finally {
    await browser.close();
  }

  if (failures.length) {
    process.stderr.write(JSON.stringify(failures, null, 2) + '\n');
    process.exitCode = 1;
  } else {
    process.stdout.write(`axe accessibility scan passed for ${routes.length} platform routes at mobile and desktop widths.\n`);
  }
})();
