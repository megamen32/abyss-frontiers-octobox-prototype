import {
  Box3,
  Box3Helper,
  BufferGeometry,
  Color,
  Group,
  Line,
  LineBasicMaterial,
  Material,
  Vector3,
} from 'three';
import type { ChunkData } from '../types';

const COLORS = {
  chunk: new Color('#2a7ca7'),
  free: new Color('#37d67a'),
  obstacle: new Color('#cf5c4f'),
  empty: new Color('#7b8490'),
  portal: new Color('#4d9eff'),
  graph: new Color('#f1de76'),
  player: new Color('#f7f7f7'),
  visibleRadius: new Color('#4d9eff'),
  interactiveRadius: new Color('#ffbf69'),
  simulationRadius: new Color('#ff6ad5'),
};

export class DebugRenderer {
  createChunkDebug(chunk: ChunkData): Group {
    const group = new Group();

    const chunkBox = new Box3(chunk.bounds.min.clone(), chunk.bounds.max.clone());
    group.add(new Box3Helper(chunkBox, COLORS.chunk));

    for (const cell of chunk.cells) {
      const color = cell.kind === 'free' ? COLORS.free : cell.kind === 'obstacle' ? COLORS.obstacle : COLORS.empty;
      const helper = new Box3Helper(new Box3(cell.bounds.min.clone(), cell.bounds.max.clone()), color);
      const material = helper.material as Material & { transparent: boolean; opacity: number };
      material.transparent = true;
      material.opacity = cell.kind === 'free' ? 0.75 : 0.28;
      group.add(helper);
    }

    for (const portal of chunk.portals) {
      const helper = new Box3Helper(new Box3(portal.bounds.min.clone(), portal.bounds.max.clone()), COLORS.portal);
      const material = helper.material as Material & { transparent: boolean; opacity: number };
      material.transparent = true;
      material.opacity = 0.9;
      group.add(helper);
    }

    for (const obstacle of chunk.obstacles) {
      const helper = new Box3Helper(new Box3(obstacle.bounds.min.clone(), obstacle.bounds.max.clone()), COLORS.obstacle);
      const material = helper.material as Material & { transparent: boolean; opacity: number };
      material.transparent = true;
      material.opacity = 0.48;
      group.add(helper);
    }

    for (const [fromId, toId] of chunk.adjacency) {
      const from = chunk.cells.find((cell) => cell.id === fromId);
      const to = chunk.cells.find((cell) => cell.id === toId);
      if (!from || !to) {
        continue;
      }
      const geometry = new BufferGeometry().setFromPoints([
        from.bounds.min.clone().add(from.bounds.max).multiplyScalar(0.5),
        to.bounds.min.clone().add(to.bounds.max).multiplyScalar(0.5),
      ]);
      group.add(new Line(geometry, new LineBasicMaterial({ color: COLORS.graph })));
    }

    return group;
  }

  createPlayerRadius(radius: number): Line {
    const points: Vector3[] = [];
    const segments = 48;
    for (let index = 0; index <= segments; index += 1) {
      const angle = (index / segments) * Math.PI * 2;
      points.push(new Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius));
    }
    return new Line(new BufferGeometry().setFromPoints(points), new LineBasicMaterial({ color: COLORS.player }));
  }

  createChunkRadiusHelper(color: keyof typeof COLORS): Box3Helper {
    const helper = new Box3Helper(new Box3(new Vector3(), new Vector3()), COLORS[color]);
    const material = helper.material as Material & { transparent: boolean; opacity: number };
    material.transparent = true;
    material.opacity = 0.42;
    return helper;
  }
}
