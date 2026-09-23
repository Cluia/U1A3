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

Acesse **http://localhost:5000** — **não** defina `USE_HTTPS` se for usar só no PC.

---

## Uso somente no PC (recomendado)

A webcam funciona em **`http://localhost`** sem certificado. Dois jeitos de testar:

**Opção A — Captura MR**

1. Abra **duas abas** no navegador (Chrome ou Edge):
   - [http://localhost:5000/arvr](http://localhost:5000/arvr) — sala virtual  
   - [http://localhost:5000/mr](http://localhost:5000/mr) — **Iniciar câmera** (webcam do PC)
2. Ajuste os **sliders de calibração** em `/mr` se os avatares ficarem deslocados.

**Reconhecimento (nome no VR):** em `/mr` → *Reconhecimento facial*:

1. Digite o **nome** (ex.: seu nome).
2. **Upload:** botão *Fotos* — selecione 3–8 imagens (JPG/PNG), rosto de frente e bem visível.
3. **Webcam:** inicie a câmera e use *Cadastrar frame* várias vezes com pequenas variações de ângulo.
4. Abra `/arvr` — o texto acima do avatar deve mostrar o **nome** (verde no preview quando reconhecido).

Dados em `face_registry/` (local, não versionado). *Limpar cadastros* remove tudo; com nome no campo, remove só essa pessoa.

**Opção B — Laboratório CV**

1. Aba [http://localhost:5000/arvr](http://localhost:5000/arvr)  
2. Aba [http://localhost:5000/cv](http://localhost:5000/cv) → pipeline *Detecção de Rostos* → marque *Transmitir rostos para VR* → inicie a câmera.

Se você tinha ativado HTTPS antes, desligue no PowerShell antes de subir o servidor:

```powershell
Remove-Item Env:USE_HTTPS -ErrorAction SilentlyContinue
python server.py
```

<details>
<summary>Câmera no celular (opcional)</summary>

Exige **HTTPS** (`USE_HTTPS=true`) e aceitar certificado autoassinado em `https://<IP-do-PC>:5000/mr`.
</details>

---

## Fluxo da atividade (referência)

1. **`/arvr`** — visualizar a sala virtual.  
2. **`/mr`** ou **`/cv`** — captura e detecção de rostos.  
3. Calibração em `/mr` quando necessário.

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
