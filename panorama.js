import { Viewer } from "@photo-sphere-viewer/core";

/**
 * Обгортка над Photo Sphere Viewer.
 *
 * - lazily створюється при першому open() і перевикористовується для кожної
 *   наступної панорами (setPanorama робить кросфейд замість перестворення
 *   в'юєра — рух вперед/назад по маршруту виглядає плавно).
 *
 * Навігація "вперед/назад" зроблена окремими кнопками по боках екрана
 * (#pano-prev / #pano-next у main.js), а не клікабельними стрілками
 * всередині самої панорами — на телефоні такі стрілки важко влучно
 * натиснути і вони заважають обертати огляд.
 */

export class PanoramaController {
  constructor(container, { onPositionChange } = {}) {
    this.container = container;
    this.onPositionChange = onPositionChange;
    this.viewer = null;
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
      });

      this.viewer.addEventListener("position-updated", ({ position }) => {
        if (this.onPositionChange) this.onPositionChange(position);
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

  destroy() {
    if (this.viewer) {
      this.viewer.destroy();
      this.viewer = null;
    }
  }
}
