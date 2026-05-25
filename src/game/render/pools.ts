import {
  BoxGeometry,
  Color,
  Mesh,
  MeshStandardMaterial,
  OctahedronGeometry,
  SphereGeometry,
  type Object3D,
} from 'three';

type MeshFactory = () => Mesh;

class MeshPool {
  private readonly available: Mesh[] = [];

  constructor(private readonly factory: MeshFactory) {}

  acquire(): Mesh {
    const mesh = this.available.pop() ?? this.factory();
    mesh.visible = true;
    return mesh;
  }

  release(mesh: Mesh): void {
    mesh.visible = false;
    mesh.parent?.remove(mesh);
    this.available.push(mesh);
  }
}

export class RenderPools {
  readonly sphereObstacle = new MeshPool(
    () =>
      new Mesh(
        new SphereGeometry(1, 18, 18),
        new MeshStandardMaterial({ color: new Color('#a4563f'), roughness: 0.7, metalness: 0.12 }),
      ),
  );

  readonly boxObstacle = new MeshPool(
    () =>
      new Mesh(
        new BoxGeometry(1, 1, 1),
        new MeshStandardMaterial({
          color: new Color('#b46843'),
          emissive: new Color('#34170f'),
          roughness: 0.72,
          metalness: 0.08,
        }),
      ),
  );

  readonly coin = new MeshPool(
    () =>
      new Mesh(
        new OctahedronGeometry(0.9, 0),
        new MeshStandardMaterial({ color: new Color('#f8c95f'), emissive: new Color('#5e4310') }),
      ),
  );

  readonly chest = new MeshPool(
    () =>
      new Mesh(
        new BoxGeometry(1.8, 1.4, 1.2),
        new MeshStandardMaterial({ color: new Color('#5d8fbc'), roughness: 0.45, metalness: 0.4 }),
      ),
  );

  releaseObjects(items: Object3D[]): void {
    for (const item of items) {
      if (!(item instanceof Mesh)) {
        item.parent?.remove(item);
        continue;
      }

      if (item.geometry instanceof SphereGeometry) {
        this.sphereObstacle.release(item);
      } else if (item.geometry instanceof OctahedronGeometry) {
        this.coin.release(item);
      } else if (item.scale.x > 1.5 && item.scale.y > 1.2) {
        this.chest.release(item);
      } else {
        this.boxObstacle.release(item);
      }
    }
  }
}
