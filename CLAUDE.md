# minha CLARA (minhaclara.com)

App de agenda para profissionais de beleza: painel da dona, página pública de reservas e assistente Clara.
Nome interno antigo: **Encaixa**. Schemas, pastas e IDs ainda usam `encaixa` (ex.: `encaixa_private`, projeto Vercel `encaixa`). **Não renomeie estruturas internas sem permissão explícita.**

Leia sempre antes de mudar algo:
- @specs/agendamento.md — regras da agenda (fonte da verdade)
- @specs/design.md — identidade visual e responsivo
- @memoria.md — arquitetura, decisões, problemas conhecidos e próximos passos
- `CONTEXTO.md` — histórico detalhado de cada sessão (consultar quando precisar de evidência ou ID)

## Regra obrigatória
Se algum pedido meu contradisser uma decisão ou regra de segurança registrada em `@specs/agendamento.md`, `@specs/design.md` ou `@memoria.md`, pare imediatamente e me avise antes de alterar qualquer arquivo ou criar migração SQL. Explique qual regra seria afetada e pergunte se desejo substituí-la.

## Stack
- **Frontend:** React 19 + Vite 8 (SPA com rotas por hash `#/`), lucide-react, CSS próprio (sem framework). Node 24.
- **Backend:** Supabase (Postgres 17, Auth, Realtime, Edge Functions em Deno). Regras de negócio no banco (funções `security definer`, gatilhos, RLS).
- **Edge Functions:** `booking` (gateway público), `clara` (assistente, IA via Groq), `billing`, `stripe-webhook`, `whatsapp` (em standby, não publicada). Todas com `verify_jwt = false` e autenticação própria.
- **Pagamentos:** Stripe (assinatura mensal por tamanho de equipe, portal do cliente, webhook assinado).
- **Hospedagem:** Vercel, publicada por pacote estático (`scripts/deploy-vercel.ps1`), não por build da Vercel.
- **Mobile:** Capacitor 8 Android (`android/`), `appId` `com.minhaclara.app`.
- **Testes:** `node:test` + PGlite (Postgres em memória) com as migrações na ordem de produção.

## Comandos
- `npm run dev` — site local em http://localhost:3000 (usa o Supabase de **produção** do `.env.local`: dados reais)
- `npm test` — suíte principal · `npm run build` — build de produção · `npm run check:release` — ambos
- `npm run test:scheduling:concurrency` / `test:billing:concurrency` / `test:whatsapp:concurrency` — concorrência em Postgres nativo
- `npm run android:live` (com `npm run dev` aberto) · `npm run android:release` · `npm run android:open`
- WhatsApp (só simulação local): `npm run whatsapp:sim` + `npm run dev:whatsapp`

## Mapa do código (skill `repo-map`)
Quando não souber em que arquivo JS/JSX/TS mora um comportamento, rode o mapa antes de abrir arquivos grandes (`main.jsx`). Instruções de execução no Windows estão na própria skill (`~/.claude/skills/repo-map`). Sempre com:
`--exclude-glob ".env*,android/*,design-references/*,stitch_encaixa_beauty_scheduling_app/*,marketing/*,public/*,*.md,**/*.md,dist/*"`
e, se souber nomes, `--mentioned-idents "nomeA,nomeB"`. Ordem: `status` → `update` se desatualizado → ler só os 3–5 primeiros arquivos.
Não cobre `.sql` (regras do banco): para isso use `specs/agendamento.md`, `memoria.md` e busca direta em `supabase/`.

## Regras gerais
- Nunca altere funções SQL do Supabase sem manter `security definer` e `set search_path = ''` onde já existem.
- Nunca exponha dados de clientes existentes na rota pública `/#/booking/:slug`.
- Sempre use o fuso `America/Sao_Paulo`.
- Antes de qualquer mudança no cálculo de horários ou na confirmação de reserva, apresente um plano resumido.
- Após aprovar e concluir uma mudança, atualize `@memoria.md`.
- Publicar (Vercel), aplicar migração ou publicar função em produção só com autorização explícita. Migração: ensaio com `begin … rollback` em produção antes de aplicar; backup antes de mudanças estruturais.
- Nunca colocar segredos em arquivos versionados nem no chat. Chave pública do Supabase é a única no `.env.local`.
- WhatsApp continua desligado (`VITE_WHATSAPP_ENABLED`) até decisão explícita.
