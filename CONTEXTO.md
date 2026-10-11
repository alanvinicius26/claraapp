# Minha Clara — leia primeiro ao retomar

## Git + encaixes — 11/10/2026, LOCAL, nada publicado
- Repositório Git criado (branch main, LF fixo via .gitattributes/core.autocrlf=false, .local/dist/.env ignorados; nenhum segredo encontrado nos arquivos versionados). Commits usam a identidade global do Git (Alan Vinicius). Sem remoto configurado.
- scheduling_integrity.sql verificada na ordem REAL de produção (após billing_plans e platform_admin): testes PGlite e 9 testes PostgreSQL nativo concorrentes passaram. Continua NÃO aplicada no Supabase; leitura remota não refeita nesta sessão.
- Encaixes implementados localmente: supabase/parallel_bookings.sql (aplicar depois da scheduling_integrity), Serviços (chave + limite 2–10), Equipe (Faz encaixes + liberar online), painel/Clara/página pública respeitam a regra. Detalhes, decisões e roteiro em ENCAIXES.md. 436 testes + 12 concorrentes passaram; build aprovado.
- Publicação exige aprovação explícita (regra abaixo). Pacote de release ainda não preparado.

## Auditoria de pagamentos — 08/10/2026, correção LOCAL aguardando publicação
- Pedido atual: verificar pagamentos, expiração e demais fluxos. Resultado detalhado em VERIFICACAO-PAGAMENTOS-20261008.md. 44 testes automatizados passaram,7 verificações remotas de expiração em transação revertida; código de billing/webhook produção(v5) e sandbox(v7) iguais ao local. Nenhuma alteração de backend ou dados reais.
- Novo teste Stripe real sandbox: cartão vencido recusado; checkout team3 R$59,90 pago, renovação paga, renovação recusada/past_due bloqueou, fatura regularizada restaurou acesso, portal cancelou ao fim do período e avanço encerrou/bloqueou. Nova assinatura sub_1UOKZiCHmArYgc52XnFiNZ0V, fatura recuperada in_1UOKfvCHmArYgc527ZUTkuWv. Relógio existente clock_1UO1AlCHmArYgc52pEEedago agora07/04/2027 23:33:20UTC. Fixture final canceled/team3/can_use=false,paid_until07/04/2027 21:33:20UTC,45eventos processados,5profissionais preservados. Não apagar objetos de QA.
- Encontrado BUG no frontend publicado: Subscription usa professionals=[] e wrapper do pacote baseline não fornece essa prop. Array novo reinicia useEffect a cada resposta, gerando loop de consultas. Logs produção101045 chamadas200/24h, zero assinaturas pagas. Aba do titular navegada para agenda para interromper nesta sessão.
- Correção LOCAL em src/Subscription.jsx com EMPTY_PROFESSIONALS estável. Teste antes/depois sem rede:29consultas(cortadas pelo limite da fixture) vs3 em32segundos. Pacote .local/vercel/clara-billing-production-20261008-polling-v1 pronto/build aprovado,14arquivos inalterados e somenteHTML/2JS alterados, agenda preservada. Não publicar dist. Nenhum deploy novo efetuado até aqui.
- Pergunta assíncrona pendente: "Posso publicar agora a correção já testada da tela Minha assinatura, para eliminar as consultas repetidas?" Skill deployments-cicd diz que pedido de inspeção não autoriza release; regra explicada e linkada. Se usuário autorizar, usar scripts/deploy-vercel.ps1 com esse pacote, conferir manifestos via scripts/verify-release.mjs, depois conferir contagem de chamadas em produção. Não repetir a mesma aprovação após resposta positiva.
- Produção após auditoria: enabled=true,2trials originais intactos até15/10/2026 08:36SP,0assinaturas,acesso dos2preservado. Brevo vencimento ainda não implementado. Nenhuma compra real executada.

## PRODUÇÃO LIBERADA — 08/10/2026, 11:36 UTC (estado atual)
- Integração live e liberação concluídas dentro da autorização explícita já recebida. activate_billing executada uma vez: enabled=true, 2 contas com acesso preservado, 2 trials até 2026-10-15T11:36:05.418762Z (15/10 às 08:36 São Paulo), 0 assinaturas pagas. Novos espaços recebem sete dias pelo trigger existente. Não executar novamente nem estender os trials sem solicitação.
- Usuário entrou pessoalmente na Clara. Tela Minha assinatura autenticada confirmou quatro preços, limite 5 durante trial e "Seu teste grátis está ativo" com data15/10/2026 08:36. Ausentes aviso de configuração incompleta e banner de teste; frontend confirmou configuração live. Não alterar a data para forçar compra em produção.
- Stripe Shell leu os quatro preços usando --stripe-version=2025-04-30.basil: todos active=true/livemode=true, BRL, month/interval_count1, per_unit/licensed, sem trial Stripe, valores2990/5990/7990/9990 e lookup keys corretas. Segredos e parâmetros persistidos reconferidos no painel Supabase por nomes/digests, sem revelar seus valores.
- Smoke pós-ativação: site200, billing sem autenticação401, webhook sem assinatura400. Nenhuma alteração de fonte/build/deploy nesta retomada; pacote publicado ready-v4 permanece. Os testes financeiros completos são os de sandbox já documentados. Nenhuma compra ou entrega financeira real validada, porque não houve transação live.
- Configuração pública em .local/stripe/clara-live-config.json; detalhes STRIPE-ATIVACAO.md. Cobrança começa somente com contratação expressa após os sete dias; nenhuma cobrança automática pelo simples cadastro. Avisos Brevo de vencimento continuam fora desta entrega.

## Conexão LIVE salva — retomada 08/10/2026 (prevalece sobre o histórico)
- Usuário autorizou explicitamente chave live, webhook, armazenamento dos dois segredos no Supabase de produção e liberação com sete dias grátis. Não pedir a mesma aprovação novamente.
- Stripe acct_1SA92PCEaIxWT9I9: charges_enabled=true, payouts_enabled=true, details_submitted=true consultados pelo Stripe Shell em 07/10. Quatro preços LIVE criados, IDs em .local/stripe/clara-live-config.json. Portal bpc_1UO3AGCEaIxWT9I9vXdB5GI8 ativo/live/padrão: faturas, cartão e cancelamento ao fim do período; sem troca livre de plano, pausa ou alteração de dados.
- Webhook we_1UO3GyCEaIxWT9I9OSPV4g6w ATIVO, endpoint de produção gtqcehwvddvqllicnreu/functions/v1/stripe-webhook, oito eventos do roteiro. API do endpoint 2025-08-27.basil, única Basil oferecida pelo painel. Revisão inicial bloqueou diferença; consulta à documentação oficial https://docs.stripe.com/api/versioning confirmou compatibilidade entre versões mensais Basil e inspeção do código confirmou ausência de exigência exata no evento. Nova tentativa aprovada; backend continua consultando assinatura em 2025-04-30.basil. Não criar outro webhook.
- Verificação por Gmail concluída em 07/10. STRIPE_SECRET_KEY e STRIPE_WEBHOOK_SECRET guardados no Supabase de PRODUÇÃO via painéis, sem valores em arquivos/chat. Linhas/digests e horário de salvamento confirmados. Também salvos BILLING_MODE=live, APP_ORIGIN=https://minhaclara.com, quatro STRIPE_PRICE_*_ID e STRIPE_PORTAL_CONFIGURATION_ID. Não revelar novamente as chaves.
- Interrupção anterior por limite de uso da revisão automática. Retomada autorizada em 08/10; navegador voltou a funcionar. Consulta SQL nesta retomada: enabled=false, 2 contas, 0 assinaturas, 0 trials. Ainda falta validação final e activate_billing; não considerar pagamento liberado.
- Aba da Clara aberta em /#/app/assinatura, sessão deslogada. Solicitado ao usuário entrar diretamente no site para conferir configuração autenticada. Continuar verificações independentes enquanto aguarda. Nenhuma cobrança real executada.

## Titular informou ativação Stripe — 07/10/2026, retomada
- Usuário informou que ativou por outro navegador e enviou captura do painel em produção. Acesso pelo navegador do Codex continua autenticado; não pedir novo login.
- Confirmado pelo WebMCP get_dashboard_context: account_id acct_1SA92PCEaIxWT9I9, livemode=true, URL /acct_1SA92PCEaIxWT9I9/dashboard. Agora há chave publicável pk_live na tela, sem redirecionamento ao teste. Isso confirma modo de produção; flags charges_enabled/payouts_enabled ainda não consultadas.
- Modal de cópia inicial dispensado com Não copiar nada; nenhum produto/chave/dado copiado. Não foi revelada nem transmitida chave secreta. Conexão LIVE e liberação de cobrança no app continuam pendentes. A autorização específica anterior para segredos era apenas para testes; pedir autorização específica para produção, explicando o destino Supabase de produção.
- Aba Stripe marcada para retomada; consultar inventário ao retornar. Nenhuma configuração live salva nesta retomada.

