# Clara — planos por tamanho de equipe

Publicado em 07/10/2026 com autorização do usuário. **Cobranças reais continuam desativadas.** Planos, menu fixo, saída da conta e reenvio de confirmação disponíveis em https://minhaclara.com.

Atualização Stripe: sandbox conectado e fluxos de pagamento, alteração, renovação e cancelamento validados. Evidências e limites em `STRIPE-TESTES.md`. A conta real depende da verificação do titular e conexão LIVE descritas em `STRIPE-ATIVACAO.md`.

| Plano interno | Atendentes incluídos | Mensalidade total | Variável do preço Stripe |
| --- | --- | --- | --- |
| `solo` | 1, proprietário | R$ 29,90 | `STRIPE_PRICE_1_ID` |
| `team3` | até 3 | R$ 59,90 | `STRIPE_PRICE_3_ID` |
| `team4` | até 4 | R$ 79,90 | `STRIPE_PRICE_4_ID` |
| `team5` | até 5 | R$ 99,90 | `STRIPE_PRICE_5_ID` |

O proprietário ocupa uma vaga mesmo se desativar sua agenda. Os demais profissionais contam quando ativos. Os quatro valores são totais por estabelecimento, não multiplicadores por pessoa. Dois e três atendentes custam o mesmo. Não há sexto atendente ativo. Registros desativados e seus históricos permanecem no banco; os profissionais continuam sendo agendas administradas pelo proprietário, não novas contas de login.

## Comportamento

- Com a cobrança desativada, acesso preservado e teto de cinco. A migração não ativa cobrança nem inicia o teste.
- Depois da ativação autorizada: sete dias sem cartão, com até cinco. Ao acabar, contratar um plano que comporte a equipe ou desativar os excedentes antes de escolher um menor.
- Adicionar, desativar e reativar profissionais nunca cria uma cobrança automaticamente. Para ampliar a capacidade paga, escolher um plano em **Minha assinatura** e confirmar o preço.
- Aumento: Stripe calcula a diferença proporcional ao restante do período, cobra imediatamente e mantém a data de renovação. `pending_if_incomplete` mantém o plano anterior até o pagamento da diferença. Autenticação adicional ou cartão recusado podem ser resolvidos pela fatura hospedada na Stripe. A confirmação local informa o novo total mensal e a regra proporcional; o valor exato da diferença é calculado pela Stripe.
- Redução: exige equipe compatível; limite menor após confirmação, menor mensalidade na próxima renovação, sem crédito/estorno do período atual. A vaga excedente fica bloqueada durante a solicitação, inclusive em outras abas.
- Cancelamento da assinatura: portal configurado somente para o final do período pago. Portal permite consultar faturas e atualizar pagamento, sem alterar preços/quantidades livremente.
- Solicitação interrompida: a tela permite continuar ou cancelar. Uma contratação ainda aberta é expirada antes de trocar de plano. Uma atualização pendente é cancelada anulando exclusivamente sua fatura de alteração, quando ainda aberta. Isso não cancela a assinatura anterior.
- Retorno da página Stripe não concede acesso. Webhook assinado consulta o estado atual e grava plano e período confirmado. Pagamento de atualização recusado não estende nem retira o período anteriormente pago no mesmo plano.
- Se uma alteração feita fora do app deixar a equipe acima do plano, gravações/novas reservas ficam indisponíveis até reduzir a equipe ou regularizar o plano. Consulta e desativação continuam disponíveis. Não há exclusão automática de dados.

## Arquivos e garantias locais

- `supabase/functions/_shared/plans.js`: catálogo compartilhado de limites e valores; nenhum segredo no frontend.
- `src/Subscription.jsx`, `src/billing.js`, `src/billing-plans.css`: seleção, confirmação, reconsulta, retomada e cancelamento de solicitação.
- `src/Team.jsx`: contagem, orientação e bloqueio visual de inclusão/reativação.
- `supabase/billing_plans.sql`: migração incremental após `billing.sql`; independente de `scheduling_integrity.sql`. As tabelas financeiras ficam privadas, RPCs de operação/eventos são exclusivas do serviço. O trigger também protege chamadas diretas ao banco, não só a interface.
- `billing/index.ts`: quatro preços fixos de servidor, um item com quantidade 1, validação de moeda/valor/periodicidade/ambiente, portal restrito e operação persistente por proprietário. A mesma operação mantém a chave de idempotência e data proporcional após falhas de rede.
- `stripe-webhook/index.ts`: mapeia os quatro preços, recusa itens/quantidades desconhecidos, eventos assinados e estado atual, com deduplicação e lease de sincronização. O RPC antigo de evento de plano único perde permissão de serviço após a migração.
- A migração recusa equipes preexistentes com mais de cinco sem desativar ninguém. Avaliar esses dados antes da publicação.

## Validação concluída

