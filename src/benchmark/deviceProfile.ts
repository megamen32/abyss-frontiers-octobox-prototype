import type { WebGLRenderer } from 'three'
import type { BenchmarkDeviceProfile } from './reportTypes'

type NavigatorWithExtras = Navigator & {
  deviceMemory?: number
}

export async function collectBenchmarkDeviceProfile(renderer: WebGLRenderer): Promise<BenchmarkDeviceProfile> {
  const nav = navigator as NavigatorWithExtras
  const gl = renderer.getContext()
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info')
  const adapter = nav.gpu ? await nav.gpu.requestAdapter().catch(() => null) : null
  const adapterInfo = await readAdapterInfo(adapter)
  return {
    capturedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    languages: [...navigator.languages],
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    deviceMemoryGb: nav.deviceMemory ?? null,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    cookieEnabled: navigator.cookieEnabled,
    online: navigator.onLine,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    },
    screen: {
      width: window.screen.width,
      height: window.screen.height,
      availWidth: window.screen.availWidth,
      availHeight: window.screen.availHeight,
      colorDepth: window.screen.colorDepth,
      pixelDepth: window.screen.pixelDepth,
      orientation: window.screen.orientation?.type ?? 'unknown',
    },
    webgl: {
      vendor: debugInfo ? String(gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)) : null,
      renderer: debugInfo ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)) : null,
      version: String(gl.getParameter(gl.VERSION)),
      shadingLanguageVersion: String(gl.getParameter(gl.SHADING_LANGUAGE_VERSION)),
      maxTextureSize: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)),
      maxRenderbufferSize: Number(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)),
      antialias: gl.getContextAttributes()?.antialias ?? false,
    },
    webgpu: {
      available: adapter !== null,
      adapterInfo,
    },
  }
}

async function readAdapterInfo(adapter: GPUAdapter | null): Promise<Record<string, string | number | boolean | null>> {
  if (!adapter) {
    return {}
  }
  const adapterWithInfo = adapter as GPUAdapter & { requestAdapterInfo?: () => Promise<GPUAdapterInfo> }
  const info = typeof adapterWithInfo.requestAdapterInfo === 'function'
    ? await adapterWithInfo.requestAdapterInfo().catch(() => adapter.info)
    : adapter.info
  return Object.fromEntries(
    Object.entries(info).filter((entry): entry is [string, string | number | boolean | null] => (
      typeof entry[1] === 'string'
      || typeof entry[1] === 'number'
      || typeof entry[1] === 'boolean'
      || entry[1] === null
    )),
  )
}
