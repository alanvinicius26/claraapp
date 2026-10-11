# Administração da Clara — implementação de 08/10/2026

**Publicado em produção em 08/10/2026, após autorização explícita do titular.** Painel: https://minhaclara.com/#/admin. A única conta administrativa de produção é `alan.vinicius3143@gmail.com`, vinculada pelo UUID confirmado `f05055a6-85f0-4e55-9020-8a1bac13737c`. O acesso administrativo não alterou seu teste gratuito ou sua assinatura.

## Funcionalidades

- Rota `#/admin`, acessível após login, inclusive para administrador sem estúdio. O menu Administração aparece somente quando o servidor confirma a permissão.
- Permissão vinculada ao UUID da conta em tabela privada. Sem concessão por e-mail no navegador, metadados editáveis ou segredo no frontend. Toda consulta e alteração administrativa valida a permissão no servidor.
- Busca paginada de contas por e-mail/nome do estúdio, situação do acesso, tamanho da equipe, benefício e histórico administrativo.
- Cortesia com ou sem vencimento e período gratuito com data obrigatória; escolha de plano, motivo interno, extensão/alteração e encerramento. Alterações concorrentes são rejeitadas por versão do benefício.
- Benefício separado dos campos financeiros controlados pela Stripe. Validade consultada pelo relógio do banco, sem depender de tarefas agendadas. Respeita o limite de atendentes do plano concedido.
- Encerrar/expirar benefício preserva dados. Outros períodos legítimos de teste ou pagamento continuam valendo. Sem acesso válido, permanecem as possibilidades de consulta e regularização já previstas no produto.
- Contas com assinatura ainda em andamento (inclusive inadimplente ou cancelamento futuro) não recebem cortesia. Contas que já têm cliente Stripe passam por conferência de assinaturas e checkouts abertos no provedor, sob trava que impede nova contratação simultânea. Não há cancelamento automático de assinatura por este painel.
- Cupons de 1–100% ou R$ 0,01–99,90; primeira cobrança, 1–36 meses ou enquanto durar a assinatura. Prazo de resgate e limite total de usos opcionais. Restritos aos produtos dos quatro preços da Clara.
- Código digitado no Checkout Stripe ao contratar. A assinatura mostra o preço-base e orienta conferir o desconto e o valor final no pagamento. Não há aplicação retroativa de cupom a assinaturas existentes pelo painel.
- Consulta de usos na Stripe, retomada de criação interrompida e desativação para novos resgates. Desativar não remove descontos de assinaturas que já resgataram o cupom.
- Auditoria de concessão, alteração, revogação e criação/ativação/desativação de cupons. Motivos internos não são expostos à pessoa beneficiada.

## Arquivos principais

- `supabase/platform_admin.sql`: migração incremental após `billing_plans.sql`, sem concessões automáticas de administrador.
- `supabase/platform_admin_bootstrap.sql`: concessão inicial, somente por conexão administrativa ao banco e e-mail confirmado informado pelo titular. Recusa conceder a outra pessoa se já houver um administrador diferente.
- `supabase/functions/billing/admin.js`: validação de cupons, recuperação idempotente, conferência de assinaturas antes da gratuidade.
- `supabase/functions/billing/index.ts`: ações autenticadas e entrada de códigos no Checkout.
- `src/Admin.jsx`, `src/admin.css`, `src/main.jsx`: painel, formulário de revisão e menu restrito.
- `src/Subscription.jsx`: apresentação da cortesia e orientação de cupons.

## Validação local

- `npm test`: **426 testes passaram**, incluindo novos cenários SQL e Edge. Log `.local/admin-full-tests.log`.
- `npm run test:billing:concurrency`: **8 testes passaram** em PostgreSQL nativo local com conexões independentes; inclui cortesia versus checkout e conferência do provedor versus checkout. Log `.local/admin-concurrency.log`. Precisou executar fora do sandbox, pois o Windows impediu a inicialização do PostgreSQL no ambiente restrito.
- `npm run build`: aprovado. Avisos preexistentes de `use client` do lucide.
- Navegador, sem dados reais: concessão e confirmação de cortesia, criação de cupom de 50% por três meses, consulta de usos, desativação e acesso negado. Conta cortesia mostra R$ 0,00 e não apresenta contratação. Conferido em larguras de 390 e 320 px, sem rolagem horizontal nos cenários inspecionados.
- Pacote isolado abre login e demonstração da agenda sem erros de console. Módulos de agendamento preservados pela verificação de reversão das mudanças do gerador.
- Prévia fictícia: `http://127.0.0.1:3000/.local/admin-qa.html`; variantes `?mode=denied` e `?mode=benefit`. Não faz chamadas reais à Stripe ou ao Supabase.