## Publicado com cobrança desligada — 07/10/2026, estado atual
- Usuário autorizou publicar HOJE e depois pediu deixar tudo preparado, pois verificará documentos Stripe somente à noite. Site/backend publicados com cobrança DESATIVADA. Não ativar antecipadamente. Esta seção substitui pendências históricas abaixo sobre planos, logout, menu fixo e reenvio.
- Produção https://minhaclara.com: Vercel dpl_8jHyugtnKRmsVeYDvxkQstrAc2XQ, READY, aliases minhaclara.com/www/encaixa-eta. Pacote .local/vercel/clara-billing-production-20261007-ready-v4; manifesto16 arquivos públicos verificado SHA256 contra remoto. JS clara-base-20261007-ready-v4.js; features clara-features-DQmagRG0.js; CSS baseline index-clara-0a6f6d530535f189.css e style-BBn6Y_Rq.css.
- Supabase produção gtqcehwvddvqllicnreu: migração20261007200853_clara_billing_plans_inactive; billing v2 e stripe-webhook v2 ACTIVE. Autenticação própria/HMAC mantidas, verify_jwt=false intencional. Backups .local/releases/before-billing-plans-20261007. Booking/clara e agendamento não alterados. Última consulta:2usuários,2estúdios,0assinaturas,0trials iniciados,billing.enabled=false,acesso dos proprietários=true.
- Gerador scripts/prepare-clara-billing-release.mjs usa baseline publicado, substitui SOMENTE Auth/Team/Subscription e inclui sidebar/logout já preparados; reverter as três substituições reproduz JS base byte a byte. Recursos/OwnerSlots da agenda não entram. React é compartilhado via bridge (plugin enforce:pre). Pacotes ready-v1/v2 têm falhas e NÃO podem ser publicados. Não usar dist ou a prévia antiga co722pqv5, que contém agenda pendente.
- Homologação final https://encaixa-m92qs2gal-bertunesinc-3931.vercel.app, deployment dpl_85c2wG3ccvKCfSUFU84TCF4s4Bqn READY/preview/sem aliases, pacote clara-billing-test-20261007-ready-v4; APP_ORIGIN teste atualizado e confirmado pelo retorno do portal. Login, agenda, equipe e assinatura testados. Teste grátis expirado de propósito para QA.
- Sandbox acct_1SA92fCHmArYgc52, Supabase myqfoqfnjtdzouupoaiq, billing.enabled=true somente em testes. Fixture clara-billing-qa@example.invalid, owner1a7e9a92-da69-4a9d-a77c-627c645c6310, studio46e21497-eaa1-44fc-a9c4-28ccdff9de97; customer cus_VOo7a4Rbfbz5op, assinatura sub_1UO0YSCHmArYgc52CQbJx1dG. Segredos continuam só no Supabase. Dados fictícios permanecem para auditoria.
- QA real sandbox: contratação solo recusada e3DS paga; upgrades3/4/5 pagos; upgrade pendente/recusado preserva plano/acesso; cancel_pending; sexto rejeitado; downgrade409 com cinco ativos, aprovado após desativar excedentes; cancelamento no portal preservou período; relógio clock_1UO1AlCHmArYgc52pEEedago validou renovação paga até07/12, renovação recusada past_due/can_use=false e cancelamento concluído canceled/can_use=false. Cinco profissionais preservados,um ativo. 46 testes locais de release passaram; históricos406+6concorrência. UI publicada desktop/celular sem overflow horizontal; console produção limpo; logout e reenvio acessíveis. Smoke booking200/null,billing401,clara401,webhook400.
- Stripe produção acct_1SA92PCEaIxWT9I9, Minhaclara; /apikeys ainda redireciona para /test/apikeys. Documentos não enviados pelo agente. Após aprovação ainda conectar catálogo/portal/credenciais/webhook LIVE e liberar cobrança; explicado ao usuário. Roteiro STRIPE-ATIVACAO.md. Não prometer ativação automática só com documentos.
- Revisão automática rejeitou salvar BILLING_MODE=live em produção por possível cobrança antes da verificação pessoal. Não contornar. Formulário descartado; confirmou apenas APP_PUBLISHABLE_KEY/GROQ_API_KEY existentes. APP_ORIGIN e BILLING_MODE de produção NÃO salvos. Manter pendente para depois da verificação. O banco de produção permanece desligado.
- E-mails: confirmação funcionou segundo usuário; recuperação adiada pelo próprio; reenvio agora publicado. Avisos de vencimento Brevo ainda não implementados. Nenhum e-mail real ou dinheiro movimentado nos testes.
- Próxima retomada: ler STRIPE-ATIVACAO.md, confirmar verificação/live e completar conexão. Não refazer migração/testes nem criar novo Supabase ou catálogo de teste. Autorização anterior de transferência de segredos era específica ao projeto testes; observar aprovação exigida para transferência live.

- Ajuste final v4: mensagem de cancelamento pendente só aparece enquanto há acesso pago; assinatura encerrada informa encerramento e não exibe data de trial antigo como período pago. Conferido na fixture real canceled. Versão v3 substituída pela v4, sem nova alteração no backend.

## Histórico anterior (estados da época; prevalece a seção atual)

## Stripe conectada ao Clara — testes — 07/10/2026
- Autorização explícita recebida: “Autorizo usar a chave de teste da Stripe, criar o webhook e guardar os dois segredos no projeto Clara — testes.” Ação concluída; não pedir de novo. STRIPE_SECRET_KEY e STRIPE_WEBHOOK_SECRET salvos no projeto myqfoqfnjtdzouupoaiq por transferência entre painéis, sem valores em chat/logs/arquivos. Persistência confirmada após recarregar.
- Webhook we_1UNzz1CHmArYgc525OLglL3h criado na conta TESTE acct_1SA92fCHmArYgc52, enabled, livemode=false, API2025-04-30.basil e oito eventos documentados em STRIPE-TESTES.md. Não recriar. URL https://myqfoqfnjtdzouupoaiq.supabase.co/functions/v1/stripe-webhook.
- Stripe CLI trigger invoice.paid gerou fatura avulsa sintética USD20: evento evt_1UO01BCHmArYgc52DkIeITdk entregue em 18:56:46UTC com HTTP200 e received=true; uma entrega, zero falhas,237ms. POST de assinatura inválida retornou400/received=false. Apenas transporte/assinatura do webhook validados: não houve checkout de plano Clara, assinatura ou chamada de leitura autenticada à API Stripe.
- Consulta final no Supabase teste:0usuários,0estúdios,0eventos de assinatura aplicados, billing.enabled=false. Produção intacta, nenhuma cobrança real. Fatura/cliente sintéticos permanecem na Stripe de testes.
- Falta frontend de homologação com APP_ORIGIN HTTPS existente e depois testes completos de contratação/troca/cancelamento. Nenhum frontend publicado nesta etapa. Publicação e ativação de produção continuam dependendo de aprovação específica. Detalhes e identificadores públicos em STRIPE-TESTES.md e .local/stripe/clara-test-config.json.
- Browser: Stripe aba1 na entrega do webhook; Supabase aba2 em functions/secrets do projeto testes. Inventariar se IDs mudarem. Nunca imprimir snapshots sem ocultar segredos.

## Supabase Clara — testes CRIADO — 07/10/2026
- Usuário confirmou custo0/mês e criação/configuração: “Confirmado, pode criar”. Projeto myqfoqfnjtdzouupoaiq, nome Clara — testes, org zvovwelwpbrldxlihads, região sa-east-1, ACTIVE_HEALTHY. Não criar outro. Produção gtqcehwvddvqllicnreu intacta.
- Banco aplicado: 20261007182621_clara_test_baseline (fontes de produção incluindo media e billing, sem scheduling_integrity) e 20261007182650_clara_test_billing_plans. Billing e stripe-webhook v1 ACTIVE, fontes atuais e dependências publicadas. Detalhes em STRIPE-TESTES.md e .local/stripe/clara-test-config.json.
- Salvos inicialmente os sete parâmetros sem segredos: BILLING_MODE=test, quatro preços, portal, APP_PUBLISHABLE_KEY do projeto. Os dois segredos foram salvos na etapa acima; falta APP_ORIGIN HTTPS de homologação. Nenhum frontend publicado, nenhuma cobrança ativada.
- Smoke remoto:401 sem login,400 sem assinatura,405 para GET; SQL com proprietário inativo contou5 e recusou6º, transação revertida,0usuários/estúdios. RLS pública habilitada, operação de cobrança negada a anon. Cobrança false.
- Pergunta assíncrona sobre segredos RESPONDIDA e ação concluída na etapa acima. Não repetir a aprovação de criação do projeto, funções ou conexão das credenciais.
- Endpoint registrado na etapa acima. Origin/preview de homologação ainda precisa definição/publicação autorizada; não usar origem produção para testes.

## Histórico Stripe — 07/10/2026, catálogo e portal de TESTE criados
- Usuário entrou na Stripe e avisou “Feito”. Conta de teste acct_1SA92fCHmArYgc52, Área restrita de New business. Criados e conferidos os quatro produtos/preços mensais 29,90/59,90/79,90/99,90. IDs em STRIPE-TESTES.md e .local/stripe/clara-test-config.json (sem segredos). Não recriar em nova retomada.
- Portal bpc_1UNzCOCHmArYgc52igMhd5Iu salvo pelo Stripe Shell oficial do Workbench, livemode=false, faturas/cartão/cancelamento ao fim do período, sem troca livre de plano. Não havia portal antes; a primeira configuração virou padrão. Nenhuma chave extraída, assinatura ou pagamento criado.
- Naquela etapa, Supabase tinha somente o projeto de produção. Usuário delegou escolha da organização; escolhida zvovwelwpbrldxlihads, free, custo0/mês. Aprovação recebida e projeto criado posteriormente, conforme as seções atuais acima. Não recriar nem migrar produção.
- Browser Stripe aba13, Workbench/Shell aberto. Comandos via campo “Shell input field”, teste confirmado pela página. Ferramenta WebMCP search_dashboard disponível para buscas. Portal/settings na página de fundo não deve ser salvo com estado antigo. Marcar aba para retomada. Integração e pagamentos reais de sandbox ainda pendentes; site/cobrança de produção intactos.

## Menu desktop fixo, sem rolagem — 07/10/2026, LOCAL
- Usuário rejeitou a barra de rolagem no menu lateral e pediu menu fixo no desktop. Esta preferência substitui a rolagem desktop descrita no histórico de logout abaixo.
- src/account-exit.css agora mantém sidebar fixa com overflow:clip a partir de768px e ajusta espaçamentos pela altura. Em janelas baixas, retira somente textos decorativos/repetidos e compacta o menu; as oito opções, link público e saída continuam acessíveis. No celular, mantém o menu recolhível e sua rolagem.
- Conferido no navegador:965×912 (tamanho da referência),1366×768,1280×720,1024×600,965×851 e alturas651/550/450/400. Na altura400, saída termina em394px e scrollHeight=clientHeight=400; em651 também sem recorte. Menu móvel390px conserva overflow:auto. Build passou (.local/sidebar-fixed-build.log). Nenhuma lógica de autenticação/cobrança alterada.
- Pacote isolado atualizado pelo script scripts/prepare-clara-logout-release.mjs: .local/vercel/clara-logout-fixed-sidebar-20261007,15 arquivos, JS index-clara-badfb0cc0214910c.js, CSS index-clara-0a6f6d530535f189.css. Usa baseline visual publicado e inclui apenas saída visível + novo layout sidebar; sem planos/reenvio/agendamento pendente. O pacote antigo clara-logout-only-20261007 está SUPERADO e não deve ser publicado.
- NÃO publicado. Aprovação para deploy continua necessária. Prévia atualizada na aba local de3000/production-qa;4175 continua mostrando o pacote anterior até trocar explicitamente a prévia.

