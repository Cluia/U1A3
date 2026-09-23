# Relatório de investigação — U1A3 (Realidade Mista)

**Sistema:** servidor Flask + captura `/mr` + visualização `/arvr`  
**Ambiente de teste:** PC (webcam do notebook), iluminação razoável (ambiente interno)  
**Configuração:** ~12 FPS na captura; calibração ajustada manualmente (incl. escala de profundidade Z)  
**Data:** 22/09/2026  

---

## 1. Resumo executivo

Os testes confirmaram que o fluxo **câmera → detecção de rostos (Haar) → avatares na cena VR** funciona de forma **estável** na faixa de distâncias usada no dia a dia (de muito perto do notebook até o limite da cadeira reclinada). A **proximidade** altera o tamanho da caixa de detecção e o comportamento de aproximação/afastamento do avatar no mundo virtual. O principal ponto de fragilidade observado foi **movimento horizontal rápido da cabeça**, não a variação de profundidade. Acessórios como **óculos e headset** não impediram a detecção. O avatar tende a **flutuar** acima da grade de referência, indicando limitação de mapeamento/calibração no eixo Y e não falha de detecção.

---

## 2. Objetivo da investigação

Validar, em uso real no PC:

- alcance e estabilidade da detecção em diferentes distâncias;
- efeito da proximidade na caixa de detecção e no avatar;
- impacto de calibração (eixo Z) no resultado percebido;
- robustez com acessórios (óculos, headset);
- sensibilidade a movimentos (horizontal vs profundidade);
- fidelidade espacial básica (avatar no chão vs flutuando).

---

## 3. Metodologia

1. Abertura de duas abas: `/arvr` (sala virtual) e `/mr` (webcam + preview anotado).
2. Captura contínua com **12 FPS**.
3. Variação de distância entre o rosto e a webcam, do **mínimo** (próximo ao notebook) ao **máximo** testado (cadeira inclinada para trás, sem testes além desse alcance).
4. Ajuste do slider de **profundidade (escala Z)** na calibração, observando efeito na cena VR.
5. Testes informais com **óculos** e **headset** durante a captura.
6. Movimentos controlados: balanço horizontal da cabeça e aproximação/afastamento (eixo de profundidade).

**Limitação declarada:** não foram realizados testes além do alcance máximo da cadeira; não houve variação sistemática de iluminação extrema (só “razoável”).

---

## 4. Resultados por tema

### 4.1 Distância e alcance

| Aspecto | Observação |
|--------|------------|
| Faixa testada | Desde **colado ao notebook** até o **alcance máximo da cadeira reclinada** |
| Além desse alcance | **Não testado** |
| Estabilidade | **Boa** em toda a faixa, com **12 FPS** |
| Contagem de rostos | Manteve-se consistente para uma pessoa na cena (sem relato de múltiplos avatares instáveis nesta sessão) |

**Interpretação:** o detector Haar permaneceu útil na distância típica de uso de webcam em notebook. O limite superior prático do experimento foi o conforto físico da posição na cadeira, não um limite técnico explícito registrado.

---

### 4.2 Caixa de detecção e proximidade

| Aspecto | Observação |
|--------|------------|
| Tamanho da caixa | **Aumenta** com proximidade e **diminui** com distância |
| Coerência | Comportamento **esperado**: rosto ocupa mais pixels quando perto |

**Interpretação:** a largura/altura do bounding box em **pixels** é o principal sinal usado pelo servidor para estimar **escala** e **profundidade simulada (Z)** no VR. Isso ilustra a diferença entre **medida na imagem (2D)** e **posição no mundo 3D**.

---

### 4.3 Calibração (escala Z) vs detecção

| Aspecto | Observação |
|--------|------------|
| Ajuste de escala Z | **Não houve percepção de mudança na detecção** (caixa no preview) |
| Avatar no VR | **Aproxima e afasta** conforme a detecção / proximidade real |

**Interpretação:** parâmetros de calibração (`z_scale`, `z_offset`, etc.) afetam o **mapeamento 2D → 3D** enviado ao `/arvr`, **não** o algoritmo OpenCV de detecção. A expectativa correta é sentir diferença na **posição/tamanho do avatar**, não no retângulo desenhado na imagem. Se a mudança de Z foi sutil, pode ser necessário variar também `Profundidade (offset Z)`, `Tamanho do avatar` e `Altura base (Y)` para corrigir flutuação.

---

### 4.4 Posicionamento do avatar (chão vs flutuação)

| Aspecto | Observação |
|--------|------------|
| Movimento em profundidade | Avatar **acompanha** aproximação/afastamento de forma coerente |
| Contato com o chão | Avatar **aparece flutuando**, não apoiado na grade do chão |

