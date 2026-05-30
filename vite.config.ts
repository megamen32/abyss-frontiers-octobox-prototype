import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { buildBenchmarkMarkdown, sanitizeLabel } from './src/benchmark/reportUtils'
import type { BenchmarkSessionReport } from './src/benchmark/reportTypes'

export default defineConfig({
  base: process.env.BASE_URL || '/abyss-frontiers-octobox-prototype/',
  server: {
    host: '127.0.0.1',
    port: 4173,
  },
  plugins: [
    {
      name: 'iphone-benchmark-report-writer',
      configureServer(server) {
        server.middlewares.use('/__benchmark__/report', async (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify({ ok: false, error: `Method ${req.method} not allowed` }))
            return
          }
          try {
            const body = await readRequestBody(req)
            const report = JSON.parse(body) as BenchmarkSessionReport
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
            const label = sanitizeLabel(report.sessionLabel || report.device.platform || 'iphone')
            const directory = resolve(process.cwd(), 'artifacts/performance/iphone', `${timestamp}-${label}`)
            await mkdir(directory, { recursive: true })
            await writeFile(resolve(directory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
            await writeFile(resolve(directory, 'summary.md'), buildBenchmarkMarkdown(report), 'utf8')
            res.statusCode = 200
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify({ ok: true, directory }))
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            res.statusCode = 500
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify({ ok: false, error: message }))
          }
        })
      },
    },
  ],
})

function readRequestBody(req: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}
