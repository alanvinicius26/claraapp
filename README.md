# Minha Clara

**Correção visual publicada:** a marca visível é **Clara**, sem o antigo sufixo, com nova logo profissional. Por pedido do usuário, a frase **“Você cuida. A Clara organiza.”**, os textos anteriores, a personagem, as cores e o layout foram restaurados/preservados. Publicada em https://encaixa-eta.vercel.app/, deploy `dpl_CLX7DEbh5fHCSsAwdDVGzgj752FU`. O pacote visual foi derivado da versão anterior de produção e preserva as regras da agenda. O build completo local depende da migração de agendamento ainda não aprovada/aplicada. Domínio `minhaclara.com` comprado segundo o usuário, ainda não conectado. Prompts e assets em `design-references/clara/logo/clara-logo-v2.md`.

**Domínio e e-mails — 07/10/2026:** domínio `minhaclara.com` conectado à Vercel por DNS na Hostinger, com HTTPS validado; `www` redireciona ao endereço principal. Detalhes em `DOMINIO.md`. Falta criar a conta Brevo e configurar SMTP/URLs de autenticação, reenvio e entrega de e-mails. Instruções locais da Edge Function Clara não foram republicadas no deploy visual. Os nomes anteriores abaixo são histórico.

**Agendamentos — revisão local de 06/10/2026:** a auditoria, as correções e os testes estão em [AUDITORIA_AGENDAMENTOS.md](AUDITORIA_AGENDAMENTOS.md). Nova migração `scheduling_integrity.sql` ainda não publicada: protege também salas/macas e torna expediente/almoço obrigatórios no banco, inclusive no painel. As observações históricas abaixo que permitem agendamento manual fora do expediente deixam de valer após essa migração. A publicação depende de aprovação.

Aplicativo de gestão para profissionais de beleza, baseado nos designs originais em `stitch_encaixa_beauty_scheduling_app/`.

## Preparação para produção — 06/10/2026

**Atualização:** deploy autorizado e concluído em https://encaixa-eta.vercel.app/. Banco e funções atualizados, cobrança mantida desativada até a configuração da Stripe. A publicação não iniciou os sete dias de teste nem bloqueou contas. Ver o estado atual no início de PRODUCAO.md; os parágrafos seguintes registram a preparação anterior à publicação.

Consulte **[PRODUCAO.md](PRODUCAO.md)** para o plano atual, evidências de teste, configuração de assinatura (sete dias grátis e R$ 29,90/mês), ordem de migrações, carga de 1.000 usuários e critérios de liberação. As alterações desta revisão são **locais**, ainda não publicadas. A capacidade de 1.000 usuários não foi certificada; depende do teste em homologação. Publicação exige aprovação expressa do usuário.

Novas migrações pendentes, nesta ordem: `supabase/production_readiness.sql` e `supabase/billing.sql`. Também precisam ser publicadas as versões locais de `booking`, `clara`, `billing` e `stripe-webhook`. Não publicar apenas o front-end antes do banco. O restante deste documento inclui histórico de versões anteriores.

## Iniciar

Requer Node.js 24.x (fixado em `package.json`; validado com Node 24).

```sh
npm install
npm run dev
```

Abra o endereço indicado pelo terminal. O arquivo `.env.local` deste computador já contém a URL e a chave **publicável** do Supabase conectado. Em outro ambiente, copie `.env.example` para `.env.local` e preencha a chave publicável. Nunca coloque uma chave secreta ou `service_role` no front-end.

Crie sua conta, confirme o e-mail quando solicitado e configure seu estúdio. Depois cadastre os serviços, ajuste o expediente e compartilhe seu link em **Agendamento online**. A demonstração é separada e usa dados fictícios, sem gravar no banco.

## Implementado

