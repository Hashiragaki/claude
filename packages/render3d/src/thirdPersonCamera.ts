import { Vector3, type Object3D, type PerspectiveCamera } from 'three';
import { clamp, damp, orbitOffset } from './math';

export interface ThirdPersonCameraOptions {
  /** Distance horizontale initiale derrière la cible (mètres). */
  distance?: number;
  /** Hauteur initiale de la caméra au-dessus du point visé (mètres). */
  height?: number;
  /** Hauteur du point visé au-dessus de l'origine de la cible (≈ poitrine du personnage). */
  lookHeight?: number;
  /** Orientation initiale autour de Y (radians, 0 = caméra côté +Z de la cible). */
  yaw?: number;
  minPitch?: number;
  maxPitch?: number;
  minRadius?: number;
  maxRadius?: number;
  /** Raideur du suivi (plus grand = plus réactif). */
  followDamping?: number;
  /** Radians par pixel de glissement. */
  rotateSpeed?: number;
  /** Facteur de zoom par unité de molette. */
  zoomSpeed?: number;
  /** Élément recevant les glissements souris et la molette (souvent le canevas). */
  domElement?: HTMLElement | null;
}

/**
 * Caméra à la troisième personne : suit une cible avec amortissement, orbite au glisser de la
 * souris (lacet libre, tangage borné) et zoom à la molette.
 */
export class ThirdPersonCamera {
  yaw: number;
  pitch: number;
  radius: number;
  readonly lookAt = new Vector3();
  private target: Object3D | null;
  private readonly options: Required<Omit<ThirdPersonCameraOptions, 'domElement' | 'yaw' | 'distance' | 'height'>>;
  private readonly targetPosition = new Vector3();
  private targetYaw: number;
  private targetPitch: number;
  private targetRadius: number;
  private detachers: (() => void)[] = [];
  private initialized = false;

  constructor(
    readonly camera: PerspectiveCamera,
    target: Object3D | null,
    options: ThirdPersonCameraOptions = {},
  ) {
    this.target = target;
    const distance = options.distance ?? 6;
    const height = options.height ?? 2.5;
    this.options = {
      lookHeight: options.lookHeight ?? 1.2,
      minPitch: options.minPitch ?? 0.05,
      maxPitch: options.maxPitch ?? 1.35,
      minRadius: options.minRadius ?? 2,
      maxRadius: options.maxRadius ?? 25,
      followDamping: options.followDamping ?? 8,
      rotateSpeed: options.rotateSpeed ?? 0.005,
      zoomSpeed: options.zoomSpeed ?? 0.001,
    };
    this.yaw = this.targetYaw = options.yaw ?? 0;
    const { minPitch, maxPitch, minRadius, maxRadius } = this.options;
    this.pitch = this.targetPitch = clamp(Math.atan2(height, distance), minPitch, maxPitch);
    this.radius = this.targetRadius = clamp(Math.hypot(distance, height), minRadius, maxRadius);
    if (options.domElement) this.attach(options.domElement);
  }

  setTarget(target: Object3D | null): void {
    this.target = target;
    this.initialized = false;
  }

  /** Oriente la caméra (radians) ; `immediate` évite la transition. */
  setYaw(yaw: number, immediate = false): void {
    this.targetYaw = yaw;
    if (immediate) this.yaw = yaw;
  }

  /** Branche les contrôles souris (glisser pour tourner, molette pour zoomer). */
  attach(element: HTMLElement): void {
    this.detach();
    let dragging: number | null = null;
    let lastX = 0;
    let lastY = 0;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.button !== 2) return;
      dragging = e.pointerId;
      lastX = e.clientX;
      lastY = e.clientY;
      element.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (dragging !== e.pointerId) return;
      this.rotate(e.clientX - lastX, e.clientY - lastY);
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onUp = (e: PointerEvent) => {
      if (dragging !== e.pointerId) return;
      dragging = null;
      element.releasePointerCapture?.(e.pointerId);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      this.zoom(e.deltaY);
    };
    const onContextMenu = (e: Event) => e.preventDefault();
    element.addEventListener('pointerdown', onDown);
    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerup', onUp);
    element.addEventListener('pointercancel', onUp);
    element.addEventListener('wheel', onWheel, { passive: false });
    element.addEventListener('contextmenu', onContextMenu);
    this.detachers.push(() => {
      element.removeEventListener('pointerdown', onDown);
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerup', onUp);
      element.removeEventListener('pointercancel', onUp);
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('contextmenu', onContextMenu);
    });
  }

  /** Retire les écouteurs souris. */
  detach(): void {
    for (const d of this.detachers) d();
    this.detachers = [];
  }

  /** Tourne autour de la cible (déplacement en pixels). */
  rotate(dx: number, dy: number): void {
    const { rotateSpeed, minPitch, maxPitch } = this.options;
    this.targetYaw -= dx * rotateSpeed;
    this.targetPitch = clamp(this.targetPitch + dy * rotateSpeed, minPitch, maxPitch);
  }

  /** Rapproche (< 0) ou éloigne (> 0) la caméra. */
  zoom(delta: number): void {
    this.targetRadius = clamp(
      this.targetRadius * Math.exp(delta * this.options.zoomSpeed),
      this.options.minRadius,
      this.options.maxRadius,
    );
  }

  /** Place la caméra immédiatement, sans amortissement. */
  snap(): void {
    this.initialized = false;
    this.yaw = this.targetYaw;
    this.pitch = this.targetPitch;
    this.radius = this.targetRadius;
    this.update(0);
  }

  update(dt: number): void {
    if (this.target) {
      this.target.getWorldPosition(this.targetPosition);
      this.targetPosition.y += this.options.lookHeight;
    }
    const lambda = this.options.followDamping;
    if (!this.initialized) {
      this.lookAt.copy(this.targetPosition);
      this.initialized = true;
    } else {
      this.lookAt.set(
        damp(this.lookAt.x, this.targetPosition.x, lambda, dt),
        damp(this.lookAt.y, this.targetPosition.y, lambda, dt),
        damp(this.lookAt.z, this.targetPosition.z, lambda, dt),
      );
    }
    // Orbite et zoom légèrement lissés (réactifs mais sans à-coups).
    this.yaw = dt > 0 ? damp(this.yaw, this.targetYaw, 18, dt) : this.targetYaw;
    this.pitch = dt > 0 ? damp(this.pitch, this.targetPitch, 18, dt) : this.targetPitch;
    this.radius = dt > 0 ? damp(this.radius, this.targetRadius, 10, dt) : this.targetRadius;

    const offset = orbitOffset(this.yaw, this.pitch, this.radius);
    this.camera.position.set(this.lookAt.x + offset.x, this.lookAt.y + offset.y, this.lookAt.z + offset.z);
    this.camera.lookAt(this.lookAt);
  }
}
