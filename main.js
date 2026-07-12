import { MapView } from "./mapview.js";
import { loadTrajectory, computeInitialView } from "./trajectory.js";
import { PanoramaController } from "./panorama.js";

// ---------------------------------------------------------------- CONFIG
const CONFIG = {
  trajectory: {
    // Файл поз: "#timestamp imgname x y z qx qy qz qw"
    posesUrl: "assets/panoramas/poses.txt",
    // imgname у файлі поз (напр. "pano/169....jpg") відносно цього шляху.
    panoramaBaseUrl: "assets/panoramas/",
  },
  orientation: {
    // Локальний "вперед" знімального ріга — використовується лише для
    // початкового напрямку погляду при відкритті панорами.
    // Якщо панорама відкривається не туди — пробуйте [0,1,0], [0,0,1] і т.д.
    forwardAxis: [1, 0, 0],
    // Поправка (у градусах) між світовим азимутом і yaw=0 текстури
    // панорами. Впливає на конус напрямку погляду на мінікарті. Якщо конус
    // показує не в той бік — покрутіть це значення (спробуйте 90, 180, 270,
    // або від'ємні), той самий принцип підбору, що й для forwardAxis.
    worldYawOffsetDeg: 0,
  },
  miniMap: {
    // Скільки метрів по горизонталі показувати в мінікарті навколо
    // поточної точки. Менше значення = більше приближено.
    worldSpanMeters: 22,
  },
};

// ---------------------------------------------------------------- DOM refs
const els = {
  loading: document.getElementById("loading"),
  loadingStatus: document.getElementById("loading-status"),
  mapContainer: document.getElementById("map-view"),
  statPanoramas: document.getElementById("stat-panoramas"),
  statHint: document.getElementById("stat-hint"),
  resetView: document.getElementById("reset-view"),
  miniMapContainer: document.getElementById("mini-map"),

  panoramaOverlay: document.getElementById("panorama-view"),
  panoramaContainer: document.getElementById("panorama-container"),
  panoCaption: document.getElementById("pano-caption"),
  closeBtn: document.getElementById("pano-close"),
  prevBtn: document.getElementById("pano-prev"),
  nextBtn: document.getElementById("pano-next"),
  iris: document.getElementById("iris"),
};

let poses = [];
let currentIndex = -1;

const map = new MapView(els.mapContainer, {
  onMarkerClick: (index, event) => openPanoramaAt(index, event),
});

// Маленька карта в кутку панорами — показує ту саму траєкторію, приближену
// до поточної точки, і теж дозволяє клікнути іншу панораму.
const miniMap = new MapView(els.miniMapContainer, {
  onMarkerClick: (index, event) => openPanoramaAt(index, event),
});

const panorama = new PanoramaController(els.panoramaContainer, {
  // Живий конус напрямку погляду на мінікарті, синхронізований з тим,
  // куди користувач зараз дивиться всередині панорами.
  onPositionChange: ({ yaw }) => {
    if (currentIndex < 0) return;
    const offsetRad = (CONFIG.orientation.worldYawOffsetDeg * Math.PI) / 180;
    const twoPi = Math.PI * 2;
    const worldBearing = ((yaw - offsetRad) % twoPi + twoPi) % twoPi;
    miniMap.setHeading(currentIndex, worldBearing);
  },
});

// ---------------------------------------------------------------- init

async function init() {
  setStatus("Завантаження траєкторії панорам…");
  try {
    poses = await loadTrajectory(CONFIG.trajectory.posesUrl);
    map.setTrajectory(poses);
    miniMap.setTrajectory(poses);
    els.statPanoramas.textContent = String(poses.length);
  } catch (err) {
    console.error(err);
    setStatus("Не вдалося завантажити файл траєкторії. Перевірте шлях і консоль браузера (F12).");
    return;
  }

  hideLoading();
}

function setStatus(text) {
  els.loadingStatus.textContent = text;
}

function hideLoading() {
  els.loading.classList.add("hidden");
}

// ---------------------------------------------------------------- panorama flow

function panoramaUrlFor(pose) {
  return CONFIG.trajectory.panoramaBaseUrl + pose.imgname;
}

function formatCaption(pose) {
  const date = new Date(pose.timestamp * 1000);
  const dateStr = Number.isFinite(date.getTime()) ? date.toLocaleString("uk-UA") : "";
  return `${dateStr}  ·  ${pose.index + 1} / ${poses.length}`;
}