- React 19 + Vite: login, cadastro, recuperação de senha e configuração inicial.
- Agenda diária: criar, concluir, remarcar, cancelar e bloquear horários.
- Clientes: cadastro, edição, observações internas e histórico.
- Serviços: preço, duração, categoria, foto e arquivamento.
- Recebimentos manuais: Pix, cartão, dinheiro, filtros mensais e CSV protegido contra fórmulas.
- Estúdio: foto, endereço, apresentação, link, expediente, almoço, antecedência, janela de reservas e intervalo de limpeza.
- Página pública: disponibilidade real, reserva, confirmação, calendário ICS e link privado para cancelar/remarcar.
- Compartilhamento no WhatsApp e geração local de QR Code.
- Supabase Auth, PostgreSQL com RLS, Storage de fotos e Edge Function `booking` publicados.

## Arquitetura e regras

O painel autenticado usa a Data API com políticas de propriedade por `auth.uid()`. Nenhuma tabela de clientes ou de agenda é acessível anonimamente.

As reservas públicas passam pela Edge Function `booking`, que valida a chave publicável do aplicativo, limita requisições e chama apenas quatro operações permitidas. A chave publicável identifica o aplicativo, não autentica pessoas. O token aleatório da reserva funciona como credencial para gerenciá-la. Operações privilegiadas do banco só são executáveis pelo back-end.

Uma constraint de exclusão PostgreSQL impede sobreposição, inclusive em requisições simultâneas. A ocupação inclui a duração do serviço e o intervalo de limpeza. Reserva e cadastro de cliente acontecem na mesma transação. As regras públicas usam o fuso `America/Sao_Paulo`; cancelamento/remarcação até duas horas antes. Agendamentos manuais podem ocorrer fora do expediente, mas nunca sobrepor outros horários.

Pagamentos registram o valor histórico do atendimento. Reservas pagas não são canceláveis pelo link público. O painel local consulta uma revisão a cada 55–65 segundos, quando visível e online, e ao recuperar o foco; só recarrega os dados se necessário. A disponibilidade pública é consultada novamente na confirmação.

## Banco e funções

Projeto: `gtqcehwvddvqllicnreu` (São Paulo). Fontes das migrações já aplicadas, em ordem:

1. `supabase/schema.sql` — tabelas, políticas, triggers e RPCs.
2. `supabase/hardening.sql` — gateway público e limites de requisições.
3. `supabase/quality.sql` — índices e política interna.
4. `supabase/media.sql` — imagens e políticas do Storage.
5. `supabase/multiservice.sql` — vários serviços por reserva; inclui a correção remota da consulta de remarcação.
6. `supabase/booking_readiness.sql` — retorno do pagamento e horizonte na gestão pública; proteção do link permanente no banco.
7. `supabase/product_completion.sql` — substitui o link fixo por endereços anteriores preservados; unificação revisada de clientes, consulta de datas por período e WhatsApp obrigatório/e-mail opcional. Gateway `booking` atualizado para a versão 3.
8. `supabase/team.sql` — profissionais, expedientes individuais, conflitos por profissional e compatibilidade com chamadas antigas. Gateway `booking` atualizado para a versão 4.

## Equipe e agendas independentes

Em **Equipe**, adicione profissionais e configure os sete dias de expediente, incluindo pausa de almoço. Até salvar o expediente individual, a profissional segue os horários do salão em Meu espaço. Depois de salvar, o expediente fica independente. Todas usam o mesmo catálogo de serviços, valores e regras de antecedência/limpeza do salão.

Na agenda, filtre uma profissional ou veja todas. Ao criar um agendamento ou bloqueio, selecione a profissional; bloquear uma agenda não bloqueia as demais. A remarcação no painel permite transferir um atendimento confirmado e não pago, respeitando os conflitos de quem vai recebê-lo. A cliente escolhe a profissional no link público; suas sugestões de datas e horários usam essa agenda. A remarcação pública mantém a profissional original.

A migração vinculou os atendimentos anteriores à profissional principal sem alterar seus horários, valores ou serviços. Profissionais inativas deixam de receber novas reservas públicas, mantendo seu histórico. A conta do salão administra a equipe; acessos individuais, permissões por funcionária e divisão de um único atendimento entre profissionais não fazem parte desta versão.

`tests/team.sql` valida atendimentos simultâneos entre profissionais, rejeição de sobreposição para a mesma profissional, bloqueios, expediente próprio, sugestões, remarcação, pagamentos e RLS com dados sintéticos revertidos ao final.

