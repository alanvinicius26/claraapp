# Memória do projeto — minha CLARA

Histórico vivo e enxuto. Atualizar ao concluir cada mudança aprovada. Evidências, IDs de deploy e detalhes de cada sessão ficam em `CONTEXTO.md`.

Estado em **19/10/2026**: produção em minhaclara.com (Vercel `dpl_5eTwXK6JugGpxgoV2cLbm4paKbHk`, commit `694fcce`), Supabase `gtqcehwvddvqllicnreu` (sa-east-1) com `client_change_notice` e `client_duplicates` aplicadas.

## Arquitetura atual

### Frontend (`src/`)
| Arquivo | Papel |
| --- | --- |
| `main.jsx` | App, rotas por hash, `Auth`, `Dashboard` e telas (Agenda, Clientes, Serviços, Recebimentos, Meu espaço, Agendamento online) |
| `booking.jsx`, `booking-policy.js` | Página pública `#/booking/:slug`, link da cliente `#/manage/:token` e prazo para cancelar/remarcar |
| `lib.js` | Cliente Supabase, `rpc()` (rotas públicas passam pela Edge Function `booking`), `query()` |
| `dashboard-data.js` | Carga paginada do painel + `dashboard_revision` (atualiza a cada 55–65 s) |
| `Team.jsx`, `HoursEditor.jsx`, `Resources.jsx`, `ParallelService.jsx` | Equipe, expedientes, salas/macas, encaixes |
| `hours-validation.js` | Valida o expediente antes de salvar (espelha os CHECKs de `working_hours`/`professional_hours`) e sugere pausa dentro do dia |
| `network.js` | Prazo das requisições e `errorMessage` (tradução de erros para a dona/cliente) |
| `Subscription.jsx`, `billing.js` | Planos e assinatura (Stripe) |
| `BookingAlerts.jsx`, `booking-alerts.js` | Sino de avisos em tempo real |
| `AccessNotice.jsx`, `access-notice.js` | Aviso de teste/plano encerrado |
| `ClaraChat.jsx`, `ClaraDayCard.jsx`, `ClaraArt.jsx` | Assistente e personagem |
| `ClientDuplicates.jsx`, `client-duplicates.js`, `ClientMerge.jsx` | Duplicados pelo WhatsApp e unificação manual |
| `Admin.jsx` | Área da plataforma (`#/admin`) |
| `Landing.jsx` | Página inicial pública |
| `WhatsApp*.jsx`, `whatsapp-connection.js` | Atendimento WhatsApp (standby, fora do build) |
| `features.js`, `remembered-login.js` | Chave do WhatsApp; e-mail lembrado no login |

### Supabase — RPCs usadas pelo app
- **Públicas (via Edge Function `booking`):** `booking_page`, `available_slots_team`, `available_dates_team`, `book_appointment_team`, `manage_booking` (legado aceito: `available_slots*`, `book_appointment*`; `book_appointment_whatsapp` aceita mas inerte).
- **Dona (JWT):** `setup_studio`, `owner_available_slots`, `save_hours`, `save_professional_hours`, `merge_clients`, `merge_client_group`, `dashboard_revision`, `studio_link_available`, `billing_status`, `mark_notifications_seen`.
- **Clara (Edge `clara`):** `clara_request_allowed`, `clara_take_quota`, `clara_read`, `clara_dialogue_get/save/commit`, `clara_reschedule_options`.
- **Plataforma:** `platform_admin_status`, `admin_accounts`, `admin_history`, `admin_set_access`, `admin_revoke_access`, `admin_coupons_list`.
- **Internas (`encaixa_private`):** `scheduling_slots`, `team_slots`, `schedule_fits`, `resources_free`, `parallel_fits`, `services_parallel_limit`, `billing_access`, `require_studio_subscription`, `lock_schedule`, `validate_schedule`, `notify_owner`, `resolve_studio`.
- Tabelas principais: `studios`, `professionals`, `working_hours`, `professional_hours`, `services`, `resources`, `clients`, `appointments`, `appointment_resources`, `payments`, `studio_notifications`; privadas em `encaixa_private` (cobrança, limites, revisões, locks, admin).

### Edge Functions em produção
`booking` v12, `clara` v16 (19/10: guia com prazo configurável), `billing` v6, `stripe-webhook` v5. `whatsapp` não publicada.

