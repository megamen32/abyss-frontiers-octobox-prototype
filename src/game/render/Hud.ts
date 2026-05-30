import { GAME_CONFIG } from '../config';
import type { ChunkCoord, DebugTimingSnapshot } from '../types';
import type { RuntimeFlightTuning } from '../simulation/runtimeTuning';
import type { BoidsDebugStats } from '../../boids/BoidsTypes';
import { FpsPanel } from '../../ui/FpsPanel';

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
  boidsDebugVisible: boolean;
  spawnBudget: number;
  averageFps: number;
  timings: DebugTimingSnapshot;
  dead: boolean;
  paused: boolean;
  boidsDebug?: BoidsDebugStats;
  autopilot: boolean;
  virtualJoystickEnabled: boolean;
}

const JS_DEADZONE = GAME_CONFIG.virtualJoystick.deadzone;
const JS_MAX_TRAVEL = GAME_CONFIG.virtualJoystick.maxTravel;

export class Hud {
  readonly root: HTMLDivElement;
  /** Normalised joystick axes, updated every touch frame. */
  joystickForward = 0;
  joystickRight = 0;
  joystickVertical = 0;

  private readonly depthValue = document.createElement('span');
  private readonly depthBandEl = document.createElement('span');
  private readonly depthGaugeFill = document.createElement('div');
  private readonly hpValue = document.createElement('span');
  private readonly hpGaugeFill = document.createElement('div');
  private readonly stallValue = document.createElement('span');
  private readonly lootValue = document.createElement('span');

  private readonly debugPanel = document.createElement('div');
  private readonly fpsPanel = new FpsPanel();
  private readonly debugContent = document.createElement('div');
  private readonly debugTimings = document.createElement('div');
  private readonly debugTuning = document.createElement('div');
  private readonly debugBoids = document.createElement('div');
  private readonly debugShipLabel = document.createElement('div');
  private readonly debugPerfLabel = document.createElement('div');
  private readonly debugTuneLabel = document.createElement('div');
  private readonly debugBoidLabel = document.createElement('div');
  private readonly keyHints = document.createElement('div');

  private readonly restartButton = document.createElement('button');
  private readonly menuButton = document.createElement('button');
  private readonly deathOverlay = document.createElement('div');
  private readonly pauseOverlay = document.createElement('div');
  private debugMenuToggle!: HTMLInputElement;
  private fpsMenuToggle!: HTMLInputElement;
  private chunkMenuToggle!: HTMLInputElement;
  private fogMenuToggle!: HTMLInputElement;
  private boidsMenuToggle!: HTMLInputElement;
  private autopilotMenuToggle!: HTMLInputElement;
  private joystickMenuToggle!: HTMLInputElement;
  private readonly joystickEl = document.createElement('div');
  private readonly joystickThumb = document.createElement('div');
  private readonly verticalUpBtn = document.createElement('button');
  private readonly verticalDownBtn = document.createElement('button');

  private onRestart: (() => void) | null = null;
  private onPause: (() => void) | null = null;
  private onToggleJoystick: ((enabled: boolean) => void) | null = null;
  private onToggleDebug: ((enabled: boolean) => void) | null = null;
  private onToggleFps: ((enabled: boolean) => void) | null = null;
  private onToggleChunks: ((enabled: boolean) => void) | null = null;
  private onToggleFog: ((enabled: boolean) => void) | null = null;
  private onToggleBoidsDebug: ((enabled: boolean) => void) | null = null;
  private onToggleAutopilot: ((enabled: boolean) => void) | null = null;
  private joystickTouchId: number | null = null;
  private joystickBaseRect: DOMRect | null = null;
  private joystickVisible = false;

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
    this.debugContent.className = 'debug-line';
    this.debugTimings.className = 'debug-line';
    this.debugTuning.className = 'debug-line';
    this.debugBoids.className = 'debug-line';
    this.debugShipLabel.className = 'debug-label';
    this.debugShipLabel.textContent = 'SHIP';
    this.debugPerfLabel.className = 'debug-label';
    this.debugPerfLabel.textContent = 'PERF';
    this.debugTuneLabel.className = 'debug-label';
    this.debugTuneLabel.textContent = 'TUNE';
    this.debugBoidLabel.className = 'debug-label';
    this.debugBoidLabel.textContent = 'BOID';
    this.debugPanel.append(this.fpsPanel.root, this.debugShipLabel, this.debugContent, this.debugPerfLabel, this.debugTimings, this.debugTuneLabel, this.debugTuning, this.debugBoidLabel, this.debugBoids);

