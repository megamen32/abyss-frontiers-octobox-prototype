import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

interface MetricSummary {
  average: number;
  maximum: number;
  p95: number;
}

interface PerfFrame {
  timestampMs: number;
  fps: number;
  depth: number;
}

interface RenderReport {
  frameCount: number;
  metrics: Record<string, MetricSummary>;
  frames: PerfFrame[];
}

test('profiles a 30 second downward flight', async ({ page }) => {
  test.setTimeout(45_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/?cpu=1');
  await page.waitForFunction(() => typeof window.__ABYSS_PERF__?.report === 'function');
  await page.evaluate(() => window.__ABYSS_PERF__?.clear());

  await page.keyboard.down('KeyS');
  await page.keyboard.down('ShiftLeft');
  await page.waitForTimeout(30_000);
  await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('KeyS');

  const report = await page.evaluate(() => window.__ABYSS_PERF__?.report()) as RenderReport;
  const outputDirectory = resolve(process.cwd(), 'artifacts/performance');
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    resolve(outputDirectory, 'deep-dive-profile.json'),
    `${JSON.stringify({ report }, null, 2)}\n`,
    'utf8',
  );

  expect(report.frameCount).toBeGreaterThan(60);
  expect(report.metrics.drawCalls.maximum).toBeGreaterThan(0);
  expect(report.metrics.staticMeshChunks.maximum).toBeGreaterThan(0);
  expect(report.metrics.chunkSyncMs.p95).toBeLessThan(80);
  expect(report.metrics.worldMs.p95).toBeLessThan(80);
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
