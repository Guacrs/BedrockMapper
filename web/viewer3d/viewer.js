/**
 * Experimental Three.js voxel terrain viewer.
 *
 * Consumes GET /api/mesh/:dimension/:chunkX/:chunkZ and streams chunks around
 * the camera. One Group per Minecraft chunk (terrain mesh + optional emissive
 * sibling). Shared materials. When a texture atlas is available
 * (`/api/textures/atlas.*`), faces are textured; otherwise the viewer keeps
 * the vertex-colour fallback.
 *
 * PR33: emissive blocks (torch, glowstone, …) arrive on `mesh.emissive` and
 * use a MeshStandardMaterial with an emissive channel so they visibly glow
 * without baking light into terrain vertex colours. No Minecraft light
 * propagation yet.
 *
 * Extension points for later PRs: players3d / markers3d can place objects using
 * minecraftToThree() without changing the terrain coordinate system.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { chunkKey, minecraftToThree } from './coords3d.js';
import {
  ChunkStreamer,
  UNLOAD_DISTANCE_CHUNKS,
  VIEW_DISTANCE_CHUNKS,
} from './chunk-streamer.js';
import { isMeshResponseCurrent } from './mesh-epoch.js';

/**
 * @param {object} mesh
 * @returns {THREE.BufferGeometry}
 */
export function meshToGeometry(mesh) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(mesh.normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(mesh.colors, 3));
  if (mesh.uvs?.length) {
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(mesh.uvs, 2));
  }
  geometry.setIndex(mesh.indices);
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * @param {object | null | undefined} buffers
 * @returns {boolean}
 */
function hasMeshBuffers(buffers) {
  return Boolean(buffers?.positions?.length && buffers?.indices?.length);
}