    this.keyHints.className = 'key-hints';
    this.keyHints.textContent = 'Z debug  U this panel  C chunks  F fog  R restart  +/- accel  [/] drag  ;/\' turn  Esc pause  B autopilot';

    topLeft.append(playerCard, this.debugPanel, this.keyHints);

    const bottomRight = document.createElement('div');
    bottomRight.className = 'hud-br';

    this.menuButton.className = 'menu-btn';
    this.menuButton.textContent = 'Menu';
    this.menuButton.addEventListener('click', () => this.onPause?.());

    this.restartButton.className = 'restart-btn';
    this.restartButton.textContent = 'Restart';
    this.restartButton.addEventListener('click', () => this.onRestart?.());
    bottomRight.append(this.menuButton, this.restartButton);

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
        <div class="pause-menu-grid">
          <label class="menu-row">
            <span>Debug</span>
            <input type="checkbox" class="menu-toggle debug-toggle" />
          </label>
          <label class="menu-row">
            <span>FPS Panel</span>
            <input type="checkbox" class="menu-toggle fps-toggle" />
          </label>
          <label class="menu-row">
            <span>Chunk Bounds</span>
            <input type="checkbox" class="menu-toggle chunk-toggle" />
          </label>
          <label class="menu-row">
            <span>Fog</span>
            <input type="checkbox" class="menu-toggle fog-toggle" />
          </label>
          <label class="menu-row">
            <span>Boids/LOD</span>
            <input type="checkbox" class="menu-toggle boids-toggle" />
          </label>
          <label class="menu-row">
            <span>Autopilot</span>
            <input type="checkbox" class="menu-toggle autopilot-toggle" />
          </label>
        </div>
        <label class="menu-row">
          <span>Virtual Joystick</span>
          <input type="checkbox" class="menu-toggle joystick-toggle" checked />
        </label>
      </div>
    `;

    this.joystickEl.className = 'joystick-base';
    this.joystickThumb.className = 'joystick-thumb';
    this.joystickEl.append(this.joystickThumb);

    this.verticalUpBtn.className = 'vertical-btn up';
    this.verticalUpBtn.textContent = '▲';
    this.verticalDownBtn.className = 'vertical-btn down';
    this.verticalDownBtn.textContent = '▼';

    this.root.append(topLeft, bottomRight, this.deathOverlay, this.pauseOverlay, this.joystickEl, this.verticalUpBtn, this.verticalDownBtn);
    parent.append(this.root);

    this.debugMenuToggle = this.requirePauseToggle('.debug-toggle');
    this.fpsMenuToggle = this.requirePauseToggle('.fps-toggle');
    this.chunkMenuToggle = this.requirePauseToggle('.chunk-toggle');
    this.fogMenuToggle = this.requirePauseToggle('.fog-toggle');
    this.boidsMenuToggle = this.requirePauseToggle('.boids-toggle');
    this.autopilotMenuToggle = this.requirePauseToggle('.autopilot-toggle');
    this.joystickMenuToggle = this.requirePauseToggle('.joystick-toggle');
    this.debugMenuToggle.addEventListener('change', () => this.onToggleDebug?.(this.debugMenuToggle.checked));
    this.fpsMenuToggle.addEventListener('change', () => this.onToggleFps?.(this.fpsMenuToggle.checked));
    this.chunkMenuToggle.addEventListener('change', () => this.onToggleChunks?.(this.chunkMenuToggle.checked));
    this.fogMenuToggle.addEventListener('change', () => this.onToggleFog?.(this.fogMenuToggle.checked));
    this.boidsMenuToggle.addEventListener('change', () => this.onToggleBoidsDebug?.(this.boidsMenuToggle.checked));
    this.autopilotMenuToggle.addEventListener('change', () => this.onToggleAutopilot?.(this.autopilotMenuToggle.checked));
    this.joystickMenuToggle.addEventListener('change', () => {
      this.setJoystickVisible(this.joystickMenuToggle.checked);
      this.onToggleJoystick?.(this.joystickMenuToggle.checked);
    });

    this.setupJoystickTouch();
    this.setupVerticalButtons();
  }

  setCallbacks(callbacks: {
    onRestart: () => void;
    onPause?: () => void;
    onToggleJoystick?: (enabled: boolean) => void;
    onToggleDebug?: (enabled: boolean) => void;
    onToggleFps?: (enabled: boolean) => void;
    onToggleChunks?: (enabled: boolean) => void;
    onToggleFog?: (enabled: boolean) => void;
    onToggleBoidsDebug?: (enabled: boolean) => void;
    onToggleAutopilot?: (enabled: boolean) => void;
  }): void {
    this.onRestart = callbacks.onRestart;
    this.onPause = callbacks.onPause ?? null;
    this.onToggleJoystick = callbacks.onToggleJoystick ?? null;
    this.onToggleDebug = callbacks.onToggleDebug ?? null;
    this.onToggleFps = callbacks.onToggleFps ?? null;
    this.onToggleChunks = callbacks.onToggleChunks ?? null;
    this.onToggleFog = callbacks.onToggleFog ?? null;
    this.onToggleBoidsDebug = callbacks.onToggleBoidsDebug ?? null;
    this.onToggleAutopilot = callbacks.onToggleAutopilot ?? null;
  }

  setJoystickVisible(visible: boolean): void {
    this.joystickVisible = visible;
    this.joystickEl.style.display = visible ? 'block' : 'none';
    this.verticalUpBtn.style.display = visible ? 'block' : 'none';
    this.verticalDownBtn.style.display = visible ? 'block' : 'none';
    this.joystickMenuToggle.checked = visible;
  }

  syncMenuToggle(checked: boolean): void {
    this.joystickMenuToggle.checked = checked;
  }

  private requirePauseToggle(selector: string): HTMLInputElement {
    const input = this.pauseOverlay.querySelector(selector);
    if (!(input instanceof HTMLInputElement)) {
      throw new Error(`Missing pause toggle ${selector}`);
    }
    return input;
  }

  private setupJoystickTouch(): void {
    const onStart = (e: TouchEvent) => {
      if (this.joystickTouchId !== null) return;
      for (const touch of e.changedTouches) {
        const rect = this.joystickEl.getBoundingClientRect();
        const cx = rect.left + rect.width * 0.5;
        const cy = rect.top + rect.height * 0.5;
        if (Math.abs(touch.clientX - cx) < rect.width * 0.5 && Math.abs(touch.clientY - cy) < rect.height * 0.5) {
          this.joystickTouchId = touch.identifier;
          this.joystickBaseRect = rect;
          this.updateJoystick(touch);
          e.preventDefault();
          return;
        }
      }
    };
    const onMove = (e: TouchEvent) => {
      if (this.joystickTouchId === null) return;
      for (const touch of e.changedTouches) {
        if (touch.identifier === this.joystickTouchId) {
          this.updateJoystick(touch);
          e.preventDefault();
          return;
        }
      }
    };
    const onEnd = (e: TouchEvent) => {
      if (this.joystickTouchId === null) return;
      for (const touch of e.changedTouches) {
        if (touch.identifier === this.joystickTouchId) {
          this.joystickTouchId = null;
          this.joystickBaseRect = null;
          this.joystickForward = 0;
          this.joystickRight = 0;
          this.joystickThumb.style.transform = 'translate(-50%, -50%)';
          e.preventDefault();
          return;
        }
      }
    };
    this.root.addEventListener('touchstart', onStart, { passive: false });
    this.root.addEventListener('touchmove', onMove, { passive: false });
    this.root.addEventListener('touchend', onEnd);
    this.root.addEventListener('touchcancel', onEnd);
  }

  private updateJoystick(touch: Touch): void {
    const rect = this.joystickBaseRect;
    if (!rect) return;
    const cx = rect.left + rect.width * 0.5;
    const cy = rect.top + rect.height * 0.5;
    let dx = touch.clientX - cx;
    let dy = -(touch.clientY - cy);
    const dist = Math.sqrt(dx * dx + dy * dy);
    const maxDist = JS_MAX_TRAVEL;
    let clampedDist = Math.min(dist, maxDist);
    if (dist > 0.001) {
      const scale = clampedDist / dist;
      dx *= scale;
      dy *= scale;
    }
    this.joystickThumb.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${-dy}px))`;
    let normalX = dx / maxDist;
    let normalY = dy / maxDist;
    const deadLen = Math.sqrt(normalX * normalX + normalY * normalY);
    if (deadLen < JS_DEADZONE) {
      normalX = 0;
      normalY = 0;
    } else {
      const s = (deadLen - JS_DEADZONE) / (1 - JS_DEADZONE);
      normalX = (normalX / deadLen) * s;
      normalY = (normalY / deadLen) * s;
    }
    this.joystickForward = Math.max(-1, Math.min(1, normalY));
    this.joystickRight = Math.max(-1, Math.min(1, -normalX));
  }

  private setupVerticalButtons(): void {
    const pressed = new Set<number>();
    const onStart = (e: TouchEvent) => {
      for (const touch of e.changedTouches) {
        const el = document.elementFromPoint(touch.clientX, touch.clientY);
        if (el === this.verticalUpBtn || this.verticalUpBtn.contains(el)) {
          pressed.add(touch.identifier);
          this.joystickVertical = 1;
          e.preventDefault();
        } else if (el === this.verticalDownBtn || this.verticalDownBtn.contains(el)) {
          pressed.add(touch.identifier);
          this.joystickVertical = -1;
          e.preventDefault();
        }
      }
    };
    const onEnd = (e: TouchEvent) => {
      for (const touch of e.changedTouches) {
        pressed.delete(touch.identifier);
      }
      if (pressed.size === 0) this.joystickVertical = 0;
    };
    this.root.addEventListener('touchstart', onStart, { passive: false });
    this.root.addEventListener('touchend', onEnd);
    this.root.addEventListener('touchcancel', onEnd);
  }

  render(s: HudSnapshot): void {
    if (s.virtualJoystickEnabled !== this.joystickVisible) {
      this.setJoystickVisible(s.virtualJoystickEnabled);
    }
    this.debugMenuToggle.checked = s.debugEnabled;
    this.fpsMenuToggle.checked = s.debugEnabled && s.debugUiVisible;
    this.chunkMenuToggle.checked = s.chunkDebugEnabled;
    this.fogMenuToggle.checked = s.fogEnabled;
    this.boidsMenuToggle.checked = s.boidsDebugVisible;
    this.autopilotMenuToggle.checked = s.autopilot;
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
    this.fpsPanel.record(s.fps);
    this.fpsPanel.setVisible(showDebug);

    if (showDebug) {
      this.debugContent.textContent =
        `${s.speed.toFixed(1)} spd  ` +
        `${s.driftAngleDeg.toFixed(0)}° drift  ` +
        `seed ${s.seed}  ` +
        `chunk ${s.coord.x},${s.coord.y},${s.coord.z}  ` +
        `dist ${s.distance.toFixed(1)}  ` +
        `budget ${s.spawnBudget}  ` +
        `avg ${s.averageFps.toFixed(1)}  ` +
        `fog ${s.fogEnabled ? 'ON' : 'OFF'}  ` +
        `chunkdbg ${s.chunkDebugEnabled ? 'ON' : 'OFF'}  ` +
        `autopilot ${s.autopilot ? 'ON' : 'OFF'}`;
      this.debugTimings.textContent =
        `frame ${s.timings.frameMs.toFixed(1)}  ` +
        `sim ${s.timings.simulationMs.toFixed(1)}  ` +
        `sync ${s.timings.chunkSyncMs.toFixed(1)}  ` +
        `render ${s.timings.renderMs.toFixed(1)}  ` +
        `calls ${s.timings.drawCalls}  ` +
        `tris ${s.timings.drawTriangles}  ` +
        `chunks ${s.timings.visibleChunks}  ` +
        `workers ${s.timings.workerCount}  ` +
        `worker ${s.timings.workerTotalMs.toFixed(1)}`;
      this.debugTuning.textContent =
        `accel ${s.tuning.baseAcceleration.toFixed(1)}  ` +
        `drag ${s.tuning.baseDrag.toFixed(2)}  ` +
        `turn ${s.tuning.turnInputSpeed.toFixed(2)}  ` +
        `octo ${s.timings.workerOctoboxMs.toFixed(1)}  ` +
        `mesh ${s.timings.workerStaticMeshMs.toFixed(1)}`;
      const showBoidsDebug = s.boidsDebugVisible && s.boidsDebug !== undefined;
      this.debugBoidLabel.style.display = showBoidsDebug ? 'block' : 'none';
      this.debugBoids.style.display = showBoidsDebug ? 'block' : 'none';
      if (showBoidsDebug && s.boidsDebug) {
        const bd = s.boidsDebug;
        this.debugBoids.textContent =
          `boids ${bd.boidCount}/${bd.activeBoidCount}  ` +
          `${bd.gpuMode ? 'GPU' : 'CPU'}  ` +
          `cells ${bd.activeCells}  ` +
          `overflow ${bd.gridOverflow}  ` +
          `avg/cell ${bd.avgBoidsPerCell}  ` +
          `nbr ${bd.neighborSearchMs.toFixed(1)}  ` +
          `steer ${bd.steeringMs.toFixed(1)}  ` +
          `avoid ${bd.avoidanceMs.toFixed(1)}  ` +
          `int ${bd.integrationMs.toFixed(1)}  ` +
          `mine ${bd.mineUpdateMs.toFixed(1)}  ` +
          `avgN ${bd.avgNeighbors.toFixed(1)}  ` +
          `alloc ${bd.neighborResultAllocations}  ` +
          `heavy ${bd.heavyUpdates}/${bd.cheapUpdates}  ` +
          `lod ${bd.boidsFullCount}/${bd.boidsClusterCount}/${bd.boidsPooledCount}/${bd.boidsCulledCount}  ` +
          `clusters ${bd.activeClusterCount}  ` +
          `hz ${bd.boidsEffectiveUpdateHz.toFixed(0)}  ` +
          `skip ${bd.boidsSkippedFrames}  ` +
          `sim ${bd.simulationMs.toFixed(1)}  ` +
          `render ${bd.renderMs.toFixed(1)}`;
      }
    } else {
      this.debugBoidLabel.style.display = 'none';
      this.debugBoids.style.display = 'none';
    }

    const deathStats = this.deathOverlay.querySelector('.death-stats');
    if (deathStats) {
      deathStats.innerHTML = `Loot: ${s.loot}<br>Depth: ${Math.max(0, s.depth).toFixed(0)}m<br>Distance: ${s.distance.toFixed(1)}`;
    }
    this.deathOverlay.style.display = s.dead ? 'grid' : 'none';
    this.pauseOverlay.style.display = s.paused && !s.dead ? 'grid' : 'none';
  }
}
