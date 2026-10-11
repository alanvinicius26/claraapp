# Clara — ativação de pagamentos reais

Estado em 08/10/2026: PRODUÇÃO LIBERADA. Conta Stripe habilitada para pagamentos e repasses; catálogo, portal, webhook e segredos LIVE salvos e conferidos. activate_billing executada às11:36:05UTC: enabled=true, duas contas com acesso, dois trials até15/10/2026 às08:36 São Paulo, zero assinaturas pagas. Novos espaços recebem sete dias a partir da criação. Tela autenticada da conta do titular confirmou o teste ativo e a configuração live. IDs em .local/stripe/clara-live-config.json. Não duplicar recursos nem repetir a ativação.

Conferência final: quatro preços lidos pela API2025-04-30.basil, ativos/live, BRL mensal, per_unit/licensed, valores2990/5990/7990/9990, sem trial da Stripe. Segredos persistidos reconferidos por nomes/digests. Site200, billing sem login401, webhook sem assinatura400. Nenhum pagamento live executado; contratação/renovação/cancelamento foram homologados em sandbox conforme STRIPE-TESTES.md. A entrega financeira real de um webhook só poderá ser confirmada após uma transação real. Não houve novo deploy nem mudanças de código nesta liberação.

Webhook salvo com API 2025-08-27.basil (Basil disponível no painel); backend consulta assinatura em 2025-04-30.basil. Compatibilidade mensal confirmada na documentação oficial https://docs.stripe.com/api/versioning e no código, que usa do evento apenas identificadores e metadados básicos antes de recuperar o estado atual da assinatura. Segredos já persistidos no Supabase de produção; não revelá-los novamente. Os passos abaixo são o roteiro original e devem ser confrontados com este estado atual.

## Contas e destinos

| Ambiente | Stripe | Supabase | Site |
| --- | --- | --- | --- |
| Produção | `acct_1SA92PCEaIxWT9I9` — Minhaclara | `gtqcehwvddvqllicnreu` | https://minhaclara.com |
| Testes | `acct_1SA92fCHmArYgc52` | `myqfoqfnjtdzouupoaiq` | https://encaixa-m92qs2gal-bertunesinc-3931.vercel.app |

A conta principal também possui seu próprio modo de teste. Ele NÃO é o sandbox configurado. Não copiar IDs, chaves ou clientes de testes para produção.

## Verificação do titular concluída

Titular concluiu a ativação e a verificação por e-mail. Stripe retornou charges_enabled=true, payouts_enabled=true e details_submitted=true. Não foi necessário enviar documentos ou segredos pelo chat.

Se quiser conferir uma compra real, o titular deve realizá-la pessoalmente. Nenhuma compra live foi feita pelo agente.

## Roteiro técnico original (etapas já concluídas; não repetir)

1. Confirmar conta e ambiente LIVE. Consultar antes de criar para não duplicar produtos, preços, portal ou webhook. Usar as lookup keys abaixo como identificadores estáveis no ambiente live.
2. Criar/conferir os quatro preços: BRL mensal, quantidade 1, `billing_scheme=per_unit`, uso `licensed`, intervalo 1 mês, sem trial da Stripe, sem faixas nem medidor.

| Plano | Centavos | Lookup key | Variável |
| --- | --- | --- | --- |
| solo | 2990 | `clara_solo_monthly_brl_v1` | `STRIPE_PRICE_1_ID` |
| team3 | 5990 | `clara_team3_monthly_brl_v1` | `STRIPE_PRICE_3_ID` |
| team4 | 7990 | `clara_team4_monthly_brl_v1` | `STRIPE_PRICE_4_ID` |
| team5 | 9990 | `clara_team5_monthly_brl_v1` | `STRIPE_PRICE_5_ID` |

3. Portal: faturas e atualização de pagamento habilitadas; cancelamento `at_period_end`, sem rateio; `subscription_update`, pausa e atualização de dados desabilitados. Guardar `STRIPE_PORTAL_CONFIGURATION_ID`; o app fornece a URL de retorno.
4. Webhook live: `https://gtqcehwvddvqllicnreu.supabase.co/functions/v1/stripe-webhook`, API `2025-04-30.basil`, eventos `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.pending_update_applied`, `customer.subscription.pending_update_expired`, `invoice.paid`, `invoice.payment_failed`, `invoice.voided`.
5. Guardar no backend de PRODUÇÃO: `STRIPE_SECRET_KEY` live e `STRIPE_WEBHOOK_SECRET` do endpoint live, quatro preços, portal, `BILLING_MODE=live`, `APP_ORIGIN=https://minhaclara.com`. `APP_PUBLISHABLE_KEY` já existe no projeto; é a chave pública Supabase, não uma chave Stripe. Nunca colocar segredos em `VITE_`, arquivos ou mensagens. Transferência live especificamente autorizada pelo titular e concluída.
6. Conferir backend autenticado: `configured=true`, `mode=live`, `plans_version=2`. Conferir valores/ambiente do catálogo, portal e endpoint. Não disparar cobrança real de QA automaticamente.
7. Só então, com a liberação de cobrança autorizada, executar uma vez `select encaixa_private.activate_billing();`. Isso inicia sete dias para os estúdios existentes que ainda não têm trial; novos estúdios recebem sete dias no cadastro. Publicar código ou definir modo NÃO inicia o trial.
8. Conferir `billing_settings.enabled=true`, trial futuro, cadastro/login, escolha de plano e retorno. Pagamento e acesso definitivos são confirmados pelo webhook; não considerar apenas o redirect como prova. Uma compra real de conferência precisa ser realizada pelo titular, se desejada.

## Preparação já concluída

- Migração de produção `20261007200853_clara_billing_plans_inactive`, funções billing e stripe-webhook v2.
- Vercel produção `dpl_8jHyugtnKRmsVeYDvxkQstrAc2XQ`, READY, aliases minhaclara.com/www/encaixa-eta.
- Pacote `.local/vercel/clara-billing-production-20261007-ready-v4`; manifesto verificado contra todos os 16 arquivos públicos remotos. Não usar `dist`: fonte completa contém outra alteração de agenda ainda não autorizada/publicada.
- Contratação solo, recusa, autenticação 3DS, upgrades 3/4/5, downgrade, máximo cinco, cancelamento, renovação paga e recusada e encerramento confirmados em sandbox. Relatório em STRIPE-TESTES.md.
- Produção final: 2 usuários, 2 estúdios, 0 assinaturas pagas, 2 trials iniciados, acesso dos dois proprietários preservado, `billing_enabled=true`.
- A revisão automática rejeitou a tentativa anterior à verificação pessoal. Após a ativação pelo titular e a autorização específica live, os parâmetros foram salvos normalmente. O bloqueio foi resolvido com a conclusão dos requisitos, sem contorno.

## Recuperação e limites

Backups das funções anteriores e lista de migrações: `.local/releases/before-billing-plans-20261007`. Durante um problema de configuração, manter cobrança desligada; não reimplantar função v1 contra o banco de planos v2. Não apagar assinaturas, clientes ou histórico para tentar corrigir uma configuração.

Os testes não movimentaram dinheiro nem enviaram e-mail real. Recuperação de senha por e-mail será testada pelo titular quando desejar, conforme decisão anterior. Avisos de vencimento via Brevo não fazem parte desta integração: o webhook atual sincroniza a assinatura, sem enviar esses avisos.
