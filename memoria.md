# Memória do projeto — minha CLARA

Histórico vivo e enxuto. Atualizar ao concluir cada mudança aprovada. Evidências, IDs de deploy e detalhes de cada sessão ficam em `CONTEXTO.md`.

Estado em **15/10/2026**: produção em minhaclara.com (Vercel `dpl_3i7kXjmL49kMmTeo3RKTvJf1Xgkg`), Supabase `gtqcehwvddvqllicnreu` (sa-east-1), último commit `00ed5f8`.

## Arquitetura atual

### Frontend (`src/`)
| Arquivo | Papel |
| --- | --- |
| `main.jsx` | App, rotas por hash, `Auth`, `Dashboard` e telas (Agenda, Clientes, Serviços, Recebimentos, Meu espaço, Agendamento online) |
| `booking.jsx` | Página pública `#/booking/:slug` e link da cliente `#/manage/:token` |
| `lib.js` | Cliente Supabase, `rpc()` (rotas públicas passam pela Edge Function `booking`), `query()` |
| `dashboard-data.js` | Carga paginada do painel + `dashboard_revision` (atualiza a cada 55–65 s) |
| `Team.jsx`, `HoursEditor.jsx`, `Resources.jsx`, `ParallelService.jsx` | Equipe, expedientes, salas/macas, encaixes |
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
- **Dona (JWT):** `setup_studio`, `owner_available_slots`, `save_hours`, `save_professional_hours`, `merge_clients`, `merge_client_group` (nova, local), `dashboard_revision`, `studio_link_available`, `billing_status`, `mark_notifications_seen`.
- **Clara (Edge `clara`):** `clara_request_allowed`, `clara_take_quota`, `clara_read`, `clara_dialogue_get/save/commit`, `clara_reschedule_options`.
- **Plataforma:** `platform_admin_status`, `admin_accounts`, `admin_history`, `admin_set_access`, `admin_revoke_access`, `admin_coupons_list`.
- **Internas (`encaixa_private`):** `scheduling_slots`, `team_slots`, `schedule_fits`, `resources_free`, `parallel_fits`, `services_parallel_limit`, `billing_access`, `require_studio_subscription`, `lock_schedule`, `validate_schedule`, `notify_owner`, `resolve_studio`.
- Tabelas principais: `studios`, `professionals`, `working_hours`, `professional_hours`, `services`, `resources`, `clients`, `appointments`, `appointment_resources`, `payments`, `studio_notifications`; privadas em `encaixa_private` (cobrança, limites, revisões, locks, admin).

### Edge Functions em produção
`booking` v12, `clara` v15, `billing` v6, `stripe-webhook` v5. `whatsapp` não publicada.

## Decisões aprovadas
- **Privacidade na reserva online:** a rota pública nunca consulta clientes existentes; cada reserva cria um cadastro novo. A unificação é manual no painel.
- **Regras no banco:** horários, confirmação, capacidade e cobrança são impostos por funções/gatilhos `security definer`; a interface só reflete.
- **Encaixes** (14/10): opt-in por serviço e profissional, liberação separada para o online, limite pelo menor `parallel_limit`.
- **Cobrança:** 7 dias grátis sem cartão; planos por tamanho de equipe (1=R$29,90; 2–3=R$59,90; 4=R$79,90; 5=R$99,90); acesso só por estado confirmado pelo webhook; vencido = só consulta.
- **Avisos em tempo real** (14–15/10): eventos em `studio_notifications`, só ações da cliente, retenção de 90 dias; som e notificação por aparelho.
- **Aviso de acesso encerrado** (15/10): janela uma vez por sessão + faixa fixa, botão para Minha assinatura; pose `14-lembrete`.
- **Clientes duplicados (Opção A, 15–16/10):** detecção e unificação com 1 clique só no painel (Clientes, detalhe da cliente e detalhe do atendimento), pela chave do WhatsApp; aviso privado "já é cliente" no sino. Unificação preserva todo o histórico (inclusive pago), observações, e-mail; nome/e-mail divergentes vão para as observações; acima de 5000 caracteres recusa tudo. Rejeitada a Opção B (vínculo automático na reserva pública) por contrariar a decisão de privacidade e permitir que quem conhece um telefone associe reservas ao histórico de outra pessoa.
- **Login:** lembra só o e-mail no aparelho; senha fica com o gerenciador do navegador.
- **WhatsApp em standby:** código e simulador prontos, escondidos por `VITE_WHATSAPP_ENABLED`; migrações `whatsapp*.sql` não aplicadas.
- **Android:** backup do app desligado; modo ao vivo protegido (scripts + trava no Gradle para builds release).
- **Publicação:** pacote estático via `scripts/deploy-vercel.ps1`, sempre prévia conferida antes da produção; migrações ensaiadas com rollback; commit antes ou logo após publicar.

## Problemas conhecidos
- **Clientes duplicados** nas reservas online continuam sendo criados (decisão de privacidade); agora o painel detecta e unifica. Em produção havia 2 grupos em 7 cadastros (15/10). Migração `client_duplicates.sql` e painel **ainda não publicados** (commit 7fd181b + complementos de 16/10). Detalhe do atendimento não abre na demonstração; conferir com conta real após publicar.
- **Proteção contra senhas vazadas** desativada no Supabase Auth (pode exigir plano Pro).
- **Schema `encaixa_backup_20261014`** em produção guarda cópia com dados pessoais (backup de 14/10); decidir data para apagar (sugestão: ~30 dias).
- **Capacitor:** função `billing` recusa a origem do app; links de e-mail apontam para a origem interna; Stripe precisa abrir no navegador externo; avisos ainda usam API do navegador.
- **WhatsApp (standby):** eventos de canal conectado mas desativado se perdem após 5 tentativas; opt-out ("SAIR") é definitivo, sem reativação; confirmação com número real da Meta pendente.
- Não há typecheck no projeto (sem `tsconfig`, `tsc` ou `deno` local); Edge Functions `.ts` só são verificadas ao publicar.
- Logo `clara-logo-v2.png` com 476 KB carregado em todas as telas.
- Duas contas com teste vencido em 15/10 (bloqueadas para gravação, comportamento esperado).

## Próximos passos
1. Decidir e executar a remoção do backup `encaixa_backup_20261014`.
2. Ativar a proteção de senhas vazadas no painel do Supabase (se o plano permitir).
3. Publicar a unificação de clientes: ensaiar e aplicar `client_duplicates.sql`, depois publicar o site (antes do site a tela não quebra, mas o botão de unificar falha sem a função).
4. Preparar o app Android para a loja: origem na `billing`, deep links de e-mail, Stripe externo, `@capacitor/local-notifications` e push (FCM).
5. Otimizar o logo para WebP.
6. Quando autorizado: ativar o WhatsApp (migrações, função, Meta) seguindo `WHATSAPP-ATENDIMENTO.md`.
