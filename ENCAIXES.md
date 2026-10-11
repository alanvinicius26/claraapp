# Encaixes — implementação de 11/10/2026

**Somente local. Nada aplicado no Supabase nem publicado na Vercel.** Depende de `supabase/scheduling_integrity.sql`, que também continua pendente.

## Como funciona

- **Serviço** (Serviços → editar): chave **“Posso atender outra pessoa junto”** e campo **“Até quantas pessoas ao mesmo tempo”** (2 a 10, contando a primeira pessoa). Sem a chave, o serviço é exclusivo, como hoje.
- **Profissional** (Equipe → Dados da profissional): **“Faz encaixes”** e **“Liberar encaixes no agendamento online”** (só pode ficar ligada com “Faz encaixes”; o banco também exige isso).
- O limite é **por profissional**: em cada instante, as pessoas atendidas juntas pela mesma profissional não passam do **menor limite** entre os atendimentos simultâneos. Uma reserva com vários serviços usa o menor limite deles; se algum serviço for exclusivo, a reserva inteira é exclusiva.
- **Bloqueios/folgas** e **serviços exclusivos** nunca dividem horário com nada.
- **Salas e macas** vinculadas continuam atendendo uma pessoa por vez: dois encaixes que usam a mesma maca são recusados.
- **Painel e Clara** (dona da conta): oferecem encaixe se a profissional “Faz encaixes”. O seletor de horário mostra “09:00 · encaixe” e um aviso.
- **Agendamento online e remarcação pelo link da cliente**: só oferecem encaixe se a profissional também tiver a liberação online. Sem ela, a cliente vê apenas horários totalmente livres.
- **Agenda**: atendimentos simultâneos da mesma profissional aparecem com “· Encaixe”.
- O limite fica gravado na reserva (como preço e duração). Mudar o serviço ou desligar “Faz encaixes” depois **não invalida** encaixes já marcados; só impede novos.

## Banco (`supabase/parallel_bookings.sql`)

- Colunas: `services.allows_parallel`, `services.parallel_limit`; `professionals.accepts_parallel`, `professionals.parallel_online`; `appointments.parallel_limit` (snapshot, 1 = exclusivo).
- A exclusão GiST `appointments_professional_overlap` passa a valer só entre reservas exclusivas (`parallel_limit=1`). Qualquer sobreposição com encaixe é validada pelo trigger `zz_parallel_capacity`, serializado pela trava por estúdio (`a0_lock_schedule`) da `scheduling_integrity`. Por isso a ordem de aplicação importa.
- Chamadas sem usuário (gateway público) seguem a regra online; a dona segue “Faz encaixes”. Conflitos retornam SQLSTATE `23P01`, como a constraint, e o gateway continua respondendo HTTP 409.
- `owner_available_slots` passa a retornar também `shared` (horário é encaixe). As funções de horários livres públicas, do painel e da Clara usam a mesma regra (`encaixa_private.parallel_fits`).
- Reservas existentes recebem `parallel_limit=1`: comportamento idêntico ao atual até alguém ativar as opções.

## Validação

- `npm run check:release`: **436 testes passaram**, build aprovado.
- `tests/parallel-bookings.test.js` (PGlite, todas as migrações na ordem de produção): limites, menor limite, bordas `[início, fim)`, exclusivos, bloqueios, outra profissional, painel com `shared`, Clara, regra online, reserva pública, snapshot após mudar catálogo/equipe, cancelamento, maca exclusiva, RLS e limites de coluna.
- `npm run test:scheduling:concurrency` (PostgreSQL 18 nativo, conexões independentes): **12 testes passaram**, incluindo 8 inserções simultâneas para limite 3 (exatamente 3 confirmadas), 8 reservas públicas simultâneas (3 reservas e 3 clientes) e encaixes disputando com exclusivos.
- Os testes de agenda existentes (`tests/scheduling.test.js`) rodam agora na ordem real de produção (`billing_plans` → `platform_admin` → `scheduling_integrity` → `parallel_bookings`) e continuam passando.
- Navegador com fixture isolada `.local/parallel-qa.html` (`tests/parallel-ui-fixture.js`, rede externa bloqueada, dados fictícios): salvar serviço com limite 3, ligar/desligar opções na Equipe, horário “09:00 · encaixe” com aviso, rótulo na agenda e no cartão do serviço. Sem rolagem horizontal em 375 px.

## Publicação (exige aprovação explícita — regra do CONTEXTO.md)

1. Backup e leitura de compatibilidade em produção.
2. Aplicar `supabase/scheduling_integrity.sql` (pendente desde 06/10, ver AUDITORIA_AGENDAMENTOS.md).
3. Aplicar `supabase/parallel_bookings.sql`.
4. Publicar a função `booking` (`index.ts` + `validation.js`) e a `clara` (o `guide.js` agora descreve encaixes — não publicar antes da migração).
5. Publicar o frontend. O `dist` genérico contém também as telas de salas/macas da `scheduling_integrity`; é necessário preparar um pacote de release a partir do pacote em produção (`clara-admin-20261008-admin-v1`), como nas publicações anteriores.
