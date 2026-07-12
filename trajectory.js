import * as THREE from "three";

/**
 * Завантажує і парсить файл траєкторії панорам.
 *
 * Очікуваний формат (через пробіл, один заголовковий рядок з #):
 *   #timestamp imgname x y z qx qy qz qw
 *   1783518563.624737 pano/1783518563.624737.jpg 3323287.427846 5580917.481488 168.578918 0.539840 -0.475107 0.521073 -0.459706
 *
 * x, y, z вважаються тією самою системою координат, що й хмара точок
 * (горизонтальна площина x/y, z — висота).
 */
export async function loadTrajectory(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Не вдалося завантажити файл траєкторії: ${url} (HTTP ${res.status})`);
  }
  const text = await res.text();

  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));

  const poses = lines
    .map((line) => {
      const parts = line.split(/\s+/);
      if (parts.length < 9) return null;
      const [timestamp, imgname, x, y, z, qx, qy, qz, qw] = parts;
      return {
        timestamp: parseFloat(timestamp),
        imgname,
        position: { x: parseFloat(x), y: parseFloat(y), z: parseFloat(z) },
        quaternion: { x: parseFloat(qx), y: parseFloat(qy), z: parseFloat(qz), w: parseFloat(qw) },
      };
    })
    .filter(Boolean);

  poses.sort((a, b) => a.timestamp - b.timestamp);
  poses.forEach((p, i) => (p.index = i));

  return poses;
}

/**
 * Перетворює кватерніон пози на початковий yaw/pitch (радіани) для
 * панорамного в'юєра, щоб панорама відкривалась обличчям у той бік,
 * куди дивилась камера під час зйомки.
 *
 * `forwardAxis` — локальний "вперед" знімального ріга у власній системі
 * координат (той самий порядок осей, що й кватерніон).
 *
 * Якщо панорами відкриваються не в той бік — пробуйте [0,1,0], [0,0,1],
 * [-1,0,0] і т.д. у main.js -> CONFIG.orientation.forwardAxis, доки не
 * стане правильно. Це залежить від того, як конкретний SLAM/знімальний
 * риг визначає свої локальні осі, і наперед це знати неможливо.
 */
export function computeInitialView(pose, forwardAxis = [1, 0, 0]) {
  const q = new THREE.Quaternion(
    pose.quaternion.x,
    pose.quaternion.y,
    pose.quaternion.z,
    pose.quaternion.w
  );

  const forward = new THREE.Vector3(...forwardAxis)
    .normalize()
    .applyQuaternion(q)
    .normalize();

  // Photo Sphere Viewer: X -> right, Y -> up, Z -> forward
  const yaw = Math.atan2(forward.x, forward.z);
  const pitch = Math.asin(THREE.MathUtils.clamp(forward.y, -1, 1));

  return { yaw, pitch };
}

/**
 * Обчислює, куди в панорамі має "дивитись" стрілка навігації "вперед/назад"
 * (як у Google Street View), щоб вона виглядала прив'язаною до реального
 * маршруту, а не висіла в довільному місці кадру.
 *
 * yaw — напрямок за світовими x/y (горизонтальна площина). Використовує
 * лише позиції, без кватерніона: панорамна текстура має ФІКСОВАНУ
 * орієнтацію відносно світу (типово вирівняну по компасу під час зйомки),
 * тому один і той самий offsetRad працює для всіх точок маршруту.
 * Якщо стрілки показують не в той бік — підберіть offsetRad (у main.js ->
 * CONFIG.orientation.worldYawOffsetDeg), той самий принцип підбору методом
 * спроб, що й для forwardAxis вище.
 *
 * pitch — нахил "до землі", розрахований з трикутника
 * (висота ока над землею) / (горизонтальна відстань до сусідньої точки) +
 * враховує різницю висот (z) між точками. Завдяки цьому стрілка до
 * ближньої панорами дивиться різкіше вниз, а до дальньої — майже
 * горизонтально, як і має бути. minPitch/maxPitch — межі, щоб стрілка не
 * "залипала" в підлогу чи не спливала до горизонту при екстремальних
 * відстанях; eyeHeight — підберіть під зріст оператора/висоту камери, якщо
 * стрілки виглядають зависокими чи занизькими.
 */
export function computeNavArrowAim(
  fromPose,
  toPose,
  {
    offsetRad = 0,
    eyeHeight = 1.6,
    minPitch = -0.55,
    maxPitch = -0.05,
  } = {}
) {
  const dx = toPose.position.x - fromPose.position.x;
  const dy = toPose.position.y - fromPose.position.y;
  const dz = toPose.position.z - fromPose.position.z;

  const horizDist = Math.max(Math.hypot(dx, dy), 0.3);
  const dist3d = Math.hypot(dx, dy, dz);

  const twoPi = Math.PI * 2;
  let yaw = Math.atan2(dx, dy) + offsetRad;
  yaw = ((yaw % twoPi) + twoPi) % twoPi;

  // Ціль — точка на "землі" сусідньої панорами: настільки нижче рівня ока,
  // наскільки нижча (чи вища) сама точка з урахуванням висоти ока.
  const verticalDrop = Math.max(eyeHeight - dz, 0.15);
  let pitch = -Math.atan2(verticalDrop, horizDist);
  pitch = Math.min(maxPitch, Math.max(minPitch, pitch));

  return { yaw, pitch, distance: dist3d };
}
