# Aplicação U1A3 (servidor executável)

Servidor Flask + Socket.IO com **Realidade Mista**: detecção de rostos na câmera e avatares na cena [`/arvr`](http://localhost:5000/arvr).

Documentação do repositório (visão geral e demo): **[`../README.md`](../README.md)**  
Roteiro da disciplina (etapas, investigação, apresentação): **[`../README-U1A3.md`](../README-U1A3.md)**

---

## Início rápido

```powershell
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
python server.py
```

| Ambiente | Ativar venv |
|----------|-------------|
| Windows | `.\venv\Scripts\activate` |
| Linux / macOS | `source venv/bin/activate` |

Acesse **http://localhost:5000**. Para demo com celular: `http://<IP-do-PC>:5000/mr`.

---

## Fluxo recomendado (U1A3)

1. **`/arvr`** no PC ou headset — visualizar a sala virtual.  
2. **`/mr`** no celular — **Iniciar câmera** (transmissão automática de rostos).  
3. Ajuste os **sliders de calibração** em `/mr` se os avatares ficarem deslocados.

Alternativa: **`/cv`** → pipeline *Detecção de Rostos* → marcar *Transmitir rostos para VR*.

---

## Estrutura desta pasta

```text
app/
├── server.py              # Flask, OpenCV, salas Socket.IO, estado MR (mr_tracks)
├── requirements.txt
├── static/
│   ├── js/
│   │   ├── mr.js          # Captura dedicada (/mr)
│   │   ├── arvr.js        # Cena A-Frame + avatares MR
│   │   ├── cv.js          # Visão computacional
│   │   ├── cv3d.js        # CV → Three.js
│   │   └── worldgen.js    # IA (opcional)
│   └── css/style.css
└── templates/
    ├── mr.html            # Captura MR (mobile-first)
    ├── arvr.html
    ├── cv.html
    └── ...
```

Na primeira execução, modelos **MediaPipe** podem ser baixados para `models/`.

---

## Interfaces

### `/mr` — Captura MR (principal)

- Webcam / câmera frontal do celular  
- Envio contínuo via `mr_face_frame`  
- Calibração 2D→3D (`mr_set_calibration`)  
- Contadores: rostos no frame e entidades na VR  

### `/arvr` — Visualização VR

- Cena A-Frame compartilhada (WebXR)  
- Avatares MR em `#trackEntities` (separados dos objetos do painel)  
- Grade no chão para referência espacial  

### `/cv` — Laboratório OpenCV

Pipelines: `edges`, `contours`, `faces`, `color`, `blur`, `threshold`, `hands`, `pose`.  
No pipeline `faces`, a resposta inclui lista `faces[]` com coordenadas e normalizados `(nx, ny)`.

### Outras rotas

- **`/cv3d`** — mapeamento CV → Three.js  
- **`/worldgen`** — geração de cenas com OpenAI (requer `OPENAI_API_KEY`)

---

## WebSocket — Realidade Mista (sala `mr` + broadcast `arvr`)

| Direção | Evento | Descrição |
|---------|--------|-----------|
| Cliente → servidor | `join_mr` | Entra na sala; recebe calibração e tracks atuais |
| Cliente → servidor | `mr_face_frame` | `{ image: "data:image/jpeg;base64,..." }` |
| Cliente → servidor | `mr_set_calibration` | `{ range_x, range_y, base_y, z_scale, z_offset, scale_factor, ... }` |
| Servidor → cliente | `mr_face_result` | Imagem anotada + `detections` + `tracks` |
| Servidor → cliente | `mr_tracks_update` | Lista de tracks para `/arvr` (e clientes `mr`) |
| Servidor → cliente | `mr_calibration_update` | Parâmetros de mapeamento atualizados |

Cada **track** inclui, entre outros: `id`, `label` (ex. `Pessoa 1`), `position` `{x,y,z}`, `scale`, `nx`, `ny`, `updated_at`.

Sala **`arvr`** (inalterada do base + MR): `join_arvr`, `arvr_command`, `scene_state`, `object_added`, …  
Ao entrar em `join_arvr`, o cliente também recebe `mr_tracks_update` e `mr_calibration_update`.

Documentação completa das salas `cv`, `cv3d` e `worldgen`: [base-project-arvrcv](https://github.com/henning-nr/base-project-arvrcv).

---

## Docker (opcional)

```bash
cp .env.example .env
docker compose up -d --build
```

Em produção (`DEBUG=false`), configure `APP_ACCESS_PASSWORD` e `FLASK_SECRET_KEY` (ver `.env.example`).

---

## Variáveis de ambiente úteis

| Variável | Efeito |
|----------|--------|
| `OPENAI_API_KEY` | Habilita `/worldgen` |
| `APP_ACCESS_PASSWORD` | Login em `/login` + proteção Socket.IO |
| `FLASK_SECRET_KEY` | Sessão Flask (obrigatória com `DEBUG=false`) |
| `PORT` | Porta do servidor (padrão `5000`) |

---

## Expandir o projeto

- Novo pipeline: `_apply_pipeline()` em `server.py`  
- Ajuste do mapeamento MR: `mr_calibration` e `_face_bbox_to_world()` em `server.py`  
- Visual dos avatares: `upsertTrackEntity()` em `static/js/arvr.js`  
- Referência pixel→mundo (Three.js): `pixelToWorld()` em `static/js/cv3d.js`
