import type { ChunkCoord } from '../types';

interface HudSnapshot {
  hp: number;
  loot: number;
  fps: number;
  seed: number;
  coord: ChunkCoord;
  distance: number;
  depth: number;
  debugEnabled: boolean;
  dead: boolean;
}

export class Hud {
  private readonly root: HTMLDivElement;
  private readonly stats = {
    hp: document.createElement('span'),
    loot: document.createElement('span'),
    fps: document.createElement('span'),
    seed: document.createElement('span'),
    coord: document.createElement('span'),
    distance: document.createElement('span'),
    depth: document.createElement('span'),
  };
  private readonly debugButton = document.createElement('button');
  private readonly restartButton = document.createElement('button');
  private readonly deathOverlay = document.createElement('div');
  private onRestart: (() => void) | null = null;
  private onToggleDebug: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud';

    const top = document.createElement('div');
    top.className = 'hud-top';

    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = '<h1>Abyss Frontiers</h1>';
    const stats = document.createElement('div');
    stats.className = 'stats';
    stats.append(
      this.stat('HP', this.stats.hp),
      this.stat('Loot', this.stats.loot),
      this.stat('FPS', this.stats.fps),
      this.stat('Seed', this.stats.seed),
      this.stat('Chunk', this.stats.coord),
      this.stat('Distance', this.stats.distance),
      this.stat('Depth', this.stats.depth),
    );
    panel.append(stats);

    const controls = document.createElement('div');
    controls.className = 'controls';
    this.restartButton.textContent = 'Restart';
    this.restartButton.addEventListener('click', () => this.onRestart?.());
    this.debugButton.className = 'secondary';
    this.debugButton.addEventListener('click', () => this.onToggleDebug?.());
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'Click to steer. Ship keeps cruising, Shift boosts, F1 toggles debug.';
    controls.append(this.restartButton, this.debugButton, hint);

    top.append(panel, controls);

    const bottom = document.createElement('div');
    bottom.className = 'hud-bottom';
    const status = document.createElement('div');
    status.className = 'status-strip';
    status.textContent = 'Click the viewport to lock cursor and steer the camera.';
    bottom.append(status);

    this.deathOverlay.className = 'death-overlay';
    this.deathOverlay.style.display = 'none';
    this.deathOverlay.innerHTML = `
      <div class="death-card">
        <h2>Run Lost</h2>
        <p>The abyss kept the hull. Restart to replay the same deterministic seed.</p>
        <div class="death-stats"></div>
        <button>Restart Run</button>
      </div>
    `;
    this.deathOverlay.querySelector('button')?.addEventListener('click', () => this.onRestart?.());

    this.root.append(top, bottom, this.deathOverlay);
    parent.append(this.root);
  }

  setCallbacks(callbacks: { onRestart: () => void; onToggleDebug: () => void }): void {
    this.onRestart = callbacks.onRestart;
    this.onToggleDebug = callbacks.onToggleDebug;
  }

  render(snapshot: HudSnapshot): void {
    this.stats.hp.textContent = `${snapshot.hp}`;
    this.stats.loot.textContent = `${snapshot.loot}`;
    this.stats.fps.textContent = `${snapshot.fps.toFixed(0)}`;
    this.stats.seed.textContent = `${snapshot.seed}`;
    this.stats.coord.textContent = `${snapshot.coord.x}, ${snapshot.coord.y}, ${snapshot.coord.z}`;
    this.stats.distance.textContent = `${snapshot.distance.toFixed(1)}`;
    this.stats.depth.textContent = `${snapshot.depth.toFixed(1)}`;
    this.debugButton.textContent = snapshot.debugEnabled ? 'Hide Debug' : 'Show Debug';

    const deathStats = this.deathOverlay.querySelector('.death-stats');
    if (deathStats) {
      deathStats.innerHTML = `Loot: ${snapshot.loot}<br>Distance: ${snapshot.distance.toFixed(1)}<br>Seed: ${snapshot.seed}`;
    }
    this.deathOverlay.style.display = snapshot.dead ? 'grid' : 'none';
  }

  private stat(label: string, valueNode: HTMLElement): HTMLElement {
    const wrapper = document.createElement('div');
    const labelNode = document.createElement('strong');
    labelNode.textContent = label;
    wrapper.append(labelNode, valueNode);
    return wrapper;
  }
}
