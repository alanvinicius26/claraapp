# E-mails da Clara — 07/10/2026

## Configuração concluída

- Conta Brevo criada pelo usuário, acesso disponível no navegador.
- Domínio `minhaclara.com` autenticado pela Brevo; confirmação explícita “Your domain has been authenticated”.
- Remetente `Clara <nao-responda@minhaclara.com>` criado e **Verified**, DKIM do domínio e DMARC configurados. Este é um endereço de envio; não foi criada caixa de entrada.
- Supabase `gtqcehwvddvqllicnreu`: Site URL alterada de `http://localhost:3000` para `https://minhaclara.com`; Redirect URLs agora contém exatamente `https://minhaclara.com`.
- Nenhum deploy, migração SQL ou alteração de cobrança nesta etapa. Usuário testou o cadastro e informou que o e-mail de confirmação funcionou.

## Registros adicionados à Hostinger

Os três registros do site foram preservados. Todos os registros novos usam TTL 300.

| Tipo | Nome | Valor |
| --- | --- | --- |
| TXT | @ | brevo-code:3004b9d3df5a5f31ca7855ead7ca3b02 |
| CNAME | brevo1._domainkey | b1.minhaclara-com.dkim.brevo.com |
| CNAME | brevo2._domainkey | b2.minhaclara-com.dkim.brevo.com |
| TXT | _dmarc | v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com |

A primeira tentativa de autenticação mostrou propagação parcial; a tentativa posterior confirmou autenticação. Não adicionar registros SPF ou MX inventados: não foram solicitados pela Brevo.

## SMTP conectado — 07/10/2026

Usuário confirmou a verificação do telefone em 07/10/2026 e autorizou explicitamente criar a chave SMTP e salvá-la no Supabase com “Confirmado, pode ser!”. A antiga aba SMTP ainda solicitava telefone; recarregá-la resolveu o estado desatualizado.

Chave **Clara Supabase Auth**, variante Standard, criada e confirmada **Active**. Lista da Brevo mostra vencimento em **06/10/2027** (o formulário de criação mostrava um ano). A interface também informa expiração após 90 dias de inatividade. Renovar antes do vencimento. Valor transferido diretamente pelo navegador para o campo Password do Supabase, sem impressão em logs ou gravação no projeto. Não foi criada chave de API.

Configuração SMTP do Supabase **salva e conferida após recarregar**:

- Remetente: `nao-responda@minhaclara.com`, nome `Clara`.
- Host: `smtp-relay.brevo.com`, porta 587.
- Intervalo mínimo: 60 segundos.
- Login: usuário SMTP específico da conta Brevo.
- Senha: chave **SMTP** armazenada pelo Supabase e exibida como senha oculta após salvar.

Após recarregar, o toggle de SMTP permaneceu ligado, servidor/porta/remetente preservados, mensagem de senha armazenada e Save changes desativado: a configuração foi persistida. Campos de remetente, usuário e senha aparecem vazios na leitura DOM protegida, embora preenchidos na interface; foram conferidos visualmente. Não concluir que houve falha de preenchimento apenas por essa leitura. A interface informa limite inicial de 30 e-mails/hora após habilitar SMTP. Plano Brevo exibiu 300 e-mails/dia.

Usuário informou que o e-mail de confirmação funcionou no teste de cadastro em 07/10/2026. Resultado confirmado pelo usuário, sem inspeção da caixa de entrada pelo agente. Recuperação usa o mesmo SMTP, mas o fluxo de link/troca de senha ainda não foi validado; usuário decidiu testar depois. Não repetir pedido de destinatário ou disparar testes sem nova solicitação.

Avisos de vencimento/pagamento ainda não estão implementados. A integração atual é SMTP para Supabase Auth. O webhook Stripe sincroniza estado da assinatura/faturas, sem chamadas de envio de e-mail à Brevo; também não há rotina de aviso antecipado de fim do teste/vencimento. Cobrança continua desativada conforme configuração anterior. Esses avisos exigem integração própria entre regras/eventos de cobrança e envio transacional, com templates e prevenção de duplicatas. A pergunta do usuário sobre avisos não autoriza ativar cobrança ou publicar mudanças.

Modelo atual de confirmação foi consultado, sem edição: assunto “Confirm your email address”, corpo padrão em inglês com `{{ .ConfirmationURL }}`. Tradução/identidade visual dos templates ainda não foram aplicadas. A autorização desta etapa cobre SMTP; não equivale a autorização de deploy do frontend ou migrações.

## Reenvio no frontend — somente local

`src/main.jsx` adiciona entrada “Reenviar e-mail” no login, formulário de confirmação sem senha e reenvio nas telas de confirmação/recuperação. Usa `supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo: location.origin } })` para confirmação e o endpoint de recuperação para senha. Resposta genérica preserva privacidade; intervalo de 60 segundos e bloqueio de requisições simultâneas evitam cliques repetidos. Falhas permitem tentar novamente.

Fixture `tests/production-ui-fixture.js` intercepta reenvio e bloqueia rede externa; `?mode=auth-resend-failure` simula falha apenas na primeira tentativa. Build passou, assim como 14 testes existentes de sessão/rede/configuração de deploy. Evidências em `.local/clara-email-build.log` e `.local/clara-email-tests.log`. Teste de navegador confirmou falha amigável, nova tentativa, resposta genérica e botão desabilitado por 60 segundos, sem envio real.

**Não publicar o `dist` atual:** ele também contém mudanças de agendamento não autorizadas. O pacote visual publicado continua `.local/vercel/clara-visual-only-20261006`. Preparar pacote isolado do Auth a partir da produção antes de pedir autorização de deploy; não aplicar a migração de agendamento para liberar reenvio.

Referências: [SMTP do Supabase](https://supabase.com/docs/guides/auth/auth-smtp), [URLs de retorno](https://supabase.com/docs/guides/auth/redirect-urls), [SMTP da Brevo](https://help.brevo.com/hc/en-us/articles/7924908994450-Send-transactional-emails-using-Brevo-SMTP).
