import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  CRUST_MATERIALS,
  disposeCrustMaterial,
  makeCrustMaterial,
} from './crust-materials';
import {
  groundFinish,
  handoverAt,
  HANDOVER_TRANSMISSION,
  makeSurfaceLightUniforms,
  withSurfaceLight,
} from './crust-surface-light';

interface Patched {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
}

/** What three hands `onBeforeCompile`: the material's own program, its
 *  chunks still unresolved includes. */
function compile(material: THREE.Material, lib: 'physical' | 'basic') {
  const shader: Patched = {
    uniforms: {},
    vertexShader: THREE.ShaderLib[lib].vertexShader,
    fragmentShader: THREE.ShaderLib[lib].fragmentShader,
  };
  material.onBeforeCompile(
    shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    {} as THREE.WebGLRenderer
  );
  return shader;
}

describe('the handover from agent to ground (W15o)', () => {
  it('is all the way to ground on the frame the tile changes mesh', () => {
    expect(handoverAt(1, 0.02)).toBe(0);
    expect(handoverAt(0.02, 0.02)).toBe(1);
    expect(handoverAt(0, 0.02)).toBe(1);
    let last = 0;
    for (let a = 1; a >= 0.02; a -= 0.01) {
      const share = handoverAt(a, 0.02);
      expect(share).toBeGreaterThanOrEqual(last);
      last = share;
    }
  });

  it('eases how clear the body is inside the chunk three would include', () => {
    // an include is unresolved when the patch runs: a line inside one
    // matches nothing, so the chunk's own text is patched and used
    expect(HANDOVER_TRANSMISSION).toContain(
      'material.transmission = mix( transmission, uGroundTransmission, vWork.w );'
    );
    expect(HANDOVER_TRANSMISSION).toContain(
      'material.thickness = mix( thickness, uGroundThickness, vWork.w );'
    );
  });

  it("brings every option's body to its own ground's finish", () => {
    for (const option of CRUST_MATERIALS) {
      const spec = makeCrustMaterial(option.id);
      withSurfaceLight(spec.agent, makeSurfaceLightUniforms(), 1, spec.ground);
      const { fragmentShader: f, uniforms } = compile(spec.agent, 'physical');
      expect(f, option.id).not.toContain('#include <transmission_fragment>');
      // gloss and metal before the material is set up from them; the
      // reflectance and the coat after, before any light is gathered
      expect(f.indexOf('roughnessFactor = mix(')).toBeGreaterThan(
        f.indexOf('#include <metalnessmap_fragment>')
      );
      const coat = f.indexOf('material.clearcoat = mix(');
      expect(coat).toBeGreaterThan(
        f.indexOf('#include <lights_physical_fragment>')
      );
      expect(coat).toBeLessThan(f.indexOf('#include <lights_fragment_begin>'));
      const finish = groundFinish(spec.ground);
      expect(uniforms.uGroundRoughness.value).toBe(finish.roughness);
      expect(uniforms.uGroundMetalness.value).toBe(finish.metalness);
      expect(uniforms.uGroundIor.value).toBe(finish.ior);
      expect(uniforms.uGroundClearcoat.value).toBe(finish.clearcoat);
      expect(uniforms.uGroundTransmission.value).toBe(finish.transmission);
      expect(spec.agent.customProgramCacheKey()).toContain('ground-handover');
      disposeCrustMaterial(spec);
    }
  });

  it('reads a matte ground as having no coat and no glass', () => {
    const gummy = makeCrustMaterial('gummy');
    expect(groundFinish(gummy.ground)).toEqual({
      roughness: 0.72,
      metalness: 0.05,
      ior: 1.5,
      clearcoat: 0,
      clearcoatRoughness: 0,
      transmission: 0,
      thickness: 0,
    });
    const acrylic = makeCrustMaterial('acrylic');
    expect(groundFinish(acrylic.ground).transmission).toBe(0.55);
    disposeCrustMaterial(gummy);
    disposeCrustMaterial(acrylic);
  });

  it('leaves the lit cap, which never becomes ground, as it was', () => {
    const cap = withSurfaceLight(
      new THREE.MeshBasicMaterial(),
      makeSurfaceLightUniforms(),
      0.9
    );
    expect(compile(cap, 'basic').fragmentShader).not.toContain('uGround');
    expect(cap.customProgramCacheKey()).not.toContain('ground-handover');
  });
});