- `npm test`: **406 testes aprovados**. Log `.local/billing-full-tests.log`.
- `npm run test:billing:concurrency`: **6 testes aprovados**, PostgreSQL nativo local, conexões independentes. Log `.local/billing-concurrency.log`.
- `npm run build`: concluído; avisos preexistentes de `use client` no lucide. Log `.local/billing-build.log`.
- Cobertura nova: quatro valores, máximo e proprietário inativo, ativação/desativação, isolamento entre donos, permissões, validade do período pago, upgrade recusado, respostas perdidas, checkout retomado, redução incompatível, portal indevido, diferenças de ambiente, repetição de eventos e compatibilidade com/sem a migração de agendamento local.
- Concorrência real: oito inclusões pela última vaga; oito pedidos pela trava de cobrança; redução competindo com nova inclusão; snapshot antigo em REPEATABLE READ aborta.
- Navegador: desktop, 390 e 320 px; quatro valores, confirmação do aumento, plano menor incompatível desabilitado, sexto atendente bloqueado, assinatura após fim do teste, falha simulada preservando plano anterior. Sem rolagem horizontal e sem erros de console nos cenários conferidos.
- Fixture local sem rede externa: `http://127.0.0.1:3000/.local/production-qa.html?mode=billing-active#/app/assinatura`. Modos `billing-three`, `billing-limit`, `billing-expired`, `billing-disabled`, `billing-failure`. Trocas de plano ali são simulações e não movimentam dinheiro.

**Sandbox Stripe validado em 07/10/2026:** contratação solo com recusa/3DS, upgrades para3/4/5, downgrade, máximo cinco, recusa de upgrade, cancelamento pelo portal, renovação paga/recusada e encerramento. Conferidos pelo webhook e banco. Também passaram46 testes automatizados de release. Detalhes e limites em STRIPE-TESTES.md; não houve cobrança real.

## Referência da configuração (testes concluídos; produção conforme STRIPE-ATIVACAO.md)

1. Criar/acessar a conta Stripe pelo titular. Não pedir chave secreta, CPF ou dados bancários no chat. Usar sandbox e um Supabase de homologação separado; não misturar clientes Stripe de teste e produção na mesma base.
2. Criar quatro preços recorrentes mensais, BRL, `unit_amount` 2990/5990/7990/9990, `billing_scheme=per_unit` e quantidade fixa 1 por assinatura (não multiplicar pela quantidade de atendentes), sem período grátis na Stripe. O app controla os sete dias. O identificador antigo `STRIPE_PRICE_ID` é aceito apenas como fallback para `solo`; os demais são obrigatórios. Manter os IDs estáveis quando houver assinaturas/solicitações abertas.
3. Configurar portal, guardar `STRIPE_PORTAL_CONFIGURATION_ID` (`bpc_…`). Habilitar faturas, atualização de pagamento e cancelamento ao fim do período; manter **subscription_update desativado**. A função consulta essa configuração antes de abrir o portal.
4. Configurar no backend `BILLING_MODE=test`, `STRIPE_SECRET_KEY=sk_test_…`, os quatro IDs, `STRIPE_WEBHOOK_SECRET`, `APP_ORIGIN` HTTPS exata e `APP_PUBLISHABLE_KEY`. Segredos nunca em variáveis `VITE_`. As variáveis do Supabase são fornecidas pelo ambiente.
5. Migração e novas funções devem ser publicadas juntas numa janela controlada e autorizada: `billing_plans.sql` uma vez após `billing.sql`, depois `billing` e `stripe-webhook` com seu módulo `_shared/plans.js`. Não reaplicar migrações já aplicadas. A migração sozinha torna o endpoint antigo incompatível com novas contratações; cobrança deve estar desativada durante a transição.
6. Endpoint de webhook com API **2025-04-30.basil**: `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.pending_update_applied`, `customer.subscription.pending_update_expired`, `invoice.paid`, `invoice.payment_failed`, `invoice.voided`.
7. Homologar contratação de cada plano, cartão recusado, autenticação adicional, upgrade pago e recusado, expiração/cancelamento de atualização, downgrade, renovação e recusa, cancelamento, retorno com webhook atrasado, duas abas, resposta perdida e repetição de evento. Validar particularmente a fatura hospedada para concluir autenticação adicional na versão fixada da API. Conferir os valores efetivos na Stripe.
8. Só com homologação concluída e nova aprovação configurar IDs/chaves de produção, `BILLING_MODE=live`, endpoint/segredo de produção e ativar cobrança. Taxas do provedor não foram descontadas dos preços e a margem ainda precisa ser calculada.

**Publicação concluída com cobrança desativada:** migração20261007200853_clara_billing_plans_inactive, billing/stripe-webhook v2 e pacote isolado clara-billing-production-20261007-ready-v4. O build completo dist continua fora do escopo, pois inclui outra alteração de agenda. Cobrança LIVE depende dos passos restantes em STRIPE-ATIVACAO.md.

Referências consultadas: [alterações pendentes](https://docs.stripe.com/billing/subscriptions/pending-updates), [atualização de assinatura](https://docs.stripe.com/api/subscriptions/update), [portal do cliente](https://docs.stripe.com/customer-management/portal-deep-links).