Além dos testes locais com transporte simulado, a homologação no sandbox real da Stripe foi concluída: desconto de 50% por três meses, desconto de R$ 5 na primeira cobrança, cupom expirado rejeitado, retomada idempotente sem duplicar o código, desativação e cupom de 100% com resgate efetivo. A cobrança fictícia de R$ 0 foi confirmada e liberou o plano via webhook; o limite de um resgate impediu novos usos. A duração de três meses foi conferida no Checkout; não houve avanço do relógio para testar renovação deste cupom nesta publicação.

Cortesias permanentes e temporárias, alteração e revogação, bloqueio de checkout durante gratuidade e recusa de cortesia com assinatura ativa passaram no ambiente de testes. Ao concluir, todos os cupons de QA foram desativados, nenhum benefício permaneceu concedido, o cancelamento da assinatura fictícia foi agendado para o fim do período e a permissão administrativa temporária foi removida. Nova chamada real confirmou acesso administrativo negado com HTTP 403. Nenhuma compra real foi iniciada.

## Pacote e publicação concluída

Gerador: `node scripts/prepare-admin-release.mjs [identificador-novo]`.

Pacote preparado: `.local/vercel/clara-admin-20261008-admin-v1`.
Manifesto: `.local/vercel/clara-admin-20261008-admin-v1.manifest.json`.

O pacote usa como base `.local/vercel/clara-billing-production-20261008-polling-v1`. Altera somente a rota/menu administrativos e a assinatura, adicionando os novos assets; preserva a implementação publicada de agenda. Não publicar o `dist` genérico, que também contém alterações locais anteriores de agendamento. Conferir o deploy corrente antes de promover o pacote, para não substituir mudanças publicadas depois da base escolhida.

Publicação realizada:

1. Migração `clara_platform_admin_access_and_coupons` aplicada em **Clara — testes** (`myqfoqfnjtdzouupoaiq`) e, após homologação, em produção (`gtqcehwvddvqllicnreu`).
2. Função `billing` publicada como versão 8 em testes e versão 6 em produção, com o mesmo conteúdo. Preservada a autenticação JWT manual (`verify_jwt=false`); os endpoints verificam a identidade no Auth antes das ações. Segredos e preços não foram alterados.
3. Bootstrap executado somente para a conta confirmada indicada pelo titular. Verificados o administrador único, o bloqueio de escrita direta nas tabelas privadas e o acesso negado por RPC a um usuário sem permissão.
4. Vercel `dpl_Biwce84P5zdfjUgGZ1uJopd4uwhd` em estado READY, publicado em `minhaclara.com`. Os 19 arquivos públicos conferem com o manifesto por SHA-256. Evidência: `.local/admin-production-verification.json`.
5. Painel real aberto com sucesso na sessão do titular em `https://minhaclara.com/#/admin`, sem erros de console. Chamadas sem autenticação à Edge e à RPC administrativa retornaram HTTP 401.

A base efetivamente publicada antes desta alteração era `clara-billing-production-20261007-ready-v4`. Foi comparada com a base do pacote: o corpo do módulo principal é idêntico, exceto pelas declarações de importação que selecionam a versão de assinatura; o agendamento foi preservado. Evidência: `.local/admin-production-baseline.json`.

A migração é compatível com contas sem benefício e não ativa cobrança, não inicia testes, não altera planos pagos e não cadastra administrador por conta própria. Em rollback do frontend, preservar as tabelas de benefício/auditoria: apagar a migração retiraria acessos já concedidos. A função anterior continua bloqueada pela regra de gratuidade no banco.

Referências da API fixada: [cupons Stripe](https://docs.stripe.com/api/coupons/create?api-version=2025-04-30.basil), [códigos promocionais](https://docs.stripe.com/api/promotion_codes/create?api-version=2025-04-30.basil).

