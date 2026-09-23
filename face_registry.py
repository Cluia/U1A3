"""
Cadastro e reconhecimento facial simples (LBPH) para a U1A3.
Armazena amostras em face_registry/ e treina o modelo ao cadastrar.
"""

import json
import logging
import re
import uuid
from pathlib import Path

import cv2
import numpy as np

logger = logging.getLogger(__name__)

REGISTRY_DIR = Path(__file__).resolve().parent / "face_registry"
REGISTRY_JSON = REGISTRY_DIR / "registry.json"
FACE_SIZE = (200, 200)
LBPH_THRESHOLD = 72.0
MAX_SAMPLES_PER_PERSON = 30

_lbph = None
_label_to_name: dict[int, str] = {}


def _load_registry() -> dict:
    REGISTRY_DIR.mkdir(parents=True, exist_ok=True)
    if not REGISTRY_JSON.is_file():
        return {"people": []}
    with open(REGISTRY_JSON, encoding="utf-8") as f:
        data = json.load(f)
    data.setdefault("people", [])
    return data


def _save_registry(data: dict) -> None:
    REGISTRY_DIR.mkdir(parents=True, exist_ok=True)
    with open(REGISTRY_JSON, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _slug_name(name: str) -> str:
    safe = re.sub(r"[^\w\s-]", "", name.strip(), flags=re.UNICODE)
    safe = re.sub(r"[-\s]+", "_", safe.lower())
    return (safe[:40] or "pessoa")


def list_summary() -> list[dict]:
    reg = _load_registry()
    return [
        {"name": p["name"], "samples": len(p.get("samples", []))}
        for p in reg["people"]
    ]


def _detect_faces_haar(
    frame: np.ndarray,
    *,
    scale_factor: float = 1.15,
    min_neighbors: int = 6,
    min_size: tuple[int, int] = (48, 48),
) -> list:
    h_img, w_img = frame.shape[:2]
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    cascade = cv2.CascadeClassifier(
        cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    )
    raw = cascade.detectMultiScale(
        gray,
        scaleFactor=scale_factor,
        minNeighbors=min_neighbors,
        minSize=min_size,
    )
    faces = []
    for i, (x, y, w, h) in enumerate(raw):
        cx = int(x + w / 2)
        cy = int(y + h / 2)
        faces.append({
            "id": f"face-{i}",
            "x": int(x),
            "y": int(y),
            "w": int(w),
            "h": int(h),
            "cx": cx,
            "cy": cy,
            "nx": round(cx / w_img, 4),
            "ny": round(cy / h_img, 4),
        })
    return faces


def extract_face_gray(frame: np.ndarray, face: dict) -> np.ndarray | None:
    h_img, w_img = frame.shape[:2]
    x, y, w, h = int(face["x"]), int(face["y"]), int(face["w"]), int(face["h"])
    pad = int(0.12 * max(w, h))
    x1, y1 = max(0, x - pad), max(0, y - pad)
    x2, y2 = min(w_img, x + w + pad), min(h_img, y + h + pad)
    roi = frame[y1:y2, x1:x2]
    if roi.size == 0:
        return None
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    gray = cv2.equalizeHist(gray)
    return cv2.resize(gray, FACE_SIZE)


def rebuild_recognizer() -> None:
    global _lbph, _label_to_name
    _label_to_name = {}
    if not hasattr(cv2, "face"):
        logger.warning("opencv-contrib (cv2.face) indisponível — reconhecimento desativado.")
        _lbph = None
        return

    images: list[np.ndarray] = []
    labels: list[int] = []
    reg = _load_registry()
    for idx, person in enumerate(reg["people"]):
        _label_to_name[idx] = person["name"]
        for rel in person.get("samples", []):
            path = REGISTRY_DIR / rel
            img = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
            if img is None:
                continue
            if img.shape[:2] != (FACE_SIZE[1], FACE_SIZE[0]):
                img = cv2.resize(img, FACE_SIZE)
            images.append(img)
            labels.append(idx)

    if not images:
        _lbph = None
        return

    _lbph = cv2.face.LBPHFaceRecognizer_create()
    _lbph.train(images, np.array(labels, dtype=np.int32))
    logger.info("Reconhecimento facial: %d amostra(s), %d pessoa(s).", len(images), len(_label_to_name))


def recognize(frame: np.ndarray, face: dict) -> tuple[str | None, float | None]:
    gray = extract_face_gray(frame, face)
    if gray is None or _lbph is None:
        return None, None
    label, confidence = _lbph.predict(gray)
    if float(confidence) > LBPH_THRESHOLD:
        return None, float(confidence)
    return _label_to_name.get(int(label)), float(confidence)


def enroll(frame: np.ndarray, name: str) -> dict:
    name = name.strip()[:40]
    if not name:
        return {"ok": False, "error": "Informe um nome."}

    faces = _detect_faces_haar(
        frame, scale_factor=1.1, min_neighbors=5, min_size=(32, 32)
    )
    if not faces:
        return {
            "ok": False,
            "error": "Nenhum rosto encontrado. Use foto frontal, rosto grande no quadro e boa luz.",
        }

    face = max(faces, key=lambda f: f["w"] * f["h"])
    gray = extract_face_gray(frame, face)
    if gray is None:
        return {"ok": False, "error": "Não foi possível recortar o rosto."}

    reg = _load_registry()
    slug = _slug_name(name)
    person = next((p for p in reg["people"] if p["name"].lower() == name.lower()), None)
    if person is None:
        person = {"name": name, "slug": slug, "samples": []}
        reg["people"].append(person)
    elif not person.get("slug"):
        person["slug"] = slug

    samples = person.setdefault("samples", [])
    if len(samples) >= MAX_SAMPLES_PER_PERSON:
        return {
            "ok": False,
            "error": f"Máximo de {MAX_SAMPLES_PER_PERSON} fotos para «{name}». Remova amostras antigas se necessário.",
        }

    person_dir = REGISTRY_DIR / person["slug"]
    person_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex[:12]}.png"
    rel_path = f"{person['slug']}/{filename}"
    cv2.imwrite(str(REGISTRY_DIR / rel_path), gray)
    samples.append(rel_path)
    _save_registry(reg)
    rebuild_recognizer()

    return {
        "ok": True,
        "name": name,
        "samples": len(samples),
        "registry": list_summary(),
    }


def clear_registry(name: str | None = None) -> dict:
    """Remove todas as amostras ou só de uma pessoa (por nome)."""
    reg = _load_registry()
    if not name:
        for person in reg["people"]:
            slug = person.get("slug")
            if slug:
                folder = REGISTRY_DIR / slug
                if folder.is_dir():
                    for f in folder.glob("*.png"):
                        f.unlink(missing_ok=True)
        reg["people"] = []
        _save_registry(reg)
        rebuild_recognizer()
        return {"ok": True, "registry": list_summary(), "message": "Todos os cadastros foram removidos."}

    key = name.strip().lower()
    kept = []
    removed = False
    for person in reg["people"]:
        if person["name"].lower() == key:
            removed = True
            slug = person.get("slug")
            if slug:
                folder = REGISTRY_DIR / slug
                if folder.is_dir():
                    for f in folder.glob("*.png"):
                        f.unlink(missing_ok=True)
            continue
        kept.append(person)
    if not removed:
        return {"ok": False, "error": f"Pessoa «{name}» não encontrada no cadastro."}
    reg["people"] = kept
    _save_registry(reg)
    rebuild_recognizer()
    return {
        "ok": True,
        "registry": list_summary(),
        "message": f"Cadastro de «{name}» removido.",
    }
