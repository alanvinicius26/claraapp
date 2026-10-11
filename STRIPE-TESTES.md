# Stripe da Clara — homologação concluída

Auditoria adicional em08/10/2026: ver VERIFICACAO-PAGAMENTOS-20261008.md. Novo ciclo completo team3 passou, incluindo cartão vencido, renovação paga/recusada, recuperação e cancelamento. 44 testes automatizados e7 verificações remotas passaram. Encontrado loop de consultas da tela de assinatura; correção local validada e pacote pronto, aguardando publicação autorizada. A produção já está ativada desde08/10, conforme STRIPE-ATIVACAO.md; referências abaixo à produção desativada descrevem o estado histórico de07/10.

Atualizado em 07/10/2026. Os fluxos abaixo foram executados com objetos e cartões fictícios no sandbox Stripe, com sincronização real pelo webhook e conferência no Supabase. Nenhuma cobrança real ou e-mail real foi enviado. A produção foi publicada com cobrança desativada; ativação LIVE está descrita em STRIPE-ATIVACAO.md.

## Ambientes

- Stripe de testes: `acct_1SA92fCHmArYgc52`, Área restrita de New business.
- Supabase Clara — testes: `myqfoqfnjtdzouupoaiq`, organização `zvovwelwpbrldxlihads`, região sa-east-1, plano gratuito aprovado pelo usuário.
- Prévia final: https://encaixa-m92qs2gal-bertunesinc-3931.vercel.app, deployment `dpl_85c2wG3ccvKCfSUFU84TCF4s4Bqn`, READY, sem aliases de produção.
- APP_ORIGIN atualizado para essa prévia; retorno do portal conferido na interface. Banner de teste e noindex; apenas URL/chave pública do Supabase testes no pacote.
- Migrações: `20261007182621_clara_test_baseline` e `20261007182650_clara_test_billing_plans`. Sem scheduling_integrity.
- billing e stripe-webhook publicados com core.js e _shared/plans.js; autenticação de sessão própria e HMAC, verify_jwt=false intencional.
- Salvos: BILLING_MODE=test, quatro preços, portal, APP_PUBLISHABLE_KEY, APP_ORIGIN, STRIPE_SECRET_KEY e STRIPE_WEBHOOK_SECRET. Os segredos foram transferidos entre painéis com autorização explícita, sem valores em arquivos/logs/chat.
- Cobrança ativada SOMENTE nesse Supabase para QA. Produção `gtqcehwvddvqllicnreu` segue billing.enabled=false.

A prévia anterior co722pqv5 foi substituída: contém a fonte completa com alterações de agendamento ainda não publicadas. Não promover nem usar como baseline. O pacote final usa o mesmo gerador isolado da produção, com três componentes atualizados e código de agenda publicado preservado byte a byte.

## Catálogo

Preços mensais, BRL, totais fixos por estabelecimento, quantidade1, per_unit/licensed, sem teste grátis na Stripe.

| Plano | Mensalidade | Produto | Preço |
| --- | --- | --- | --- |
| solo,1 | R$29,90 | `prod_VOmg3bv0YWE52l` | `price_1UNz7NCHmArYgc52bZHIfGtD` |
| team3,até3 | R$59,90 | `prod_VOmht6GzARXPzZ` | `price_1UNz8JCHmArYgc52cEfIso9p` |
| team4,até4 | R$79,90 | `prod_VOmieH7uvKgben` | `price_1UNz94CHmArYgc52r4K8ApT6` |
| team5,até5 | R$99,90 | `prod_VOmjVaOGh1Kzwl` | `price_1UNz9nCHmArYgc52XJMs4qKY` |

Portal `bpc_1UNzCOCHmArYgc52igMhd5Iu`: faturas/cartão e cancelamento no fim do período; subscription_update=false. Não recriar.

Webhook `we_1UNzz1CHmArYgc525OLglL3h`: ativo/teste, API2025-04-30.basil, URL https://myqfoqfnjtdzouupoaiq.supabase.co/functions/v1/stripe-webhook.

Eventos: customer.subscription.created/updated/deleted/pending_update_applied/pending_update_expired, invoice.paid/payment_failed/voided.

## Testes executados

Fixture confirmada por SQL sem envio de e-mail: clara-billing-qa@example.invalid, proprietário `1a7e9a92-da69-4a9d-a77c-627c645c6310`, estúdio `46e21497-eaa1-44fc-a9c4-28ccdff9de97`, slug clara-billing-qa. Customer `cus_VOo7a4Rbfbz5op`, assinatura `sub_1UO0YSCHmArYgc52CQbJx1dG`. Credencial fictícia de QA apenas no script local dedicado, nunca reutilizar em produção.