## Planos até cinco atendentes — 07/10/2026, LOCAL
- Usuário definiu teto de cinco, incluindo proprietário, e autorizou a implementação (“Pode fazer a aplicaçao”). Valores mensais totais: 1=R$29,90; 2–3=R$59,90; 4=R$79,90; 5=R$99,90. Implementados localmente; NÃO publicado nem ativado pagamento. Regra de aprovação antes de publicar preservada.
- Fonte e roteiro em PLANOS.md. Catálogo supabase/functions/_shared/plans.js; UI Subscription/Team; nova migração supabase/billing_plans.sql após billing.sql, independente de scheduling_integrity. Backend billing/stripe-webhook agora exige os quatro preços e portal restrito; publicar também o módulo compartilhado. Não publicar funções novas contra o banco antigo nem deixar função antiga ativa após a migração de planos.
- Teste grátis/cobrança desligada permite até cinco. Proprietário conta uma vaga mesmo desativado. Somente demais ativos contam. Mudança de equipe não cobra automaticamente: escolher/confirmar plano; upgrade proporcional com pending_if_incomplete; downgrade exige desativar excedentes, reduz limite e cobra menor valor na renovação sem estorno. Dados preservados. Banco impõe limites transacionais, até em chamadas diretas e concorrentes. Estado pago só pelo webhook; solicitações possuem chave persistente para retomar sem duplicar.
- Validação: npm test 406 aprovados, build aprovado; testes PostgreSQL nativo de concorrência 6 aprovados (o runtime precisou executar fora do sandbox Windows para iniciar, somente localhost/dados sintéticos). Logs .local/billing-full-tests.log, billing-build.log, billing-concurrency.log. UI desktop/390/320, bloqueio sexto, confirmação e falha simulada conferidos, sem overflow/console errors.
- Stripe real/sandbox NÃO conectado nem testado: falta conta/configuração do usuário e homologação remota autorizada. Perguntado por mensagem assíncrona se já criou conta. Não pedir segredos no chat. Cobrança remota continua desativada. Nada alterado em Vercel/Supabase/Brevo remoto nesta etapa.
- Prévia isolada sem rede real: http://127.0.0.1:3000/.local/production-qa.html?mode=billing-expired#/app/assinatura. Outros modos em PLANOS.md. NÃO publicar fixtures. NÃO publicar dist completo: pendências anteriores de agenda e autorização continuam. Ainda não há pacote de frontend isolado dos planos.

## Saída da conta visível — 07/10/2026, LOCAL, aguardando deploy
- Usuário relatou não encontrar opção para sair/voltar ao login. A produção tem somente ícone no perfil ao fim do menu; sidebar desktop não tinha rolagem para alturas pequenas. As abas disponíveis estavam deslogadas; nenhuma sessão real do usuário foi encerrada.
- Fonte local agora mostra “Sair” no cabeçalho e “Sair da conta” abaixo do perfil (na demonstração, “Sair da demonstração”). Sidebar rola também no desktop. Mesma chamada Supabase signOut e tratamento de erro preservados, sem alterar escopo da sessão ou backend. CSS isolado src/account-exit.css; handler compartilhado leaveAccount em src/main.jsx.
- Pacote de publicação preparado SEM as pendências de agendamento ou de reenvio: .local/vercel/clara-logout-only-20261007, derivado do pacote visual publicado. Script scripts/prepare-clara-logout-release.mjs confere hash do baseline e reversibilidade exata das duas substituições de UI; todos os demais arquivos copiados intactos. Manifesto ao lado. Bundle index-clara-badfb0cc0214910c.js, CSS index-clara-e0e30502695e2a78.css.
- Build local e14 testes de sessão/rede/configuração passaram; sintaxe do bundle isolado conferida. Fixture logout-failure bloqueia rede real e simula falha/retry: mensagem de erro mantém painel e segunda tentativa retorna ao login. Pacote isolado testado em desktop,390px e320px: saída visível, rolagem até fim do menu e saída da demonstração para login; console sem erros. Logs .local/clara-logout-build.log e .local/clara-logout-tests.log. Prévia http://127.0.0.1:4175/#/demo/agenda.
- NÃO publicado. Perguntar aprovação antes de deploy conforme regra abaixo. Ao retomar publicação, verificar se a produção ainda usa o baseline index-clara-64ae4532b705e8db.js; não sobrescrever versão posterior. Usar explicitamente PackageDirectory do pacote logout, nunca dist inteiro. Reenvio permanece local e não faz parte deste pacote.

## E-mails — 07/10/2026, SMTP conectado e reenvio LOCAL
- Usuário avisou “Criei a conta” após a etapa do domínio. Brevo acessível; minhaclara.com autenticado com TXT de verificação, dois CNAME DKIM e TXT DMARC adicionados na Hostinger, TTL300. Remetente Clara <nao-responda@minhaclara.com> criado, Verified. Registros do site preservados. Detalhes públicos em EMAILS.md.
- Supabase Site URL e única Redirect URL agora https://minhaclara.com. SMTP personalizado SALVO e confirmado após recarregar: ativado, remetente Clara <nao-responda@minhaclara.com>, host smtp-relay.brevo.com, porta587, intervalo60s, senha armazenada oculta e Save changes desativado.
- Usuário confirmou telefone verificado e autorizou explicitamente criar a chave SMTP e armazená-la no Supabase: “Confirmado, pode ser!”. Chave Clara Supabase Auth criada, Standard, Active na Brevo, vencimento listado06/10/2027; também expira após90dias sem uso. Chave transferida diretamente pelo navegador sem logs/arquivo. Não pedir autorização de conexão novamente. Leitura DOM mascara campos sensíveis como vazios, apesar de preenchidos; conferir visualmente.
- Usuário informou que o e-mail de confirmação funcionou no cadastro. Recuperação ainda não validada; usuário decidiu testar depois, não insistir em destinatário/testes. Modelo de confirmação segue padrão inglês; só consultado. Perguntou sobre avisos de vencimento de pagamento: fonte do webhook Stripe apenas sincroniza assinatura/faturas, sem disparos Brevo; avisos ainda não implementados e cobrança continua desativada. Não há autorização nova para publicar frontend, migração ou ativar cobrança.
- Reenvio de confirmação implementado somente no Auth local, também disponível depois do cadastro e da recuperação, intervalo60s e bloqueio de envio simultâneo. Fixture auth-resend-failure sem rede permite falha/retry. Build e14 testes passaram; navegador confirmou falha, nova tentativa e intervalo.
- Não houve deploy ou migração. NÃO publicar dist inteiro: pendência de agendamento descrita abaixo continua. Ainda precisa preparar pacote de publicação isolado do Auth antes de pedir autorização de deploy.

## Conexão do domínio — 07/10/2026, DNS aplicado e HTTPS verificado
- Usuário confirmou compra de minhaclara.com na Hostinger e pediu conectar à Vercel. Adicionados minhaclara.com e www.minhaclara.com ao projeto encaixa, ambos verified=true. www redireciona HTTP308 ao domínio raiz. Nenhuma publicação de código ou migração nesta etapa.
- Após usuário avisar “Login feito”, configurados pela interface Hostinger: A @ 216.198.79.1 e 64.29.17.1; CNAME www 21167071923b4bea.vercel-dns-017.com; TTL300. Apenas dois registros anteriores existiam, sem e-mail. Nameservers Hostinger mantidos. Valores anteriores em .local/vercel/hostinger-dns-before-20261007.json. Estado/detalhes em DOMINIO.md e .local/vercel/clara-domain-status.json.
- Vercel confirmou misconfigured=false nos dois nomes. DNS público Cloudflare/Google e ambos os autoritativos corretos. HTTPS no IP recomendado validado normalmente, HTTP200 e bundle index-clara-64ae4532b705e8db.js corretos; www HTTP308 para raiz. Após o cache local expirar, https://minhaclara.com/ abriu corretamente no navegador às12:22UTC: título Clara, frase original e login. Conexão concluída, sem alteração de configuração de rede local nem bypass de certificado.
- Script scripts/configure-clara-domain.ps1 consulta configuração; -Connect adiciona somente os dois nomes ausentes. Connector Vercel tem erro de escopo; script usa credencial local DPAPI existente e projeto/equipe explícitos. E-mail/Brevo e URLs de Auth Supabase permanecem pendentes para a próxima etapa.

## Deploy visual publicado — 06/10/2026
- Autorização atual: “Faça deploy e depois vamos partir para os sistema de envio de email”. Publicação visual concluída em https://encaixa-eta.vercel.app/; Vercel dpl_CLX7DEbh5fHCSsAwdDVGzgj752FU, READY e alias confirmados. Logo Clara, monograma C e favicon v3; frases originais preservadas; sufixo PRO removido do frontend.
- ATENÇÃO: o build atual de src inclui alterações de agendamento NÃO publicadas. A revisão automática rejeitou a migração clara_scheduling_integrity por ampliar o escopo visual autorizado, alterando regras de reservas/acesso. Não contornar essa rejeição nem publicar dist isoladamente. Necessária autorização explícita para a migração de agendamento e funções correspondentes.
- Para atender o pedido visual com segurança, o pacote .local/vercel/clara-visual-only-20261006 foi derivado do artefato em produção clara-production-live-20261006, conferido byte a byte contra o remoto antes da preparação. Script reproduzível scripts/prepare-clara-visual-release.mjs; trocas limitadas ao componente da logo, imagens/ícones, oito textos de marca e nomes dos arquivos com hashes novos. Regras de negócio e backend preservados. Não houve migração nem publicação de Edge Functions.
- Bundle publicado: index-clara-64ae4532b705e8db.js; CSS index-clara-1b9c0b1664739869.css. Manifesto SHA-256 em .local/vercel/clara-visual-only-20261006.manifest.json. Pacote .local/vercel/clara-logo-live-20261006 é rascunho do build COMPLETO, NÃO PUBLICAR sem resolver autorização da migração. Backup da referência anterior/funções/DDL substituível em .local/releases/before-clara-logo-20261006.
- Validação: 379 testes e build do código local passaram (.local/clara-final-release.log); pacote visual teve sintaxe JS, substituições exatas, ausência da RPC pendente, logo/login/demo e console conferidos. Produção HTTP200, bundle correto e cabeçalhos confirmados; booking200/null, billing401, clara401 e stripe-webhook400 esperados (.local/deploy-verification.json). Nenhum dado de cliente, e-mail real ou cobrança alterado.
- E-mails: usuário confirmou “Tenho apenas o domínio” (minhaclara.com comprado; conta Brevo ainda não criada). Domínio NÃO conectado ao site nesta revisão. Próximo passo: usuário criar conta Brevo e confirmar e-mail; autenticar domínio/remetente, configurar SMTP no Supabase e URLs corretas, adicionar reenvio de confirmação e testar confirmação/recuperação. Documentação oficial conferida: https://supabase.com/docs/guides/auth/auth-smtp e https://help.brevo.com/hc/en-us/articles/7924908994450-Send-transactional-emails-using-Brevo-SMTP . Configuração remota de SMTP continua pendente.

