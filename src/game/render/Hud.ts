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
  debugUiVisible: boolean;
  chunkDebugEnabled: boolean;
  fogEnabled: boolean;
  spawnBudget: number;
  averageFps: number;
  timings: DebugTimingSnapshot;
  dead: boolean;
  paused: boolean;
}

export class Hud {
  private readonly root: HTMLDivElement;

  private readonly depthValue = document.createElement('span');
  private readonly depthBandEl = document.createElement('span');
  private readonly depthGaugeFill = document.createElement('div');
  private readonly hpValue = document.createElement('span');
  private readonly hpGaugeFill = document.createElement('div');
  private readonly stallValue = document.createElement('span');
  private readonly lootValue = document.createElement('span');

  private readonly debugPanel = document.createElement('div');
  private readonly debugContent = document.createElement('div');
  private readonly debugTimings = document.createElement('div');
  private readonly debugTuning = document.createElement('div');
  private readonly keyHints = document.createElement('div');

  private readonly restartButton = document.createElement('button');
  private readonly deathOverlay = document.createElement('div');
  private readonly pauseOverlay = document.createElement('div');

  private onRestart: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud';

    const topLeft = document.createElement('div');
    topLeft.className = 'hud-tl';

    const playerCard = document.createElement('div');
    playerCard.className = 'player-card';

    const gauges = document.createElement('div');
    gauges.className = 'gauges';

    const depthCol = document.createElement('div');
    depthCol.className = 'gauge-col';
    this.depthValue.className = 'gauge-value depth-val';
    this.depthBandEl.className = 'gauge-sub';
    const depthGauge = document.createElement('div');
    depthGauge.className = 'mini-gauge';
    this.depthGaugeFill.className = 'mini-gauge-fill';
    depthGauge.append(this.depthGaugeFill);
    depthCol.append(this.depthValue, this.depthBandEl, depthGauge);

    const hpCol = document.createElement('div');
    hpCol.className = 'gauge-col';
    this.hpValue.className = 'gauge-value hp-val';
    const hpLabel = document.createElement('span');
    hpLabel.className = 'gauge-sub';
    hpLabel.textContent = 'HP';
    const hpGauge = document.createElement('div');
    hpGauge.className = 'mini-gauge';
    this.hpGaugeFill.className = 'mini-gauge-fill hp-fill';
    hpGauge.append(this.hpGaugeFill);
    hpCol.append(this.hpValue, hpLabel, hpGauge);

    const stallCol = document.createElement('div');
    stallCol.className = 'gauge-col stall-col';
    this.stallValue.className = 'stall-badge calm';

    const lootCol = document.createElement('div');
    lootCol.className = 'gauge-col loot-col';
    this.lootValue.className = 'gauge-value loot-val';
    const lootLabel = document.createElement('span');
    lootLabel.className = 'gauge-sub';
    lootLabel.textContent = 'Loot';
    lootCol.append(this.lootValue, lootLabel);

    gauges.append(depthCol, hpCol, stallCol, lootCol);
    playerCard.append(gauges);

    this.debugPanel.className = 'debug-panel';
    this.debugContent.className = 'debug-content';
    this.debugTimings.className = 'debug-line';
    this.debugTuning.className = 'debug-line';
    this.debugPanel.append(this.debugContent, this.debugTimings, this.debugTuning);

    this.keyHints.className = 'key-hints';
    this.keyHints.textContent = 'Z debug  U this panel  C chunks  F fog  R restart  +/- accel  [/] drag  ;/\' turn  P pause';

    topLeft.append(playerCard, this.debugPanel, this.keyHints);

    const bottomRight = document.createElement('div');
    bottomRight.className = 'hud-br';
    this.restartButton.className = 'restart-btn';
    this.restartButton.textContent = 'Restart';
    this.restartButton.addEventListener('click', () => this.onRestart?.());
    bottomRight.append(this.restartButton);

    this.deathOverlay.className = 'death-overlay';
    this.deathOverlay.style.display = 'none';
    this.deathOverlay.innerHTML = `
      <div class="death-card">
        <h2>Run Lost</h2>
        <p>The abyss kept the hull.</p>
        <div class="death-stats"></div>
        <button>Restart</button>
      </div>
    `;
    this.deathOverlay.querySelector('button')?.addEventListener('click', () => this.onRestart?.());

