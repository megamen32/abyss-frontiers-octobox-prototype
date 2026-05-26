import { MeshStandardMaterial, type IUniform } from 'three';

const DITHER_UNIFORM = /* glsl */ `
uniform float fogFade;
`;

const DITHER_LOGIC = /* glsl */ `
  if (fogFade < 0.999) {
    float threshold = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    if (threshold > fogFade) discard;
  }
`;

export function createFogDitherMaterial(base: MeshStandardMaterial): MeshStandardMaterial {
  const mat = base.clone();
  patchDither(mat);
  return mat;
}

export function setFogFade(material: MeshStandardMaterial, fade: number): void {
  material.userData.fogFade = fade;
  const handle = material.userData.fogFadeUniform;
  if (handle) {
    (handle as { value: number }).value = fade;
  }
}

export function patchDither(mat: MeshStandardMaterial): void {
  mat.userData.fogFade = 1.0;
  mat.onBeforeCompile = (shader) => {
    const uniform: IUniform = { value: mat.userData.fogFade ?? 1.0 };
    shader.uniforms.fogFade = uniform;
    mat.userData.fogFadeUniform = uniform;
    shader.fragmentShader = DITHER_UNIFORM + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      DITHER_LOGIC,
    );
  };
}
