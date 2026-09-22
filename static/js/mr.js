/**
 * mr.js – Página dedicada de captura MR (etapa 4)
 * Envia frames via mr_face_frame; calibração via mr_set_calibration.
 */

"use strict";

const CALIB_FIELDS = [
  { key: "range_x", label: "Amplitude X (esq/dir)", min: 1, max: 15, step: 0.5 },
  { key: "range_y", label: "Amplitude Y (cima/baixo)", min: 1, max: 12, step: 0.5 },
  { key: "base_y", label: "Altura base (Y)", min: 0, max: 4, step: 0.1 },
  { key: "z_scale", label: "Profundidade (escala Z)", min: 2, max: 20, step: 0.5 },
  { key: "z_offset", label: "Profundidade (offset Z)", min: -10, max: 0, step: 0.5 },
  { key: "scale_factor", label: "Tamanho do avatar", min: 1, max: 8, step: 0.25 },
];

let socket = null;
let camStream = null;
let captureTimer = null;
let waitingResult = false;
let frameCount = 0;
let lastFpsTime = Date.now();
let calibration = {};
let calibDebounce = null;

const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const logPanel = document.getElementById("logPanel");
const webcamVideo = document.getElementById("webcamVideo");
const captureCanvas = document.getElementById("captureCanvas");
const resultImg = document.getElementById("resultImg");
const noSignal = document.getElementById("noSignal");
const fpsBadge = document.getElementById("fpsBadge");
const fpsRange = document.getElementById("fpsRange");
const fpsVal = document.getElementById("fpsVal");
const btnStartCam = document.getElementById("btnStartCam");
const btnStopCam = document.getElementById("btnStopCam");
const faceCountStat = document.getElementById("faceCountStat");
const vrTrackStat = document.getElementById("vrTrackStat");
const calibSliders = document.getElementById("calibSliders");
const arvrLink = document.getElementById("arvrLink");
const serverOrigin = document.getElementById("serverOrigin");
const btnCopyArvr = document.getElementById("btnCopyArvr");

function log(msg, type = "info") {
  const p = document.createElement("p");
  p.className = type;
  p.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logPanel.appendChild(p);
  logPanel.scrollTop = logPanel.scrollHeight;
  if (logPanel.children.length > 60) logPanel.removeChild(logPanel.firstChild);
}

function buildCalibUI() {
  calibSliders.innerHTML = CALIB_FIELDS.map((f) => `
    <label class="mr-calib-row">
      <span class="mr-calib-label">${f.label}</span>
      <input type="range" id="cal-${f.key}" data-key="${f.key}"
             min="${f.min}" max="${f.max}" step="${f.step}" value="5">
      <span class="mr-calib-val" id="cal-val-${f.key}">—</span>
    </label>`).join("");

  CALIB_FIELDS.forEach((f) => {
    const input = document.getElementById(`cal-${f.key}`);
    input.addEventListener("input", () => {
      document.getElementById(`cal-val-${f.key}`).textContent = input.value;
      scheduleCalibrationPush();
    });
  });
}

function applyCalibrationToUI(cal) {
  calibration = { ...cal };
  CALIB_FIELDS.forEach((f) => {
    const input = document.getElementById(`cal-${f.key}`);
    const valEl = document.getElementById(`cal-val-${f.key}`);
    if (!input || cal[f.key] === undefined) return;
    input.value = cal[f.key];
    valEl.textContent = cal[f.key];
  });
}

function scheduleCalibrationPush() {
  clearTimeout(calibDebounce);
  calibDebounce = setTimeout(pushCalibration, 200);
}

function pushCalibration() {
  if (!socket || !socket.connected) return;
  const payload = {};
  CALIB_FIELDS.forEach((f) => {
    const input = document.getElementById(`cal-${f.key}`);
    if (input) payload[f.key] = parseFloat(input.value);
  });
  socket.emit("mr_set_calibration", payload);
}

function setupLinks() {
  const origin = window.location.origin;
  const arvrUrl = `${origin}/arvr`;
  if (arvrLink) arvrLink.href = arvrUrl;
  if (serverOrigin) serverOrigin.textContent = origin;
  if (btnCopyArvr) {
    btnCopyArvr.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(arvrUrl);
        log("URL do /arvr copiada.");
      } catch {
        log("Não foi possível copiar — use o link acima.", "warning");
      }
    });
  }
}