**Interpretação:** o mapeamento atual posiciona o centro do rosto em coordenadas 3D com `base_y` e fórmulas em `_face_bbox_to_world()`; o modelo visual (cilindro + esfera) tem altura fixa e o pivot pode não coincidir com os “pés” na grade. Isso é **limitação de calibração/modelo**, não falha de detecção.

**Sugestão para refinamento:** reduzir `Altura base (Y)` e/ou `Amplitude Y`; validar na grade de `/arvr` até os pés alinharem ao plano y = 0.

---

### 4.5 Acessórios (óculos e headset)

| Condição | Detecção |
|----------|----------|
| Óculos | **Sem problemas** |
| Headset | **Sem problemas** |

**Interpretação:** na iluminação testada, o Haar frontal manteve características suficientes do rosto. Cenários não testados: máscara cobrindo boca/nariz, boné com sombra forte, óculos muito escuros em ambiente escuro.

---

### 4.6 Movimento e sincronização

| Tipo de movimento | Comportamento |
|-------------------|---------------|
| **Horizontal** (balanço de cabeça) | **Maior dificuldade** — instabilidade ou atraso na percepção de acompanhamento |
| **Profundidade** (aproximar/afastar) | **Pouca interferência**; em geral **fixo e bom** |
| Impressão geral | Sistema **estável** para uso contínuo a 12 FPS na faixa de distância testada |

**Interpretação:** movimentos laterais alteram rapidamente `nx` (coordenada normalizada horizontal) e stressam o **tracking** e a **suavização** entre frames. Movimento em Z altera principalmente o tamanho da caixa, o que o pipeline já usa de forma mais estável.

---

## 5. Conceitos obrigatórios (síntese para apresentação)

| Pergunta | Resposta baseada nos testes |
|----------|----------------------------|
| Como o sistema sabe onde está cada pessoa? | Detecta o rosto (Haar), calcula o **centro** e tamanho da caixa em pixels, normaliza (`nx`, `ny`) e converte em `position` / `scale` para o VR. |
| Como transformar coordenadas da câmera em posição no VR? | Mapeamento configurável em `/mr` (`range_x`, `range_y`, `base_y`, `z_scale`, `z_offset`, `scale_factor`) aplicado ao centro e largura do rosto. |
| Dificuldade de mapear profundidade? | A câmera **não mede distância real**; usa **tamanho do rosto** como proxy. Nos testes, profundidade física funcionou bem; Z de calibração não muda a detecção, só o avatar. |
| Pixel vs coordenada vs objeto 3D | **Pixel:** caixa no preview. **Coordenada:** `nx`, `ny`, posição mapeada. **Objeto 3D:** avatar (cilindro/esfera + label) na cena A-Frame. |

---

## 6. Conclusões

1. O protótipo atende bem ao cenário **uma pessoa, PC, iluminação razoável**, na distância **notebook ↔ cadeira reclinada**, com **12 FPS**.
2. A **proximidade** controla o tamanho da detecção e o **afastar/aproximar** do avatar de forma compreensível para demonstração de realidade mista.
3. **Calibração Z** não deve ser avaliada pelo retângulo de detecção, apenas pelo comportamento do avatar — alinhado ao desenho do sistema.
4. **Flutuação** do avatar indica necessidade de ajuste fino de **altura (Y)** e/ou modelo visual, não de trocar o detector.
5. **Óculos e headset** não foram obstáculo nos testes realizados.
6. **Movimento horizontal rápido** é o principal fator de degradação percebida; **profundidade** foi o eixo mais estável.

---

## 7. Trabalhos futuros (opcional na disciplina)

- Testar distâncias **além** da cadeira e condições de **luz fraca / contraluz**.
- Testar **máscara**, **boné** e **múltiplas pessoas** na mesma cena.
- Ajustar calibração para **pés na grade** e documentar valores finais dos sliders.
- Evoluir de detecção para **reconhecimento** (nome no label do avatar).
- Desafio Master: nome flutuante + avatar orientado ao observador VR.

---

## 8. Evidências recomendadas

Para anexar à apresentação:

- Print de `/mr` com caixa grande (perto) e pequena (longe).
- Print de `/arvr` mostrando avatar flutuando vs após ajuste de `base_y`.
- Vídeo curto (~15 s) com balanço horizontal vs movimento em profundidade.
- Tabela de sliders de calibração **antes** e **depois** dos ajustes.

---

*Relatório elaborado a partir das observações de teste em ambiente real; complementa o roteiro da atividade U1A3 e o README do projeto.*
