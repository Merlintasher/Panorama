import { MapView } from "./mapview.js";
import { loadTrajectory, computeInitialView, computeNavArrowAim } from "./trajectory.js";
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
    // панорами. Впливає на те, куди показують стрілки "вперед/назад" і на
    // конус напрямку погляду на мінікарті. Якщо стрілки вказують не в той
    // бік маршруту — покрутіть це значення (спробуйте 90, 180, 270, або
    // від'ємні), той самий принцип підбору, що й для forwardAxis.
    worldYawOffsetDeg: 0,
  },
  navArrows: {
    // Висота ока над землею (метри) — визначає, наскільки різко стрілка
    // "падає" вниз для близьких сусідніх точок. Зменшіть, якщо стрілки
    // виглядають задерто вгору; збільшіть, якщо задерто в підлогу.
    eyeHeight: 1.6,
    minPitch: -0.55,
    maxPitch: -0.05,
    // Розмір стрілки трохи змінюється залежно від відстані до сусідньої
    // точки (ближче — більша), в межах цього діапазону.
    minScale: 0.75,
    maxScale: 1.25,
    // Відстань (метри), на якій розмір стрілки вважається "базовим" (1.0).
    referenceDistance: 3,
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

function distanceToScale(distance) {
  const { minScale, maxScale, referenceDistance } = CONFIG.navArrows;
  // Ближче за референсну відстань -> більша стрілка; далі -> менша.
  const ratio = referenceDistance / Math.max(distance, 0.3);
  return Math.min(maxScale, Math.max(minScale, ratio));
}

function buildNavMarkers(index) {
  const pose = poses[index];
  const offsetRad = (CONFIG.orientation.worldYawOffsetDeg * Math.PI) / 180;
  const { eyeHeight, minPitch, maxPitch } = CONFIG.navArrows;
  const markers = [];

  const next = poses[index + 1];
  if (next) {
    const { yaw, pitch, distance } = computeNavArrowAim(pose, next, {
      offsetRad, eyeHeight, minPitch, maxPitch,
    });
    markers.push({
      id: "nav-next",
      direction: "next",
      yaw, pitch,
      scale: distanceToScale(distance),
      tooltip: "Вперед",
    });
  }

  const prev = poses[index - 1];
  if (prev) {
    const { yaw, pitch, distance } = computeNavArrowAim(pose, prev, {
      offsetRad, eyeHeight, minPitch, maxPitch,
    });
    markers.push({
      id: "nav-prev",
      direction: "prev",
      yaw, pitch,
      scale: distanceToScale(distance),
      tooltip: "Назад",
    });
  }

  return markers;
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
    panorama.setNavMarkers(buildNavMarkers(index), (direction) => {
      step(direction === "next" ? 1 : -1);
    });
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

els.closeBtn.addEventListener("click", closePanorama);
els.prevBtn.addEventListener("click", () => step(-1));
els.nextBtn.addEventListener("click", () => step(1));
els.resetView.addEventListener("click", () => map.fitToBounds(poses));

window.addEventListener("keydown", (e) => {
  if (!els.panoramaOverlay.classList.contains("visible")) return;
  if (e.key === "ArrowRight") step(1);
  if (e.key === "ArrowLeft") step(-1);
  if (e.key === "Escape") closePanorama();
});

let touchStartX = null;
els.panoramaContainer.addEventListener("touchstart", (e) => {
  if (e.touches.length === 1) touchStartX = e.touches[0].clientX;
}, { passive: true });
els.panoramaContainer.addEventListener("touchend", (e) => {
  if (touchStartX === null) return;
  const dx = e.changedTouches[0].clientX - touchStartX;
  touchStartX = null;
  if (Math.abs(dx) > 140) step(dx > 0 ? -1 : 1);
}, { passive: true });

init();
