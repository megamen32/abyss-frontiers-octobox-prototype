import {
  BufferGeometry,
  BoxGeometry,
  Color,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshStandardMaterial,
  OctahedronGeometry,
  SphereGeometry,
  type Object3D,
  Vector3,
} from 'three';
import { patchDither, setFogFade } from './fogDither';

type ObjectFactory<T extends Object3D> = () => T;

function installFadeCallback(mesh: Mesh): void {
  mesh.onBeforeRender = () => {
    const fade = mesh.userData.fadeOpacity ?? 1;
    if (mesh.material instanceof MeshStandardMaterial) {
      setFogFade(mesh.material, fade);
    }
  };
}

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

  constructor() {
    patchDither(this.sphereObstacleMaterial);
    patchDither(this.boxObstacleMaterial);
    patchDither(this.coinMaterial);
    patchDither(this.chestMaterial);
  }

  readonly sphereObstacle = new ObjectPool<Mesh>(
    () => {
      const m = new Mesh(this.sphereObstacleGeometry, this.sphereObstacleMaterial);
      installFadeCallback(m);
      return m;
    },
    24,
  );

  readonly boxObstacle = new ObjectPool<Mesh>(
    () => {
      const m = new Mesh(this.boxObstacleGeometry, this.boxObstacleMaterial);
      installFadeCallback(m);
      return m;
    },
    180,
  );

  readonly coin = new ObjectPool<Mesh>(
    () => {
      const m = new Mesh(this.coinGeometry, this.coinMaterial);
      installFadeCallback(m);
      return m;
    },
    40,
  );

  readonly chest = new ObjectPool<Mesh>(
    () => {
      const m = new Mesh(this.chestGeometry, this.chestMaterial);
      installFadeCallback(m);
      return m;
    },
    12,
  );

  readonly mine = new ObjectPool<Group>(
    () => {
      const group = new Group();
      const coreMat = new MeshStandardMaterial({ color: new Color('#ff684f'), emissive: new Color('#622118'), roughness: 0.35, metalness: 0.18 });
      patchDither(coreMat);
      const core = new Mesh(
        new OctahedronGeometry(1, 1),
        coreMat,
      );
      core.name = 'mine-core';
      installFadeCallback(core);
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
