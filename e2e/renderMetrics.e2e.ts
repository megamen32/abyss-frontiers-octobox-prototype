import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

interface MetricSummary {
  average: number;
  maximum: number;
}

interface RenderReport {
  frameCount: number;
  metrics: Record<string, MetricSummary>;
}

test('captures real renderer and draw-call metrics to a report', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/');
  await page.waitForFunction(() => typeof window.__ABYSS_PERF__?.report === 'function');
  await page.evaluate(() => window.__ABYSS_PERF__?.clear());
  await page.waitForTimeout(4_000);
  const startup = await page.evaluate(() => window.__ABYSS_PERF__?.report()) as RenderReport;

  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await page.evaluate(() => window.__ABYSS_PERF__?.clear());
  await page.waitForTimeout(2_000);
  const afterRestart = await page.evaluate(() => window.__ABYSS_PERF__?.report()) as RenderReport;

  const outputDirectory = resolve(process.cwd(), 'artifacts/performance');
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    resolve(outputDirectory, 'render-metrics.json'),
    `${JSON.stringify({ startup, afterRestart }, null, 2)}\n`,
    'utf8',
  );

  expect(startup.frameCount).toBeGreaterThan(10);
  expect(startup.metrics.drawCalls.maximum).toBeGreaterThan(0);
  expect(startup.metrics.drawTriangles.maximum).toBeGreaterThan(0);
  expect(startup.metrics.renderDrawMs.average).toBeGreaterThanOrEqual(0);
  expect(startup.metrics.staticMeshChunks.maximum).toBeGreaterThan(0);
  expect(startup.metrics.drawLines.average).toBeLessThan(20);
  expect(afterRestart.frameCount).toBeGreaterThan(5);
  expect(afterRestart.metrics.staticMeshChunks.maximum).toBeGreaterThan(0);
  expect(afterRestart.metrics.drawCalls.maximum).toBeLessThan(startup.metrics.drawCalls.maximum * 2 + 30);
  expect(pageErrors).toEqual([]);
});

declare global {
  interface Window {
    __ABYSS_PERF__?: {
      clear: () => void;
      report: () => RenderReport;
    };
  }
}
