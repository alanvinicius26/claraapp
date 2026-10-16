# Agendamento — regras de negócio (fonte da verdade)

As regras vivem no **banco** (Supabase/Postgres). A interface só mostra o que o banco libera, e toda gravação é revalidada no banco. Mudanças aqui exigem plano resumido aprovado antes (ver `CLAUDE.md`).

Migrações que definem estas regras, na ordem aplicada em produção: `schema` → `hardening` → `quality` → `multiservice` → `booking_readiness` → `product_completion` → `team` → `custom_links` → `clara*` → `production_readiness` → `billing` → `billing_plans` → `platform_admin` → `scheduling_integrity` → `parallel_bookings` → `booking_notifications` → `booking_notifications_retention` → `client_duplicates` (local, ainda não aplicada) → `client_change_notice` (local, ainda não aplicada; independe de `client_duplicates`).

## Configurações do estúdio (`public.studios`)
| Campo | Padrão | Faixa | Uso |
| --- | --- | --- | --- |
| `min_notice` | 120 min | 0–10080 | antecedência mínima para começar |
| `horizon` | 30 dias | **1–90** | até quantos dias à frente aceita reservas |
| `buffer` | 15 min | 0–120 | intervalo de limpeza após o atendimento |
| `active` | true | — | reservas online ligadas/pausadas |
| `change_notice_hours` | 2 h | **2, 4, 6, 12, 24 ou 48** | prazo para a cliente cancelar/remarcar sozinha pelo link |

## Cálculo de horários livres
Funções: `public.available_slots_team` (público), `public.owner_available_slots` (dona), `encaixa_private.scheduling_slots` (núcleo), `encaixa_private.team_slots` (Clara), `public.available_dates_team` (lista de dias).

Para um dia e uma profissional, testa horários **de 15 em 15 min** e libera apenas os que passam em todas as etapas:

1. **Expediente:** usa `professional_hours` do dia da semana; se a profissional não tiver horário próprio naquele dia, usa `working_hours` do estúdio. Dia desligado = sem horários.
2. **Duração + limpeza cabem no expediente:** ocupação = soma das durações dos serviços + `buffer`, intervalo `[início, fim)`, tudo dentro de abertura–fechamento (`encaixa_private.schedule_fits`).
3. **Pausa:** a ocupação não pode cruzar `break_start`–`break_end`.
4. **Antecedência:** início ≥ agora + `min_notice`.
5. **Horizonte:** data entre hoje e hoje + `horizon` (fuso São Paulo).
6. **Conflito com a profissional:** nenhuma sobreposição com outro atendimento não cancelado ou bloqueio dela — exceto **encaixe** (`encaixa_private.parallel_fits`):
   - profissional com `accepts_parallel` (e, na reserva pública, também `parallel_online`);
   - todos os serviços envolvidos com `allows_parallel`; limite = menor `parallel_limit` (2–10) entre os atendimentos sobrepostos;
   - bloqueios e atendimentos exclusivos (`parallel_limit = 1`) nunca aceitam encaixe.
7. **Recursos físicos (sala/maca):** serviços com `resource_id` exigem o recurso ativo e livre durante toda a ocupação (`resources_free`, tabela `appointment_resources`).

Detalhes:
- Todo cálculo usa `America/Sao_Paulo`; instantes gravados em UTC (`timestamptz`).
- Serviços: 1 a 20 por atendimento, durações e preços **somados**.
- `available_dates_team` varre no máximo 14 dias por chamada e devolve até 3 dias com o primeiro horário de cada (`hasMore` para continuar).
- Painel (dona): `owner_available_slots` ignora a regra "liberar encaixe online", informa `shared` (é encaixe) e aceita o horário original de atendimentos antigos fora da grade de 15 min.

## Confirmação da reserva (operação atômica)
Caminho público: navegador → Edge Function `booking` (valida chave publicável, formato dos campos, `p_start` com fuso explícito, limite por IP) → `public.book_appointment_team` (`security definer`). Em uma única transação:

1. **Trava por estúdio:** `select … for update` no estúdio + gatilho `a0_lock_schedule` (tabela `encaixa_private.schedule_locks`) serializa reservas e mudanças de configuração do mesmo estúdio. Conflito simultâneo → erro `23P01` ("Esse horário acabou de ser ocupado").
2. **Validação dos dados:** nome 2–120, e-mail opcional válido, WhatsApp com DDD obrigatório (normalizado sem `55`), observação ≤ 2000.
3. **Revalidação:** o horário precisa estar em `available_slots_team` naquele momento; gatilhos `z_validate_schedule` e `zz_parallel_capacity` conferem de novo expediente, antecedência, horizonte, recursos e capacidade.
4. **Snapshot imutável** (gatilho `normalize_appointment`): `price`, `service_name`, `service_items` (id, nome, preço, duração), `ends_at`, `occupied` e `parallel_limit` gravados no atendimento. Mudar o catálogo depois **não** altera reservas feitas.
5. **Cadastro:** cria um **novo** registro em `clients` a cada reserva online (privacidade: a rota pública nunca busca clientes existentes) e o atendimento `confirmed`, `source = 'online'`.
6. **Aviso à dona:** gatilho `zz_notify_owner` grava em `studio_notifications` (ver abaixo).
7. Retorno: `{ id, token }` — o `token` (`manage_token`) é o link da cliente.

