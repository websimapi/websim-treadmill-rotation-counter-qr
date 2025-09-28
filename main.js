// ...existing code...
const els = {
  video: document.getElementById('video'),
  overlay: document.getElementById('overlay'),
  cameraSelect: document.getElementById('cameraSelect'),
  startBtn: document.getElementById('startBtn'),
  stopBtn: document.getElementById('stopBtn'),
  resetBtn: document.getElementById('resetBtn'),
  detectDot: document.getElementById('detectDot'),
  statusText: document.getElementById('statusText'),
  count: document.getElementById('count'),
  lastDet: document.getElementById('lastDet'),
  fps: document.getElementById('fps'),
  targetData: document.getElementById('targetData'),
  zoomControls: document.getElementById('zoomControls'),
  zoomRange: document.getElementById('zoomRange'),
  zoomMinus: document.getElementById('zoomMinus'),
  zoomPlus: document.getElementById('zoomPlus'),
  zoomVal: document.getElementById('zoomVal'),
};

let stream = null;
let detector = 'auto'; // 'barcode', 'jsqr'
let running = false;
let rotationCount = 0;
let state = 'WAIT_VISIBLE'; // or 'WAIT_INVISIBLE'
let visibleFrames = 0;
let invisibleFrames = 0;
let lastDetStr = '';
let lastFrameTime = performance.now();
let fpsAvg = 0;
let zoomCaps = null, zoomTrack = null, pinch = null;

const MIN_VISIBLE_FRAMES = 2;
const MIN_INVISIBLE_FRAMES = 2;
const MIN_BOX_AREA_RATIO = 0.005; // must be at least 0.5% of frame area

// dynamic target linked to generator
function getTargetData() { return els.targetData.textContent.trim(); }

// Camera setup
async function listCameras() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const vids = devices.filter(d => d.kind === 'videoinput');
  els.cameraSelect.innerHTML = '';
  vids.forEach((d, i) => {
    const opt = document.createElement('option');
    opt.value = d.deviceId;
    opt.textContent = d.label || `Camera ${i+1}`;
    els.cameraSelect.appendChild(opt);
  });
}

async function startCamera() {
  await stopCamera();
  const deviceId = els.cameraSelect.value || undefined;
  stream = await navigator.mediaDevices.getUserMedia({
    video: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      facingMode: deviceId ? undefined : { ideal: 'environment' },
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 60 }
    },
    audio: false
  });
  els.video.srcObject = stream;
  await els.video.play();
  running = true;
  els.startBtn.disabled = true;
  els.stopBtn.disabled = false;
  els.statusText.textContent = 'Running';
  setupOverlay();
  chooseDetector();
  setupZoom();
  loop();
}

async function stopCamera() {
  running = false;
  els.startBtn.disabled = false;
  els.stopBtn.disabled = true;
  els.statusText.textContent = 'Stopped';
  zoomTrack = null; zoomCaps = null; els.zoomControls.classList.add('hidden');
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
}

function setupOverlay() {
  const { videoWidth: w, videoHeight: h } = els.video;
  const c = els.overlay;
  c.width = w; c.height = h;
}
window.addEventListener('resize', () => running && setupOverlay());

function chooseDetector() {
  if ('BarcodeDetector' in window) {
    try {
      const bd = new window.BarcodeDetector({ formats: ['qr_code'] });
      // simple ping
      detector = 'barcode';
      // stash instance
      chooseDetector.instance = bd;
      els.statusText.textContent = 'Detector: Barcode';
      return;
    } catch {}
  }
  detector = 'jsqr';
  els.statusText.textContent = 'Detector: jsQR';
}

function drawOverlay(box) {
  const ctx = els.overlay.getContext('2d');
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (!box) return;
  ctx.strokeStyle = '#0a8f3c';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(box.topLeft.x, box.topLeft.y);
  ctx.lineTo(box.topRight.x, box.topRight.y);
  ctx.lineTo(box.bottomRight.x, box.bottomRight.y);
  ctx.lineTo(box.bottomLeft.x, box.bottomLeft.y);
  ctx.closePath();
  ctx.stroke();
}

function areaOfBox(box) {
  // approximate polygon area via bounding box
  const xs = [box.topLeft.x, box.topRight.x, box.bottomRight.x, box.bottomLeft.x];
  const ys = [box.topLeft.y, box.topRight.y, box.bottomRight.y, box.bottomLeft.y];
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return (maxX - minX) * (maxY - minY);
}

function updateFPS() {
  const now = performance.now();
  const dt = now - lastFrameTime;
  lastFrameTime = now;
  const fps = 1000 / dt;
  fpsAvg = fpsAvg ? (fpsAvg * 0.9 + fps * 0.1) : fps;
  els.fps.textContent = Math.round(fpsAvg);
}

function updateState(visibleNow) {
  if (visibleNow) {
    visibleFrames++;
    invisibleFrames = 0;
  } else {
    invisibleFrames++;
  }

  if (state === 'WAIT_VISIBLE') {
    if (visibleFrames >= MIN_VISIBLE_FRAMES) {
      state = 'WAIT_INVISIBLE';
      els.detectDot.classList.add('ok');
      els.statusText.textContent = 'Marker in view';
    }
  } else if (state === 'WAIT_INVISIBLE') {
    if (invisibleFrames >= MIN_INVISIBLE_FRAMES) {
      rotationCount++;
      els.count.textContent = rotationCount;
      els.detectDot.classList.remove('ok');
      els.detectDot.classList.add('warn');
      els.statusText.textContent = 'Marker passed';
      els.lastDet.textContent = new Date().toLocaleTimeString();
      state = 'WAIT_VISIBLE';
      visibleFrames = 0;
      invisibleFrames = 0;
      // remove warn after brief moment
      setTimeout(() => els.detectDot.classList.remove('warn'), 300);
    }
  }

  if (!visibleNow && state === 'WAIT_VISIBLE') {
    visibleFrames = 0;
  }
}

