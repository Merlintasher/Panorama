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
 */

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
        if (this._onNavSelect && marker?.data?.direction) {
          this._onNavSelect(marker.data.direction);
        }
      });

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
      this.viewer.destroy();
      this.viewer = null;
      this.markersPlugin = null;
    }
  }
}
