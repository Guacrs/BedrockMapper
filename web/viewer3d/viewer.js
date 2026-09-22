/**
 * Experimental Three.js surface-terrain viewer.
 *
 * Consumes GET /api/mesh/:dimension/:chunkX/:chunkZ and streams chunks around
 * the camera. One Mesh per Minecraft chunk, shared material, vertex colours.
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

/**
 * @param {object} mesh
 * @returns {THREE.BufferGeometry}
 */
export function meshToGeometry(mesh) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(mesh.normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(mesh.colors, 3));
  geometry.setIndex(mesh.indices);
  geometry.computeBoundingSphere();
  return geometry;
}

export class TerrainViewer3D {
  /**
   * @param {HTMLElement} container
   * @param {{
   *   dimension?: string,
   *   center?: { x: number, z: number } | null,
   *   debug?: boolean,
   * }} [options]
   */
  constructor(container, options = {}) {
    this.container = container;
    this.dimension = options.dimension ?? 'overworld';
    this.debug = Boolean(options.debug);
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

    // Shared material — vertex colours carry BedrockMapper surface colours.
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.02,
      flatShading: false,
      side: THREE.FrontSide,
    });

    const hemi = new THREE.HemisphereLight(0xb1e1ff, 0x444422, 0.55);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 0.95);
    sun.position.set(80, 120, 40);
    this.scene.add(sun);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 1200;
    this.controls.screenSpacePanning = true;

    /** @type {Map<string, THREE.Mesh>} */
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

  /** Start the render loop and initial chunk stream. */
  start() {
    if (this._disposed) return;
    this._running = true;
    this.resize();
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
    if (epoch !== this._meshEpoch || this._disposed) return 'stale';
    if (response.status === 404) return false;
    if (!response.ok) throw new Error(`mesh HTTP ${response.status}`);
    const mesh = await response.json();
    if (epoch !== this._meshEpoch || this._disposed) return 'stale';
    if (!mesh?.positions?.length || !mesh?.indices?.length) return false;
    if (this._meshes.has(key)) return true;

    const geometry = meshToGeometry(mesh);
    const object = new THREE.Mesh(geometry, this.material);
    object.name = `chunk:${key}`;
    object.frustumCulled = true;
    this.terrainGroup.add(object);
    this._meshes.set(key, object);

    if (this.debug) {
      const helper = new THREE.BoxHelper(object, 0x30363d);
      helper.name = `bounds:${key}`;
      object.userData.helper = helper;
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
    object.geometry.dispose();
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
    this._debugEl.textContent =
      `chunks ${this.streamer.loadedChunks.size}  ` +
      `cam ${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)}  ` +
      `look ${t.x.toFixed(0)},${t.y.toFixed(0)},${t.z.toFixed(0)}  ` +
      `${this._fps.toFixed(0)} fps`;
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
    this.material.dispose();
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