| Cenário | Resultado observado |
| --- | --- |
| Checkout solo, cartão recusado | Mensagem de recusa; sem assinatura/período pago; can_use=false |
| Checkout solo com3DS | Desafio sintético concluído; webhook ativou solo2990, pago até07/11/2026 19:29:49UTC |
| Upgrade solo→team3 pendente | Limite1 e acesso pago anterior preservados; link de fatura disponível |
| Cancelar alteração pendente | Solicitação limpa, assinatura/plano anterior mantidos |
| Novo upgrade team3,3DS | Fatura proporcional2999centavos paga; banco team3/active |
| Upgrade team3→team4→team5 | Faturas proporcionais1998/1999centavos pagas; limites4/5 confirmados |
| Cinco atendentes e sexto | Cinco ativos permitidos; sexto recusado pelo banco |
| Redução com cinco ativos | HTTP409 orientando desativar excedentes; sem alteração de plano |
| Redução após desativar excedentes | Plano solo confirmado; cinco registros preservados,um ativo; período pago mantido |
| Upgrade com cartão chargeCustomerFail | Solicitação pendente, solo e período anterior preservados; cancel_pending restaurou estado sem operação |
| Portal | Faturas, cartão e cancelamento disponíveis; sem troca livre de plano |
| Cancelamento pelo portal | cancel_at_period_end=true; statusactive e acesso até07/11 preservados |
| Renovação mensal paga | Após desfazer cancelamento e avançar relógio: soloactive, paid_until07/12/2026, faturaR$29,90 paga |
| Renovação recusada | Cartão de falha + avanço: past_due, paid_untilnull, can_use=false; faturaR$29,90 malsucedida |
| Encerramento programado | Avanço após cancelamento: canceled, can_use=false, operação nula, histórico preservado |

Relógio `clock_1UO1AlCHmArYgc52pEEedago` ligado ao customer já existente, avançado até janeiro2027. O relógio altera datas da Stripe, não now() do PostgreSQL; estado/acesso foram verificados via webhook e RPC. Final da fixture: canceled/solo, sem período pago/operação, cinco profissionais preservados,um ativo. Objetos permanecem para auditoria; não excluir para limpar uma retomada. O relógio possui expiração automática do próprio serviço.

Transporte inicial: evt_1UO01BCHmArYgc52DkIeITdk (fatura avulsa)HTTP200; HMAC inválidoHTTP400. Eventos da assinatura inicial incluíram evt_1UO0YVCHmArYgc52fnjbbdQ9 e evt_1UO0YWCHmArYgc52QpQ3qzMo. A homologação acima substitui a limitação do smoke inicial.

## Verificação do release

- 46 testes relevantes passaram em .local/stripe/release-checks.log. Execuções anteriores:406 testes gerais e6 testes PostgreSQL de concorrência.
- SQL protege último lugar, isolamento entre proprietários, chamadas diretas, operação persistente, deduplicação e falhas de rede.
- Frontend final: login QA, agenda, equipe, assinatura e logout; plano/cancelamento refletidos pelo banco. Produção: login, reenvio, demonstração e planos conferidos, desktop e celular sem rolagem horizontal, console sem erros novos.
- 16 arquivos públicos da produção comparados por SHA256 com o manifesto. Cabeçalhos CSP/HSTS e cache conferidos. Smoke remoto booking200/null, billing401, clara401, stripe-webhook400, conforme esperado.
- scripts/prepare-clara-billing-release.mjs mantém a agenda publicada e compartilha a instância React. Usar apenas pacotes ready-v4; v1/v2 são rascunhos superados.
- Saída visível/menu desktop fixo e reenvio de confirmação estão publicados. Nenhum teste enviou mensagem real.

## Limites da validação e próxima etapa

Checkout inicial foi executado para solo; os demais preços foram confirmados por upgrades. Concorrência, resposta perdida, repetição de eventos e expiração de operação possuem testes automatizados locais, sem repetir todos os cenários pela interface Stripe. Não afirmar que houve compra real nem que todos os cenários possíveis foram esgotados.

A conta de produção `acct_1SA92PCEaIxWT9I9` ainda depende da verificação pessoal. Após aprovação, conectar catálogo/portal/credenciais/webhook LIVE e liberar cobrança conforme STRIPE-ATIVACAO.md. A revisão automática bloqueou salvar BILLING_MODE=live antes dessa verificação; parâmetro não salvo. Usuário já foi informado.

Recuperação por e-mail foi adiada pelo titular. Avisos de vencimento via Brevo ainda não foram implementados. Mapeamento sem segredos e evidências resumidas: .local/stripe/clara-test-config.json.

Referências: [cartões de teste](https://docs.stripe.com/testing?testing-method=card-numbers), [relógios de teste](https://docs.stripe.com/billing/testing/test-clocks/simulate-subscriptions), [portal](https://docs.stripe.com/api/customer_portal/configurations/create), [webhooks](https://docs.stripe.com/api/webhook_endpoints/create).