async function startCamera() {
  try {
    camStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    webcamVideo.srcObject = camStream;
    webcamVideo.style.display = "block";
    resultImg.style.display = "none";
    noSignal.style.display = "none";
    fpsBadge.style.display = "block";
    btnStartCam.disabled = true;
    btnStopCam.disabled = false;
    log("Câmera iniciada — transmitindo para /arvr.");
    startCaptureLoop();
  } catch (err) {
    log(`Erro na câmera: ${err.message}`, "error");
  }
}

function stopCamera() {
  if (camStream) {
    camStream.getTracks().forEach((t) => t.stop());
    camStream = null;
  }
  clearInterval(captureTimer);
  captureTimer = null;
  webcamVideo.style.display = "none";
  webcamVideo.srcObject = null;
  noSignal.style.display = "flex";
  fpsBadge.style.display = "none";
  btnStartCam.disabled = false;
  btnStopCam.disabled = true;
  log("Câmera parada.");
}

function startCaptureLoop() {
  const fps = parseInt(fpsRange.value, 10);
  const interval = Math.max(80, Math.floor(1000 / fps));
  clearInterval(captureTimer);
  captureTimer = setInterval(captureAndSend, interval);
}

function captureAndSend() {
  if (!socket?.connected || waitingResult || !camStream || webcamVideo.readyState < 2) return;

  const ctx = captureCanvas.getContext("2d");
  captureCanvas.width = webcamVideo.videoWidth || 640;
  captureCanvas.height = webcamVideo.videoHeight || 480;
  ctx.drawImage(webcamVideo, 0, 0, captureCanvas.width, captureCanvas.height);
  socket.emit("mr_face_frame", {
    image: captureCanvas.toDataURL("image/jpeg", 0.75),
  });
  waitingResult = true;
}

function handleMrResult(data) {
  waitingResult = false;
  if (data.error) {
    log(data.error, "error");
    return;
  }

  if (data.image) {
    resultImg.src = data.image;
    resultImg.style.display = "block";
    webcamVideo.style.display = "none";
  }

  const det = (data.detections || []).find((d) => d.type === "faces");
  const nFaces = det?.count ?? 0;
  const nTracks = (data.tracks || []).length;
  faceCountStat.textContent = `Rostos: ${nFaces}`;
  vrTrackStat.textContent = `Na cena VR: ${nTracks}`;

  frameCount++;
  const now = Date.now();
  if (now - lastFpsTime >= 1000) {
    fpsBadge.textContent = `${frameCount} fps`;
    frameCount = 0;
    lastFpsTime = now;
  }
}

function initSocket() {
  socket = io({ transports: ["websocket"] });

  socket.on("connect", () => {
    statusDot.classList.add("connected");
    statusText.textContent = "Conectado";
    log("Conectado ao servidor.");
    socket.emit("join_mr");
  });

  socket.on("disconnect", () => {
    statusDot.classList.remove("connected");
    statusText.textContent = "Desconectado";
    log("Desconectado.", "warning");
  });

  socket.on("mr_ready", ({ message, calibration: cal }) => {
    log(message);
    if (cal) applyCalibrationToUI(cal);
  });

  socket.on("mr_calibration_update", ({ calibration: cal }) => {
    if (cal) applyCalibrationToUI(cal);
  });

  socket.on("mr_calibration_ack", ({ calibration: cal }) => {
    if (cal) calibration = cal;
  });

  socket.on("mr_face_result", handleMrResult);

  socket.on("mr_tracks_update", ({ tracks }) => {
    vrTrackStat.textContent = `Na cena VR: ${(tracks || []).length}`;
  });
}

fpsRange.addEventListener("input", () => {
  fpsVal.textContent = fpsRange.value;
  if (captureTimer) startCaptureLoop();
});

btnStartCam.addEventListener("click", startCamera);
btnStopCam.addEventListener("click", stopCamera);

document.addEventListener("DOMContentLoaded", () => {
  buildCalibUI();
  setupLinks();
  initSocket();
});