Proteções:
- **Limite por IP** (`booking_rate_limit`, hash SHA-256 do IP): gravações **15 a cada 10 min**, leituras **120 por minuto**. O cabeçalho `X-Forwarded-For` é sobrescrito pela plataforma (testado: não burlável).
- **Plano/teste vencido:** gatilho `billing_access_guard` (`encaixa_private.require_studio_subscription`) recusa gravações de negócio e novas reservas quando `encaixa_private.billing_access` é falso (teste de 7 dias vencido, assinatura inativa, acesso do admin expirado ou equipe acima do limite do plano). Consulta e exportação continuam permitidas.

## Link da cliente (`#/manage/:token`)
Função `public.manage_booking(token, action, start)`:
- **Ver:** dados da própria reserva (serviço, horário, profissional, estúdio, status, se há pagamento).
- **Remarcar** e **cancelar** só quando: status `confirmed`, faltam **≥ `change_notice_hours`** do estúdio para o início (padrão 2 h; substituiu as 2 horas fixas em 16/10, `client_change_notice.sql`) e **não há pagamento registrado**.
- O prazo é lido no momento da ação: mudar a configuração vale também para reservas já feitas. A mesma regra está em `manage_booking` e no ramo de remarcação (token) de `available_slots_team`, para a lista de horários e a gravação nunca divergirem. Mensagem: "Alterações online são permitidas até N horas antes."
- Não confundir com `min_notice` (antecedência para **agendar**, etapa 4 do cálculo): são colunas e regras independentes; uma não altera a outra.
- A conta é feita entre instantes (`starts_at` < `now()` + N horas), então o resultado é o mesmo em qualquer fuso; os horários mostrados seguem `America/Sao_Paulo`.
- O prazo aparece para a cliente antes de confirmar (`booking_page` → `studio.change_notice_hours`) e no link (`manage_booking` → `change_notice_hours`). Fora do prazo, o link mostra os botões desabilitados e "Chamar o estúdio no WhatsApp" (se o estúdio tiver telefone).
- Remarcar: mesma profissional e mesmos serviços; o novo horário precisa estar livre (mesmas regras acima, excluindo a própria reserva).
- Cada ação gera aviso à dona (`client_rescheduled` / `client_cancelled`).

## Avisos à dona (tempo real)
- Tabela `public.studio_notifications` (RLS: só a dona lê), publicada no Supabase Realtime.
- Gatilho `encaixa_private.notify_owner` só registra ações **sem usuário logado** (rota pública): nova reserva online, remarcação e cancelamento pela cliente. Ações da dona (painel, Clara) não geram aviso.
- Nova reserva cujo WhatsApp já existe em outro cadastro ativo do estúdio recebe `returning: true` e `previous_visits` no aviso ("Nova reserva · já é cliente"). Só no aviso da dona; a resposta pública não muda. (`client_duplicates.sql`)
- `public.mark_notifications_seen` marca como vistos; avisos com mais de **90 dias** são apagados por estúdio (novo aviso ou abertura do sino).

## Clientes duplicados pelo WhatsApp (só no painel)
- A reserva online continua criando um cadastro novo e nunca consulta, vincula ou devolve clientes existentes.
- Chave do telefone: `encaixa_private.phone_key` (SQL) = `phoneKey` (`src/client-duplicates.js`): só dígitos, sem 55, 9º dígito restaurado em celular antigo (8 dígitos começando com 6–9); fixo mantém 10 dígitos; inválido = sem chave (nunca agrupa).
- O painel agrupa cadastros ativos com a mesma chave e sugere como principal o de mais visitas concluídas, depois com próximo horário, depois o mais antigo.
- `public.merge_client_group(alvo, origens[])`: só a dona do estúdio, todos com a mesma chave, tudo ou nada; reaproveita `merge_clients` (move todos os atendimentos, passados e futuros — pagamentos acompanham o atendimento —, junta observações, arquiva com `merged_into`) e preenche o e-mail do principal se estiver vazio. Nome ou e-mail diferentes dos cadastros arquivados viram uma linha datada nas observações internas (“Unificado em DD/MM/AAAA: cadastro “X” · e-mail Y”); se as observações passarem de 5000 caracteres, nada é unificado.
- A sugestão aparece na tela Clientes (grupos), no detalhe da cliente e no detalhe do atendimento; o painel recarrega após unificar, então visitas e "clientes que voltam" já contam o histórico unificado. Conta com teste vencido não consegue unificar (gatilho de cobrança nos atendimentos).

## Agenda interna (painel e Clara)
- Mesmas regras de expediente, pausa, antecedência, horizonte, recursos e capacidade, aplicadas pelos gatilhos em qualquer gravação.
- `guard_schedule_configuration` impede mudar expediente/serviço/recurso de forma que um atendimento futuro confirmado fique sem cobertura.
- Bloqueios (`status = 'blocked'`) são sempre exclusivos e não têm serviço/preço.
- Atendimento com pagamento registrado não pode mudar serviços ou horário; cancelado não volta a confirmado.