## Correção visual solicitada — 06/10/2026, LOCAL
- Pedido mais recente prevalece: manter a frase e os textos como antes; remover apenas o sufixo PRO e trocar a logo por uma mais profissional. Referência visual enviada pelo usuário.
- Restaurados “Você cuida. A Clara organiza.”, “MAIS TEMPO PARA O QUE VOCÊ AMA”, descrição, três benefícios, frase superior, textos de login/cadastro e rodapés originais (sem o sufixo). Marca visível: Clara. Domínio escolhido continua minhaclara.com; não confundir o endereço com obrigação de escrever “minha” na logo.
- Nova logo gerada com image_gen: src/assets/clara-logo-v2.png, monograma C próprio + lettering clara. Símbolo isolado em public/clara-icon-v3.png, aplicado aos detalhes e favicon. Substitui a versão tipográfica com calendário da revisão imediatamente anterior. Personagem, layout e paleta preservados.
- Prompts e método em design-references/clara/logo/clara-logo-v2.md. Aprovação de publicação continua necessária; nada publicado/configurado remotamente nesta revisão.
- Validação desta correção: build aprovado (.local/clara-logo-v2-build.log); 11 testes existentes de configuração de publicação e assistente aprovados (.local/clara-logo-v2-tests.log). Login conferido no navegador em desktop, 390 px e 320 px, sem rolagem horizontal nem erros no console. Logo e monograma com transparência verificada. Prévia isolada: http://127.0.0.1:3000/.local/production-qa.html?mode=auth.

## Histórico: primeira revisão Minha Clara — substituída pela correção visual acima
- Decisão atual do usuário: “Agora é minhaclara o dominio e a cara do site sera sobre agende e assistente clara. Nada de PRO”. Nome de apresentação: Minha Clara; domínio escolhido: minhaclara.com. Não foi verificado o registro nem configurado DNS/Vercel/Supabase para esse domínio.
- Produto: Minha Clara. Personagem: Clara, sua assistente. Foco da entrada: agendamento online, rotina e remarcação com a assistente. Não voltar à marca anterior ou usar o antigo sufixo nas telas.
- Marca tipográfica sem imagem com texto antigo, símbolo de calendário com coração e favicon correspondente. Mascote e paleta preservadas. Textos atualizados no login/cadastro, painel, assinatura, reservas, exportação ICS e fontes da Edge Function Clara. Identificadores técnicos existentes e UID de eventos foram preservados para não alterar integrações/reservas.
- Supabase verificado nesta conversa: cadastro e confirmação de e-mail habilitados; SMTP próprio desativado; Site URL http://localhost:3000 e lista de Redirect URLs vazia. Cobrança desativada. Configuração de e-mail, reenvio de confirmação e conexão do domínio continuam pendentes.
- Esta revisão é local; a regra de aprovação para publicar abaixo continua válida. Há alterações anteriores de agendamento que exigem migração: revisar o escopo antes de publicar o build atual.
- Validação: build aprovado; 324 testes existentes da assistente/diálogo/configuração de publicação aprovados; entrada e cadastro conferidos no navegador em desktop, 390 px e 320 px, menu móvel e assinatura sem sobreposição da marca. Busca textual em fontes, funções e build sem a marca antiga; imagem da logo antiga não entra no bundle. Logs em .local/minha-clara-build.log e .local/minha-clara-tests.log. Nenhum e-mail ou dado real enviado/alterado.

## Reengenharia de agendamentos — 06/10/2026, LOCAL, ainda não publicada
- Auditoria e implementação em AUDITORIA_AGENDAMENTOS.md. Nova migração supabase/scheduling_integrity.sql, após billing.sql; NÃO aplicada no remoto. Requer aprovação antes de qualquer publicação conforme regra abaixo.
- Mutex transacional por estúdio nas escritas/configurações, validação obrigatória de expediente/almoço/folga no trigger e exclusão GiST para salas/macas. Soma de serviços e exclusão por profissional existentes preservadas. Recursos vinculados ao catálogo reservam toda a sequência + limpeza. Trocar vínculo atualiza reservas futuras atomicamente, sem mudar preço/horário; conflito reverte tudo.
- Frontend: OwnerSlots, Resources, editor com consulta antes de salvar/remarcar/alterar serviços, erros persistentes, conversão IANA em scheduling.js. Gateway booking index.ts + novo validation.js exige instantes com offset e devolve HTTP409 em conflitos. Manter ambos os arquivos ao publicar.
- npm run check:release: 379 testes passaram e build passou. PostgreSQL nativo portátil em .local/pg-test permite testes com conexões simultâneas; script npm run test:scheduling:concurrency. Relatório descreve cenários, limites e ordem de aplicação. Fixture UI isolada .local/scheduling-qa.html; nenhum dado real gravado.
- Leitura remota confirmou 3 registros de agenda, 1 futuro confirmado, zero intervalos não finitos/vazios e zero futuros fora do expediente; recursos ainda não existem em produção. Cadastrar/vincular recursos reais após aprovação; nenhum nome de sala/maca foi inventado para os dados existentes.

## Deploy autorizado e concluído — 06/10/2026
- Usuário pediu explicitamente “faça deploy”. Publicado em https://encaixa-eta.vercel.app/; Vercel dpl_D9XWG3vgXb3c621raDH14TMoymGw, estado READY confirmado, alias público correto. Pacote .local/vercel/clara-production-live-20261006; bundle index-DOfl8Qe2.js. O ZIP anterior clara-production-20261006 é rascunho anterior e foi substituído por este pacote.
- Migrações remotas aplicadas: clara_production_readiness e clara_billing_inactive. Fontes production_readiness.sql e billing.sql; NÃO reaplicar. Funções publicadas: booking v8, clara v11, billing v1 e stripe-webhook v1.
- Ajuste de segurança operacional antes do deploy: cobrança DESATIVADA por padrão em encaixa_private.billing_settings.enabled=false. trial_ends_at fica null até ativação. Zero períodos iniciados/zero estúdios bloqueados confirmados no remoto; catálogo ativo preservado. O app informa que o acesso continua disponível. Nenhuma cobrança real e nenhuma conta Stripe criada.
- Quando Stripe/SMTP/homologação estiverem prontos e houver aprovação, ativar uma única vez pelo administrador com select encaixa_private.activate_billing(); função idempotente não exposta a clientes/service_role. Concede sete dias completos às contas existentes; contas novas iniciam sete dias ao criar o espaço após ativação. NÃO executar agora. Checkout recusa quando a flag está desligada mesmo que existam segredos Stripe.
- Os ajustes de logo e presença da Clara descritos como locais nas seções históricas abaixo agora estão publicados junto com correções de sessão, rede, consultas, índices e WebP.
- 363 testes passaram após mudança da flag e build passou; .local/deploy-release-check.log. Verificação remota: HTTP200 e bundle correto, CSP/HSTS/cache presentes; booking consulta inexistente200/null, billing/clara sem autenticação401, webhook sem assinatura400. RLS/permissões de funções conferidas; funções financeiras privadas não executáveis por clientes/anon. Logs públicos do navegador sem erros; entrada e demonstração funcionando.
- Não havia sessão autenticada nas abas de validação; nenhum login com credenciais, envio de e-mail, pergunta à Groq, reserva ou pagamento real foi realizado. Não confundir smoke test com validação completa de Auth/Stripe/carga. Capacidade de1.000 ainda não certificada.
- Antes do deploy, fontes remotas booking v7/clara v10 e referência anterior Vercel preservadas em .local/releases/before-production-20261006. Relatório smoke .local/deploy-verification.json; script scripts/verify-release.mjs não grava dados de negócio.

## Preparação de produção — 06/10/2026, SOMENTE LOCAL
- Pedido: revisar auth/sessão, banco/conexões, erros, completude e desempenho para meta de 1.000 usuários simultâneos. Usuário definiu 7 dias grátis e R$ 29,90/mês; não tem conta de pagamentos nem CNPJ. Orientado sobre Stripe PF/CPF com fonte oficial; integração preparada em teste, sem criar conta, cobrar ou publicar.
- Plano atual e procedimento completo em PRODUCAO.md. NÃO declarar 1.000 usuários certificados: não há ambiente de homologação/carga executada. Dependências externas: Stripe sandbox/live, SMTP/URLs, capacidade Supabase/Groq, restauração e alertas. Publicação exige nova aprovação conforme regra abaixo.
- Novos arquivos: src/network.js, session.js, dashboard-data.js, ErrorBoundary.jsx, Subscription.jsx; supabase/production_readiness.sql e billing.sql; funções billing/stripe-webhook. Migrações NÃO aplicadas remotamente. Front-end novo depende delas; validar com fixture local ou banco de homologação. Não publicar isoladamente.
- Auth: deadline, erros amigáveis/retry, eventos antes de bootstrap, descarta sessão antiga após saída, reset de estado por conta, confirmação de nova senha, persistência da recuperação na aba. Supabase mantém hashes, sem senha própria no app.
- Painel: cursores de 500 linhas (sem truncamento 1.000), leitura compartilhada, revisão por estúdio, polling 55–65s só visível/online; leitura inicial ainda traz todo histórico, limite técnico100mil não significa desempenho certificado. Índices FK/cursor preparados; nenhuma alteração de pool remoto. max_connections observado60, Auth/Data API compartilham conexões; não aumentar para1.000.
- Assinatura: teste por proprietário, read-only após expirar, novas reservas/IA/gravações de negócio bloqueadas no servidor, cancelamento público permitido pelas regras existentes. Checkout2990BRL/mês após teste, portal/faturas, webhooks assinados/deduplicados, lease por cliente para estado canônico. Modo teste padrão. Não iniciar teste de contas existentes aplicando billing.sql antes de conseguir habilitar pagamentos.
- Clara: mantém30 perguntas IA/dia, novo limite20 requisições/minuto; reset continua disponível após expirar assinatura. Autorização de envio à Groq continua só pergunta + até4 perguntas anteriores.
- AssetsWebP: cinco imagens principais7.425.214→399.488bytes (94,6%menores), originais preservados, faviconv2. Vercelcacheversionado/CSP/HSTS; scriptdeploy allowlistWebP alterado mas NÃO executado.
- Auditoria npm encontrou source-map-js vulnerável, atualizado; zero vulnerabilidades reportadas após atualização. PGlite0.5.8 devdependency para testes SQL locais, não incluído no navegador.
- Testes adicionais: production.test.js, sql.local.test.js, billing-edge.test.js; testes de escrita remotos agora exigem TEST_ENV_FILE+ALLOW_STAGING_TESTS e bloqueiam produção conhecida. Roteirok6 tests/load/1000-users.js preparado, não executado. Fixture visual isolada .local/production-qa.html bloqueia rede externa; testes/fixtures nunca devem ser publicados.
- Validação final: npm run check:release passou, 363 testes/zero falhas, build concluído; log.local/release-check.log. Bundle principal143,67kB/42,24gzip; avisospreexistenteslucide useclient. Visual: falha de sessão→retry→login, falha de dados→retry→agenda, cadastro com confirmação, recuperação sem e-mail real, tela nova senha, assinatura expirada390px, clientes53 com mostrarmais sem alterar grid. Sem erros de execução na fixture; abaQA encerrada e viewport restaurado. Detalhes em PRODUCAO.md e CHECKLIST.md.

