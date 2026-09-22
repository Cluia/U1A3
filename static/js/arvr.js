/**
 * arvr.js – Lógica cliente para a interface AR/VR
 *
 * Responsabilidades:
 *  - Conexão Socket.IO com o servidor
 *  - Envio de comandos via painel de controle
 *  - Recepção de eventos e atualização da cena A-Frame
 */

"use strict";

/* ── Estado local ── */
const localState = { objects: {}, skyColor: "#87CEEB" };
const trackState = {};
const TRACK_COLORS = ["#4CC3D9", "#F16745", "#FFC65D", "#7BC8A4", "#93648D", "#3A7CA5"];
let socket = null;
let lastTrackLogCount = -1;

/* ── Elementos DOM ── */
const statusDot   = document.getElementById("statusDot");
const statusText  = document.getElementById("statusText");
const connInfo    = document.getElementById("connInfo");
const objCountEl  = document.getElementById("objCount");
const objCountBadge = document.getElementById("objCountBadge");
const objectList  = document.getElementById("objectList");
const logPanel    = document.getElementById("logPanel");
const trackSummary = document.getElementById("trackSummary");
const trackList   = document.getElementById("trackList");
const trackCountBadge = document.getElementById("trackCountBadge");

/* ── Utilitários ── */
function log(msg, type = "info") {
  const p = document.createElement("p");
  p.className = type;
  p.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logPanel.appendChild(p);
  logPanel.scrollTop = logPanel.scrollHeight;
  if (logPanel.children.length > 80) logPanel.removeChild(logPanel.firstChild);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function updateCounts() {
  const n = Object.keys(localState.objects).length;
  objCountEl.textContent = n;
  objCountBadge.textContent = `${n} objeto${n !== 1 ? "s" : ""}`;
}

/* ── Cena A-Frame helpers ── */
const SHAPE_MAP = {
  box:          "a-box",
  sphere:       "a-sphere",
  cylinder:     "a-cylinder",
  cone:         "a-cone",
  torus:        "a-torus",
  dodecahedron: "a-dodecahedron",
};

function createAframeEntity(obj) {
  const tag = SHAPE_MAP[obj.type] || "a-box";
  const el = document.createElement(tag);
  el.setAttribute("id", `obj-${obj.id}`);
  el.setAttribute("position", `${obj.position.x} ${obj.position.y} ${obj.position.z}`);
  el.setAttribute("material", { color: obj.color, metalness: 0.2, roughness: 0.7 });
  el.setAttribute("shadow", "cast: true; receive: true");

  // Sombra suave
  if (obj.type === "box")      el.setAttribute("depth", "0.8");
  if (obj.type === "cylinder") el.setAttribute("radius-top", "0.4");
  if (obj.type === "torus")    el.setAttribute("radius-tubular", "0.08");

  if (obj.animation) attachAnimation(el);
  return el;
}

function attachAnimation(el) {
  el.setAttribute("animation", "property: rotation; to: 0 360 0; loop: true; dur: 3000; easing: linear");
}

function removeAnimation(el) {
  el.removeAttribute("animation");
  el.setAttribute("rotation", "0 0 0");
}

/* ── Tracks MR (rostos → avatares) ── */
function trackDomId(trackId) {
  return `mr-entity-${trackId}`;
}

function getTrackContainer() {
  return document.getElementById("trackEntities");
}

function upsertTrackEntity(track) {
  const domId = trackDomId(track.id);
  let root = document.getElementById(domId);
  const colorIdx = (parseInt(String(track.id).split("-").pop(), 10) || 1) % TRACK_COLORS.length;
  const color = TRACK_COLORS[colorIdx];
  const scale = track.scale || 1;
  const pos = track.position || { x: 0, y: 1, z: -3 };

  if (!root) {
    root = document.createElement("a-entity");
    root.setAttribute("id", domId);

    const body = document.createElement("a-cylinder");
    body.setAttribute("data-part", "body");
    body.setAttribute("radius", "0.22");
    body.setAttribute("height", "1.1");
    body.setAttribute("position", "0 0.55 0");

    const head = document.createElement("a-sphere");
    head.setAttribute("data-part", "head");
    head.setAttribute("radius", "0.28");
    head.setAttribute("position", "0 1.25 0");

    const label = document.createElement("a-text");
    label.setAttribute("data-part", "label");
    label.setAttribute("align", "center");
    label.setAttribute("position", "0 1.95 0");
    label.setAttribute("width", "5");
    label.setAttribute("color", "#ffffff");

    root.appendChild(body);
    root.appendChild(head);
    root.appendChild(label);
    getTrackContainer().appendChild(root);
    trackState[track.id] = root;
  }

  root.setAttribute("position", `${pos.x} ${pos.y} ${pos.z}`);
  root.setAttribute("scale", `${scale} ${scale} ${scale}`);

  const body = root.querySelector('[data-part="body"]');
  const head = root.querySelector('[data-part="head"]');
  const label = root.querySelector('[data-part="label"]');
  if (body) body.setAttribute("material", { color, metalness: 0.35, roughness: 0.55 });
  if (head) head.setAttribute("material", { color: "#ffdbac", metalness: 0.1, roughness: 0.75 });
  if (label) label.setAttribute("value", track.label || track.id);
}

function removeTrackEntity(trackId) {
  const domId = trackDomId(trackId);
  const el = document.getElementById(domId);
  if (el) el.remove();
  delete trackState[trackId];
}

function syncTracksFromServer(tracks) {
  const ids = new Set((tracks || []).map((t) => t.id));
  Object.keys(trackState).forEach((id) => {
    if (!ids.has(id)) removeTrackEntity(id);
  });
  (tracks || []).forEach(upsertTrackEntity);

  const n = tracks ? tracks.length : 0;
  if (trackCountBadge) trackCountBadge.textContent = `${n} pessoa(s)`;
  if (trackSummary) {
    trackSummary.textContent = n
      ? `${n} entidade(s) sincronizada(s) da câmera.`
      : "Nenhuma pessoa no frame (ou captura inativa).";
  }
  renderTrackList(tracks || []);
}

function renderTrackList(tracks) {
  if (!trackList) return;
  if (tracks.length === 0) {
    trackList.innerHTML = `<div style="color:var(--text-muted);font-size:.82rem;padding:.4rem">—</div>`;
    return;
  }
  trackList.innerHTML = tracks.map((t) => {
    const p = t.position || {};
    return `
      <div class="object-item">
        <div class="object-item-info">
          <span>${escHtml(t.label || t.id)}</span>
        </div>
        <span style="font-size:.75rem;color:var(--text-muted)">
          (${p.x ?? 0}, ${p.y ?? 0}, ${p.z ?? 0})
        </span>
      </div>`;
  }).join("");
}

/* ── Socket.IO ── */
function initSocket() {
  socket = io({ transports: ["websocket"] });

  socket.on("connect", () => {
    statusDot.classList.add("connected");
    statusText.textContent = "Conectado";
    connInfo.textContent = `ID: ${socket.id}`;
    log("Conectado ao servidor WebSocket.");
    socket.emit("join_arvr");
  });

  socket.on("disconnect", () => {
    statusDot.classList.remove("connected");
    statusText.textContent = "Desconectado";
    connInfo.textContent = "Reconectando…";
    log("Desconectado do servidor.", "warning");
  });

  /* ── Eventos de cena ── */

  socket.on("scene_state", (state) => {
    log(`Estado da cena recebido: ${state.objects.length} objetos.`);
    // Limpa cena e reconstrói
    clearLocalScene();
    document.getElementById("sky").setAttribute("color", state.sky_color);
    localState.skyColor = state.sky_color;
    state.objects.forEach(addObjectToScene);
    updateCounts();
  });

  socket.on("object_added", (obj) => {
    addObjectToScene(obj);
    updateCounts();
    log(`Objeto adicionado: #${obj.id} (${obj.type})`);
  });

  socket.on("object_removed", ({ id }) => {
    removeObjectFromScene(id);
    updateCounts();
    log(`Objeto removido: #${id}`);
  });

  socket.on("sky_changed", ({ color }) => {
    document.getElementById("sky").setAttribute("color", color);
    localState.skyColor = color;
    log(`Cor do céu alterada para ${color}`);
  });

  socket.on("scene_cleared", () => {
    clearLocalScene();
    document.getElementById("sky").setAttribute("color", "#87CEEB");
    updateCounts();
    log("Cena limpa.", "warning");
  });

  socket.on("object_moved", (obj) => {
    const el = document.getElementById(`obj-${obj.id}`);
    if (el) {
      el.setAttribute("position", `${obj.position.x} ${obj.position.y} ${obj.position.z}`);
      if (localState.objects[obj.id]) localState.objects[obj.id].position = obj.position;
    }
    log(`Objeto #${obj.id} movido para (${obj.position.x}, ${obj.position.y}, ${obj.position.z})`);
  });

  socket.on("color_changed", ({ id, color }) => {
    const el = document.getElementById(`obj-${id}`);
    if (el) el.setAttribute("material", { color: color, metalness: 0.2, roughness: 0.7 });
    if (localState.objects[id]) localState.objects[id].color = color;
    renderObjectList();
    log(`Cor do objeto #${id} alterada para ${color}`);
  });

  socket.on("animation_toggled", ({ id, animation }) => {
    const el = document.getElementById(`obj-${id}`);
    if (el) animation ? attachAnimation(el) : removeAnimation(el);
    if (localState.objects[id]) localState.objects[id].animation = animation;
    log(`Animação do objeto #${id}: ${animation ? "ativada" : "desativada"}`);
  });

  socket.on("mr_tracks_update", (data) => {
    const tracks = data.tracks || [];
    syncTracksFromServer(tracks);
    if (tracks.length !== lastTrackLogCount) {
      log(`MR: ${tracks.length} pessoa(s) na cena.`);
      lastTrackLogCount = tracks.length;
    }
  });
}

/* ── Manipulação da lista de objetos ── */
function addObjectToScene(obj) {
  localState.objects[obj.id] = obj;
  const container = document.getElementById("sceneObjects");
  const existing = document.getElementById(`obj-${obj.id}`);
  if (existing) existing.remove();
  container.appendChild(createAframeEntity(obj));
  renderObjectList();
}

function removeObjectFromScene(id) {
  const el = document.getElementById(`obj-${id}`);
  if (el) el.remove();
  delete localState.objects[id];
  renderObjectList();
}

function clearLocalScene() {
  document.getElementById("sceneObjects").innerHTML = "";
  Object.keys(localState.objects).forEach(k => delete localState.objects[k]);
  renderObjectList();
}

function renderObjectList() {
  const objs = Object.values(localState.objects);
  if (objs.length === 0) {
    objectList.innerHTML = `<div style="color:var(--text-muted);font-size:.85rem;text-align:center;padding:1rem">Nenhum objeto ainda</div>`;
    return;
  }
  objectList.innerHTML = objs.map(obj => `
    <div class="object-item">
      <div class="object-item-info">
        <span class="color-dot" style="background:${escHtml(obj.color)}"></span>
        <span>#${escHtml(obj.id)} ${escHtml(obj.type)}</span>
      </div>
      <div class="flex gap-1">
        <input type="color" value="${escHtml(obj.color)}" title="Mudar cor"
               style="width:24px;height:24px;border:none;border-radius:4px;cursor:pointer;padding:0"
               onchange="changeColor(${Number(obj.id)}, this.value)">
        <button class="btn btn-outline btn-sm" title="${obj.animation ? 'Parar animação' : 'Animar'}"
                onclick="toggleAnimation(${Number(obj.id)})">${obj.animation ? "⏸" : "▶"}</button>
        <button class="btn btn-danger btn-sm" title="Remover"
                onclick="removeObject(${Number(obj.id)})">✕</button>
      </div>
    </div>
  `).join("");
}

/* ── Funções chamadas pelos botões HTML ── */
function sendCommand(command, payload = {}) {
  if (!socket || !socket.connected) {
    log("Não conectado ao servidor!", "error");
    return;
  }
  socket.emit("arvr_command", { command, payload });
}

function addObject(type) {
  const color = document.getElementById("objColor").value;
  sendCommand("add_object", { type, color });
}

function removeObject(id) {
  sendCommand("remove_object", { id });
}

function changeSky() {
  const color = document.getElementById("skyColor").value;
  sendCommand("change_sky", { color });
}

function setSkyPreset(color) {
  document.getElementById("skyColor").value = color;
  sendCommand("change_sky", { color });
}

function clearScene() {
  if (confirm("Limpar toda a cena?")) sendCommand("clear_scene");
}

function changeColor(id, color) {
  sendCommand("change_color", { id, color });
}

function toggleAnimation(id) {
  sendCommand("toggle_animation", { id });
}

/* ── Inicialização ── */
document.addEventListener("DOMContentLoaded", initSocket);
