export const GAME_CONFIG = {
  // Global world seed — change to generate a completely different universe.
  seed: 133742,

  ship: {
    // Collision sphere radius of the ship in world units.
    radius: 1,
    // Hard maximum speed cap in units/s. Velocity is clamped to this after every physics step.
    maxSpeed: 20,
    // Thrust force applied per second in the facing direction (units/s²). Actual value scales
    // up with depth — see depthAccelerationScale.
    baseAcceleration: 0.5,
    // Extra acceleration fraction gained at maximum depth. At full depth ramp the ship accelerates
    // at baseAcceleration * (1 + depthAccelerationScale). Depth ramp distance is world.depthDifficultyRamp.
    depthAccelerationScale: 0.95,
    // Drag fraction removed per second when flying straight. velocity *= (1 - baseDrag * dt) each frame.
    baseDrag: 0.2,
    // Additional drag added when turning. Scales linearly from 0 (straight) to 1 (full stall angle).
    // Total drag = baseDrag + turnRatio*turnDrag + stallAmount*stallDrag + speedLimitDrag.
    turnDrag: 0.34,
    // Additional drag applied at full stall (angle ≥ stallAngleDeg). Creates a strong speed penalty
    // for sharp turns at high speed.
    stallDrag: 0.8,
    // Extra drag applied when speed exceeds 80 % of maxSpeed, rising quadratically to this value
    // at 100 % speed. Prevents the ship from exceeding maxSpeed without a hard clamp.
    speedLimitExtraDrag: 1.6,
    // Angle (degrees) between velocity and thrust below which no stall effect occurs. Smooth turning
    // zone — drag is only baseDrag + a small turnDrag fraction.
    softTurnAngleDeg: 45,
    // Angle (degrees) at which full stall drag applies. Between softTurnAngleDeg and stallAngleDeg
    // the stall effect fades in via smoothstep.
    stallAngleDeg: 90,
    // Speed at which thrustForward tracks targetThrustForward via slerp. Higher values make the ship
    // respond to steering input more instantly; lower values add inertia. Unit: 1/s (exponential rate).
    steeringResponsiveness: 20.2,
    // Rate at which targetThrustForward drifts back toward thrustForward when no steering key is held.
    // Acts as angular drag — prevents the ship from spinning freely after a turn. Unit: 1/s.
    // 0 = no damping, higher = faster return to neutral. ~4 gives ~250ms settling time.
    steeringAngularDrag: 6.0,
    // Thrust efficiency when completely stalled (angle ≥ stallAngleDeg). 0 = no thrust while stalled,
    // 1 = full thrust regardless. Current value keeps 25 % thrust at max stall.
    thrustEfficiencyAtFullStall: 0.8,
    // Visual forward turn rate (rad/s) when the ship is moving slowly. The model rotates to match
    // actual velocity direction; at low speed it rotates slowly.
    visualForwardTurnRateMin: 1.7,
    // Visual forward turn rate (rad/s) at full speed. The model snaps toward velocity direction more
    // aggressively at high speed so it looks like it's pointing where it flies.
    visualForwardTurnRateMax: 8.4,
    // Starting hit points. Ship dies when HP reaches 0.
    hp: 100.0,
    // Seconds of invulnerability granted after taking a hit. Prevents rapid successive damage.
    hitInvulnerabilityTime: 1,
  },

  camera: {
    // Default distance from the camera to the ship along the orbit offset direction (units).
    distance: 8.5,
    // Default height of the camera above the ship (units). Combined with distance, defines the base
    // camera position in ship-local space before yaw/pitch adjustment.
    height: 5.4,
    // Exponential smoothing factor for camera position and lookAt. Lower = more lag, higher = snappier.
    // Used as the rate in: blend = 1 - exp(-k * smoothness * dt).
    smoothness: 0.3,
    // Seconds of delay before the camera lookAt direction catches up to the ship heading. Creates
    // the feeling that the camera is "dragged" behind the ship's nose on turns.
    followLookDelay: 0.22,
    // Damping rate for lookAt direction lag. Higher values make the lag dissipate faster.
    followLookDamping: 4.8,
    // Keyboard yaw orbit speed (rad/s) when the player rotates the camera with arrow keys.
    keyboardYawSpeed: 1.8,
    // Keyboard pitch orbit speed (rad/s). Moves camera up/down around the ship.
    keyboardPitchSpeed: 1.45,
    // Half-width of the dead-zone cone (radians) in which small yaw deviations don't trigger camera
    // auto-follow. Prevents the camera from wiggling for tiny heading changes.
    deadlockHalfWidth: 0.7,
    // Half-height of the dead-zone cone (radians) for pitch. Same purpose as deadlockHalfWidth.
    deadlockHalfHeight: 0.7,
    // When the angle between the camera look direction and the thrust direction exceeds this value
    // (degrees), the thrust-look assist starts blending the camera toward the ship's flight path.
    thrustLookAssistStartAngleDeg: 30,
    // Angle (degrees) at which the thrust-look assist reaches full blend strength.
    thrustLookAssistFullAngleDeg: 60,
    // Minimum ship speed (units/s) for the thrust-look assist to activate. Below this threshold the
    // camera stays in free orbit regardless of angle.
    thrustLookAssistSpeedThreshold: 17,
    // Maximum blend weight [0–1] the thrust-look assist applies. 1 = camera fully snaps to thrust
    // direction; 0.72 leaves 28 % of the player's manual aim intact.
    thrustLookAssistMaxBlend: 0.4,
    // Vertical field of view in degrees.
    fov: 68,
    // Minimum camera pitch (radians, negative = looking down). Clamps the orbit to avoid flipping.
    pitchMin: -1.2,
    // Maximum camera pitch (radians, positive = looking up).
    pitchMax: 1.2,
    // How many seconds of travel the lookAt target is placed ahead of the ship. Scales with ship
    // speed so at high speed the view opens up further ahead. lookAheadDist = max(lookAheadMin, speed * lookAheadSeconds).
    lookAheadSeconds: 1.0,
    // Minimum look-ahead distance (units) used when the ship is slow or stationary.
    lookAheadMin: 3,
    // Safety margin as a fraction of the half-FOV. Points must stay this far from screen edges.
    // 0.12 = 12 % inset from each edge before the camera zooms out to keep a point in frame.
    viewMargin: 0.12,
    // Points in ship-local space (x=right, y=up, z=forward/nose) that the camera must always keep
    // inside the visible frustum. The camera pulls back until all anchors are on screen.
    shipViewAnchors: [
      { x: 0, y: 0, z: 2.5 },   // nose
      { x: 0, y: 0, z: -1.5 },  // tail
    ],
  },

  world: {
    // Side length of a single cubic chunk in world units. All chunk coordinates are multiples of this.
    chunkSize: 64,
    // Radius of chunks (in chunk units) in which interactive gameplay events (mines, loot) update.
    // 0 = only the current chunk.
    interactiveRadius: 0,
    // Radius of chunks (in chunk units) that are kept fully simulated around the player.
    simulationRadius: 1,
    // Extra chunk radius added on top of simulationRadius for background pre-generation. Chunks in
    // this band are generated but not yet active, reducing pop-in.
    preloadRadiusPadding: 1,
    // Extra chunk radius beyond generationRadius before a loaded chunk is evicted. Creates a
    // hysteresis buffer so crossing a boundary doesn't immediately remove trailing chunks while
    // leading ones are still being generated.
    evictionRadiusPadding: 1,
    // How many seconds ahead (at current speed) the system pre-generates chunks along the travel
    // direction. Converted to chunk offsets each frame.
    generationLookaheadSeconds: 4,
    // Starting chunk spawn budget — how many chunks can be spawned per frame on the first frame.
    spawnBudgetInitial: 10,
    // Floor for the adaptive spawn budget. The system will never drop below this many chunks/frame
    // even under heavy load.
    spawnBudgetMin: 1,
    // FPS threshold below which the spawn budget is reduced by 1 each sample window.
    spawnBudgetFpsThreshold: 30,
    // Sampling window in seconds over which average FPS is measured for budget adjustment.
    spawnBudgetSampleSeconds: 20,
    // Depth (units below surface, y-axis) over which the difficulty gradually ramps from 0 to 1.
    // Controls how fast deeper chunks become harder and denser.
    depthDifficultyRamp: 1000,
    // Bonus probability added to obstacle placement per unit of depth danger [0–1]. At max danger
    // the obstacle fill chance rises by this amount (e.g. 0.55 + 0.18 = 0.73 base chance).
    depthObstacleDensityBonus: 0.18,
    // Multiplier applied to maxObstaclesPerChunk at maximum depth danger. Scales the hard obstacle
    // cap so deep chunks can hold more obstacles.
    depthObstacleCapMultiplier: 1.45,
    // Extra density bias added per unit of depth danger when estimating octobox cell density. Higher
    // values cause the octobox to subdivide more finely at depth, creating smaller cells.
    depthCellDensityBonus: 0.2,
    // Player spawn position in world units. Should land inside the first chunk (0–chunkSize).
    spawn: {
      x: 32,
      y: 32,
      z: 32,
    },
    // Radius of the cylindrical portal opening (units). Determines the passable hole between chunks.
    portalRadius: 4.5,
    // Distance from the chunk face to inset the portal center (units). Prevents portals from sitting
    // exactly on the boundary.
    portalInset: 2.2,
    // Depth (units) of the portal tunnel geometry rendered on each face.
    portalThickness: 2,
    // Number of axis-aligned divisions used when splitting dense octobox cells. 3 = 27 children.
    denseSplitDivisions: 2,
    // Number of axis-aligned divisions used when splitting sparse / low-density octobox cells.
    // 2 = 8 children (classic octree split).
    sparseSplitDivisions: 2,
    // Maximum recursion depth of the octobox tree. Cells at this depth become leaves regardless of
    // size or density.
    octoboxMaxDepth: 5,
    // Probability [0–1] that a cell is recursively split at each depth level (checked after
    // density and size constraints are satisfied).
    octoboxSplitProbability: 0.82,
    // Minimum allowed leaf cell size as a multiple of the portal radius. Ensures no cell is ever
    // smaller than the passage the player needs to fly through.
    octoboxMinCellSizeMultiplier: 1.15,
    // Maximum allowed leaf cell size as a multiple of the portal radius. Very large cells are
    // considered "open space" and aren't forced to split.
    octoboxMaxCellSizeMultiplier: 20,
    // Density value below which a cell is treated as effectively empty and splitting stops.
    // Prevents unnecessary subdivision of open-space areas.
    octoboxEmptyDensityThreshold: 0.12,
    // Density value above which a cell is treated as dense and will use denseSplitDivisions.
    // Cells between empty and dense thresholds use sparseSplitDivisions.
    octoboxDenseDensityThreshold: 0.58,
    // Probability [0–1] that a navigable cell is tagged as "free" (no obstacle placed). Sparse
    // open pockets; lower = denser obstacle coverage overall.
    freeBoxProbability: 0.18,
    // Minimum half-width of a passable corridor (units). Cells narrower than 2× this value are not
    // added to the navigable set, preventing unpassable dead-end slivers.
    minPassageRadius: 4,
    // Hard cap on the number of obstacles per chunk at base danger. Scaled up by
    // depthObstacleCapMultiplier at max depth.
    maxObstaclesPerChunk: 120,
    // Maximum number of loot items (coins + chests) that can be placed per chunk.
    maxLootPerChunk: 20,
    // Number of web workers dedicated to building chunk geometry in the background.
    chunkBuildWorkers: 2,
    // Content generation strategy. 'scatter' = random octobox-based obstacles.
    // Future modes may include 'cave' for fully procedural cave tunnels.
    generationMode: 'cave',
    // Cave bias value at or above which a cell is considered part of the cave core (void interior).
    // Core cells are mostly kept empty to form the tunnel passage.
    caveCoreBias: 0.72,
    // Cave bias value at or below which a cell is considered part of the cave wall (solid exterior).
    // Wall cells receive heavy obstacle fill to form solid tunnel walls.
    caveWallBias: 0.6,
  },

  collision: {
    // HP damage dealt when the ship hits a small or medium obstacle (minSize ≤ 8 units).
    obstacleDamage: 34,
    // HP damage dealt when the ship hits a large obstacle (minSize > 8 units).
    largeObstacleDamage: 67,
    // HP damage dealt when the ship hits the world surface (y ceiling/floor boundary).
    surfaceDamage: 20,
    // Distance (units) used to push the ship away from the collision surface after resolving
    // overlap. Prevents the ship from remaining embedded in geometry.
    separationDistance: 0.35,
    // Velocity multiplier applied in the normal direction after an obstacle collision. Values > 1
    // make the ship bounce away faster than it arrived (energetic rebound).
    obstacleReboundFactor: 1.1,
    // Minimum rebound speed (units/s) after hitting an obstacle. Ensures the ship is always pushed
    // away even when impact speed is very low.
    obstacleReboundMinSpeed: 8,
    // Fraction [0–1] of velocity tangential to the obstacle surface that is retained after impact.
    // Lower values = more friction / speed scrubbing on grazes.
    obstacleTangentialDamping: 0.42,
    // Rebound factor for the world surface (stronger than obstacles).
    surfaceReboundFactor: 1.2,
    // Minimum rebound speed after hitting the world surface.
    surfaceReboundMinSpeed: 10,
    // Tangential damping fraction retained after hitting the world surface.
    surfaceTangentialDamping: 0.78,
    // Collection radius for coins (units). Ship must approach within this distance to pick up a coin.
    coinRadius: 1.5,
    // Collection radius for chests (units). Larger than coins because chests are bigger objects.
    chestRadius: 2.2,
  },

  mines: {
    // Maximum number of mines that can be active simultaneously per chunk.
    maxPerChunk: 3,
    // Distance (units) at which the mine detects the player and enters targeting state.
    triggerRadius: 15,
    // Speed (units/s) at which a launched mine travels toward its target.
    launchSpeed: 22,
    // Seconds of player velocity extrapolation used to predict the intercept point. The mine aims
    // at player.position + velocity * leadTime at the moment it triggers.
    leadTime: 0.7,
    // Duration (seconds) of the telegraph animation shown before the mine launches. Gives the
    // player a visual warning to dodge.
    telegraphDuration: 0.5,
    // Physical radius of the mine (units). Used for collision detection with the player and obstacles.
    radius: 1.2,
    // HP damage dealt when the mine hits the ship.
    damage: 34,
    // Depth (units below surface) at which mines switch from passive idle to rocket homing.
    deepMineDepth: 500,
    // Continuous acceleration (units/s²) during rocket homing phase. The mine accelerates
    // toward a predicted intercept point each frame instead of setting velocity instantly.
    rocketAcceleration: 5,
    // Maximum speed cap during rocket phase (units/s). Prevents the homing speed from
    // growing unbounded over long approach distances.
    rocketMaxSpeed: 35,
    // Distance (units) from the player at which the rocket phase ends and the final
    // launched burst begins. At this point the mine inherits its rocket velocity and
    // adds an aimed burst toward the player.
    rocketToLaunchedDistance: 6,
  },

  cave: {
    // Master switch — disables all cave generation when false.
    enabled: false,
    // Probability [0–1] per chunk face per chunk that a cave entrance spawns. Checked independently
    // for each of the three negative faces (nx, ny, nz) per chunk.
    entranceProbability: 0.06,
    // Base tunnel radius at the surface level (units). The tunnel starts this wide at depth 0.
    baseRadius: 5.5,
    // Minimum tunnel radius (units). The radius never shrinks below this value regardless of depth.
    minRadius: 3,
    // How much the tunnel radius decreases per cave depth node. radius -= radiusDecayPerDepth per step.
    radiusDecayPerDepth: 0.8,
    // Spacing between consecutive cave path nodes (units). Controls how curvy the tunnel is — shorter
    // spacing with high curvature = tighter bends.
    nodeSpacing: 14,
    // Minimum number of nodes in a cave branch path.
    minNodes: 3,
    // Maximum number of nodes in a cave branch path.
    maxNodes: 6,
    // Maximum angular deviation (radians) between consecutive path segments. Higher values allow
    // sharper turns.
    maxCurvature: 0.35,
    // Probability [0–1] that a branch forks off at each node.
    branchProbability: 0.4,
    // Maximum recursion depth of cave branching. Limits total branch count.
    maxBranchDepth: 2,
    // Distance (units) between obstacle rings in gauntlet sections of caves.
    gauntletSpacing: 10,
    // Number of segments used to approximate the circular cross-section of the tunnel.
    ringSegments: 24,
    // Step size (units) used when sampling the cave SDF to place obstacles. Smaller = more accurate
    // but slower generation.
    sampleStep: 2,
  },

  blackHole: {
    // Minimum depth (units below surface) where black hole caves appear.
    minDepth: 200,
    // Maximum depth where black hole caves appear.
    maxDepth: 1000,
    // Radius of the black hole entrance sphere (diameter = radius * 2).
    entranceRadius: 128,
    // Number of ring segments for the sphere mesh.
    sphereSegments: 32,
  },

  visuals: {
    // Enables the in-game debug overlay (chunk wireframes, collision spheres, fps graph).
    debugEnabled: false,
    // How many chunks around the player are rendered in the chunk debug overlay (0 = current only).
    debugChunkRadius: 0,
    // How many chunks of visibility the fog allows. This is the PRIMARY fog parameter — density
    // is computed from it so generation pop-in is always hidden.
    // fogDensity = sqrt(-log(0.03)) / ((fogRenderRadiusChunks - 0.5) * chunkSize)
    fogRenderRadiusChunks: 3,
    // Sky and fog color near the surface (dangerLevel = 0).
    skyColor: 0x03111a,
    fogColor: 0x02070c,
    // Sky and fog color deep in the abyss (dangerLevel = 1). Lerped from surface colors.
    abyssSkyColor: 0x000205,
    abyssFogColor: 0x000102,
    // Ambient light intensity at the surface (bright, light from above).
    surfaceAmbientIntensity: 1.6,
    // Ambient light intensity at full abyss depth (dim, oppressive darkness).
    abyssAmbientIntensity: 0.35,
    // Color and opacity of the bright fog plane near the surface. This is a soft light veil,
    // not a hard water sheet.
    fogPlaneColor: 0x6fc9ff,
    fogPlaneOpacity: 0.3,
  },
} as const;
