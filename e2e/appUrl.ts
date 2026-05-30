import { resolve } from 'node:path'

export function appUrl(path = '/'): string {
  if (process.env.ABYSS_RENDER_MODE === 'file') {
    const suffix = path.startsWith('/?') ? path.slice(1) : ''
    return `file://${resolve(process.cwd(), 'dist/index.html')}${suffix}`
  }
  return path
}