async function openPanoramaAt(index, event) {
  const pose = poses[index];
  if (!pose) return;

  currentIndex = index;
  map.setActiveMarker(index);
  miniMap.setActiveMarker(index, { worldSpan: CONFIG.miniMap.worldSpanMeters });
  triggerIris(event);
  els.panoramaOverlay.classList.add("visible");

  const { yaw, pitch } = computeInitialView(pose, CONFIG.orientation.forwardAxis);
  const caption = formatCaption(pose);

  els.panoCaption.textContent = caption;
  updateNavButtons();

  try {
    await panorama.open(panoramaUrlFor(pose), { yaw, pitch, caption });
  } catch (err) {
    console.error(err);
    els.panoCaption.textContent = "Не вдалося завантажити зображення панорами";
  }
}

function step(delta) {
  const next = currentIndex + delta;
  if (next < 0 || next >= poses.length) return;
  openPanoramaAt(next);
}

function closePanorama() {
  els.panoramaOverlay.classList.remove("visible");
  map.clearActiveMarker();
  miniMap.clearActiveMarker();
  currentIndex = -1;
}

function updateNavButtons() {
  els.prevBtn.disabled = currentIndex <= 0;
  els.nextBtn.disabled = currentIndex >= poses.length - 1;
}

function triggerIris(event) {
  const x = event ? event.clientX : window.innerWidth / 2;
  const y = event ? event.clientY : window.innerHeight / 2;
  els.iris.style.setProperty("--x", `${x}px`);
  els.iris.style.setProperty("--y", `${y}px`);
  els.iris.classList.remove("play");
  void els.iris.offsetWidth;
  els.iris.classList.add("play");
}

// ---------------------------------------------------------------- events

// Кнопки (стрілки навігації, закрити, скинути вигляд) лежать поверх зони,
// де користувач обертає панораму/тягає карту пальцем. Нативний браузерний
// "click" на тач-пристроях спрацьовує на елементі, над яким палець
// опинився В МОМЕНТ ВІДПУСКАННЯ — навіть якщо жест почався деінде
// (людина просто крутила огляд, а не цілилась у кнопку). Через це
// звичайний addEventListener("click", ...) ненадійний тут.
//
// Рішення: обробляємо натискання самі через pointerdown/pointerup і
// вважаємо це тапом по кнопці, лише якщо ОБИДВІ події — і початок,
// і кінець жесту — відбулись на цій самій кнопці, і зміщення пальця між
// ними мале. Нативний "click" при цьому повністю блокуємо, щоб він не міг
// випадково викликати дію ще раз чи спрацювати сам по собі після дрегу,
// що почався поза кнопкою.
const TAP_MOVE_THRESHOLD_PX = 10;

function bindTapButton(el, handler) {
  let startPos = null;
  let startedOnButton = false;

  el.addEventListener("pointerdown", (e) => {
    startedOnButton = true;
    startPos = { x: e.clientX, y: e.clientY };
  });

  el.addEventListener("pointermove", (e) => {
    if (!startedOnButton || !startPos) return;
    const dx = e.clientX - startPos.x;
    const dy = e.clientY - startPos.y;
    if (Math.hypot(dx, dy) > TAP_MOVE_THRESHOLD_PX) {
      // палець з'їхав з кнопки надто далеко — це вже не тап, а жест
      startedOnButton = false;
    }
  });

  el.addEventListener("pointerup", (e) => {
    if (startedOnButton) {
      handler(e);
    }
    startedOnButton = false;
    startPos = null;
  });

  el.addEventListener("pointercancel", () => {
    startedOnButton = false;
    startPos = null;
  });

  // Нативний click повністю ігноруємо — навігацію викликає лише
  // pointerup вище, коли жест дійсно почався на кнопці.
  el.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
}

bindTapButton(els.closeBtn, closePanorama);
bindTapButton(els.prevBtn, () => step(-1));
bindTapButton(els.nextBtn, () => step(1));
bindTapButton(els.resetView, () => map.fitToBounds(poses));

window.addEventListener("keydown", (e) => {
  if (!els.panoramaOverlay.classList.contains("visible")) return;
  if (e.key === "ArrowRight") step(1);
  if (e.key === "ArrowLeft") step(-1);
  if (e.key === "Escape") closePanorama();
});

init();
