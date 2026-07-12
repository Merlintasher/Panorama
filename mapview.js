// Проста 2D-карта маршруту (вигляд зверху), без three.js.
// Малює лінію траєкторії + клікабельні точки-панорами на <canvas>.
// Підтримує панорамування (drag) і зум (колесо миші / pinch на тач-пристроях).

const LINE_COLOR = "rgba(94, 230, 200, 0.9)";
const LINE_GLOW_COLOR = "rgba(94, 230, 200, 0.16)";
const MARKER_COLOR = "#ffb454";
const MARKER_COLOR_ACTIVE = "#fff6e0";
const MARKER_STROKE = "rgba(6, 11, 10, 0.55)";

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

export class MapView {
  constructor(container, { onMarkerClick } = {}) {
    this.container = container;
    this.onMarkerClick = onMarkerClick;

    this.canvas = document.createElement("canvas");
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");

    this.poses = [];
    this.points = []; // { x, y, index } у світових координатах (x,y — горизонтальна площина)
    this.screenPoints = []; // оновлюється щорендеру, для hit-test

    this.view = { scale: 1, cx: 0, cy: 0 }; // scale = пікселів на одиницю світу
    this._fitScale = 1;
    this.activeIndex = -1;
    this.hoverIndex = -1;

    this._activePointers = new Map(); // pointerId -> { x, y } (screen coords)
    this._downPointer = null;
    this._dragging = false;
    this._dragStartView = null;
    this._pinchLastDist = null;
    this._pinchLastMid = null;

    this.width = 0;
    this.height = 0;

    this._bindEvents();
    this._resize();
  }

  // ---------------------------------------------------------------- setup

  _bindEvents() {
    const ro = new ResizeObserver(() => this._resize());
    ro.observe(this.container);

    const c = this.canvas;

    c.addEventListener("pointerdown", (e) => {
      this._activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { c.setPointerCapture(e.pointerId); } catch {}

      if (this._activePointers.size === 2) {
        // почався pinch — скасовуємо одно-пальцевий drag/клік
        this._downPointer = null;
        this._dragging = false;
        this._startPinch();
        return;
      }

      if (this._activePointers.size === 1) {
        this._downPointer = { x: e.clientX, y: e.clientY };
        this._dragStartView = { ...this.view };
        this._dragging = false;
      }
    });

    c.addEventListener("pointermove", (e) => {
      if (!this._activePointers.has(e.pointerId)) {
        this._updateHover(e);
        return;
      }
      this._activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this._activePointers.size >= 2) {
        this._handlePinchMove();
        return;
      }

      if (this._downPointer) {
        const dx = e.clientX - this._downPointer.x;
        const dy = e.clientY - this._downPointer.y;
        if (!this._dragging && Math.hypot(dx, dy) > 6) this._dragging = true;
        if (this._dragging) {
          this.view.cx = this._dragStartView.cx - dx / this.view.scale;
          this.view.cy = this._dragStartView.cy + dy / this.view.scale;
          this._render();
        }
      }
    });

    const endPointer = (e) => {
      const wasTracked = this._activePointers.has(e.pointerId);
      this._activePointers.delete(e.pointerId);
      try { c.releasePointerCapture(e.pointerId); } catch {}
      if (!wasTracked) return;

      if (this._activePointers.size >= 2) {
        // все ще pinch (був третій палець) — перестартувати відлік
        this._startPinch();
        return;
      }

      if (this._activePointers.size === 1) {
        // з двох пальців лишився один — продовжуємо як звичайний drag,
        // без стрибка, і не рахуємо це кліком
        this._pinchLastDist = null;
        const [remaining] = this._activePointers.values();
        this._downPointer = { x: remaining.x, y: remaining.y };
        this._dragStartView = { ...this.view };
        this._dragging = true;
        return;
      }

      // останній палець прибрано
      this._pinchLastDist = null;
      const wasDragging = this._dragging;
      const start = this._downPointer;
      this._dragging = false;
      this._downPointer = null;
      if (wasDragging || !start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (Math.hypot(dx, dy) > 6) return;
      this._handleClick(e);
    };

    c.addEventListener("pointerup", endPointer);
    c.addEventListener("pointercancel", endPointer);

    c.addEventListener("wheel", (e) => this._handleWheel(e), { passive: false });
  }