## Decisões aprovadas
- **Privacidade na reserva online:** a rota pública nunca consulta clientes existentes; cada reserva cria um cadastro novo. A unificação é manual no painel.
- **Regras no banco:** horários, confirmação, capacidade e cobrança são impostos por funções/gatilhos `security definer`; a interface só reflete.
- **Encaixes** (14/10): opt-in por serviço e profissional, liberação separada para o online, limite pelo menor `parallel_limit`.
- **Cobrança:** 7 dias grátis sem cartão; planos por tamanho de equipe (1=R$29,90; 2–3=R$59,90; 4=R$79,90; 5=R$99,90); acesso só por estado confirmado pelo webhook; vencido = só consulta.
- **Avisos em tempo real** (14–15/10): eventos em `studio_notifications`, só ações da cliente, retenção de 90 dias; som e notificação por aparelho.
- **Aviso de acesso encerrado** (15/10): janela uma vez por sessão + faixa fixa, botão para Minha assinatura; pose `14-lembrete`.
- **Clientes duplicados (Opção A, 15–16/10):** detecção e unificação com 1 clique só no painel (Clientes, detalhe da cliente e detalhe do atendimento), pela chave do WhatsApp; aviso privado "já é cliente" no sino. Unificação preserva todo o histórico (inclusive pago), observações, e-mail; nome/e-mail divergentes vão para as observações; acima de 5000 caracteres recusa tudo. Rejeitada a Opção B (vínculo automático na reserva pública) por contrariar a decisão de privacidade e permitir que quem conhece um telefone associe reservas ao histórico de outra pessoa.
- **Prazo do link da cliente (16/10):** configurável por estúdio em Meu espaço (`studios.change_notice_hours`: 2, 4, 6, 12, 24 ou 48 h; padrão 2). Vale o valor atual do estúdio, inclusive para reservas já feitas (rejeitada a opção de gravar o prazo na reserva). Status confirmado e pagamento registrado continuam iguais. Fora do prazo, botões desabilitados e WhatsApp do estúdio.
- **Erros ao salvar (19/10, caso LariHair):** o único `save_hours` dela em produção (18/10, iPhone) falhou por `working_hours_check1` (pausa fora do expediente), e a tela mostrava mensagem genérica. Agora: expediente validado no formulário com o dia e o motivo; pausa nova nasce dentro do dia; dias desligados descartam pausa inválida invisível; `errorMessage` só diz "Erro de conexão" para falhas sem código do banco (inclui "Load failed" do iOS), traduz 23514/22007/23502/57014 e "Acesso negado."; recarga lenta depois de salvar não troca mais o "salvo" por erro. Sem mudança no banco.
- **Login:** lembra só o e-mail no aparelho; senha fica com o gerenciador do navegador.
- **WhatsApp em standby:** código e simulador prontos, escondidos por `VITE_WHATSAPP_ENABLED`; migrações `whatsapp*.sql` não aplicadas.
- **WAHA como adaptador (20/10, só local):** provedor por estúdio pelo canal `waha:<sessão>`, ao lado da Meta (não a substitui). Status do atendimento em `whatsapp_conversations` (`TRIAGEM`, `AGUARDANDO_ASSUNTO`, `FILA_HUMANO`, `FINALIZADO` + `resumo_duvida`), sincronizado com `mode`; rejeitada a tabela separada `whatsapp_atendimentos` (duas fontes de verdade). Mensagens ativas só 08h00–19h59 (São Paulo): lembrete adiantado para 19h30, ou cancelado se esse horário já passou; confirmação de madrugada segura até 08h; vale em `live`, não na simulação. Webhook WAHA com HMAC-SHA512, visto + "digitando" antes do texto. Riscos aceitos: API não oficial (banimento possível); detalhes em `WHATSAPP-ATENDIMENTO.md`.
- **Atendimento WAHA após o teste real (21/10, só local):**
  - **Em `FILA_HUMANO`:** saem confirmação, remarcação, cancelamento e lembrete; só o menu e o link ficam pausados.
  - **Texto do horário:** "(horário de Brasília)", inclusive nos rascunhos da Meta.
  - **`SAIR`:** uma única resposta, na hora e fora da janela; sem reativação.
  - **Mensagens que a dona digita no celular (`message.any`):** gravadas como `team_phone` e põem a conversa em `FILA_HUMANO`, só em conversas que a cliente abriu. O eco da Clara é ignorado, pela chave ou pelo texto recente.
  - **Fim da pausa:** volta sozinha 12 h após a última mensagem da equipe pelo celular; atendimento pedido pela cliente ("2") continua até encerrar.
