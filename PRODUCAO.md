# Minha Clara — preparação para produção

**Atualização de preços — 07/10/2026:** a implementação local atual tem até cinco atendentes: 1=R$29,90; 2–3=R$59,90; 4=R$79,90; 5=R$99,90, proprietário incluído. Ver **PLANOS.md** para regras, testes, migração incremental e configuração dos quatro preços Stripe. As referências a preço único abaixo são históricas. Nada desta atualização foi publicado ou ativado; sandbox Stripe real permanece pendente.

**Deploy visual mais recente — 06/10/2026:** https://encaixa-eta.vercel.app/, Vercel `dpl_CLX7DEbh5fHCSsAwdDVGzgj752FU` READY. Publicados logo Clara, ícone v3 e textos sem PRO, com frase original. Pacote `.local/vercel/clara-visual-only-20261006`, derivado da versão anterior, preserva o comportamento da agenda e todo o backend. **O código local de agendamento ainda depende de migração NÃO autorizada pela revisão automática e NÃO aplicada.** Não publicar o build completo de `src` antes de autorização explícita para essa migração. Detalhes e evidências em `CONTEXTO.md`.

**Marca atual — 06/10/2026:** Clara, sem o sufixo PRO; domínio escolhido `minhaclara.com`; assistente Clara. A frase “Você cuida. A Clara organiza.” e os textos originais foram restaurados a pedido do usuário, com nova logo. A revisão de identidade é local e ainda não foi publicada. A conexão do domínio não foi executada. Os registros de deploy abaixo descrevem versões anteriores.

Revisão local de 06/10/2026. Plano aprovado: **7 dias grátis, depois R$ 29,90 por mês**.

**Estado atualizado:** deploy solicitado e concluído em 06/10/2026 em https://encaixa-eta.vercel.app/ (Vercel `dpl_D9XWG3vgXb3c621raDH14TMoymGw`, READY). Migrações `clara_production_readiness` e `clara_billing_inactive` aplicadas; funções booking v8, clara v11, billing v1 e stripe-webhook v1 publicadas. **Cobrança ainda desativada**, sem início de testes de sete dias, bloqueios ou pagamentos. Não foi criada conta Stripe. A capacidade de 1.000 usuários simultâneos ainda precisa ser medida.

Para publicar sem bloquear contas antes de existir pagamento, `billing_settings.enabled` começa como false e os testes ficam sem data de vencimento. A tela informa que o acesso continua disponível. Depois de configurar e validar Stripe e obter aprovação para ativar a cobrança, o administrador poderá executar `select encaixa_private.activate_billing();`. Essa função não é acessível por usuários do app e concede sete dias completos às contas existentes apenas na primeira ativação. Contas novas começam o teste ao criar seu espaço após a ativação. Não executar antes de concluir os preparativos.

Pacote publicado: `.local/vercel/clara-production-live-20261006`, manifesto SHA-256 ao lado. Ele substitui o rascunho `clara-production-20261006.zip` citado no histórico abaixo. Verificação remota em `.local/deploy-verification.json`: HTML/bundle e cabeçalhos corretos, gateway público operacional e rotas protegidas rejeitando chamadas sem autorização/assinatura. Entrada e demonstração conferidas no navegador sem erros. Nenhuma sessão autenticada estava disponível para repetir o login completo. As pendências de SMTP, Stripe, carga, backup e alertas continuam válidas.

## 1. Entregas e evidências

Verificação final local: **363 testes aprovados, zero falhas**, `npm run build` aprovado. Log: `.local/release-check.log`. Bundle principal: 143,67 kB (42,24 kB gzip), React: 68,25 kB gzip, Supabase: 55,01 kB gzip. Os avisos existentes de `use client` do Lucide não impedem o build desta SPA. Navegador: recuperação de falha de sessão e dados, cadastro com confirmação, pedido de recuperação simulado, tela de nova senha, assinatura vencida em 390 px e expansão de 50 para 53 clientes; sem erros de execução capturados na fixture.

