import type { ChunkCoord, DebugTimingSnapshot } from '../types';
import type { RuntimeFlightTuning } from '../simulation/runtimeTuning';

interface HudSnapshot {
  hp: number;
  loot: number;
  fps: number;
  seed: number;
  coord: ChunkCoord;
  distance: number;
  depth: number;
  speed: number;
  stallAmount: number;
  driftAngleDeg: number;
  dangerLevel: number;
  depthBand: string;
  dangerAccent: string;
  tuning: RuntimeFlightTuning;
  debugEnabled: boolean;
  chunkDebugEnabled: boolean;
  fogEnabled: boolean;
  spawnBudget: number;
  averageFps: number;
  timings: DebugTimingSnapshot;
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
    speed: document.createElement('span'),
    drift: document.createElement('span'),
  };
  private readonly depthBand = document.createElement('span');
  private readonly dangerValue = document.createElement('span');
  private readonly stallValue = document.createElement('span');
  private readonly tuningReadout = document.createElement('div');
  private readonly timingReadout = document.createElement('div');
  private readonly depthGaugeFill = document.createElement('div');
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
    const depthOverview = document.createElement('div');
    depthOverview.className = 'depth-overview';
    depthOverview.innerHTML = `
      <div class="depth-readout">
        <span class="depth-kicker">Depth Band</span>
      </div>
      <div class="danger-readout">
        <span class="depth-kicker">Hazard</span>
      </div>
      <div class="depth-gauge">
        <div class="depth-gauge-track"></div>
      </div>
    `;
    depthOverview.querySelector('.depth-readout')?.append(this.depthBand, this.stats.depth);
    depthOverview.querySelector('.danger-readout')?.append(this.dangerValue, this.stallValue);
    this.depthGaugeFill.className = 'depth-gauge-fill';
    depthOverview.querySelector('.depth-gauge')?.append(this.depthGaugeFill);
    const stats = document.createElement('div');
    stats.className = 'stats';
    stats.append(
      this.stat('HP', this.stats.hp),
      this.stat('Loot', this.stats.loot),
      this.stat('FPS', this.stats.fps),
      this.stat('Seed', this.stats.seed),
      this.stat('Speed', this.stats.speed),
      this.stat('Drift', this.stats.drift),
      this.stat('Chunk', this.stats.coord),
      this.stat('Distance', this.stats.distance),
    );
    panel.append(depthOverview, stats);

    const controls = document.createElement('div');
    controls.className = 'controls';
    this.restartButton.textContent = 'Restart';
    this.restartButton.addEventListener('click', () => this.onRestart?.());
    this.debugButton.className = 'secondary';
    this.debugButton.addEventListener('click', () => this.onToggleDebug?.());
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'A/D yaw the thrust, W/S pitch it, inertia keeps the hull drifting, hard deflections can stall the flow. Z toggles debug, C toggles chunk debug, F toggles fog.';
    this.tuningReadout.className = 'tuning-readout';
    this.timingReadout.className = 'tuning-readout';
    controls.append(this.restartButton, this.debugButton, hint, this.tuningReadout, this.timingReadout);

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
    this.stats.depth.textContent = `${Math.max(0, snapshot.depth).toFixed(0)} m`;
    this.stats.speed.textContent = `${snapshot.speed.toFixed(1)}`;
    this.stats.drift.textContent = `${snapshot.driftAngleDeg.toFixed(0)}°`;
    this.depthBand.textContent = snapshot.depthBand;
    this.dangerValue.textContent = `${Math.round(snapshot.dangerLevel * 100)}%`;
    this.stallValue.textContent = snapshot.stallAmount >= 0.7 ? 'STALL' : snapshot.stallAmount >= 0.35 ? 'SLIP' : 'FLOW';
    this.stallValue.className = snapshot.stallAmount >= 0.7 ? 'stall-warning hot' : snapshot.stallAmount >= 0.35 ? 'stall-warning warm' : 'stall-warning calm';
    this.depthGaugeFill.style.setProperty('--depth-fill', `${(snapshot.dangerLevel * 100).toFixed(1)}%`);
    this.depthGaugeFill.style.setProperty('--depth-accent', snapshot.dangerAccent);
    this.debugButton.textContent = snapshot.debugEnabled ? 'Hide Debug' : 'Show Debug';
    this.tuningReadout.textContent =
      `Accel +/- ${snapshot.tuning.baseAcceleration.toFixed(1)}  Drag [] ${snapshot.tuning.baseDrag.toFixed(2)}`
      + `  Turn ;' ${snapshot.tuning.turnInputSpeed.toFixed(2)}  Spawn/frame ${snapshot.spawnBudget}`
      + `  Avg FPS ${snapshot.averageFps.toFixed(1)}  Chunk Debug ${snapshot.chunkDebugEnabled ? 'ON' : 'OFF'}`
      + `  Fog ${snapshot.fogEnabled ? 'ON' : 'OFF'}`
      + `  Calls ${snapshot.timings.drawCalls.toFixed(0)}  Tris ${snapshot.timings.drawTriangles.toFixed(0)}`;
    this.timingReadout.textContent =
      `Frame ${snapshot.timings.frameMs.toFixed(1)}ms  Input ${snapshot.timings.inputMs.toFixed(1)}`
      + `  Sim ${snapshot.timings.simulationMs.toFixed(1)}  Sync ${snapshot.timings.chunkSyncMs.toFixed(1)}`
      + `  World ${snapshot.timings.worldMs.toFixed(1)}  Render ${snapshot.timings.renderMs.toFixed(1)}`
      + `  Hydrate ${snapshot.timings.hydrateMs.toFixed(1)}  ReadyQ ${snapshot.timings.readyQueueMs.toFixed(1)}`
      + `  Worker ${snapshot.timings.workerTotalMs.toFixed(1)}  Octo ${snapshot.timings.workerOctoboxMs.toFixed(1)}`
      + `  Serialize ${snapshot.timings.workerSerializeMs.toFixed(1)}`
      + `  Lines ${snapshot.timings.drawLines.toFixed(0)}  Points ${snapshot.timings.drawPoints.toFixed(0)}`;
    this.timingReadout.textContent +=
      `  SpawnQ ${snapshot.timings.renderSpawnQueueMs.toFixed(1)}  MeshUpd ${snapshot.timings.renderChunkUpdateMs.toFixed(1)}`
      + `  Debug ${snapshot.timings.renderDebugMs.toFixed(1)}  CamHUD ${snapshot.timings.renderHudCameraMs.toFixed(1)}`
      + `  Draw ${snapshot.timings.renderDrawMs.toFixed(1)}`;
    this.tuningReadout.style.display = snapshot.debugEnabled ? 'block' : 'none';
    this.timingReadout.style.display = snapshot.debugEnabled ? 'block' : 'none';

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