## Vários serviços no mesmo atendimento

Em **Novo agendamento**, selecione a cliente e marque os serviços na ordem de realização. O resumo soma os valores, mostra o início/fim de cada serviço e aplica o intervalo do estúdio só depois do último. Na página pública, a cliente também pode escolher vários serviços; só aparecem horários que comportam toda a sequência, incluindo o intervalo final, sem invadir almoço, fechamento ou outra reserva.

Na ficha de um atendimento confirmado sem pagamento, use **Ver detalhes e gerenciar → Ajustar serviços** para adicionar/remover serviços, ou **Remarcar** para mudar o início. Ampliações em conflito são recusadas sem alterar a reserva anterior. A alteração da seleção usa os preços/durações atuais; uma simples remarcação preserva o que foi reservado. Reservas antigas continuam válidas, com seus valores e duração originais.

`supabase/functions/booking/index.ts` contém o back-end publicado. Não reaplique esses arquivos no projeto existente; já constam no histórico remoto. Novas alterações devem ser feitas por novas migrações.

## Validação

```sh
npm test
npm run build
```

Os testes de integração usam apenas contas sintéticas e exercitam login, isolamento entre dois estúdios, concorrência de reservas, pausa de almoço, remarcação, cancelamento, pagamento e Storage. Para repetir, prepare `tests/fixture.sql` em um projeto de teste, execute `npm run test:integration` e `node --test tests/media.test.js`, depois execute `tests/cleanup.sql`. Não use dados reais nesses testes.

## Publicação

Frontend publicado em **https://encaixa-eta.vercel.app/** em 02/10/2026. Projeto `encaixa` na conta Vercel `bertunesinc-3931`; [painel](https://vercel.com/bertunesinc-3931/encaixa). Produção por Vercel Drop, com arquivos compilados e headers de segurança. URL e chave publicável do Supabase incorporadas no build; nenhum arquivo `.env` enviado.

Esta publicação não está conectada a Git. Alterações locais não são publicadas automaticamente. Para atualizar, faça um novo build para produção, empacote somente o conteúdo de `dist` e um `vercel.json` contendo os `headers` (sem `buildCommand`, `outputDirectory` ou `framework`, pois o pacote já está compilado), e envie no painel do projeto existente. Pacote usado: `.local/vercel/encaixa.zip`. Se migrar para build remoto, configure as duas variáveis `VITE_SUPABASE_*` no projeto Vercel.

Pendente: definir `https://encaixa-eta.vercel.app` como Site URL no Supabase, incluir esse endereço em Redirect URLs preservando os endereços locais necessários e validar e-mails reais. O painel Supabase pediu login e essa alteração ainda não foi feita.

A página pública sugere até três próximos dias quando não há espaço para os serviços no dia escolhido. Cada busca consulta no máximo 14 dias em uma chamada ao gateway (`available_dates_multi`); “Buscar mais datas” continua até o limite da agenda. A seleção de uma sugestão consulta os horários novamente; a confirmação continua validada no banco.

Os links individuais usam o endereço em que o aplicativo foi aberto (`/#/booking/slug`). Para enviar às clientes, acesse o painel pelo endereço público HTTPS antes de copiar o link ou baixar o QR Code. Links de localhost são apenas para desenvolvimento. Cada conta administra um salão com agendas independentes por profissional. O endereço pode mudar em Meu espaço: os anteriores continuam abrindo o catálogo e permitindo reservas, e outro estúdio não pode usá-los. Endereços perdidos antes do registro de aliases não são recuperados automaticamente.

Na reserva pública, WhatsApp brasileiro com DDD é obrigatório e e-mail é opcional. Validamos o formato, sem confirmar posse do número. Novas reservas não são associadas automaticamente a pessoas existentes por contatos não verificados. Em Clientes → Revisar cadastro duplicado, a profissional compara os dois registros e confirma a unificação. Os atendimentos e observações passam ao cadastro principal; contatos do principal e pagamentos são preservados. O original fica arquivado no banco, sem exclusão. Não há desfazer pelo painel. `tests/product-completion.sql` testa aliases, contatos, busca por período e unificação com isolamento entre estúdios em transação revertida.