| Pilar | Correção | Evidência local / limite |
| --- | --- | --- |
| Autenticação | Inscrição nos eventos antes de recuperar a sessão, descarte de respostas antigas, recuperação preservada na aba, confirmação de senha e tentativa novamente | Testes de sessão atrasada, saída, falha e recuperação; formulário verificado no navegador. Entrega de e-mail real depende de SMTP/URLs |
| Segurança de senhas | Mantido Supabase Auth; aplicação não guarda nem calcula hashes de senha | Supabase usa bcrypt com salt. Política mínima de senha também precisa ser configurada no servidor |
| Consultas | Paginação por cursor de 500 registros, leitura única compartilhada e revisão por estúdio | Teste com 1.203 registros; resposta antiga não substitui leitura após gravação |
| Atualização do painel | Consulta leve de revisão a cada 55–65 s; para em abas ocultas/offline; recarrega os dados somente se mudaram | 1.000 painéis estáveis geram aproximadamente 17 verificações/s, em vez de aproximadamente 200 consultas completas/s no fluxo anterior. Estimativa, não benchmark |
| Índices | Cinco índices de chaves estrangeiras ausentes, índices para cursores e histórico de cliente | Migração executada em PostgreSQL local; planos e tempos remotos precisam ser medidos na homologação |
| Falhas | Prazos para rede e SDK, erros legíveis, recuperação de carregamento, proteção contra cliques duplicados, tela alternativa para erro de renderização | Testes de rede parada, corpo de resposta travado e erros técnicos; telas com nova tentativa |
| Assinatura | Checkout e portal Stripe, eventos assinados, deduplicação e sincronização serializada por cliente | Rotas executadas com respostas simuladas; SQL real em PostgreSQL local. Checkout Stripe real ainda não testado |
| Controle de acesso | Teste de 7 dias por proprietário, bloqueio de gravações de negócio/novas reservas após expirar, consulta preservada | Testes de vencimento, pagamento, cancelamento, repetição e isolamento. Recriar o estúdio não reinicia o teste |
| Imagens | Cinco imagens da marca/Clara convertidas para WebP; ícone reduzido e versionado | 7.425.214 → 399.488 bytes, redução de 94,6%. Originais preservados |
| Cache e scripts | Cache anual só nos arquivos versionados, HTML revalidado, bibliotecas separadas e QR Code sob demanda | Build local; cabeçalhos precisam de verificação após publicação |
| Dependências | Atualizada a dependência vulnerável encontrada na auditoria | `npm audit` sem vulnerabilidades reportadas nesta revisão; não equivale a auditoria completa do produto |

Arquivos principais: `src/session.js`, `src/network.js`, `src/dashboard-data.js`, `src/ErrorBoundary.jsx`, `src/Subscription.jsx`, `src/main.jsx`, `src/booking.jsx`, `supabase/production_readiness.sql`, `supabase/billing.sql`, funções `billing`, `stripe-webhook`, `booking` e `clara`, `vercel.json`.

A demonstração continua intencionalmente separada. O cartão de assinatura ilustrativo foi removido; a tela agora consulta o estado real. Sem configuração do provedor, a tela informa a indisponibilidade, sem inventar assinatura ou faturas.

## 2. Autenticação e sessão — configuração obrigatória

No projeto de homologação, depois no de produção com aprovação:

1. Configurar **Site URL** e **Redirect URLs** com a origem HTTPS exata. O código envia `location.origin` no cadastro/recuperação. Localhost só é necessário no ambiente de desenvolvimento; não permitir curingas amplos na produção.
2. Ativar confirmação de e-mail e SMTP próprio; validar domínio, remetente e entrega em caixas reais de teste. O provedor padrão não deve ser tratado como solução de envio para 1.000 usuários.
3. Exigir no servidor no mínimo 8 caracteres; habilitar proteção de senhas vazadas se disponível no plano. A auditoria remota encontrou essa proteção desativada. Não foi alterada.
4. Definir limites de cadastro/login/recuperação conforme o uso esperado e avaliar CAPTCHA para cadastro público sob abuso. Não diminuir limites só para passar o teste de carga.
5. Verificar cadastro → confirmação → configuração do espaço → saída → login → recarga da página → renovação de token → recuperação por e-mail → nova senha. Testar link expirado, reutilizado e aberto em outro dispositivo; testar duas abas e troca de conta.
6. O token fica no mecanismo de sessão do SDK para esta SPA. A chave publicável é pública por definição; `service_role`, chaves Stripe e Groq ficam somente no servidor. A autorização é imposta no banco, não pela interface.