## Regra do usuário: aprovação antes de publicar
- Pacote da revisão de produção preparado, NÃO publicado: .local/vercel/clara-production-20261006.zip (2.229.837 bytes), pasta homônima para PackageDirectory e manifesto SHA-256 ao lado. Requer migrações/funções antes do front-end; homologação requer rebuild com outro Supabase. Nenhuma credencial incluída no pacote.
- Instrução explícita mais recente: “Não faça nenhuma publicaçao sem minha aprovaçao ou pedido. Sempre pergunte”.
- Preparar, editar e testar localmente conforme solicitado. Antes de qualquer nova publicação/deploy (frontend, backend ou alterações remotas), apresentar o resultado pronto e pedir aprovação. Aguardar resposta afirmativa; não inferir autorização de pedidos antigos de deploy ou de um pedido de alteração local.
- Esta regra substitui qualquer interpretação anterior de autorização contínua para publicar.

## Nova logo CP — aplicada LOCALMENTE, aguardando aprovação de publicação
- Usuário escolheu explicitamente o monograma CP enviando a primeira proposta. Aplicado por componente compartilhado src/Brand.jsx e src/brand.css: entrada/cadastro, onboarding, menu, cabeçalho/rodapé das reservas, prévia do agendamento, plano e cartão ilustrativo. Ícones de serviços continuam próprios da categoria.
- Composição original copiada sem alterações para src/assets/clara-logo-v1.png; SVG de apresentação apenas enquadra o PNG, não é uma vetorização. Versão clara por CSS nos fundos vinho. Símbolo isolado gerado com image_gen integrado, salvo em public/clara-icon-v1.png, usado no favicon e como máscara para pequenos detalhes. Prompt acrescentado em design-references/clara/logo/PROMPTS.md.
- Visual conferido na entrada e menu em desktop e 320px, e no cartão da assinatura em desktop. Menu ajusta largura para o botão Fechar sem sobreposição. Build passou e 3 verificações existentes da configuração de publicação passaram. Script deploy-vercel.ps1 atualizado apenas para permitir o novo arquivo PNG do ícone; não executado. Nenhuma alteração remota. Nova logo e demais ajustes da Clara continuam aguardando autorização de publicação.

### Estudos anteriores
- Usuário pediu uma logo mais original que a flor atual. Geradas duas propostas com image_gen integrado: design-references/clara/logo/clara-monograma-v1.png (CP fluido + clara PRO) e clara-assinatura-v1.png (Clara manuscrita + PRO). Prompts completos em design-references/clara/logo/PROMPTS.md.
- Comparação interativa dos estudos: http://localhost:3000/.local/clara-logo-preview.html. A opção CP foi escolhida e aplicada localmente conforme acima; a produção ainda usa a flor anterior.

## Presença completa da Clara — LOCAL, aguardando aprovação
- Usuário esclareceu que queria também as outras aplicações propostas, além do cartão da agenda. Implementados ClaraEmptyState em Clientes, Serviços e Agenda, com instruções/ações próprias para primeiro cadastro, data vazia e busca sem resultados. Botões abrem os formulários existentes, limpam filtros ou abrem o chat.
- Artes novas geradas com image_gen integrado: src/assets/clara-guia-v1.png (ficha/agenda) e clara-celebrando-v1.png (aplausos). Prompts em design-references/clara/clara-presenca-v1.md. Pose apontando existente agora apresenta o WhatsAppDraft após remarcações tanto pelo editor quanto pelo chat; envio final continua manual.
- ClaraMilestone comemora primeiro serviço criado e primeiro atendimento concluído somente após mutação bem-sucedida; edição não comemora. Controle por espaço em armazenamento local com fallback em memória, sem migração. Conclusão pelos dois caminhos exige linha confirmada retornada (.select.single) para não celebrar update vazio. Componentes/CSS em ClaraPresence.jsx e clara-presence.css; regras em clara-milestones.js.
- 346 testes passaram e build passou. UI isolada contra banco em memória: falha simulada no primeiro salvamento sem comemoração, retry bem-sucedido com comemoração, edição sem repetir, primeiro atendimento concluído pela ficha e pelo modal mobile, CTA de primeira cliente e limpar busca preservando cadastro. Aparência desktop, 390px e 320px conferida; nenhum dado real ou backend alterado.
- Prévia de todos os momentos: http://localhost:3000/.local/clara-presence-preview.html (somente local; componentes reais, dados fictícios e botões de demonstração). QA: .local/clara-presence-qa.html e tests/clara-presence-ui-fixture.js, nunca empacotados no deploy. NÃO publicado; conjunto completo + cartão + login aguardam aprovação explícita.

## Cartão “Seu dia com a Clara” — LOCAL, aguardando aprovação
- Usuário aprovou começar pela presença da Clara no resumo da agenda. Implementado em src/ClaraDayCard.jsx, src/clara-day.js e src/clara-day.css. Personagem existente apoiada no cartão vinho, saudação pelo horário de São Paulo, contagem na data/profissional selecionadas, progresso de concluídos e próximo atendimento confirmado futuro. Bloqueios/cancelamentos não entram; falha de atualização exibe aviso em vez de declarar agenda livre.
- “Ver próximo atendimento” troca para a data correta, destaca e foca o atendimento na lista, sem alterar dados. “Perguntar à Clara” abre o chat existente; fechar retorna o foco ao botão e conserva o reinício da conversa. Comando de abertura é consumido para não reabrir após recarga do painel.
- Layout responsivo e animação discreta respeitando movimento reduzido. Validado visualmente em desktop, 390px e 320px; botões funcionais, sem largura excedente. 343 testes passaram (6 novos cenários de resumo/calendário/filtro). Build passou. Fixture tests/clara-day-ui-fixture.js e .local/clara-day-qa.html usa somente dados sintéticos na demonstração, não incluída na produção.
- NÃO publicado; nenhuma alteração remota ou pergunta à IA foi necessária. O ajuste anterior da Clara apoiada no título do login também continua local. Pedir aprovação explícita antes do deploy.

## Clara apontando na tela inicial (05/10/2026 — atualização visual)
- Ajuste posterior LOCAL, ainda NÃO publicado: Clara agora acompanha a primeira linha do título, com antebraço logo acima de “Você cuida.” e dedo ao lado direito das letras. Posicionamento proporcional à fonte em src/styles.css e spans do título em src/main.jsx, sem alterar a imagem. Validado em desktop, 740px, 390px e 320px; sem corte da arte ou largura excedente; build passou. Aguardar aprovação explícita para publicar esta composição.
- Personagem adicionada acima de “Você cuida”, apontando para baixo conforme referência do usuário. Nova arte src/assets/clara-apontando-v1.png gerada com image_gen integrado, preservando identidade/roupa 3D e transparência; avatar do chat preservado. Prompt registrado em design-references/clara/clara-apontando-v1.md.
- Auth em src/main.jsx e src/styles.css ajustados com imagem responsiva (340px desktop / até 230px mobile). Frase mantém quebra após “Você cuida.” também no celular. Verificado visualmente em 1016×912 e 390×844, sem sobreposição ou largura excedente. Build passou; alteração visual não exige novos testes de lógica.
- Publicado dpl_6c2EFRHbNsi9mbG7QN489QqHtzzx READY, pacote .local/vercel/clara-welcome-20261005-final. Alias https://encaixa-eta.vercel.app HTTP 200 com index-yjQ47IRh.js e imagem clara-apontando-v1-K8ckZC4e.png HTTP 200 confirmados. Backend permanece Clara v10.

## Chat reinicia ao fechar (05/10/2026 — estado atual)
- Solicitação do usuário aplicada: fechar por X, avatar, fundo ou Escape limpa mensagens, rascunho, erros e contexto da conversa. Ao abrir novamente, exibe saudação e perguntas prontas. Agendamentos já salvos permanecem intactos.
- ClaraChat usa geração de conversa para ignorar respostas atrasadas e serializa reset no servidor; abertura aguarda reset antes de liberar perguntas. Reset valida a conta original, permite retry e não chama Groq. A memória é mantida somente enquanto a conversa está aberta; não retoma a conversa anterior ao abrir.
- Ação reset em dialogue.js salva estado idle com revisão e invalida propostas pendentes usando a RPC existente. Nenhuma migração nova. Testes cobrem reset de proposta, reset após sucesso, confirmação antiga e resposta concorrente; npm test: 337 passaram. Teste SQL sintético com ROLLBACK confirmou limpeza sem desfazer agendamento salvo. Build passou.
- Navegador isolado confirmou limpeza de histórico e rascunho, retorno das três sugestões e fechamento por Escape durante resposta atrasada sem reaparecimento da resposta. Nenhum agendamento real alterado nos testes.
- Publicado: Edge clara v10 ACTIVE e frontend dpl_5LoGh8Rghw18QkYpwenr46J4vfMK READY. Pacote .local/vercel/clara-reset-20261005. Alias https://encaixa-eta.vercel.app HTTP 200 com index-BoFuurQY.js confirmado.