  _pointerMidScreen() {
    const [p1, p2] = this._activePointers.values();
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (p1.x + p2.x) / 2 - rect.left,
      y: (p1.y + p2.y) / 2 - rect.top,
    };
  }

  _pointerDist() {
    const [p1, p2] = this._activePointers.values();
    return Math.hypot(p1.x - p2.x, p1.y - p2.y);
  }

  _startPinch() {
    this._pinchLastDist = this._pointerDist();
    this._pinchLastMid = this._pointerMidScreen();
  }

  _handlePinchMove() {
    const dist = this._pointerDist();
    const mid = this._pointerMidScreen();

    if (this._pinchLastDist == null || this._pinchLastMid == null) {
      this._pinchLastDist = dist;
      this._pinchLastMid = mid;
      return;
    }

    // 1) панорамування — рух середньої точки між двома пальцями
    const dx = mid.x - this._pinchLastMid.x;
    const dy = mid.y - this._pinchLastMid.y;
    this.view.cx -= dx / this.view.scale;
    this.view.cy += dy / this.view.scale;

    // 2) масштабування — прив'язане до поточної середньої точки між
    // пальцями, щоб карта не "стрибала" під час зведення/розведення
    const before = this.screenToWorld(mid.x, mid.y);
    const factor = dist / this._pinchLastDist;
    this.view.scale = clamp(this.view.scale * factor, this._fitScale * 0.15, this._fitScale * 60);
    const after = this.screenToWorld(mid.x, mid.y);
    this.view.cx += before.x - after.x;
    this.view.cy += before.y - after.y;

    this._pinchLastDist = dist;
    this._pinchLastMid = mid;
    this._render();
  }

  _resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = w;
    this.height = h;
    this._render();
  }

  // ---------------------------------------------------------------- data

  setTrajectory(poses) {
    this.poses = poses;
    this.points = poses.map((p) => ({ x: p.position.x, y: p.position.y, index: p.index }));
    this.fitToBounds(poses);
  }

  fitToBounds(poses = this.poses) {
    if (!poses.length || this.width === 0) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    poses.forEach((p) => {
      minX = Math.min(minX, p.position.x);
      maxX = Math.max(maxX, p.position.x);
      minY = Math.min(minY, p.position.y);
      maxY = Math.max(maxY, p.position.y);
    });
    const w = Math.max(maxX - minX, 1);
    const h = Math.max(maxY - minY, 1);
    const pad = 0.82; // невеликі поля навколо маршруту
    const scale = Math.min(this.width / w, this.height / h) * pad;
    this._fitScale = clamp(scale, 0.0001, 100000);
    this.view = {
      scale: this._fitScale,
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
    };
    this._render();
  }

  // ---------------------------------------------------------------- coords

  worldToScreen(x, y) {
    return {
      sx: this.width / 2 + (x - this.view.cx) * this.view.scale,
      sy: this.height / 2 - (y - this.view.cy) * this.view.scale, // Y вгору = північ вгору
    };
  }

  screenToWorld(sx, sy) {
    return {
      x: this.view.cx + (sx - this.width / 2) / this.view.scale,
      y: this.view.cy - (sy - this.height / 2) / this.view.scale,
    };
  }

  // ---------------------------------------------------------------- zoom/pan

  _handleWheel(e) {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const before = this.screenToWorld(sx, sy);

    const factor = Math.exp(-e.deltaY * 0.0012);
    this.view.scale = clamp(this.view.scale * factor, this._fitScale * 0.15, this._fitScale * 60);

    const after = this.screenToWorld(sx, sy);
    this.view.cx += before.x - after.x;
    this.view.cy += before.y - after.y;
    this._render();
  }

  // ---------------------------------------------------------------- picking

  _hitTest(sx, sy, radius = 15) {
    let found = -1;
    let bestD = Infinity;
    for (const p of this.screenPoints) {
      const d = Math.hypot(p.sx - sx, p.sy - sy);
      if (d < radius && d < bestD) {
        bestD = d;
        found = p.index;
      }
    }
    return found;
  }

  _updateHover(e) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const idx = this._hitTest(sx, sy);
    this.canvas.style.cursor = idx >= 0 ? "pointer" : "grab";
    if (idx !== this.hoverIndex) {
      this.hoverIndex = idx;
      this._render();
    }
  }

  _handleClick(e) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const idx = this._hitTest(sx, sy);
    if (idx >= 0 && this.onMarkerClick) this.onMarkerClick(idx, e);
  }

  // ---------------------------------------------------------------- markers

  // worldSpan (опційно): скільки метрів по горизонталі має влазити в ширину
  // карти після переходу на маркер — зручно для маленької мінікарти, щоб
  // вона трималась "близько" до поточної точки, а не показувала весь маршрут.
  setActiveMarker(index, { worldSpan } = {}) {
    this.activeIndex = index;
    if (worldSpan) {
      const targetScale = this.width / worldSpan;
      this.view.scale = clamp(targetScale, this._fitScale * 0.1, this._fitScale * 300);
    }
    this._panTo(index);
    this._render();
  }

  clearActiveMarker() {
    this.activeIndex = -1;
    this._heading = null;
    this._render();
  }

  // Малює конус напрямку погляду (як синя "фара" на Google-картах) біля
  // активного маркера. bearingRad — світовий азимут (0 = +Y, за годинниковою
  // стрілкою), той самий формат, що повертає computeNavArrowAim().yaw мінус
  // worldYawOffsetDeg.
  setHeading(index, bearingRad) {
    this._heading = { index, bearing: bearingRad };
    this._render();
  }

  clearHeading() {
    this._heading = null;
    this._render();
  }

  _panTo(index) {
    const p = this.points[index];
    if (!p) return;
    const startCx = this.view.cx;
    const startCy = this.view.cy;
    const t0 = performance.now();
    const duration = 420;
    const step = (now) => {
      const t = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      this.view.cx = startCx + (p.x - startCx) * eased;
      this.view.cy = startCy + (p.y - startCy) * eased;
      this._render();
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ---------------------------------------------------------------- render

  _render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    if (!this.points.length) return;

    // лінія маршруту: широка розмита підкладка + чіткий контур
    ctx.beginPath();
    this.points.forEach((p, i) => {
      const { sx, sy } = this.worldToScreen(p.x, p.y);
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = LINE_GLOW_COLOR;
    ctx.lineWidth = 9;
    ctx.stroke();
    ctx.strokeStyle = LINE_COLOR;
    ctx.lineWidth = 2.4;
    ctx.stroke();

    // точки-панорами
    this.screenPoints = [];
    this.points.forEach((p) => {
      const { sx, sy } = this.worldToScreen(p.x, p.y);
      this.screenPoints.push({ sx, sy, index: p.index });

      const isActive = p.index === this.activeIndex;
      const isHover = p.index === this.hoverIndex;
      const r = isActive ? 9 : isHover ? 7 : 5;

      if (isActive) {
        const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 3.4);
        glow.addColorStop(0, "rgba(255, 246, 224, 0.5)");
        glow.addColorStop(1, "rgba(255, 246, 224, 0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(sx, sy, r * 3.4, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = isActive ? MARKER_COLOR_ACTIVE : MARKER_COLOR;
      ctx.fill();
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = MARKER_STROKE;
      ctx.stroke();

      if (isActive && this._heading && this._heading.index === p.index) {
        this._drawHeadingCone(sx, sy, this._heading.bearing);
      }
    });
  }

  _drawHeadingCone(sx, sy, bearing) {
    const ctx = this.ctx;
    // Одиничний світовий напрямок (sin, cos) -> екранний вектор (y інвертовано,
    // бо на екрані вниз — це додатне Y, а в світі вгору-північ — додатне Y).
    const dirX = Math.sin(bearing);
    const dirY = -Math.cos(bearing);
    const angle = Math.atan2(dirY, dirX);
    const radius = 42;
    const halfFov = 0.55; // ~63° розкриття конуса

    const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, radius);
    grad.addColorStop(0, "rgba(94, 230, 200, 0.5)");
    grad.addColorStop(1, "rgba(94, 230, 200, 0)");

    ctx.save();
    ctx.translate(sx, sy);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius, angle - halfFov, angle + halfFov);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
  }
}
