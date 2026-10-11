# Verificação de pagamentos — 08/10/2026

Os fluxos financeiros abaixo passaram no sandbox da Stripe, com sincronização pelo webhook e conferência no Supabase. Foi encontrado um defeito de consultas repetidas na tela de assinatura de produção. A correção local foi validada e empacotada; publicação ainda aguarda a autorização solicitada ao titular.

## Resultados desta execução

| Cenário | Evidência | Resultado |
| --- | --- | --- |
| Cartão expirado | Checkout team3, cartão fictício oficial final0069: "Seu cartão venceu. Tente usar outro." Banco continuou sem acesso pago | Passou |
| Contratação até três atendentes | Novo checkout R$59,90, cartão fictício4242, assinatura sub_1UOKZiCHmArYgc52XnFiNZ0V; banco active/team3, limite3 e acesso | Passou |
| Renovação paga | Relógio avançado para07/02/2027; paid_until prorrogado até07/03/2027 | Passou |
| Renovação recusada | Cartão fictício chargeCustomerFail + avanço até07/03; banco past_due, paid_until=null e can_use=false | Passou |
| Regularização | Fatura fictícia in_1UOKfvCHmArYgc527ZUTkuWv deR$59,90 paga com cartão de teste válido; banco voltou para active/can_use=true até07/04 | Passou |
| Cancelamento pelo portal | Portal avisou fim em07/04; cancel_at_period_end=true, acesso pago preservado | Passou |
| Encerramento efetivo | Avanço até07/04 às23:33:20UTC; banco canceled/can_use=false, operação nula e cinco profissionais preservados | Passou |
| Evento repetido/antigo | Reenvio de evt_1UO0whCHmArYgc52ZSpPd1tv entregue200; uma única cópia no banco, estado canceled e total34 eventos inalterados naquele momento | Passou |
| Expiração sem depender do webhook | Sete verificações remotas em transação revertida: trial ativo/expirado, período pago ativo/expirado, cancelamento programado, past_due e recuperação | 7/7 |
| Testes automatizados | billing-edge + billing-plans.sql:32; production + sql.local:12 | 44/44 |
| Código publicado | Billing e webhook de produção(v5) e testes(v7), incluindo core.js/plans.js, iguais ao código local testado após normalizar quebras de linha | Passou |

Relógio de testes existente: clock_1UO1AlCHmArYgc52pEEedago, agora até07/04/2027. As datas futuras acima são simuladas. O relógio Stripe não muda o relógio PostgreSQL; por isso a expiração temporal do banco também foi conferida separadamente em transação revertida. Não foram feitas compras reais nem alterados os trials de produção.

## Defeito encontrado e correção pronta

O pacote publicado chama Subscription sem a propriedade professionals. O valor padrão `[]` criava um array novo a cada renderização e reiniciava o efeito responsável por consultar a assinatura. A própria resposta provocava outra consulta, sem aguardar os15segundos previstos.

- Logs de produção nas24horas consultadas:101045 respostas200 em billing, além de2 testes401. Não houve5xx nessas rotas. Esse volume é de consultas, não de cobranças. Produção permanece com zero assinaturas pagas.
- Correção em src/Subscription.jsx: referência estável EMPTY_PROFESSIONALS para a lista padrão.
- Regressão de navegador, sem rede externa e com a mesma propriedade omitida: versão anterior29consultas de billing e29RPC em32segundos, limitada artificialmente pelo teste; versão corrigida3consultas de cada, conforme intervalo esperado. Ambas desmontadas ao fim do teste.
- Fixture: .local/billing-polling-qa.html e tests/billing-polling-ui-fixture.jsx. Comparação anterior gerada em .local/stripe/Subscription-before-polling-fix.jsx, apenas para teste local.
- Pacote pronto: .local/vercel/clara-billing-production-20261008-polling-v1. Build aprovado;14arquivos idênticos ao ready-v4, alterações apenas em HTML e dois arquivosJS. Agenda preservada pelo gerador, schedulingChanged=false. Não publicar dist.
- Autorização de publicação solicitada por pergunta assíncrona; ainda pendente ao gravar este relatório. A aba de produção foi tirada da tela de assinatura para interromper o loop nesta sessão.

## Produção e limites

- Stripe live: webhook we_1UO3GyCEaIxWT9I9OSPV4g6w ativo, endereço do Supabase de produção correto, oito eventos, API2025-08-27.basil.
- Supabase produção gtqcehwvddvqllicnreu: cobrança habilitada, duas contas, dois trials ativos até15/10/2026 às08:36 São Paulo, zero assinaturas pagas, ambas com acesso. Datas intactas após a auditoria.
- Os avisos de vencimento por e-mail via Brevo **não estão implementados**. O webhook atual sincroniza estados e acesso; não envia esses avisos.
- Uma compra real e a entrega correspondente do webhook live não foram executadas. As simulações financeiras foram feitas somente no sandbox. Não interpretar esta verificação como garantia absoluta de ausência de falhas.
- Cartões de teste usados conforme [documentação oficial da Stripe](https://docs.stripe.com/testing?testing-method=card-numbers).

Logs locais: .local/stripe/payment-audit-20261008-tests.log e .local/stripe/payment-audit-20261008-expiry.log.