## Conversa guiada da Clara publicada (05/10/2026)
- Usuário autorizou aplicar os reforços discutidos. Implementação em language.js e dialogue.js: datas naturais (inclusive “na próxima terça”), períodos, correções, ordinais, horas por extenso, manutenção de horário e comparativos. Regras locais resolvem casos conhecidos; fallback Groq extrai/canonicaliza trecho da pergunta sem acesso aos registros ou opções do banco e jamais pode confirmar uma alteração.
- Migração clara_dialogue_state aplicada (supabase/clara_dialogue.sql). Estado privado por proprietário com revisão: idle/identified/date/offer/confirm/cancel_question. RPCs get/save/commit verificam propriedade e revisão. Confirmação antiga de outra aba é recusada. Proposta substituída expira; confirmação repetida é idempotente. A permissão authenticated da antiga clara_reschedule_confirm foi revogada; escrita ocorre pelo wrapper com proposta ativa. Estado guarda recibo para recuperar sucesso após perda da resposta.
- Frontend retoma estado ao abrir o chat. Escolha de horário abre resumo completo antes de salvar; “tem às duas?” nunca salva. Botão de confirmar ou resposta afirmativa estrita à proposta ativa salva. Todas as sugestões antigas ficam desabilitadas por revisão. Cancelamento ambíguo pede esclarecimento; troca de profissional permanece na agenda. WhatsApp continua manual via Enviar com texto preenchido.
- Edge clara v9 ACTIVE (auth custom preservada, sem dados consultados enviados à Groq). Frontend dpl_BS6ctGnNZsRqhjZC9RZ5R2YK1Zmu READY; pacote .local/vercel/clara-dialogue-20261005; alias https://encaixa-eta.vercel.app HTTP 200 e asset index-B3viw66I.js conferidos. Requisição anônima ao chat retornou 401.
- npm test: 334 testes passaram, incluindo 300 combinações de conversas completas e cenários de negação, correção, retomada, datas inválidas e bloqueio de confirmação pelo modelo. Build passou. tests/clara-dialogue.sql passou no Supabase com fixtures sintéticas e ROLLBACK, cobrindo revisão desatualizada, confirmação sem proposta, replay e os testes de disponibilidade/propriedade anteriores.
- UI isolada validou: “Na próxima terça” -> “Tem às duas?” (nenhuma alteração) -> “Terça não, quinta à tarde” (confirmação antiga desativada) -> “O segundo” (quinta 14h30) -> “Esse mesmo” (uma única remarcação e WhatsApp personalizado). Não alteramos agendamentos reais para testar. Harness atualizado em tests/clara-dialogue-harness.js e tests/clara-ui-fixture.jsx, não incluídos no build.


## Deploy solicitado novamente (05/10/2026, 21h29)
- Build de produção concluído. Pacote .local/vercel/clara-release-20261005-212926. Deploy dpl_CSLfG8EBFyM6sc3JRGxk9pHUSoT7 READY, alias https://encaixa-eta.vercel.app confirmado. HTTP 200 e asset index-BkVKGDcX.js verificados na página pública. Backend Clara v6 já estava publicado; nenhuma migração reaplicada.


## Reagendamento conduzido pela Clara (05/10/2026)
- Fluxo solicitado implementado: perguntar próximo atendimento -> pedir nova data -> horários reais da mesma profissional -> escolher botão ou digitar horário exato oferecido -> salvar no chat -> mensagem com nome do cliente + botão Enviar (wa.me; envio final manual no WhatsApp). Nenhum dado consultado vai à Groq; contexto de appointmentId fica apenas no app/Supabase.
- Migração clara_reschedule_in_chat aplicada: supabase/clara_reschedule.sql. RPCs autenticadas verificam dono, horário futuro confirmado e não pago. Propostas privadas expiram em 15min; opções respeitam expediente, pausas, duração e intervalo originais. Confirmação revalida snapshot/disponibilidade, usa locks e proteção de conflitos; repetir a mesma confirmação é idempotente.
- Edge clara v6 ACTIVE, autenticação custom /auth/v1/user preservada. Nova intenção reschedule e reschedule.js com resolução de datas, opções e confirmação. A IA só interpreta pedido: não escreve no banco nem escolhe horário.
- Frontend dpl_213egyEHh4mi9TcmVcFS7UfY6mvc READY, alias https://encaixa-eta.vercel.app, pacote .local/vercel/clara-reschedule-20261005.
- Validação: 24 testes Node e build passaram. tests/clara-reschedule.sql executado no Supabase com dados sintéticos e rollback: troca bem sucedida preservando preço/duração, repetição, slot forjado, acesso a outro espaço, conflito surgido após oferta, snapshot desatualizado, expiração e pagamento bloqueados.
- UI testada em .local/clara-qa.html com tests/clara-ui-fixture.jsx (rede simulada e bloqueada fora da fixture; não incluída no build): próximo -> nova data -> escolher 14h -> mensagem personalizada, Enviar com texto codificado, callback de atualização da agenda. Nenhum agendamento real alterado e nenhum WhatsApp enviado. Groq real também interpretou pedido de remarcação sem seleção e pediu identificar atendimento corretamente.
- Clara mantém contexto no componente; seleção explícita por botão é confirmação. WhatsApp abre web/app conforme dispositivo, jamais simular envio automático via wa.me.


## Clara ampliada: ajuda, clientes e WhatsApp (05/10/2026)
- Edge clara v5 ACTIVE: guia estático extensível (guide.js) para tutoriais/cenários futuros, consultas de clientes e histórico, serviços, equipe, espaço e agenda. Usa RLS e filtro explícito do espaço cujo owner_id é auth.uid. Não envia resultados do banco à Groq; somente pergunta e últimas quatro perguntas, conforme autorização existente.
- Respostas com atendimentos confirmados abrem o editor existente; remarcação continua exigindo confirmação no formulário. Após update bem sucedido, Clara abre mensagem editável com horário antigo/novo, profissional e botão wa.me. Usuário envia manualmente. Sem telefone válido: copiar texto. Bloqueios não geram mensagem. Update exige starts_at original e single() para não confirmar linha ausente.
- Frontend publicado READY dpl_Ci4HA5BoRfmrEAzaxKTWPR8Kjyrx, https://encaixa-eta.vercel.app, pacote .local/vercel/clara-help-20261005.
- 22 testes passaram, build passou. Tutorial de remarcação/WhatsApp e consulta de próximo atendimento testados via UI autenticada com Groq real. Não remarcamos atendimento real nem enviamos WhatsApp para testar; formato de mensagem/link validado com dados sintéticos.
- Limites explícitos: histórico até 366 dias, listas de atendimentos 30, cadastro até 50, filtros por cliente (ambíguos pedem nome completo). Não promete qualquer consulta arbitrária nem funções futuras já disponíveis. Novos recursos devem atualizar guide.js. Dados e respostas do assistente nunca entram no histórico enviado ao modelo.
- Na validação real corrigimos client:null e datas opcionais nas intenções sem período. Logs registram somente categoria de erro de validação, sem perguntas/resultados.


## Avatar Clara publicado (05/10/2026)
- Botão flutuante substituído por rosto circular da personagem Clara com selo de interrogação; avatar também no cabeçalho. Imagem original preservada, enquadramento por CSS. Fonte src/assets/clara-personagem-v1.png.
- Build e abertura do chat verificados no navegador. Publicado dpl_GuCyRE7RXCNMd3W6P98hjGhq7mMg, READY, alias principal mantido. Pacote .local/vercel/clara-avatar-20261005. Script de publicação permite PNG em assets.

## Clara publicada após autorização (05/10/2026 — estado atual)
- Usuário AUTORIZOU explicitamente enviar à Groq a pergunta e até quatro perguntas anteriores. Bloqueio anterior resolvido; deploy permitido e concluído.
- Edge Function clara v1 ACTIVE, valida Bearer em /auth/v1/user e usa token do usuário nas RPCs com RLS. HTTP anônimo 401 verificado. Nenhuma consulta Groq autenticada ainda testada: navegador local está sem sessão, solicitado login ao usuário.
- Frontend Clara Pro + chat publicado no projeto existente: dpl_4zF4ekpSNiDXJCWKExPhpoaGJrSQ, READY, alias https://encaixa-eta.vercel.app confirmado. Pacote .local/vercel/clara-chat-20261005.
- 19 testes passaram, build passou e popup/saudação verificados na demonstração ONLINE. Demonstração não chama a IA; testar na conta real após login, com perguntas de próximo atendimento e recebimentos. Não afirmar validação ponta a ponta antes disso.

## Assistente Clara (05/10/2026 — publicação bloqueada)
- UI local: src/ClaraChat.jsx e src/clara.css, popup no painel autenticado/demo, saudação, sugestões, teclado/Escape, erros e requisições limitadas; perguntas ficam só na memória da tela.
- Migração clara_assistant_queries APLICADA, fonte supabase/clara.sql. NÃO reaplicar. RPCs invoker/RLS para próximo atendimento, agenda, recebimentos e resumo; quota persistente 30 perguntas/dia/usuário.
- Backend preparado em supabase/functions/clara/index.ts e core.js, NÃO publicado. Groq interpreta a pergunta e até 4 perguntas anteriores; dados retornados pelo banco não vão ao provedor. Modelo padrão openai/gpt-oss-20b, configurável GROQ_MODEL; secret GROQ_API_KEY informado pelo usuário como salvo.
- A revisão automática REJEITOU deploy: payload de perguntas pode conter dados pessoais e autenticação é customizada (/auth/v1/user). Solicitar autorização explícita para enviar pergunta + até 4 perguntas anteriores à Groq, depois retomar deploy. Não tentar contornar bloqueio.
- 19 testes passaram e build passou. Prévia demo verificada no navegador. SQL remoto verificou bloqueio anon/sem login. Pendente teste ponta a ponta autenticado, teste Groq real e publicação frontend. Nenhum envio de pergunta à Groq realizado.

