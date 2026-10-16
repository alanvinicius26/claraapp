# Design — identidade visual da minha CLARA

Estilo **"Warm Editorial Studio"**: acolhedor, editorial, cor vinho sobre creme, muito respiro, cantos arredondados, sombras suaves. Referência original: `stitch_encaixa_beauty_scheduling_app/warm_editorial_studio/DESIGN.md` e protótipos em `design-references/2026-09-29/`.

## Camadas de CSS (ordem de carga em `src/main.jsx`)
`styles.css` (base) → `enhancements.css` → `redesign.css` (painel/página pública) → `account-exit.css` → `polish.css` (**camada final**, prefixo `#root`, define a escala tipográfica) + CSS por componente (`landing.css`, `insights.css`, `booking-alerts.css`, `access-notice.css`, `clara*.css`, `whatsapp.css`). Ajustes novos entram no CSS do componente ou em `polish.css`; evite mexer nas camadas antigas.

## Paleta
| Token | Valor | Uso |
| --- | --- | --- |
| `--wine` (painel/pública) | `#500021` | títulos, ícones, destaques |
| Vinho de ação | `#6e1936` (hover `#5b122c`) | botão primário, contador do sino |
| `--wine-dark` | `#3c0019` / `#4b1529` | texto sobre fundos claros de alerta |
| `--cream` | `#fef9f3` (base `#faf7f2`) | fundo das páginas |
| `--blush` | `#f3e1df` | faixas de aviso, hover suave |
| `--line` | `#eadde0` / `#ece2de` | bordas de cartões e divisórias |
| `--ink` / `--text` / `--soft` | `#2b1d22` / `#5f5256` / `#8a7b7e` | texto principal / corpo / auxiliar |
| `--green` | `#607662` | confirmações, ícones positivos |
| Dourado (landing) | `#d9a87e` | detalhes decorativos |

## Tipografia
- **Plus Jakarta Sans** (Google Fonts, 400–800) para toda a interface.
- **DM Serif Display** para títulos editoriais (landing, cabeçalhos de destaque).
- Escala final (`polish.css`): label 11 · meta 12 · small 13 · **body 14** · lead 15 · h3 16 · h2 19 · h1 32 px. Nada abaixo de 11 px.
- Títulos com espaçamento negativo leve (h1 `-0.9px`), `line-height` 1.15.
- Campos de formulário com **16 px no celular** (evita zoom automático do iOS).

## Componentes
- **Cartões** (`.panel`, `.metric`, `.service-card`, `.appointment`): fundo branco, borda `#ece2de`, raio 18–20 px, `--shadow-sm`/`--shadow-md`; hover eleva com `--shadow-lg`.
- **Botões** (`.button`): altura mínima 44 px, raio 9 px, peso 700, ícone lucide à esquerda/direita. `primary` vinho `#6e1936` com sombra suave e leve subida no hover; `secondary` com borda e fundo claro; `text-button` vinho sem fundo.
- **Janelas** (`<dialog class="modal">`): nativas com `showModal`, cabeçalho com eyebrow em caixa alta, fecham com Esc.
- **Faixas de aviso** (`.demo-bar`, `.access-banner`): barra contínua no topo do conteúdo, sem cantos.
- **Ícones:** `lucide-react`.
- **Clara (personagem):** `src/ClaraArt.jsx` com 15 poses em WebP 768 px (`src/assets/clara-poses/`); originais em `design-references/clara/15-poses-2026-10-11/`. Arte decorativa (`alt=""`), o texto ao lado carrega o significado. Não existe pose triste; para avisos negativos usa-se `reminder` (14-lembrete). Novas poses seguem o prompt "identity-preserve" de `prompts.json`.

## Responsivo (mobile-first na prática)
- Pontos de quebra principais: **767/768 px** (celular × desktop), 720, 900–950 e 1150 px; 380 px para telas muito estreitas.
- Desktop: menu lateral fixo (sem rolagem), cabeçalho `sticky` com `backdrop-filter`.
- Celular: menu recolhível e barra inferior (`MobileNav`), botões de largura total em faixas e formulários.
- Painéis flutuantes (sino) são renderizados em `document.body` porque o `backdrop-filter` do cabeçalho prende elementos fixos; no celular ocupam a largura com 16 px de margem.
- Conferir sempre em **320/375 px** e **1280–1440 px**, sem rolagem horizontal e sem texto abaixo de 11 px.

## Acessibilidade e tom
- Foco visível, `aria-label` em botões só de ícone, `role="status"` em mensagens, `prefers-reduced-motion` respeitado na rolagem.
- Textos em português, segunda pessoa, acolhedores e objetivos; sem números ou depoimentos inventados.