async function loop() {
  if (!running) return;
  updateFPS();

  const w = els.overlay.width;
  const h = els.overlay.height;

  let detected = { ok: false, text: '', box: null };

  if (detector === 'barcode') {
    try {
      const bd = chooseDetector.instance;
      const codes = await bd.detect(els.video);
      for (const c of codes) {
        const txt = (c.rawValue || '').trim();
        if (txt === getTargetData()) {
          const box = {
            topLeft: c.cornerPoints[0],
            topRight: c.cornerPoints[1],
            bottomRight: c.cornerPoints[2],
            bottomLeft: c.cornerPoints[3],
          };
          const area = areaOfBox(box);
          if (area / (w * h) >= MIN_BOX_AREA_RATIO) {
            detected = { ok: true, text: txt, box };
            break;
          }
        }
      }
    } catch {}
  } else {
    // jsQR fallback: draw frame to canvas, run jsQR
    const ctx = els.overlay.getContext('2d');
    ctx.drawImage(els.video, 0, 0, w, h);
    const imgData = ctx.getImageData(0, 0, w, h);
    const { default: jsQR } = await import('jsqr');
    const qr = jsQR(imgData.data, w, h, { inversionAttempts: 'attemptBoth' });
    if (qr && qr.data.trim() === getTargetData()) {
      const box = {
        topLeft: qr.location.topLeftCorner,
        topRight: qr.location.topRightCorner,
        bottomRight: qr.location.bottomRightCorner,
        bottomLeft: qr.location.bottomLeftCorner,
      };
      const area = areaOfBox(box);
      if (area / (w * h) >= MIN_BOX_AREA_RATIO) {
        detected = { ok: true, text: qr.data.trim(), box };
      }
    }
  }

  drawOverlay(detected.box);
  els.detectDot.classList.toggle('ok', detected.ok);
  els.statusText.textContent = detected.ok ? 'Marker in view' : 'Scanning…';
  updateState(detected.ok);

  requestAnimationFrame(loop);
}

// Events
els.startBtn.addEventListener('click', startCamera);
els.stopBtn.addEventListener('click', stopCamera);
els.resetBtn.addEventListener('click', () => {
  rotationCount = 0;
  els.count.textContent = '0';
  state = 'WAIT_VISIBLE';
  visibleFrames = 0;
  invisibleFrames = 0;
  els.statusText.textContent = running ? 'Scanning…' : 'Idle';
});

navigator.mediaDevices?.getUserMedia && listCameras();

function setupZoom() {
  zoomTrack = stream?.getVideoTracks?.()[0] || null;
  zoomCaps = zoomTrack?.getCapabilities?.() || null;
  if (zoomCaps && 'zoom' in zoomCaps) {
    const { min, max, step } = zoomCaps.zoom;
    els.zoomRange.min = String(min || 1);
    els.zoomRange.max = String(max || 1);
    els.zoomRange.step = String(step || 0.1);
    els.zoomRange.value = String(zoomTrack.getSettings().zoom ?? min ?? 1);
    updateZoomUI(parseFloat(els.zoomRange.value));
    els.zoomControls.classList.remove('hidden');
  } else {
    els.zoomControls.classList.add('hidden');
  }
  bindZoomEvents();
}

function setZoom(v) {
  if (!zoomTrack || !zoomCaps?.zoom) return;
  const { min, max } = zoomCaps.zoom;
  const val = Math.min(max, Math.max(min, v));
  zoomTrack.applyConstraints({ advanced: [{ zoom: val }] }).catch(()=>{});
  updateZoomUI(val);
}

function updateZoomUI(v) {
  els.zoomRange.value = String(v);
  els.zoomVal.textContent = `${v.toFixed(1)}×`;
}

function bindZoomEvents() {
  els.zoomRange.oninput = (e)=> setZoom(parseFloat(e.target.value));
  els.zoomMinus.onclick = ()=> setZoom(parseFloat(els.zoomRange.value) - (parseFloat(els.zoomRange.step)||0.1));
  els.zoomPlus.onclick = ()=> setZoom(parseFloat(els.zoomRange.value) + (parseFloat(els.zoomRange.step)||0.1));
  enablePinchZoom(els.video);
}

function enablePinchZoom(el) {
  const active = new Map();
  const onDown = (e)=>{ el.setPointerCapture(e.pointerId); active.set(e.pointerId,{x:e.clientX,y:e.clientY}); if(active.size===2) startPinch(); };
  const onMove = (e)=>{ if(!active.has(e.pointerId)) return; active.set(e.pointerId,{x:e.clientX,y:e.clientY}); if(pinch) updatePinch(); };
  const onUp = (e)=>{ active.delete(e.pointerId); if(active.size<2) pinch=null; };
  el.addEventListener('pointerdown', onDown, {passive:false});
  el.addEventListener('pointermove', onMove, {passive:false});
  el.addEventListener('pointerup', onUp); el.addEventListener('pointercancel', onUp); el.addEventListener('pointerleave', onUp);
  function dist(){ const pts=[...active.values()]; const dx=pts[0].x-pts[1].x, dy=pts[0].y-pts[1].y; return Math.hypot(dx,dy); }
  function startPinch(){ if(!zoomCaps?.zoom) return; pinch={startDist:dist(), base: parseFloat(els.zoomRange.value)}; }
  function updatePinch(){ if(!pinch) return; const scale=dist()/pinch.startDist; setZoom(pinch.base*scale); }
}