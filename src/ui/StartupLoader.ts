import '../loading.css';

export class StartupLoader {
  readonly root = document.createElement('div');
  private readonly subtitle = document.createElement('div');
  private startedAt = performance.now();
  private done = false;

  constructor(parent: HTMLElement) {
    this.root.className = 'startup-loader';
    this.root.innerHTML = `
      <div class="loader-card" aria-live="polite">
        <svg class="loader-ship" viewBox="0 0 160 100" role="img" aria-label="Loading ship">
          <path class="sail" d="M78 12 L78 58 L35 58 Z" />
          <path class="sail" d="M86 20 L86 60 L124 60 Z" />
          <path class="hull" d="M24 63 C37 81 117 82 136 63 Z" />
          <path class="hull" d="M78 12 L78 64" />
          <path class="wake" d="M26 88 C45 80 61 96 80 88 C99 80 115 96 134 88" />
        </svg>
        <div class="loader-title">Abyss</div>
        <div class="loader-subtitle">building octree terrain</div>
        <div class="loader-bar" />
      </div>
    `;
    const subtitle = this.root.querySelector('.loader-subtitle');
    if (subtitle instanceof HTMLDivElement) {
      this.subtitle.replaceWith(subtitle);
      (this as { subtitle: HTMLDivElement }).subtitle = subtitle;
    }
    parent.append(this.root);
  }

  setStatus(text: string): void {
    if (!this.done) {
      this.subtitle.textContent = text;
    }
  }

  finish(minVisibleMs = 900): void {
    if (this.done) return;
    this.done = true;
    const elapsed = performance.now() - this.startedAt;
    window.setTimeout(() => {
      this.root.classList.add('done');
      window.setTimeout(() => this.root.remove(), 460);
    }, Math.max(0, minVisibleMs - elapsed));
  }
}