## Nova marca Clara Pro (05/10/2026)
- Nome escolhido pelo usuário: Clara Pro. Marca nas telas, título da página, calendário exportado e pacote local atualizados.
- Domínio clarapro.com.br consultado como disponível, mas NÃO registrado nem conectado. Produção continua em https://encaixa-eta.vercel.app/ e ainda exige publicação desta alteração.
- Preservados identificadores de infraestrutura, migrações históricas e UID de eventos de calendário para compatibilidade.

## Publicacao concluida com token (05/10/2026)
- Publicadas correcoes mobile e campo de link personalizado na producao https://encaixa-eta.vercel.app/ . Deployment dpl_EeNdgnYEdrEjJTL8tA5trTXtoA5o, READY, alias principal confirmado.
- Projeto existente prj_GdJAEDPFnURqmlHXASsh13BdahS5, equipe team_5K65dmEw8IQkQ1uJNW963bpT. Nenhum novo projeto criado.
- scripts/deploy-vercel.ps1 envia somente pacote compilado permitido de .local/vercel, usa token criptografado de deploy-token.xml sem imprimi-lo. Parametro -Status consulta ultimo deploy sem republicar. Precisa contexto do usuario Windows fora do sandbox para descriptografar DPAPI. Nunca ler/exibir o token em texto.
- Pacote publicado .local/vercel/encaixa-links-20261005; o status anterior de frontend pendente abaixo foi resolvido.

## Links personalizados e mobile (05/10/2026)
- StudioLinkField.jsx adiciona prévia, consulta de disponibilidade com debounce, descarte de respostas antigas e bloqueio de endereço ocupado no cadastro/perfil. A validação definitiva continua nas restrições e trigger do banco.
- Migração studio_link_availability aplicada ao Supabase gtqcehwvddvqllicnreu; fonte supabase/custom_links.sql. RPC autenticada, sem expor dados de proprietários. NÃO reaplicar migrações anteriores.
- tests/custom-links.sql executado com sucesso em transação revertida: endereço próprio/livre, formato inválido, colisão atual/alias, preservação do catálogo antigo e permissões. Nenhum dado de teste persistido. 16 testes npm e build passaram.
- Mobile: agenda-side passa a uma coluna; serviço/valor empilhados, horário sem quebra e identidade com ajuste de texto.
- Frontend ainda NÃO publicado: pacote de produção .local/vercel/encaixa-links-20261005.zip pronto, somente dist + headers. Painel existente autenticado, mas atualização por Drop exige arrastar arquivo para a página do projeto; navegador automatizado não oferece arrastar arquivo local. Não criar projeto novo.

## Limpeza de clientes fictícios solicitada (02/10/2026)
- A pedido explícito do usuário, excluídos do Supabase os quatro clientes marcados como fictícios (Mariana, Camila, Beatriz, Fernanda, emails example.invalid) e o cadastro tes (teste@encaixa.test), com seus 5 agendamentos e 2 pagamentos de exemplo.
- Transação concluída com validação de IDs, estúdio, proprietário e contagens; comparação integral das linhas restantes antes/depois confirmou preservação.
- Restam 1 cliente (Alan), 1 atendimento e 1 pagamento, preservados. Nenhum cliente com os cinco emails de teste permanece. Conta de acesso, estúdio, profissionais, serviços e expedientes mantidos.
- Não restaurar os registros fictícios. Esta solicitação substitui as orientações históricas de manter a fixture persistente. A demonstração local continua usando src/demo.js, sem dados no banco.

## Frontend publicado na Vercel (02/10/2026 — atualização mais recente)
- Usuário autenticou no painel Vercel. Destino conferido: bertunesinc-3931, inicialmente sem projetos. Criado projeto encaixa pelo Vercel Drop; produção Ready.
- URL pública: https://encaixa-eta.vercel.app/ . Painel: https://vercel.com/bertunesinc-3931/encaixa . Deployment: 4tzNj2uhrQwkqwd2mwo9NpNDKtAE / encaixa-fmawh4khb-bertunesinc-3931.vercel.app.
- Build feito com VERCEL_ENV/VERCEL_TARGET_ENV=production e configuração local do Supabase. Enviados somente 10 arquivos: dist + vercel.json com headers. Pacote .local/vercel/encaixa.zip. Nenhum .env enviado; nenhuma integração Git. Atualizar pelo painel do projeto existente com novo pacote compilado; não enviar vercel.json de build junto com dist já pronto.
- 16 testes e build passaram. HTTP anônimo 200 no domínio, 5 assets verificados, Referrer-Policy/no-referrer, nosniff e DENY conferidos. Navegador carregou login e catálogo público studio-teste-alan conectado ao Supabase, com serviços/profissional.
- Supabase Auth Site URL/Redirect URLs ainda precisam de https://encaixa-eta.vercel.app. Painel Supabase no navegador pede login; conector não oferece configuração Auth. Não alterado. Também pendente teste de e-mails reais. Não criar reservas reais para smoke tests.

## Gateway configurado e publicado (02/10/2026 — atualização posterior à auditoria)
- Usuário configurou APP_PUBLISHABLE_KEY no Supabase e solicitou teste. Publicada booking v6 no projeto gtqcehwvddvqllicnreu, ACTIVE; usa a variável de ambiente em vez da chave fixa. verify_jwt=false preservado com validação própria de apikey.
- Comparado código remoto v5 com arquivo local antes do deploy: somente alteração esperada de configuração da chave.
- Testes HTTPS reais passaram: catálogo studio-teste-alan HTTP 200 com dados; chave inválida e chave ausente HTTP 401; operação desconhecida HTTP 400; preflight CORS HTTP 200.
- Nenhuma reserva ou cadastro criado/alterado. Nenhuma migração reaplicada. Configuração/publicação do gateway concluída neste projeto; URLs e e-mails Auth e frontend Vercel continuam pendentes.

## Correções da auditoria Vercel (02/10/2026)
- Node fixado em 24.x no package.json/lock. Vite valida URL e chave publicável ao carregar a configuração; build recusa variáveis ausentes, placeholder e chaves secretas.
- scripts/deployment-config.js define compartilhamento pelo ambiente Vercel: previews/custom bloqueiam copiar catálogo/reserva, QR e WhatsApp do catálogo. Produção e desenvolvimento local mantêm comportamento anterior. Visualização pública continua acessível.
- Gateway local substitui a chave fixa por APP_PUBLISHABLE_KEY do ambiente Supabase. Ainda NÃO publicado: configurar esse secret com a chave publicável do respectivo frontend ANTES de publicar booking. A função recusa iniciar sem configuração; fallback de SUPABASE_ANON_KEY preservado.
- .gitignore cobre arquivos .env (exceto exemplo) e .vercel. README atualizado com configuração por ambiente e cuidados com artefatos prebuilt.
- Validação: 16 testes unitários, build normal e preview; build real sem variáveis rejeitado; handlers do gateway executados com Deno simulado, sem rede, verificando configuração ausente/chave correta/legada/incorreta.
- Nenhum deploy, secret remoto ou dado real alterado. URLs/e-mails Auth e publicação seguem pendentes; não reaplicar migrações.

## Equipe com agendas independentes (02/10/2026 — estado mais recente)
- Migração encaixa_independent_professional_agendas aplicada; fonte supabase/team.sql. Gateway booking v4 publicado. NÃO reaplicar.
- Tabelas professionals/professional_hours com RLS do dono. Perfil principal automático no cadastro de salão. appointments.professional_id obrigatório com FK composta; exclusão GiST agora por salão+profissional+ocupação.
- Os 5 atendimentos anteriores foram vinculados ao perfil principal. Hash de id/início/fim/preço/status/serviços antes/depois idêntico: 665aa1c74aacfc7ec16cabdd21d14699. Sem alteração de clientes/agendamentos reais nos testes.
- RPCs available_slots_team, available_dates_team e book_appointment_team no gateway. Wrappers antigos escolhem principal; token de remarcação mantém profissional reservada. manage_booking retorna professional_id/name. Disponibilidade usa expediente individual, ou horário do salão até configurar.
- Team.jsx acessível por Equipe e atalho na agenda: cadastro/nome/ativação/expediente 7 dias e almoço. Agenda filtra por profissional; modal de agendamento/bloqueio exige seleção; remarcação manual permite transferência de confirmado não pago. Pública seleciona profissional e reaplica disponibilidade/sugestões. Demo tem Juliana/Renata.
- Escopo: uma conta administra o salão, catálogo/valores/antecedência/limpeza compartilhados. Sem login individual, comissões, ou atendimento único dividido entre profissionais. Desativar preserva histórico e bloqueia novas reservas públicas.
- Validação: 13 testes unitários e build; tests/team.sql passou no remoto com rollback (simultâneos, exclusão, bloqueios, horas, fechamento, sugestões, remarcação, pagamento, RLS e RPC restrito). Regressões booking-readiness.sql/product-completion.sql passaram também. Navegador: Equipe e filtro de agenda no demo conferidos.
- Pública real carregou seletor da profissional principal no gateway v4. Demo: alternar Juliana/Renata muda configuração; filtro Renata mostra só seus 2 atendimentos e recalcula totais. Nenhuma nova reserva real criada.
- Servidor local iniciado em 127.0.0.1:3000. Publicação do front-end e e-mails Auth seguem pendentes.

## Produto concluído (01/10/2026 — estado mais recente)
- Migração encaixa_product_completion aplicada; fonte supabase/product_completion.sql. Gateway booking v3 publicado. NÃO reaplicar migrações anteriores.
- Substitui link imutável: registro privado studio_addresses reserva endereços atuais/anteriores; trigger suporta criação e edição; booking_page, available_slots_multi e book_appointment_multi resolvem aliases. Campo do painel editável novamente.
- available_dates_multi consulta até 14 dias e retorna três sugestões numa chamada. availability.js e DateSlots usam novo RPC pelo gateway. Permissões só service_role.
- WhatsApp brasileiro obrigatório, e-mail opcional; validações front-end/banco. Sem resposta à pergunta opcional, adotada essa opção com aviso em commentary. Sem verificação de posse/OTP.
- Clients → ClientMerge.jsx permite comparação + confirmação de mesma pessoa. RPC merge_clients só autenticado e valida dono/mesmo estúdio. Preserva atendimentos, pagamentos, observações e cadastro original arquivado (merged_into). Lista filtra arquivados; trigger bloqueia novas reservas para cadastro arquivado. Sem unificação automática ou mudança de clientes reais.
- 13 testes unitários e build passaram. tests/product-completion.sql e booking-readiness.sql passaram no remoto com rollback. Atualizados testes JS de integração para telefone obrigatório, mas suíte completa não reexecutada nesta etapa.
- Navegador confirmou sugestões no gateway v3 para 135 minutos, formulário com e-mail opcional/WhatsApp e revisão de duplicados no demo com comparação de contatos e botão bloqueado até checkbox. Nenhuma reserva ou unificação real foi feita.
- Publicação front-end, URLs/e-mails Auth, validação final externa e opcionais seguem pendentes. Ver CHECKLIST.md atualizado.