Referências: [segurança de senhas](https://supabase.com/docs/guides/auth/password-security), [eventos de sessão](https://supabase.com/docs/reference/javascript/auth-onauthstatechange), [redirecionamentos](https://supabase.com/docs/guides/auth/redirect-urls).

## 3. Assinatura: começar sem CNPJ

A Stripe documenta cadastro brasileiro como **pessoa física com CPF**; CNPJ é opcional nessa modalidade. A conta bancária deve corresponder ao CPF cadastrado e o provedor verifica os dados. O titular deve fazer o cadastro e fornecer os documentos diretamente à Stripe; não colocar CPF, dados bancários ou chaves secretas neste repositório ou no chat.

Fonte: [informações da Stripe para abrir conta no Brasil](https://support.stripe.com/questions/brazil-specific-information-to-open-a-stripe-account?locale=pt-BR).

### Comportamento implementado

- Após ativar a cobrança, os sete dias começam ao criar o espaço, sem cartão. Contas existentes recebem sete dias completos na ativação; publicar a migração sozinha não inicia o prazo.
- A contratação é oferecida ao terminar o teste, por cartão, R$ 29,90/mês. Não há débito automático antes de a pessoa contratar.
- Sem assinatura ativa, o histórico continua consultável/exportável; gravações de negócio, novas reservas e a IA são bloqueadas. Cancelamentos permitidos pelas regras anteriores continuam possíveis.
- Acesso pago só é concedido pelo estado confirmado do provedor, com fatura paga e validade futura. Voltar do checkout não ativa o plano por si só.
- Cancelamento programado preserva o período pago. Depois do término, a tela permite contratar novamente e consultar faturas anteriores.
- Nenhum dado de cartão passa pelo app. A Stripe hospeda pagamento, faturas e cancelamento.
- A mensalidade é o valor bruto cobrado; taxas do provedor não foram descontadas nem estimadas no código.

### Configurar e testar

1. Criar a conta Stripe e usar o ambiente de teste/sandbox.
2. Criar produto Minha Clara e **preço recorrente mensal de 2.990 centavos, BRL, quantidade 1**. Sem período grátis na Stripe, pois ele já é controlado pelo app. Copiar o `price_id` de teste.
3. Ativar/configurar o portal do cliente para faturas, atualização do pagamento e cancelamento ao final do período. Não habilitar troca livre de preços/quantidades; só há um plano implementado.
4. Criar endpoint `https://<projeto-homologacao>.supabase.co/functions/v1/stripe-webhook`, versão de eventos/API **2025-04-30.basil**, com `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid` e `invoice.payment_failed`.
5. Nos segredos das Edge Functions, cadastrar:

| Segredo | Valor / finalidade |
| --- | --- |
| `BILLING_MODE` | `test` nesta etapa; ausência também assume teste |
| `STRIPE_SECRET_KEY` | Chave `sk_test_…` do ambiente de teste |
| `STRIPE_PRICE_ID` | Preço de teste `price_…`, BRL 29,90/mês |
| `STRIPE_WEBHOOK_SECRET` | Assinatura `whsec_…` daquele endpoint |
| `APP_ORIGIN` | Origem HTTPS exata do front-end de homologação |
| `APP_PUBLISHABLE_KEY` | Chave publicável do mesmo Supabase usado no build |
| `GROQ_API_KEY` / `GROQ_MODEL` | Manter a configuração da Clara, com limites adequados ao tráfego |

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` são fornecidos pelo ambiente das funções. Não criar variáveis `VITE_` para segredos.

6. Testar assinatura após vencimento de um teste sintético, autenticação adicional de cartão, pagamento recusado, reenvio de webhook, eventos fora de ordem, renovação, falha de renovação, cancelamento e recontratação. Confirmar atualização da tela ao voltar do checkout/portal.
7. Só ativar cobrança real após esses testes e nova aprovação. Produção exige **seu próprio** preço, chave live, endpoint/segredo live e `BILLING_MODE=live`. Não reutilizar IDs de teste nem apenas trocar a chave.

Os eventos são assinados com HMAC e tolerância de 5 minutos. Uma trava por cliente serializa consulta ao estado atual da Stripe e gravação; eventos repetidos não reativam períodos antigos. Falhas devolvem HTTP 503 para repetição do provedor. A trava expira em 60 segundos para permitir recuperação.

Referências: [webhooks](https://docs.stripe.com/webhooks), [API de assinaturas fixada nesta integração](https://docs.stripe.com/api/subscriptions/update?api-version=2025-04-30.basil).

## 4. Banco e conexões

Inspeção remota somente de leitura em 06/10: PostgreSQL 17.6, `max_connections=60`, limites por requisição de 3 s para `anon` e 8 s para `authenticated`/`authenticator`. Base ainda pequena; os números atuais não medem capacidade sob carga.

O navegador e as funções usam HTTPS/Data API. **1.000 pessoas não devem abrir 1.000 conexões PostgreSQL.** PostgREST usa um pool compartilhado, gerenciado pela plataforma. Não elevar `max_connections` ou o pool para 1.000. Nesta arquitetura não há configuração de pool PostgreSQL por navegador a adicionar ao código.

Antes de alterar o pool, medir conexões ativas, espera, CPU, memória, disco, latência e filas. A documentação do Supabase orienta reservar conexões para os serviços da plataforma; se houver futuramente acesso SQL direto, usar Supavisor em modo transação/porta 6543 para serviços efêmeros. Com Data API intensa, um eventual pool manual de acesso direto deve começar conservador (até cerca de 40% do limite: 24 de 60), e não como configuração universal. Nenhum ajuste remoto de pool foi feito.

Os novos índices usam `lock_timeout=3s` para abortar sem aguardar indefinidamente. Na base pequena, a migração é transacional. Em base grande, criar os mesmos índices com `CONCURRENTLY` fora de transação e só depois instalar funções/triggers. Usar `EXPLAIN (ANALYZE, BUFFERS)` com dados sintéticos representativos, não em gravações reais.

As leituras do painel não truncam mais em 1.000 linhas, mas **o primeiro carregamento ainda consulta o histórico inteiro por estúdio em páginas de 500**. Há um teto explícito de 100 mil linhas por coleção, com erro em vez de resultado parcial. Isso não significa que 100 mil linhas tenham desempenho aprovado. Testar estúdios pequenos e grandes; se ultrapassarem os critérios, será necessário paginar por tela/período e calcular resumos no banco antes da liberação para esse volume. O limite comercial de volume deve se basear no teste, não no teto técnico.

Referências: [gerenciamento de conexões](https://supabase.com/docs/guides/database/connection-management), [pools e limites](https://supabase.com/docs/guides/database/connecting-to-postgres/pooling-and-limits).

## 5. Homologação e capacidade para 1.000 usuários

### Ambiente

Usar Supabase e front-end separados, com dados sintéticos e Stripe de teste. Não executar carga na produção atual. Os testes de escrita e carga bloqueiam o projeto de produção conhecido. Hospedagem/plano/compute devem ser equivalentes aos pretendidos para produção; ensaio local não certifica a infraestrutura remota.

Para uma instalação vazia, aplicar as migrações históricas listadas no README, incluindo `custom_links.sql`, `clara.sql`, `clara_reschedule.sql` e `clara_dialogue.sql`, na ordem registrada, depois as novas abaixo. No projeto existente, **não reaplicar as históricas**.

### Testes locais

```sh
npm ci
npm run check:release
npm audit
```

`npm test` não escreve no Supabase real: cobre regras, diálogo, rede, sessão, carregamento, assinatura e migrações em PostgreSQL/PGlite local. As funções de cobrança são executadas com `fetch` simulado. PGlite não substitui o teste da versão PostgreSQL gerenciada, PostgREST, SMTP ou Stripe.

Fixture visual isolada: `http://localhost:3000/.local/production-qa.html?mode=auth-failure`, modos `auth`, `recovery`, `expired`, `data-failure` e padrão. Ela bloqueia chamadas externas e usa cadastros sintéticos. Nunca enviar `.local` ou `tests` no pacote publicado.

### Integração real, somente em homologação

Preparar `tests/fixture.sql` no projeto de teste. Criar `.local/staging.env` com URL/chave publicável de homologação, uma variável por linha, sem aspas. No PowerShell:

```powershell
$env:TEST_ENV_FILE = '.local/staging.env'
$env:ALLOW_STAGING_TESTS = 'yes'
npm run test:integration
node --test tests/media.test.js
```

Executar os roteiros SQL de equipe/remarcação/diálogo com dados de teste e rollback; remover exclusivamente as contas sintéticas com `tests/cleanup.sql` nesse projeto. Nunca executar esse cleanup contra contas reais.

### Carga

O roteiro `tests/load/1000-users.js` requer k6 e **1.000 estúdios/contas de teste distintos**. Preparar um JSON local com `access_token`, `studio_id` e `slug` por conta, sem versionar os tokens. Criar as contas sem enviar e-mails e obter sessões antes da medição; tokens devem durar o ensaio inteiro. Usar volumes representativos, incluindo estúdios com mais de 1.000 clientes/agendamentos.

Variáveis: `ALLOW_STAGING_LOAD=yes`, `LOAD_API_ORIGIN`, `LOAD_APP_ORIGIN`, `LOAD_PUBLISHABLE_KEY`, `LOAD_USERS_FILE`. Executar:

```sh
k6 run --summary-export .local/load-summary.json tests/load/1000-users.js
```

Rampa: 100 usuários em 2 min, 500 em mais 3 min, 1.000 em mais 5 min, sustentação de 15 min, descida em 2 min. Cada usuário carrega o painel e consulta revisão a cada 55–65 s; mudanças provocam nova leitura paginada. Mede HTTP e banco, não renderização/CPU do navegador.

Tráfego público adicional pode ser habilitado com `LOAD_PUBLIC_FRACTION`. O padrão é 0 porque todos os usuários de um gerador compartilham IP e seriam limitados corretamente. Usar geradores distribuídos para medir visitantes; não desativar a proteção. Rodar separadamente uma mistura representativa de cadastros, reservas/remarcações, consultas de disponibilidade e pagamentos manuais, além do teste de colisão no mesmo horário. **O roteiro de leitura isolado não certifica o caminho de escrita ou IA.**

Critérios de aceitação iniciais:

- Menos de 1% de falhas inesperadas; p95 HTTP abaixo de 1,5 s e p99 abaixo de 3 s na carga descrita.
- Nenhum vazamento entre contas, reserva dupla ou estado financeiro inconsistente. Recusas legítimas de conflito/rate limit devem ser classificadas, não ocultadas.
- Sem esgotamento de conexões, filas crescentes ou reinícios. CPU, memória e disco sustentados com margem (investigar acima de 70–80% conforme a métrica/compute).
- Login/cadastro/recuperação continuam funcionando durante carga. Renovação de sessão e webhook não são prejudicados.
- Interface utilizável em celular de 390 px; conferir console sem erros, ausência de overflow e tamanho/tempo dos recursos.
- Repetir após qualquer mudança de infraestrutura ou consulta motivada pelo ensaio; anexar resultado, tamanho do banco, plano contratado e configuração de pool.

A Clara mantém o limite existente de 30 perguntas com IA por dia/conta e agora limita rajadas a 20 requisições/minuto/conta. A disponibilidade da IA depende das cotas da Groq. Não presumir que o plano gratuito atende 1.000 usuários; dimensionar a cota e testar 429/timeout separadamente. Nenhuma consulta de cliente/financeiro é enviada ao modelo: permanece a autorização de enviar a pergunta e até quatro perguntas anteriores.

## 6. Ordem de ativação e publicação

Somente depois de aprovação do usuário, homologação aprovada e configuração de cobrança concluída:

1. Confirmar backup e recuperação em ambiente separado, registrar release anterior e janela de alteração. Conferir referências do Supabase e Vercel.
2. Aplicar **`supabase/production_readiness.sql`** uma vez e verificar permissões/revisões/índices.
3. Aplicar **`supabase/billing.sql`** uma vez. A cobrança permanece desativada até `encaixa_private.activate_billing()`. No projeto atual, essa migração já foi aplicada; não reaplicar.
4. Publicar `booking`, `billing`, `stripe-webhook` e `clara`, com os segredos do ambiente. `verify_jwt=false` é intencional: as funções fazem autenticação de usuário, chave pública ou assinatura conforme seu propósito.
5. Validar webhook/assinatura em sandbox; para produção, confirmar preços/chaves live e repetir o fluxo autorizado de ativação do serviço.
6. Gerar um build com as duas variáveis públicas corretas. Publicar somente `dist` e os `headers` de `vercel.json` no pacote compilado. Nunca `.env`, fontes, testes, `.local` ou chaves privadas. O script `scripts/deploy-vercel.ps1` publica em produção e **não deve ser executado sem pedido/aprovação**.
7. Conferir respostas de cache/CSP/HSTS no domínio, página pública, autenticação, dados do painel, assinatura e a Clara. Em Vercel Drop, usar configuração de pacote compilado sem comandos de build. A política nova de cabeçalhos foi preparada para Vercel; se escolher Netlify, portar e validar antes.
8. Liberar gradualmente e acompanhar erros/latência. Meta de 1.000 só recebe status aprovado com o relatório de carga.

O front-end novo usa `dashboard_revision` e `billing_status`: **não publicar isoladamente antes das migrações**. Até a aplicação aprovada do SQL, o painel autenticado local apontado ao banco antigo também pode informar falha; usar a fixture ou um projeto de homologação atualizado para validar esta versão completa.

Pacote compilado preparado localmente: `.local/vercel/clara-production-20261006.zip` (2.229.837 bytes), com o front-end e os cabeçalhos, sem fontes/segredos/testes. A pasta correspondente pode ser usada como `PackageDirectory` do script, somente após aprovação e as etapas anteriores. Manifesto SHA-256: `.local/vercel/clara-production-20261006-manifest.json`. As migrações e funções permanecem nos arquivos-fonte do projeto e precisam de publicação separada. O ZIP aponta para o Supabase atual; homologação exige outro build com as variáveis daquele ambiente.

## 7. Operação, monitoramento e reversão

- Acompanhar Supabase/Vercel: HTTP 5xx/429, tempo das funções, falhas Auth, conexões, CPU, memória, disco, queries lentas e espaço do Storage. Criar alertas após autorização; não há monitor externo contratado/configurado nesta revisão.
- Acompanhar entrega/repetição de webhooks Stripe e estado dos pagamentos. Logs devem conter categoria/identificador de operação, sem tokens, perguntas, telefones, dados bancários ou dados de cartão.
- Validar backups automáticos, retenção e restauração; decidir RPO/RTO e recursos do plano com base no negócio. Nenhum ensaio de restauração remota foi realizado aqui.
- Guardar pacote anterior do front-end e versões anteriores das funções. Em regressão visual, reverter o pacote; migrações de índices/revisão podem permanecer.
- Em incidente de cobrança, suspender novas contratações pelo provedor/configuração, manter processamento dos eventos necessários e investigar. Não apagar tabelas de cobrança, IDs Stripe ou eventos para “resetar” o problema. Voltar só o front-end não remove os bloqueios da migração de assinatura; qualquer reversão do banco exige roteiro revisado e aprovado.
- Falha de rede ao gravar pode significar que a gravação já foi concluída. O app não repete gravações automaticamente e orienta atualizar antes de repetir. Reservas usam as restrições de conflito no PostgreSQL; cobrança usa idempotência e eventos assinados.

## Pendências para declarar produção aprovada

1. Conta Stripe PF/CPF, plano e portal configurados; ciclo real em sandbox validado.
2. SMTP e URLs de Auth; confirmação/recuperação/renovação de sessão verificadas no ambiente hospedado.
3. Migrações/funções testadas no Supabase de homologação, incluindo Storage e política de isolamento.
4. Teste de carga representativo, leitura e escrita, com relatório aprovado e orçamento de infraestrutura/IA definido.
5. Backup/restauração, alertas e aprovação expressa antes da publicação.