A remarcação usa o horizonte configurado no estúdio. Reservas pagas mostram uma orientação para falar com o estúdio e não oferecem alterações públicas. Se a situação mudar enquanto a página estiver aberta, uma tentativa recusada consulta novamente a reserva. `tests/booking-readiness.sql` valida o contrato no banco com registros sintéticos em uma transação revertida ao final.

Há configurações prontas para Vercel (`vercel.json`) e Netlify (`netlify.toml`). Comando: `npm run build`. Pasta publicada: `dist`. Configure as mesmas variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` no ambiente de build.

No Supabase → Authentication → URL Configuration, defina o domínio publicado em **Site URL** e permita esse domínio e o endereço local em **Redirect URLs**. Isso é necessário para os links de confirmação de conta e recuperação de senha. O endereço local padrão usado por projetos Supabase é `http://localhost:3000`; o script do aplicativo usa essa porta.

## Integrações que dependem de configuração externa

### Configuração de publicação e previews

O build valida `VITE_SUPABASE_URL` (origem HTTP/HTTPS) e `VITE_SUPABASE_PUBLISHABLE_KEY` (chave `sb_publishable_`). Variáveis ausentes, placeholders e chaves secretas impedem o build. Configure ambas em cada ambiente Vercel e faça um novo build após alterá-las. Não use `service_role` nem `sb_secret_` em variáveis `VITE_`.

O Vercel fornece `VERCEL_ENV` e `VERCEL_TARGET_ENV`. Em previews e ambientes personalizados, copiar links de catálogo/reserva, gerar QR Code e compartilhar o catálogo pelo WhatsApp ficam bloqueados. A visualização do catálogo continua disponível. Compartilhe com clientes apenas pelo endereço público de produção. Localmente, os links continuam disponíveis para testes; não os envie às clientes. Ao usar `vercel build` seguido de `vercel deploy --prebuilt`, preserve as variáveis do ambiente de destino durante o build; não promova um artefato de preview para produção, pois o bloqueio é definido no build.

O gateway agora lê `APP_PUBLISHABLE_KEY` dos secrets da Edge Function no Supabase. **Antes de publicar esta versão de `booking`**, configure esse secret com a mesma chave publicável usada pelo frontend. Sem ele, a função recusa iniciar. Configure separadamente em cada projeto (produção e teste); ao trocar a chave, sincronize backend e frontend. O fallback para a chave legada `SUPABASE_ANON_KEY` permanece. Nenhuma chave administrativa vai para o navegador.

O build do Vercel publica somente o frontend. A função `booking` e as migrações pertencem ao Supabase; não reaplique as migrações existentes. Para um projeto novo, prepare seu schema e gateway antes de apontar o preview para ele. Use um projeto de teste nos previews para não alterar dados reais. Configure Site URL/Redirect URLs no Supabase para o domínio final e previews autorizados; valide confirmação e recuperação de senha por e-mail após publicar.

Referências: [variáveis no Vite](https://vite.dev/guide/env-and-mode), [Node no Vercel](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions) e [redirecionamentos do Supabase](https://supabase.com/docs/guides/auth/redirect-urls).

- Hospedagem pública e domínio: dependem da conta/provedor escolhido. O banco e a Edge Function já estão online.
- Assinatura recorrente, checkout e notas: ainda não há provedor de pagamentos vinculado. A tela informa isso e não coleta cartões nem simula cobranças.
- E-mail/WhatsApp automático de reservas: não configurado. A confirmação real ocorre no site; a cliente pode salvar o link e o calendário. WhatsApp abre uma conversa para envio manual. E-mails de acesso à conta usam o Supabase Auth.
- O advisor do Supabase aponta a proteção contra senhas vazadas como desativada no projeto. Sua ativação depende das configurações e do plano do Supabase: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection.

Leia `CONTEXTO.md` primeiro ao retomar o trabalho para evitar releitura dos designs e economizar tokens.