    this.pauseOverlay.className = 'pause-overlay';
    this.pauseOverlay.style.display = 'none';
    this.pauseOverlay.innerHTML = `
      <div class="pause-card">
        <h2>Paused</h2>
        <p>Press Escape to resume</p>
      </div>
    `;

    this.root.append(topLeft, bottomRight, this.deathOverlay, this.pauseOverlay);
    parent.append(this.root);
  }

  setCallbacks(callbacks: { onRestart: () => void }): void {
    this.onRestart = callbacks.onRestart;
  }

  render(s: HudSnapshot): void {
    this.depthValue.textContent = `${Math.max(0, s.depth).toFixed(0)}m`;
    this.depthBandEl.textContent = s.depthBand;
    this.depthGaugeFill.style.setProperty('--fill', `${(s.dangerLevel * 100).toFixed(1)}%`);
    this.depthGaugeFill.style.setProperty('--accent', s.dangerAccent);

    const hpPct = Math.max(0, Math.min(100, s.hp));
    this.hpValue.textContent = `${Math.round(s.hp)}`;
    this.hpGaugeFill.style.setProperty('--fill', `${hpPct}%`);
    this.hpValue.style.color = s.hp <= 30 ? '#ff8f6a' : s.hp <= 60 ? '#ffd071' : '';

    const stall = s.stallAmount;
    this.stallValue.textContent = stall >= 0.7 ? 'STALL' : stall >= 0.35 ? 'SLIP' : '';
    this.stallValue.className = 'stall-badge ' + (stall >= 0.7 ? 'hot' : stall >= 0.35 ? 'warm' : 'calm');

    this.lootValue.textContent = `${s.loot}`;

    const showDebug = s.debugEnabled && s.debugUiVisible;
    this.debugPanel.style.display = showDebug ? 'block' : 'none';
    this.keyHints.style.display = s.debugEnabled ? 'block' : 'none';

    if (showDebug) {
      this.debugContent.textContent =
        `${s.fps.toFixed(0)} fps  ` +
        `${s.speed.toFixed(1)} spd  ` +
        `${s.driftAngleDeg.toFixed(0)}° drift  ` +
        `seed ${s.seed}  ` +
        `chunk ${s.coord.x},${s.coord.y},${s.coord.z}  ` +
        `dist ${s.distance.toFixed(1)}  ` +
        `budget ${s.spawnBudget}  ` +
        `avg ${s.averageFps.toFixed(1)}  ` +
        `fog ${s.fogEnabled ? 'ON' : 'OFF'}  ` +
        `chunkdbg ${s.chunkDebugEnabled ? 'ON' : 'OFF'}`;
      this.debugTimings.textContent =
        `frame ${s.timings.frameMs.toFixed(1)}  ` +
        `sim ${s.timings.simulationMs.toFixed(1)}  ` +
        `sync ${s.timings.chunkSyncMs.toFixed(1)}  ` +
        `render ${s.timings.renderMs.toFixed(1)}  ` +
        `calls ${s.timings.drawCalls}  ` +
        `tris ${s.timings.drawTriangles}  ` +
        `chunks ${s.timings.visibleChunks}  ` +
        `worker ${s.timings.workerTotalMs.toFixed(1)}`;
      this.debugTuning.textContent =
        `accel ${s.tuning.baseAcceleration.toFixed(1)}  ` +
        `drag ${s.tuning.baseDrag.toFixed(2)}  ` +
        `turn ${s.tuning.turnInputSpeed.toFixed(2)}  ` +
        `octo ${s.timings.workerOctoboxMs.toFixed(1)}  ` +
        `mesh ${s.timings.workerStaticMeshMs.toFixed(1)}`;
    }

    const deathStats = this.deathOverlay.querySelector('.death-stats');
    if (deathStats) {
      deathStats.innerHTML = `Loot: ${s.loot}<br>Depth: ${Math.max(0, s.depth).toFixed(0)}m<br>Distance: ${s.distance.toFixed(1)}`;
    }
    this.deathOverlay.style.display = s.dead ? 'grid' : 'none';
    this.pauseOverlay.style.display = s.paused && !s.dead ? 'grid' : 'none';
  }
}
