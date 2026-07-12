import { Viewer } from "@photo-sphere-viewer/core";
import { MarkersPlugin } from "@photo-sphere-viewer/markers-plugin";

/**
 * Обгортка над Photo Sphere Viewer.
 *
 * - lazily створюється при першому open() і перевикористовується для кожної
 *   наступної панорами (setPanorama робить кросфейд замість перестворення
 *   в'юєра — рух вперед/назад по маршруту виглядає плавно).
 * - вміє малювати клікабельні стрілки "вперед/назад" прямо в панорамі
 *   (як у Google Street View) через MarkersPlugin.
 * - ігнорує клік по стрілці, якщо в цей момент користувач крутив панораму
 *   (drag threshold), щоб уникнути випадкових переходів.
 */

const DRAG_THRESHOLD_PX = 10;

function navMarkerHtml(direction, scale = 1) {
  const rotated = direction === "prev" ? 'transform="rotate(180 12 12)"' : "";
  return `
    <div class="pano-nav-marker pano-nav-marker--${direction}" style="transform: scale(${scale})">
      <svg viewBox="0 0 24 24" width="30" height="30">
        <g ${rotated}>
          <path d="M7 3 L17 12 L7 21" fill="none" stroke="currentColor"
                stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" />
        </g>
      </svg>
    </div>`;
}

export class PanoramaController {
  constructor(container, { onPositionChange } = {}) {
    this.container = container;
    this.onPositionChange = onPositionChange;
    this.viewer = null;
    this.markersPlugin = null;
    this._onNavSelect = null;

    // drag-detection state
    this.isDragging = false;
    this._dragStart = null;
    this._dragPointerId = null;

    // сохраняем ссылки на обработчики, чтобы можно было снять их в destroy()
    this._onPointerDown = this._handlePointerDown.bind(this);
    this._onPointerMove = this._handlePointerMove.bind(this);
    this._onPointerUp = this._handlePointerUp.bind(this);
  }

  _handlePointerDown(e) {
    // сбрасываем именно здесь, а не по таймеру после pointerup —
    // так select-marker (даже если придёт с задержкой) увидит
    // актуальное значение isDragging на момент клика/драга
    this.isDragging = false;
    this._dragPointerId = e.pointerId;
    this._dragStart = { x: e.clientX, y: e.clientY };
  }

  _handlePointerMove(e) {
    if (!this._dragStart || e.pointerId !== this._dragPointerId) return;

    const dx = e.clientX - this._dragStart.x;
    const dy = e.clientY - this._dragStart.y;

    if (Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD_PX) {
      this.isDragging = true;
    }
  }

  _handlePointerUp(e) {
    if (e && e.pointerId !== this._dragPointerId) return;
    this._dragStart = null;
    this._dragPointerId = null;
  }

  async open(url, { yaw = 0, pitch = 0, caption = "" } = {}) {
    if (!this.viewer) {
      this.viewer = new Viewer({
        container: this.container,
        panorama: url,
        navbar: false,
        defaultYaw: yaw,
        defaultPitch: pitch,
        caption,
        loadingTxt: "Завантаження панорами…",
        touchmoveTwoFingers: false,
        mousewheelCtrlKey: false,
        plugins: [[MarkersPlugin, {}]],
      });

      this.markersPlugin = this.viewer.getPlugin(MarkersPlugin);

      this.viewer.addEventListener("position-updated", ({ position }) => {
        if (this.onPositionChange) this.onPositionChange(position);
      });

      this.markersPlugin.addEventListener("select-marker", ({ marker }) => {
        // якщо користувач крутив панораму — ігноруємо клік по стрілці
        if (this.isDragging) return;

        if (this._onNavSelect && marker?.data?.direction) {
          this._onNavSelect(marker.data.direction);
        }
      });

      this.container.addEventListener("pointerdown", this._onPointerDown);
      this.container.addEventListener("pointermove", this._onPointerMove);
      this.container.addEventListener("pointerup", this._onPointerUp);
      this.container.addEventListener("pointercancel", this._onPointerUp);
      this.container.addEventListener("pointerleave", this._onPointerUp);

      await new Promise((resolve) => {
        this.viewer.addEventListener("ready", () => resolve(), { once: true });
      });
      return;
    }

    await this.viewer.setPanorama(url, {
      position: { yaw, pitch },
      caption,
      transition: { effect: "fade", speed: 500, rotation: false },
    });
  }

  /**
   * Малює/оновлює стрілки навігації всередині панорами.
   * markers: [{ id, direction: "next"|"prev", yaw, pitch, tooltip }]
   * onSelect(direction) викликається при кліку на стрілку.
   */
  setNavMarkers(markers, onSelect) {
    if (!this.markersPlugin) return;
    this._onNavSelect = onSelect;
    this.markersPlugin.clearMarkers();
    markers.forEach((m) => {
      this.markersPlugin.addMarker({
        id: m.id,
        position: { yaw: m.yaw, pitch: m.pitch },
        html: navMarkerHtml(m.direction, m.scale ?? 1),
        anchor: "center center",
        tooltip: m.tooltip,
        data: { direction: m.direction },
      });
    });
  }

  destroy() {
    if (this.viewer) {
      this.container.removeEventListener("pointerdown", this._onPointerDown);
      this.container.removeEventListener("pointermove", this._onPointerMove);
      this.container.removeEventListener("pointerup", this._onPointerUp);
      this.container.removeEventListener("pointercancel", this._onPointerUp);
      this.container.removeEventListener("pointerleave", this._onPointerUp);

      this.viewer.destroy();
      this.viewer = null;
      this.markersPlugin = null;
    }

    this.isDragging = false;
    this._dragStart = null;
    this._dragPointerId = null;
  }
}
