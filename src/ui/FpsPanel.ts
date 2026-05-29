export class FpsPanel {
  readonly root: HTMLDivElement
  private readonly titleEl = document.createElement('div')
  private readonly statsEl = document.createElement('div')
  private readonly canvas = document.createElement('canvas')
  private readonly ctx: CanvasRenderingContext2D
  private readonly samples: number[] = []
  private maxSamples = 120

  constructor(title = 'FPS') {
    this.root = document.createElement('div')
    this.root.className = 'fps-panel'
    this.titleEl.className = 'fps-title'
    this.titleEl.textContent = title
    this.statsEl.className = 'fps-stats'
    this.canvas.className = 'fps-canvas'
    this.canvas.width = 220
    this.canvas.height = 64
    const ctx = this.canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas context not available')
    this.ctx = ctx
    this.root.append(this.titleEl, this.statsEl, this.canvas)
    this.renderStats(0, 0, 0, 0)
    this.draw()
  }

  setTitle(title: string): void {
    this.titleEl.textContent = title
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? 'block' : 'none'
  }

  record(fps: number): void {
    this.samples.push(fps)
    if (this.samples.length > this.maxSamples) {
      this.samples.shift()
    }
    let min = Infinity
    let max = -Infinity
    let sum = 0
    for (let i = 0; i < this.samples.length; i++) {
      const v = this.samples[i]
      sum += v
      if (v < min) min = v
      if (v > max) max = v
    }
    const current = this.samples[this.samples.length - 1] ?? 0
    const avg = this.samples.length > 0 ? sum / this.samples.length : 0
    this.renderStats(current, avg, min === Infinity ? 0 : min, max === -Infinity ? 0 : max)
    this.draw()
  }

  private renderStats(current: number, avg: number, min: number, max: number): void {
    this.statsEl.textContent = `${current.toFixed(0)} now  ${avg.toFixed(1)} avg  ${min.toFixed(0)} min  ${max.toFixed(0)} max`
  }

  private draw(): void {
    const { ctx } = this
    const w = this.canvas.width
    const h = this.canvas.height
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = 'rgba(3, 12, 22, 0.82)'
    ctx.fillRect(0, 0, w, h)
    ctx.strokeStyle = 'rgba(111, 209, 255, 0.12)'
    ctx.lineWidth = 1
    for (let i = 1; i <= 3; i++) {
      const y = (h / 4) * i
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
      ctx.stroke()
    }
    if (this.samples.length < 2) {
      return
    }
    let maxFps = 0
    for (let i = 0; i < this.samples.length; i++) {
      if (this.samples[i] > maxFps) maxFps = this.samples[i]
    }
    maxFps = Math.max(maxFps, 60)
    ctx.strokeStyle = '#6fe7ff'
    ctx.lineWidth = 2
    ctx.beginPath()
    for (let i = 0; i < this.samples.length; i++) {
      const x = this.samples.length === 1 ? 0 : (i / (this.samples.length - 1)) * (w - 1)
      const y = h - (this.samples[i] / maxFps) * (h - 4) - 2
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
}