- **Android:** backup do app desligado; modo ao vivo protegido (scripts + trava no Gradle para builds release).
- **Publicação:** pacote estático via `scripts/deploy-vercel.ps1`, sempre prévia conferida antes da produção; migrações ensaiadas com rollback; commit antes ou logo após publicar.

## Problemas conhecidos
- **Clientes duplicados** nas reservas online continuam sendo criados (decisão de privacidade); agora o painel detecta e unifica. Em produção havia 2 grupos em 7 cadastros (15/10). Unificação publicada em 19/10; ainda não testada com conta real (detalhe do atendimento não abre na demonstração).
- **Prazo do link da cliente** publicado em 19/10, mas a tela do link fora do prazo ainda não foi vista com reserva real.
- **Proteção contra senhas vazadas** desativada no Supabase Auth (pode exigir plano Pro).
- **Schema `encaixa_backup_20261014`** em produção guarda cópia com dados pessoais (backup de 14/10); decidir data para apagar (sugestão: ~30 dias). **`encaixa_backup_20261019`** (cópia de `studios` + 4 funções anteriores, antes das migrações de 19/10) também tem dados pessoais dos estúdios.
- **Capacitor:** função `billing` recusa a origem do app; links de e-mail apontam para a origem interna; Stripe precisa abrir no navegador externo; avisos ainda usam API do navegador.
- **WAHA (local):** container `clara-waha` + `npm run waha:local` (banco isolado, lista de números permitidos). Roteiro completo testado em 21/10 com celulares reais (menu, link, atendente, assunto, silêncio em `FILA_HUMANO`, resposta da equipe, encerrar, confirmação, lembrete cancelado fora da janela, `SAIR`). Corrigidos no caminho: contato `@lid` (número em `SenderAlt`) e ids de envio × recibo (`wahaKey`).
  - Antes de produção: `whatsapp_receipt` descartar recibos que não são de mensagens da Clara (o WAHA manda de todas as conversas); configurar mais tentativas de reentrega do webhook.
  - Os 4 pontos do teste foram implementados em 21/10 (ver Decisões), com testes, mas **ainda não repetidos com o celular**. A conferir no real: se a mensagem digitada no celular para um `@lid` traz o número, e se o eco chega com o texto idêntico.
  - Pendências que continuam: `tagsEventsOn` no WEBJS; canal configurado só por SQL; o painel ainda não mostra status/resumo nem tem botão de encerrar.
- **WhatsApp (standby):** eventos de canal conectado mas desativado se perdem após 5 tentativas; opt-out ("SAIR") é definitivo, sem reativação; confirmação com número real da Meta pendente.
- Não há typecheck no projeto (sem `tsconfig`, `tsc` ou `deno` local); Edge Functions `.ts` só são verificadas ao publicar.
- **Mapa do código (21/10):** skill `repo-map` (Tomatio13, base Aider) instalada em `~/.claude/skills/repo-map` com Python 3.12 64 bits próprio (o Python 3.14 do PC é 32 bits e não instala tree-sitter). Saída em `.repomap/` (ignorada no git). Cobre JS/JSX/TS, **não** SQL. Uso e exclusões no `CLAUDE.md`.
- Logo `clara-logo-v2.png` com 476 KB carregado em todas as telas.
- Duas contas com teste vencido em 15/10 (bloqueadas para gravação, comportamento esperado).

## Próximos passos
1. Decidir e executar a remoção dos backups `encaixa_backup_20261014` e `encaixa_backup_20261019`.
2. Ativar a proteção de senhas vazadas no painel do Supabase (se o plano permitir).
3. Avisar a LariHair que o expediente pode ser salvo de novo (o dela ainda está no padrão e ela ainda não tem serviços) e conferir com conta real a unificação e o link fora do prazo.
4. Preparar o app Android para a loja: origem na `billing`, deep links de e-mail, Stripe externo, `@capacitor/local-notifications` e push (FCM).
5. Otimizar o logo para WebP.
6. Quando autorizado: ativar o WhatsApp (migrações `whatsapp` → `whatsapp_operations` → `whatsapp_waha`, função, Meta ou WAHA) seguindo `WHATSAPP-ATENDIMENTO.md`.
7. WAHA: repetir o roteiro com o celular (banco local novo) para conferir as regras de 21/10, filtrar recibos em `whatsapp_receipt` e mostrar status/resumo do atendimento no painel.
