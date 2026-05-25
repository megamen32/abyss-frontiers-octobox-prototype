import {
  BufferGeometry,
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshStandardMaterial,
  OctahedronGeometry,
  SphereGeometry,
  type Object3D,
  Vector3,
} from 'three';

type ObjectFactory<T extends Object3D> = () => T;

class ObjectPool<T extends Object3D> {
  private readonly available: T[] = [];

  constructor(private readonly factory: ObjectFactory<T>, initialSize = 0) {
    for (let index = 0; index < initialSize; index += 1) {
      const object = this.factory();
      object.visible = false;
      this.available.push(object);
    }
  }

  acquire(): T {
    const object = this.available.pop() ?? this.factory();
    object.visible = true;
    return object;
  }

  release(object: T): void {
    object.visible = false;
    object.parent?.remove(object);
    this.available.push(object);
  }
}

export class RenderPools {
  readonly sphereObstacleGeometry = new SphereGeometry(1, 18, 18);
  readonly sphereObstacleMaterial = new MeshStandardMaterial({ color: new Color('#a4563f'), roughness: 0.7, metalness: 0.12 });
  readonly boxObstacleGeometry = new BoxGeometry(1, 1, 1);
  readonly boxObstacleMaterial = new MeshStandardMaterial({
    color: new Color('#b46843'),
    emissive: new Color('#34170f'),
    roughness: 0.72,
    metalness: 0.08,
  });
  readonly coinGeometry = new OctahedronGeometry(0.9, 0);
  readonly coinMaterial = new MeshStandardMaterial({ color: new Color('#f8c95f'), emissive: new Color('#5e4310') });
  readonly chestGeometry = new BoxGeometry(1.8, 1.4, 1.2);
  readonly chestMaterial = new MeshStandardMaterial({ color: new Color('#5d8fbc'), roughness: 0.45, metalness: 0.4 });

  readonly sphereObstacle = new ObjectPool<Mesh>(
    () => new Mesh(this.sphereObstacleGeometry, this.sphereObstacleMaterial),
    24,
  );

  readonly boxObstacle = new ObjectPool<Mesh>(
    () => new Mesh(this.boxObstacleGeometry, this.boxObstacleMaterial),
    180,
  );

  readonly coin = new ObjectPool<Mesh>(
    () => new Mesh(this.coinGeometry, this.coinMaterial),
    40,
  );

  readonly chest = new ObjectPool<Mesh>(
    () => new Mesh(this.chestGeometry, this.chestMaterial),
    12,
  );

  readonly mine = new ObjectPool<Group>(
    () => {
      const group = new Group();
      const core = new Mesh(
        new OctahedronGeometry(1, 1),
        new MeshStandardMaterial({ color: new Color('#ff684f'), emissive: new Color('#622118'), roughness: 0.35, metalness: 0.18 }),
      );
      core.name = 'mine-core';
      const telegraph = new Line(
        new BufferGeometry().setFromPoints([new Vector3(0, 0, 0), new Vector3(0, 0, 1)]),
        new LineBasicMaterial({ color: new Color('#ffb38a') }),
      );
      telegraph.name = 'mine-telegraph';
      telegraph.visible = false;
      group.add(core, telegraph);
      return group;
    },
    12,
  );

  createBoxObstacleBatch(capacity: number): InstancedMesh {
    const mesh = new InstancedMesh(this.boxObstacleGeometry, this.boxObstacleMaterial, Math.max(1, capacity));
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.count = 0;
    return mesh;
  }

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
