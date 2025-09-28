// ...existing code...
import QRCode from 'qrcode';

const qrCanvas = document.getElementById('qrCanvas');
const qrTextInput = document.getElementById('qrText');
const qrSizeSelect = document.getElementById('qrSize');
const qrMarginInput = document.getElementById('qrMargin');
const qrECCSelect = document.getElementById('qrECC');
const makeBtn = document.getElementById('makeQR');
const printBtn = document.getElementById('printQR');
const targetDataEl = document.getElementById('targetData');

function mmToPx(mm, dpi = 300) {
  // px = mm * dpi / 25.4
  return Math.round(mm * dpi / 25.4);
}

async function renderQR() {
  const text = qrTextInput.value.trim() || 'R';
  const ecc = qrECCSelect.value || 'L';
  const marginModules = Math.max(0, Number(qrMarginInput.value) || 2);
  const sizeMM = Number(qrSizeSelect.value) || 120;

  // Render at print resolution on offscreen, then draw to preview canvas
  const px = mmToPx(sizeMM);
  const off = document.createElement('canvas');
  off.width = px; off.height = px;
  await QRCode.toCanvas(off, text, {
    errorCorrectionLevel: ecc,
    width: px,
    margin: marginModules,
    color: { dark: '#000000', light: '#ffffff' }
  });

  // Fit into preview canvas
  const ctx = qrCanvas.getContext('2d');
  ctx.clearRect(0, 0, qrCanvas.width, qrCanvas.height);
  const scale = Math.min(qrCanvas.width / px, qrCanvas.height / px);
  const drawW = px * scale, drawH = px * scale;
  const x = (qrCanvas.width - drawW) / 2;
  const y = (qrCanvas.height - drawH) / 2;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, x, y, drawW, drawH);

  // Update target data for detector
  targetDataEl.textContent = text;
}

function printCurrentQR() {
  const dataUrl = qrCanvas.toDataURL('image/png'); // not embedded; only for print preview window
  const w = window.open('', '_blank');
  const title = `QR Marker - ${qrTextInput.value.trim() || 'R'}`;
  w.document.write(`
    <!doctype html>
    <html><head><title>${title}</title>
      <style>
        @page { size: A4; margin: 20mm; }
        body { margin: 0; font-family: "Noto Sans", sans-serif; color: #111; }
        .wrap { display: flex; flex-direction: column; align-items: center; gap: 12px; }
        img { width: 120mm; height: 120mm; image-rendering: pixelated; }
        .meta { color: #666; }
      </style>
    </head><body>
      <div class="wrap">
        <h1 style="margin:16mm 0 6mm;">Treadmill QR Marker</h1>
        <img src="${dataUrl}" alt="QR marker" />
        <div class="meta">
          Data: <code>${qrTextInput.value.trim() || 'R'}</code> · Size: ${qrSizeSelect.value} mm · ECC: ${qrECCSelect.value}
          <div>Print on plain white paper. Cut and tape flat to the belt with strong tape. Ensure high contrast.</div>
        </div>
      </div>
      <script>window.onload = () => setTimeout(() => window.print(), 300);</script>
    </body></html>
  `);
  w.document.close();
}

makeBtn.addEventListener('click', renderQR);
printBtn.addEventListener('click', printCurrentQR);
qrTextInput.addEventListener('input', renderQR);
qrSizeSelect.addEventListener('change', renderQR);
qrMarginInput.addEventListener('input', renderQR);
qrECCSelect.addEventListener('change', renderQR);

renderQR();
// ...existing code...