export class TerrainViewer3D {
  /**
   * @param {HTMLElement} container
   * @param {{
   *   dimension?: string,
   *   center?: { x: number, z: number } | null,
   *   debug?: boolean,
   *   meshVersion?: number,
   *   textureAtlas?: boolean,
   * }} [options]
   */
  constructor(container, options = {}) {
    this.container = container;
    this.dimension = options.dimension ?? 'overworld';
    this.debug = Boolean(options.debug);
    /** Only fetch atlas when map info explicitly says it is present. */
    this._wantAtlas = options.textureAtlas === true;
    this._disposed = false;
    this._running = false;
    this._raf = 0;
    this._lastFrame = 0;
    this._fps = 0;
    this._frames = 0;
    this._fpsWindowStart = 0;
    /** Bumped on meshVersion changes so in-flight loads can abort cleanly. */
    this._meshEpoch = 0;
    this._meshVersion = options.meshVersion ?? 1;
    /** @type {THREE.Texture | null} */
    this._atlasTexture = null;
    this._atlasLoad = null;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x10151c);

    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    this.camera = new THREE.PerspectiveCamera(60, width / height, 0.5, 4000);
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch (error) {
      const message = document.createElement('div');
      message.className = 'view3d-error';
      message.textContent =
        'WebGL is not available in this browser/session, so the 3D view cannot start. ' +
        'Use a desktop browser with WebGL (Chrome/Firefox/Safari) or check chrome://gpu.';
      container.appendChild(message);
      throw error;
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    container.appendChild(this.renderer.domElement);

    this.terrainGroup = new THREE.Group();
    this.terrainGroup.name = 'terrain';
    this.scene.add(this.terrainGroup);

    // Shared terrain material — vertex colours tint textures (or paint alone when no atlas).
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.02,
      flatShading: false,
      side: THREE.FrontSide,
    });

    // PR33: self-lit emitters (torch, glowstone, …). Strong emissive channel so
    // thin torches and full-cube lamps read as glowing under the same sun.
    // alphaTest discards torch/cross transparent texels (else they shade black).
    this.emissiveMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.4,
      metalness: 0,
      flatShading: false,
      side: THREE.DoubleSide,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 2.2,
      toneMapped: false,
      alphaTest: 0.1,
    });

    const hemi = new THREE.HemisphereLight(0xb1e1ff, 0x444422, 0.55);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 0.95);
    sun.position.set(80, 120, 40);
    this.scene.add(sun);
    // Soft fill so shadowed faces of emitters still show their emissive tint.
    const fill = new THREE.AmbientLight(0x2a3040, 0.25);
    this.scene.add(fill);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 1200;
    this.controls.screenSpacePanning = true;

    /** @type {Map<string, THREE.Object3D>} */
    this._meshes = new Map();

    const center = options.center ?? { x: 0, z: 0 };
    this._focus = minecraftToThree(center.x, 80, center.z);
    this.camera.position.set(center.x + 64, 120, center.z + 64);
    this.controls.target.set(center.x, 64, center.z);
    this.controls.update();

    this.streamer = new ChunkStreamer({
      viewDistance: VIEW_DISTANCE_CHUNKS,
      unloadDistance: UNLOAD_DISTANCE_CHUNKS,
      loadChunk: (cx, cz) => this._loadChunk(cx, cz),
      unloadChunk: (cx, cz) => this._unloadChunk(cx, cz),
    });

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.controls.addEventListener('change', () => {
      if (!this._running) return;
      this._focus = {
        x: this.controls.target.x,
        y: this.controls.target.y,
        z: this.controls.target.z,
      };
      this.streamer.scheduleUpdate(this._focus);
    });

    this._debugEl = null;
    if (this.debug) {
      this._debugEl = document.createElement('div');
      this._debugEl.id = 'debug3d';
      this._debugEl.setAttribute('aria-live', 'polite');
      container.appendChild(this._debugEl);
    }
  }

  /**
   * Load atlas once per viewer. Missing/failed atlas keeps vertex-colour mode.
   * @returns {Promise<boolean>}
   */
  async _ensureAtlas() {
    if (!this._wantAtlas) return false;
    if (this._atlasTexture) return true;
    if (this._atlasLoad) return this._atlasLoad;
    this._atlasLoad = (async () => {
      try {
        const metaRes = await fetch('/api/textures/atlas.json');
        if (!metaRes.ok) return false;
        const pngRes = await fetch('/api/textures/atlas.png');
        if (!pngRes.ok) return false;
        const blob = await pngRes.blob();
        const url = URL.createObjectURL(blob);
        const texture = await new Promise((resolve, reject) => {
          const loader = new THREE.TextureLoader();
          loader.load(url, resolve, undefined, reject);
        });
        URL.revokeObjectURL(url);
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        texture.generateMipmaps = false;
        // Atlas UVs are authored in top-left image space (v increases downward).
        // Keep flipY false so those UVs match the uploaded texels without inversion.
        texture.flipY = false;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.needsUpdate = true;
        this._atlasTexture = texture;
        this.material.map = texture;
        this.material.needsUpdate = true;
        this.emissiveMaterial.map = texture;
        // Drive the emissive channel from the same atlas so lamps glow their texture,
        // not a flat white overlay.
        this.emissiveMaterial.emissiveMap = texture;
        this.emissiveMaterial.needsUpdate = true;
        return true;
      } catch (error) {
        console.warn('[3d] texture atlas unavailable; using vertex colours', error);
        return false;
      }
    })();
    return this._atlasLoad;
  }

  /** Start the render loop and initial chunk stream. */
  start() {
    if (this._disposed) return;
    this._running = true;
    this.resize();
    void this._ensureAtlas().then(() => {
      if (!this._disposed && this._running) void this.streamer.update(this._focus);
    });
    void this.streamer.update(this._focus);
    this._lastFrame = performance.now();
    this._fpsWindowStart = this._lastFrame;
    this._frames = 0;
    const tick = (now) => {
      if (!this._running) return;
      this._raf = requestAnimationFrame(tick);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this._frames++;
      if (now - this._fpsWindowStart >= 500) {
        this._fps = (this._frames * 1000) / (now - this._fpsWindowStart);
        this._frames = 0;
        this._fpsWindowStart = now;
        this._paintDebug();
      }
    };
    this._raf = requestAnimationFrame(tick);
  }

  pause() {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  resume() {
    if (this._disposed || this._running) return;
    this.start();
  }

  resize() {
    if (this._disposed) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  /**
   * @param {number} chunkX
   * @param {number} chunkZ
   * @returns {Promise<boolean>}
   */
  async _loadChunk(chunkX, chunkZ) {
    const key = chunkKey(chunkX, chunkZ);
    if (this._meshes.has(key)) return true;
    const epoch = this._meshEpoch;

    const response = await fetch(`/api/mesh/${this.dimension}/${chunkX}/${chunkZ}`);
    if (!isMeshResponseCurrent(epoch, this._meshEpoch, this._disposed)) return 'stale';
    // 204 = known-empty hole in a sparse world; 404 kept for unknown dimension etc.
    if (response.status === 204 || response.status === 404) return false;
    if (!response.ok) throw new Error(`mesh HTTP ${response.status}`);
    // Parse via text first: a 204 can slip through a stale cached viewer as
    // response.ok, and Response.json() then throws on the empty body.
    const raw = await response.text();
    if (!isMeshResponseCurrent(epoch, this._meshEpoch, this._disposed)) return 'stale';
    // Empty body on an otherwise-OK response: treat as no mesh (defensive).
    if (!raw.trim()) return false;
    let mesh;
    try {
      mesh = JSON.parse(raw);
    } catch (error) {
      // Non-empty but invalid JSON is a real failure — do not silently discard.
      throw new Error(`mesh JSON parse failed: ${error instanceof Error ? error.message : error}`);
    }
    const hasTerrain = hasMeshBuffers(mesh);
    const hasEmissive = hasMeshBuffers(mesh?.emissive);
    if (!hasTerrain && !hasEmissive) return false;
    if (this._meshes.has(key)) return true;

    const group = new THREE.Group();
    group.name = `chunk:${key}`;

    if (hasTerrain) {
      const geometry = meshToGeometry(mesh);
      const object = new THREE.Mesh(geometry, this.material);
      object.name = `terrain:${key}`;
      object.frustumCulled = true;
      group.add(object);
    }

    if (hasEmissive) {
      const geometry = meshToGeometry(mesh.emissive);
      const object = new THREE.Mesh(geometry, this.emissiveMaterial);
      object.name = `emissive:${key}`;
      object.frustumCulled = true;
      group.add(object);
    }

    this.terrainGroup.add(group);
    this._meshes.set(key, group);

    if (this.debug) {
      const helper = new THREE.BoxHelper(group, 0x30363d);
      helper.name = `bounds:${key}`;
      group.userData.helper = helper;
      this.terrainGroup.add(helper);
    }
    return true;
  }

  /**
   * @param {number} chunkX
   * @param {number} chunkZ
   */
  _unloadChunk(chunkX, chunkZ) {
    const key = chunkKey(chunkX, chunkZ);
    const object = this._meshes.get(key);
    if (!object) return;
    this.terrainGroup.remove(object);
    object.traverse((child) => {
      if (child.isMesh) {
        child.geometry?.dispose();
      }
    });
    if (object.userData.helper) {
      this.terrainGroup.remove(object.userData.helper);
      object.userData.helper.geometry?.dispose();
      object.userData.helper.material?.dispose?.();
    }
    this._meshes.delete(key);
  }

  _paintDebug() {
    if (!this._debugEl) return;
    const t = this.controls.target;
    const p = this.camera.position;
    const paint = this._atlasTexture ? 'atlas' : 'colours';
    this._debugEl.textContent =
      `chunks ${this.streamer.loadedChunks.size}  ` +
      `cam ${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)}  ` +
      `look ${t.x.toFixed(0)},${t.y.toFixed(0)},${t.z.toFixed(0)}  ` +
      `${this._fps.toFixed(0)} fps  ${paint}`;
  }

  /** Place the orbit target near a Minecraft X/Z (e.g. world centre). */
  focusXZ(x, z, y = 64) {
    this._focus = minecraftToThree(x, y, z);
    this.controls.target.set(x, y, z);
    this.camera.position.set(x + 64, y + 80, z + 64);
    this.controls.update();
    void this.streamer.update(this._focus);
  }

  /**
   * Drop every loaded chunk mesh and fetch them again.
   * Called when `/api/map/state` reports a new `meshVersion`.
   *
   * @param {number} [meshVersion]
   */
  reloadMeshes(meshVersion) {
    if (this._disposed) return;
    if (meshVersion !== undefined) {
      if (meshVersion === this._meshVersion) return;
      this._meshVersion = meshVersion;
    }
    this._meshEpoch++;
    for (const key of [...this._meshes.keys()]) {
      const [cx, cz] = key.split(',').map(Number);
      this._unloadChunk(cx, cz);
    }
    this.streamer.forgetLoaded();
    void this.streamer.update(this._focus);
  }

  dispose() {
    this.pause();
    this._disposed = true;
    window.removeEventListener('resize', this._onResize);
    this.streamer.dispose();
    for (const key of [...this._meshes.keys()]) {
      const [cx, cz] = key.split(',').map(Number);
      this._unloadChunk(cx, cz);
    }
    this.material.map = null;
    this.material.dispose();
    this.emissiveMaterial.map = null;
    this.emissiveMaterial.emissiveMap = null;
    this.emissiveMaterial.dispose();
    this._atlasTexture?.dispose();
    this._atlasTexture = null;
    this.controls.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
    if (this._debugEl?.parentNode === this.container) {
      this.container.removeChild(this._debugEl);
    }
  }
}