## Correções prioritárias (01/10/2026)
- Aplicada migração remota encaixa_booking_readiness; fonte supabase/booking_readiness.sql. NÃO reaplicar.
- manage_booking retorna paid e horizon. Tela usa horizonte real na remarcação e oculta alterações de reservas pagas, explicando contato com estúdio. Erro ao alterar recarrega status. Troca de token limpa estado anterior e descarta resposta obsoleta.
- Link permanente após criação: campo somente leitura, removido do update do painel, trigger no banco impede troca do slug. Nome do estúdio continua editável. Não recupera links trocados anteriormente.
- 12 testes locais passaram, build passou. tests/booking-readiness.sql executado no Supabase com sucesso: registros sintéticos, rollback final; verifica horizonte, pagamento, recusa de cancelamento pago, slug imutável, nome editável, link e RPC restrito. Nenhum registro sintético persistido.
- Cadastros duplicados continuam pendentes: não unir automaticamente contatos não verificados. Melhorias opcionais de eficiência das sugestões continuam pendentes. Hospedagem/publicação e e-mails de acesso ainda dependem de configuração externa.

## Próximos dias disponíveis (01/10/2026)
- DateSlots em booking.jsx sugere até três dias quando a data escolhida está sem horários; availability.js consulta até 14 dias por busca e permite continuar, respeitando o horizonte informado. Usa available_slots_multi existente, sem migração remota.
- Seleção de outro dia/serviços invalida buscas anteriores; falhas de rede têm mensagem própria e tentativa novamente. Sugestões consultam os horários novamente ao selecionar o dia.
- npm test: 10 testes aprovados; npm run build aprovado (avisos existentes de use client no lucide-react).
- Navegador: dois serviços/135 minutos; dia 01/10 sem horários mostrou 02, 03 e 04/10 com primeiro horário 09h. Clique em 02/10 iniciou nova consulta. Nenhuma reserva criada.
- Publicação segue pendente: solicitado ao usuário informar conta de hospedagem/domínio. Nenhum serviço contratado nem publicação efetuada nesta alteração.

## Múltiplos serviços (29/09/2026)
- Implementados seleção de vários serviços no painel/página pública, total e sequência com início/fim, intervalo único após último serviço e alteração de serviços em reserva confirmada não paga.
- Migrações remotas aplicadas: encaixa_multi_service_bookings e encaixa_multi_service_reschedule_fix. Fonte final supabase/multiservice.sql; NÃO reaplicar.
- appointments.service_ids uuid[] e service_items jsonb guardam seleção/snapshots; service_id permanece para compatibilidade. Preço/duração calculados no trigger; catálogo atual não altera reservas antigas ao remarcar. Exclusion GiST continua protegendo todo o intervalo.
- Novos RPCs available_slots_multi e book_appointment_multi são exclusivos de service_role, via gateway booking v2. available_slots_multi aceita token na remarcação e exclui a própria reserva; usa duração original. RPCs antigos continuam disponíveis via gateway.
- src/ServiceSelection.jsx e service-selection.js: seleção, resumo e sequência; main.jsx/booking.jsx/redesign.jsx integrados. Alterar serviços pode ampliar ou reduzir horário; conflito rejeita toda a alteração.
- Validação: 6 testes unitários; 2 integrações reais passaram (legado + múltiplos: concorrência, almoço/fechamento, intervalo único, edição, remarcação com catálogo alterado, pagamento, RLS cruzada e RPC restrito). npm run test:integration roda ambos em sequência com fixture temporária.
- Contas QA temporárias removidas e confirmado zero remanescentes; os 5 agendamentos do usuário foram preservados e receberam snapshots compatíveis. Navegador confirmou 2 serviços/75 min/R$105, sequência 14h–15h15 e liberação às 15h30, além do recálculo da disponibilidade ao remover serviço.

## Redesign confirmado em 29/09/2026
- Usuário confirmou aplicar os 14 HTMLs enviados, mantendo as funções reais e Supabase.
- Referências extraídas em design-references/2026-09-29/01.html–14.html. Não reler o anexo inteiro (132 mil tokens).
- Pares: 01/02 assinatura mobile/desktop, 03 reserva pública, 04 página online administrativa, 05/06 espaço, 07/08 financeiro, 09/10 serviços, 11/12 clientes, 13/14 agenda.
- src/redesign.jsx + src/redesign.css: navegação inferior mobile, faixa semanal, ficha contextual da agenda, bloco de compartilhamento, assinatura/cartão 3D acessível por teclado e toque; movimento reduzido respeitado.
- main.jsx: filtros de clientes, agendamento pela ficha com cliente preenchida, períodos hoje/semana/mês no financeiro, repetir expediente de segunda para dias úteis, acessos de perfil; estilos responsivos em todas as telas.
- booking.jsx: catálogo com descrições, mapa/WhatsApp quando disponíveis, resumo fixo mobile e avanço para horários/dados; reserva continua pelo gateway real.
- Cobrança segue NÃO configurada; cartão é ilustrativo, sem formulário/coleta de cartão/CVV, plano ativo fictício ou faturas inventadas.
- Preservados os dados adicionados pelo usuário (já existem 5 clientes e agendamento adicional em 26/09); não restaurar a fixture de 4 clientes.
- Validação do redesign: build e 4 testes passaram; navegação das 7 telas desktop sem overflow; mobile 390px, filtros, ficha/preenchimento de cliente, cartão 3D por toque/teclado, catálogo público → horários reais de 30/09 → formulário de dados. Nenhuma nova reserva ou alteração de dados foi gravada nos testes visuais.

## Pedido e estado (25/09/2026)
Usuário pediu front-end, back-end e banco funcionais, usando designs locais e Supabase. Pediu este MD primeiro para economizar tokens.
Implementado e validado. Publicação do front-end aguarda escolha da hospedagem (pergunta assíncrona: Vercel / Netlify / local). Conferir a resposta antes de perguntar novamente.

## Executar
- npm run dev → http://localhost:3000 (ativo nesta sessão; porta 5173 também disponível durante os testes).
- npm test; npm run build.
- .env.local configurado, somente URL/chave publicável. Nunca expor service_role.

## Stack e arquivos
- React 19, Vite 8, Supabase JS, Lucide, QRCode. Dependências fixadas; package-lock.
- src/main.jsx: acesso/onboarding/painel/agenda/clientes/serviços/recebimentos/configurações.
- src/booking.jsx: reserva pública, confirmação, token privado, remarcação/cancelamento, ICS.
- src/lib.js: Data API autenticada + gateway público; src/domain.js: utilitários.
- src/MediaUpload.jsx, src/QRButton.jsx, src/styles.css, src/enhancements.css.
- src/demo.js: exemplos locais, sem gravação; rota /#/demo/agenda.
- README.md: operação, arquitetura, publicação e limitações.
- Designs intactos: stitch_encaixa_beauty_scheduling_app/. Já analisados; não reler em massa.

## Supabase real
- Projeto gtqcehwvddvqllicnreu, sa-east-1. Era vazio no início.
- Migrações aplicadas: encaixa_initial, encaixa_booking_gateway, encaixa_indexes, encaixa_media.
- Fontes: supabase/schema.sql, hardening.sql, quality.sql, media.sql. NÃO reaplicar.
- Tabelas: studios, working_hours, services, clients, appointments, payments; todas com RLS por proprietário.
- Exclusão GiST impede sobreposição incluindo limpeza; FKs compostas por estúdio.
- Edge Function booking ACTIVE; supabase/functions/booking/index.ts. Chave pública validada; token para gerenciar reserva; rate limit por hash IP. RPCs privilegiadas só service_role.
- Storage studio-media: fotos públicas; escrita por pasta auth.uid(); JPEG/PNG/WebP até 5 MB.
- Fuso São Paulo; cancelar/remarcar até 2h antes; pagamento manual; painel atualiza a cada 30s/foco.

## Verificado
- Build produção OK; 4 testes unitários OK.
- Integração real: login 2 contas, RLS cruzada, RPC direto bloqueado, concorrência (1 sucesso), almoço, remarcação, cancelamento/liberação, valor do pagamento e dados privados OK.
- Storage: upload do dono, rejeição de outra conta, download público OK.
- Navegador: reserva pública → confirmação → login → reserva na agenda → pagamento e totais atualizados. Desktop e 390px sem overflow horizontal.
- Contas/dados sintéticos removidos; consulta confirmou zero usuários de teste. tests/fixture.sql + integration.test.js/media.test.js + cleanup.sql permitem repetir.
- Advisor: só aviso de proteção contra senhas vazadas desativada, configuração/plano Supabase. Sem avisos remanescentes de RLS/funções expostas.

## Pendências externas — não simular
- Front-end público: conta de hospedagem/domínio. Configs Vercel/Netlify prontas. Atualizar Site URL/Redirect URLs do Auth ao publicar.
- Cobrança recorrente/notas: provedor não informado; tela informa não configurado, sem coleta de cartões.
- E-mail/WhatsApp automático de reservas: provedor não configurado; confirmação real no site + link/ICS; WhatsApp manual. Auth usa e-mails Supabase.
- Sem SMTP próprio; entrega real de e-mails de cadastro não testada. Testes não enviam mensagens.

## Conta solicitada pelo usuário
- Criada conta persistente de teste: teste@encaixa.test; Studio Teste Alan, slug studio-teste-alan.
- 4 clientes/serviços/agendamentos fictícios; 2 recebimentos de exemplo. Não remover com a limpeza de QA.
- Senha entregue na conversa, não gravada em arquivos. Conta usa endereço fictício e já está confirmada.
