# Clara — atendimento completo

> **STANDBY desde 14/10/2026.** O serviço está escondido dos usuários. Sem `VITE_WHATSAPP_ENABLED=true` no build, o menu/página "Conversas WhatsApp" e a autorização na reserva não existem no pacote, e a reserva pública continua usando `book_appointment_team`. O simulador local (`npm run whatsapp:sim` + `npm run dev:whatsapp`) liga o serviço só no modo de desenvolvimento. Para reativar: aplicar `whatsapp.sql`, `whatsapp_operations.sql` e `whatsapp_waha.sql` na ordem documentada, publicar as funções `booking` e `whatsapp` e, por último, gerar o frontend com `VITE_WHATSAPP_ENABLED=true`.

Estado em 13/10/2026: código, banco local, painel e workflows montados. O fluxo local está ativo; o oficial está importado e **inativo**, aguardando configuração/homologação na Meta. Nenhum envio real, cadastro Meta, migração remota ou deploy foi executado. O bloqueio 130497 continua fora do escopo. Este documento substitui, nos pontos alterados, o estado da primeira entrega em `WHATSAPP-N8N.md`.

## Provedor WAHA (20/10/2026, só local)

Decisão do usuário em 20/10: o WAHA (WhatsApp HTTP API) entra como **adaptador**, reaproveitando inbox, fila, autorizações, trava humana e testes. A Meta continua disponível. Nada foi aplicado em produção. O WAHA usa o WhatsApp Web, que é **não oficial**: o risco de banimento do número de cada estúdio continua existindo e não depende só do código. As travas abaixo reduzem o comportamento de robô, mas não substituem a API oficial.

- **Migração** `supabase/whatsapp_waha.sql`, depois de `whatsapp_operations.sql`. Ela só acrescenta colunas, restrições, gatilhos e funções, sem apagar dados.
- **Canal:** `whatsapp_settings.phone_number_id = 'waha:<sessão>'`, onde a sessão tem de 1 a 64 caracteres entre `A-Z a-z 0-9 _ -`, com `mode='live'`. A coluna `provider` (`meta` ou `waha`) é calculada a partir do canal. Por enquanto a plataforma configura o canal por SQL; não há tela.
- **Webhook** `POST /functions/v1/whatsapp/waha`: exige HMAC-SHA512 (`X-Webhook-Hmac` + `X-Webhook-Hmac-Algorithm: sha512`) com `WAHA_WEBHOOK_SECRET` de pelo menos 32 caracteres e só funciona em `WHATSAPP_MODE=live`. A sessão assina `message.any` (mensagens recebidas **e** enviadas pelo próprio número) e `message.ack`; `message` também é aceito, mas nunca com `fromMe`. Só conversas diretas entram; grupos, transmissões e outros eventos recebem 200 `ignored`. O evento é convertido para o envelope do inbox, sem o id e a hora de entrega do WAHA, então uma reentrega gera a mesma chave SHA-256. A segunda camada continua sendo o `in:<id da mensagem>`.
- **Idempotência:** inbox `event_key` único → `whatsapp_messages unique(studio_id,dedupe_key)` → resposta `reply:<id>` única. Uma mensagem repetida nunca gera uma segunda resposta.
- **Atendimento** (`whatsapp_conversations.status`, em vez de uma tabela nova):
  - `TRIAGEM`: menu do robô.
  - "2/atendente" → `AGUARDANDO_ASSUNTO`: o robô envia um único aviso pedindo o assunto e fica pausado.
  - A próxima mensagem da cliente vira `resumo_duvida` (até 500 caracteres, sem IA) e a conversa passa para `FILA_HUMANO`.
  - Encerrar no painel → `FINALIZADO`; a próxima mensagem da cliente volta para `TRIAGEM`.
  - A dona responde **pelo próprio celular** → `FILA_HUMANO` na hora (ver "Mensagens digitadas no celular").
  - Uma restrição garante `mode='human'` ⇔ status `AGUARDANDO_ASSUNTO`/`FILA_HUMANO`. Um gatilho mantém as duas colunas em sincronia: funções antigas gravam `mode`, as novas gravam `status`.
- **FILA_HUMANO (decisão de 21/10):** o webhook responde 200 e só registra a mensagem da cliente. Ficam pausados apenas o **menu** e o **link de agendamento**: o robô não conversa por cima da equipe. Os avisos de reserva (**confirmação, remarcação, cancelamento e lembrete**) **saem normalmente**, porque esperar o fim do atendimento fazia esses avisos vencerem. Para eles continuam valendo a janela das 08h às 20h, o `SAIR` e a autorização da reserva. A resposta manual da dona e o aviso de encaminhamento também saem.
- **Mensagens digitadas no celular (`fromMe`, decisão de 21/10):** chegam pelo `message.any` e passam por `public.whatsapp_echo`.
  - **Eco da Clara:** tudo o que a Clara envia também volta como `fromMe` e é ignorado. Reconhece pela chave `waha:<CHAVE>`, ou, quando o eco chega antes de o envio ser registrado, pelo texto de uma mensagem da Clara dos últimos 10 min (sem o endereço do site nos links). Se a mensagem estava como resultado incerto, ela passa a "aceita".
  - **Resposta da equipe:** gravada como `team_phone` no histórico. A conversa vai para `FILA_HUMANO` na hora e o menu/link pendentes são cancelados.
  - **Só conversas que a cliente abriu:** o número (ou o `@lid`) precisa já existir em `whatsapp_conversations`. Conversas pessoais do celular nunca são gravadas nem criam conversa.
  - **`@lid`:** quando a cliente escreve por um id oculto, ele fica em `whatsapp_conversations.wa_lid`, e a resposta da dona para esse id encontra a conversa. Sem número nem `@lid` conhecido, a mensagem é descartada.
  - **Fim da pausa:** se foi a dona que assumiu pelo celular, o robô volta sozinho **12 h depois da última mensagem da equipe** (`human_until`, conferido quando a cliente escreve de novo). Se foi a cliente que pediu atendente ("2"), a pausa continua até alguém encerrar, como antes.
- **SAIR (decisão de 21/10):** desliga os avisos, revoga a autorização e envia **uma única** resposta: "Pronto! Você não vai mais receber avisos automáticos de {estúdio} por aqui. Se precisar, é só escrever." Ela sai na hora, porque é resposta a quem acabou de escrever e não entra na janela. Um novo `SAIR` não gera outra (chave `optout:<conversa>`, só quando a conversa ainda não estava desativada). Não há reativação.
- **Janela 08h00–19h59 (São Paulo)** para mensagens ativas: confirmação, remarcação, cancelamento, lembrete e retomada por modelo. Respostas a quem acabou de escrever não entram na janela.
  - O lembrete é **adiantado** para 19h30 do último período permitido (gatilho `whatsapp_reminder_hours`). Se esse horário já passou, o lembrete é cancelado com `outside_hours`.
  - No envio real (`live`), `whatsapp_claim` segura a mensagem fora da janela até as 08h; se isso cair depois do atendimento, ela é cancelada. Uma confirmação de madrugada sai às 08h.
  - O worker confere de novo pelo próprio relógio (`functions/whatsapp/hours.js`, espelho do SQL) e devolve a mensagem com `deferred`.
  - A simulação não espera a janela, para os testes locais não dependerem do relógio.
  - Confirmação e lembrete seguros juntos até as 08h saem nessa ordem.
- **Texto do horário:** a cliente lê "(horário de Brasília)" no texto livre e nos rascunhos dos modelos da Meta (`integrations/whatsapp/templates.json`). O cálculo continua em `America/Sao_Paulo`, único fuso aceito por `whatsapp_settings.timezone`.
- **Envio WAHA:** `POST /api/sendSeen` → `/api/startTyping` → pausa de 1 a 4 s proporcional ao texto → `/api/sendText` (`linkPreview: false`), com `X-Api-Key`. Visto e "digitando" são cortesia: se falharem, o envio segue normalmente e nunca é repetido. Respostas: 201 com id = aceito; 429 = nova tentativa; 5xx, tempo esgotado ou 201 sem id = incerto (sem reenvio automático); outros 4xx = falha `waha_<status>`.
- **Sem disparo em massa:** não existe rota para lista ou campanha. Toda mensagem ativa precisa da autorização daquela reserva (`whatsapp_consents`) e o "SAIR" continua valendo. Sem modelos aprovados, a dona não consegue retomar uma conversa depois de 24 h.
- **Testes:** `tests/whatsapp-waha.test.js` cobre webhook duplicado e reentregue, assinatura, eventos ignorados, recibo, FILA_HUMANO sem nenhuma requisição, 03h sem envio (no banco e no worker), lembrete adiantado e cancelado, e paridade SQL/JS minuto a minuto. Desde 21/10 cobre também:
  - os 4 avisos de reserva saindo em `FILA_HUMANO`, enquanto o menu fica parado;
  - "(horário de Brasília)" no texto;
  - `SAIR` respondido uma vez, mesmo às 03h;
  - eco da Clara ignorado, pela chave e na corrida;
  - resposta pelo celular gravada, conversas pessoais descartadas e `@lid`;
  - volta do robô após 12 h.

  Nada usa rede. Um teste de mutação desligando cada regra faz os testes falharem.
- **Contato identificado por `@lid` (visto em 21/10 com WAHA real):** o WhatsApp entrega conversas diretas com `from: "<id>@lid"`, sem o número. O número vem em `_data.Info.SenderAlt` (`<número>@s.whatsapp.net`, motor GOWS) ou em `_data.key.remoteJidAlt` (NOWEB), e é isso que `wahaEvent` usa. Um `@lid` sem número, ou de grupo, é ignorado.
- **Recibos de outras conversas:** o WAHA envia `message.ack` de **todas** as conversas do celular conectado. Em 21/10 chegaram 179 assim, gravados e depois apagados do banco local. O executor local agora só aceita recibos das conversas permitidas. **Antes de produção**, `whatsapp_receipt` precisa descartar recibos que não correspondem a uma mensagem enviada pela Clara (hoje ela guarda todos, para casar com recibos que chegam antes da resposta).
- **Id das mensagens (visto em 21/10 com GOWS):** o `sendText` devolve `true_<número>@c.us_<CHAVE>`, e o recibo da mesma mensagem chega como `true_<lid>@lid_<CHAVE>`. Só a chave é estável, então `wahaKey` grava as duas como `waha:<CHAVE>`, e o recibo passa a casar com a mensagem enviada.
- **A conferir com WAHA real:** se a mensagem digitada no celular para uma conversa `@lid` traz o número (`RecipientAlt`/`remoteJidAlt`) ou só o id oculto; se o texto do eco da Clara chega idêntico ao enviado; no motor WEBJS, `tagsEventsOn` para receber `message.ack`; e quantas vezes o WAHA reentrega um webhook que falhou. Em 21/10, uma entrega perdida durante um reinício voltou sozinha; para produção, convém configurar mais tentativas.

### Teste local com WAHA real (`npm run waha:local`)

- **O que sobe:** o container `clara-waha` (`devlikeapro/waha:gows-2026.9.2`, motor GOWS, sem navegador) em `127.0.0.1:3001`, com painel e Swagger desligados e sessões no volume `clara-waha-sessions`. Também sobe a página/webhook local em `127.0.0.1:8788` (configuração `clara-waha-local` em `.claude/launch.json`).
- **Banco isolado:** PGlite em `.local/waha-test/database`, com as migrações na ordem e o estúdio "Clara — Teste WAHA" (expediente das 08h às 21h). O script **não lê `.env.local` nem conecta ao Supabase**. Ele roda o mesmo `createHandler`, a mesma fila e o mesmo `wahaSender` da Edge Function, em modo `live`.
- **Segredos de teste** (chave da API e HMAC) ficam em `.local/waha-test/config.json` e `waha.env`. São gerados na primeira execução e nunca impressos.
- **Lista de números permitidos** (`"allow"` no `config.json`): mensagens de qualquer outro número são descartadas antes de gravar, e o envio para qualquer outro número é recusado (`not_in_test_allowlist`). Com a lista vazia, nada é respondido. Isso protege os contatos reais caso o celular conectado seja um número em uso.
- **Página local** (aceita só Host 127.0.0.1/localhost; POST só da própria origem): mostra o QR code, o estado da sessão, a janela 08h–20h, a criação de reserva de teste com autorização (início e lembrete configuráveis) e as conversas com status, assunto, recibos e erros. Também permite encerrar o atendimento e responder como atendente.
- **Links nas mensagens** usam `https://teste-local.minhaclara.invalid`, porque o modo `live` exige HTTPS. Eles não abrem; servem só para conferir o texto.
- **Precisa de dois celulares:** o número de teste, conectado ao WAHA pelo QR, e o celular da "cliente", que vai na lista. O WAHA ignora mensagens enviadas pelo próprio número.
- **Recomeçar do zero:** parar o script, apagar `.local/waha-test/database` e, se quiser trocar o número, `docker rm -f clara-waha` + `docker volume rm clara-waha-sessions`.
- **Verificado em 20/10, sem celular conectado:**
  - O container chega ao webhook pelo endereço `host.docker.internal`.
  - Sem assinatura ou com assinatura errada: 401. Recibo assinado: gravado. O mesmo recibo de novo: `duplicate`.
  - Número fora da lista: ignorado. QR: PNG servido.
  - Host falso ou POST de outro site: 403.
- **Verificado em 21/10 com dois celulares reais** (conectado final 9351; clientes final 4330 e depois final 7431):
  - `Oi` → menu; `1` → link de agendamento; `2` → um único aviso pedindo o assunto (`AGUARDANDO_ASSUNTO`).
  - A mensagem seguinte vira o assunto (`resumo_duvida`) e a conversa passa para `FILA_HUMANO`. As mensagens depois dela ficam só registradas: nenhuma resposta automática e nenhuma chamada ao WAHA.
  - A resposta da atendente pela página é entregue, com recibo. "Encerrar" leva a `FINALIZADO`, e um novo "Oi" logo depois não repete a saudação.
  - Reserva criada às 19h52 para 08h00 do dia seguinte:
    - a confirmação ficou pendente enquanto a conversa estava em `FILA_HUMANO` (regra existente: avisos automáticos esperam o fim do atendimento) e foi entregue assim que o atendimento foi encerrado;
    - o lembrete de 07h45 foi cancelado (`outside_hours`): ele seria adiantado para 19h30 da véspera, que já tinha passado.
  - `SAIR` marca a conversa como `opted_out`, revoga a autorização e cancela os envios pendentes **sem responder nada** (comportamento original).
  - Recibos "entregue" e "lido" casam com as mensagens depois de `wahaKey`.
  - Mensagens de grupos e de outras conversas do celular conectado foram descartadas pelo filtro do teste.
  - As mensagens digitadas no celular conectado não entravam no histórico.
  - Os 4 pontos levantados (confirmação durante o atendimento, texto do fuso, resposta ao `SAIR`, mensagens `fromMe`) foram decididos e implementados no mesmo dia; ver as regras acima. Falta repetir o roteiro com o celular.

## Fluxo da cliente

```mermaid
flowchart TD
    A[Cliente escreve no WhatsApp do estabelecimento] --> B[Clara valida assinatura e salva o evento]
    B --> C[n8n inicia o processamento]
    C --> D{Estado da conversa}
    D -->|Humano| E[Registrar mensagem no painel; bot pausado]
    D -->|Automático| F{Escolha da cliente}
    F -->|Início ou menu| G[Saudação com botões]
    F -->|Agendar| H[Link específico do estabelecimento]
    F -->|Atendente| I[Confirmar encaminhamento e pausar bot]
    F -->|SAIR| J[Revogar notificações e responder uma vez]
    H --> K[Reserva e autorização opcional]
    K --> L[Confirmação na fila]
    K --> M[Lembrete no horário configurado]
    K --> N[Remarcação ou cancelamento atualiza a fila]
    E --> O[Proprietário responde pelo painel]
    O --> P[Encerrar atendimento retoma o bot]
    L --> Q[Conferir consentimento, janela, modelo e duplicidades]
    M --> Q
    N --> Q
    Q --> R[Adaptador oficial ou simulado]
    R --> S[Recibos autenticados atualizam o histórico]
```

O menu oficial usa botões `Agendar` e `Falar com atendente`; os textos `1`, `2`, `agendar`, `atendente` e `menu` também funcionam. A confirmação de encaminhamento humano é enviada uma única vez por transição; depois, as respostas automáticas (menu e link) aguardam o encerramento. Com a migração `whatsapp_waha.sql`, os avisos de reserva (confirmação, remarcação, cancelamento e lembrete) passam pela fila humana e saem normalmente, sempre com janela, autorização e `SAIR`. A saudação não se repete a cada mensagem. O sistema mantém as regras de reservas, recursos, profissionais, fuso, consentimento, prazo dos lembretes e estados de envio da implementação anterior.

## O que está instalado no n8n

| Workflow | ID | Estado nesta instalação |
| --- | --- | --- |
| Clara — Atendimento completo [LOCAL] | `ClaraFullLocal01` | Publicado/ativo, apenas servidor simulado |
| Clara — Atendimento completo [OFICIAL] | `ClaraFullLive01` | Importado, inativo, URL do Supabase atual preparada; função/credencial aguardando publicação/configuração |
| Clara — Fila de confirmações e lembretes [SIMULAÇÃO] | `ClaraWaQueueSim01` | Preservado e despublicado; substituído pelo completo |
| Clara — Cliente inicia conversa [SIMULAÇÃO] | `ClaraWaInboxSim01` | Preservado, manual |
| Fluxo inicial informado pelo usuário | `fWw0sNDvnpUn1Vr1` | Preservado, sem alterações nesta entrega |

Cada workflow completo possui:

1. **Iniciar operação**: acionamento manual de manutenção.
2. **Verificação a cada minuto**: recuperação periódica e vencimento de notificações.
3. **Acordar com novo evento**: webhook autenticado, sem dados da cliente; reduz a espera quando chega uma mensagem.
4. **Receber e encaminhar atendimentos**: consome a entrada persistente na Clara, interpreta escolhas, pausa humana e recibos.
5. **Enviar respostas e notificações devidas**: processa a fila usando as regras da Clara e a credencial daquele estabelecimento.
6. **Verificar pendências e falhas**: consulta contadores operacionais, sem conteúdo/telefones.
7. **Precisa de atenção?**: decide se há falhas, resultados incertos ou eventos de entrada atrasados.
8. **Registrar incidente sem dados pessoais**: abre/atualiza um incidente persistente, evitando criar um incidente repetido a cada ciclo.
9. **Ciclo concluído**: encerra a execução.

Há também uma nota explicando a arquitetura no próprio canvas. As regras de conversa ficam no banco/servidor da Clara para que o botão manual, o webhook e o relógio não possam tomar decisões contraditórias. O n8n orquestra etapas reais; não faz consultas diretas às tabelas nem recebe credenciais dos estabelecimentos.

Importação: `integrations/n8n/clara-atendimento.local.json` e `clara-atendimento.oficial.json`. Ambos são exportados inativos. `npm run whatsapp:workflows` gera todos os arquivos; `scripts/configure-n8n-operations.ps1` importa os dois novos na instalação Docker local sem reimportar os antigos. O local reaproveita a credencial Header Auth já cadastrada.

## Conexão por estabelecimento

O painel **Conversas WhatsApp → WhatsApp do estabelecimento** inclui preparar a conexão, continuar na Meta, reconectar, conferir modelos aprovados e desconectar. O botão fica desabilitado quando a plataforma ainda não configurou os requisitos, em vez de simular uma conexão bem-sucedida.

O cadastro usa o SDK oficial/Embedded Signup; o servidor autentica o JWT Supabase, confere o proprietário, cria uma sessão de dez minutos com uso único e limita tentativas. A conclusão troca o código no servidor, verifica aplicativo e permissões do token, confere que o número pertence à WABA autorizada, assina seus eventos e salva a conexão. O cliente nunca fornece um token permanente ao frontend/n8n.

Cada token é cifrado com **AES-256-GCM**, nonce aleatório e vínculo criptográfico ao `studio_id`. Os registros ficam no schema privado sem acesso de `anon`/`authenticated`; a chave mestra fica nos segredos da Edge Function. O envio consulta a credencial por estabelecimento **e número**, sem recorrer a uma credencial global. Repetir/cancelar/substituir o cadastro não permite concluir uma sessão antiga. Um número não pode ser vinculado a dois estabelecimentos.

Conectar não ativa automaticamente mensagens: o estabelecimento fica pausado até revisar registro/modelos/configuração. Trocar/reconectar o canal cancela mensagens ainda pendentes e limpa a configuração de modelos para nova conferência. Desconectar desativa a fila e apaga o token cifrado da conexão, mantendo histórico; também invalida cadastros em andamento. O vínculo do aplicativo na Meta pode ser revogado pelo proprietário nas configurações de sua empresa. A Clara não desregistra o número nem remove uma assinatura de WABA compartilhada por outros números.

Para número novo no fluxo padrão Cloud API, há uma ação separada de registro, com PIN de seis dígitos informado pelo proprietário e não armazenado. Não executamos essa ação. O caminho de coexistência com o aplicativo WhatsApp Business é opcional e permanece desligado; sua disponibilidade depende da conta/permissões da Meta e precisa de homologação específica. A implementação exige retorno de WABA e número; não presume qual número escolher se a Meta retornar apenas a conta.

**Conferir modelos aprovados** consulta a Meta e aceita os nomes `clara_confirmation_v1`, `clara_reminder_v1`, `clara_reschedule_v1`, `clara_cancellation_v1` e `clara_human_followup_v1`, em `pt_BR`, aprovados como utilidade. Os quatro primeiros exigem exatamente seis parâmetros de corpo; a retomada é estática. Componentes extras/incompatíveis são rejeitados. A Meta determina a aprovação/categoria; modelos não encontrados continuam bloqueados. Rascunhos: `integrations/whatsapp/templates.json`.

## Entrada persistente e endpoints

O webhook oficial confirma o recebimento **depois** de salvar o evento assinado na inbox do banco. Falha de banco devolve erro para a Meta repetir. A repetição do mesmo corpo é deduplicada por SHA-256, e os IDs de mensagem/recibo também são deduplicados ao processar envelopes diferentes. Cada evento é transacional; um evento inválido não reverte outro. Há até cinco tentativas de entrada, com recuo, antes de registrar falha para investigação. Esse limite é separado das quatro tentativas controladas da fila de saída.

Novas rotas sob `/functions/v1/whatsapp`:

| Rota | Autenticação / finalidade |
| --- | --- |
| `POST /connection` | JWT Supabase do proprietário + `studio_id`; ações `status`, `begin`, `complete`, `register`, `templates`, `disconnect`. CORS restrito a `APP_ORIGIN`. Nunca retorna token. |
| `POST /inbox` | Bearer da ponte n8n; processa até 30 envelopes pendentes do modo atual. |
| `POST /health` | Mesmo Bearer; retorna contadores de fila, falhas, entradas atrasadas e solicitações humanas. |
| `POST /incident` | Mesmo Bearer; registra/atualiza incidente operacional sem PII. |
| `POST /process` | Mesmo Bearer; processa entradas antes das saídas. Se modo live estiver sem liberação de envio, bloqueia antes de reivindicar saídas. |
| `GET/POST /webhook` | Verificação de desafio e assinatura Meta; entrada live pode funcionar com envio ainda desabilitado. |

`N8N_WAKE_URL` é opcional: após persistir o evento, a Edge Function tenta acordar o n8n em segundo plano, com Bearer e corpo vazio. Se o n8n estiver fora do ar, a inbox permanece; o relógio recupera o trabalho. Não há garantia de processamento instantâneo durante indisponibilidade. Confirmar assinatura/recibo continua sendo responsabilidade da Clara.

Falhas/incertezas de saída continuam visíveis no histórico. O `/health` considera somente falhas definitivas da última hora (mensagens e eventos de entrada); sem novas falhas, o incidente é encerrado e o registro histórico permanece. Números brasileiros recebidos da Meta sem o nono dígito (55+DDD+8 dígitos iniciados por 6–9) são tratados como o mesmo celular com o 9, inclusive para SAIR. Unificar cadastros mantém confirmação/lembrete somente quando o cadastro principal tem o mesmo número autorizado; número diferente ou ausente invalida a autorização. Incidentes globais são registros operacionais privados, consumidos pelo fluxo/operador; não disparam e-mail/WhatsApp externo. Não há reenvio automático de resultado incerto. Para investigar uma falha de entrada, localizar o evento privado, corrigir a causa e só então planejar uma repetição controlada; não apagar provas de consentimento nem reabrir toda a fila.

## Configuração para produção

1. Homologar/publicar as dependências existentes de agenda, `whatsapp.sql`, depois **`whatsapp_operations.sql`** e por último **`whatsapp_waha.sql`** (status do atendimento e janela 08h–20h valem também para a Meta). A segunda migração adiciona tabelas/funções e amplia uma constraint para a confirmação de encaminhamento; não remove dados. Publicar funções `booking`/`whatsapp` antes do frontend. Nenhuma migração remota foi executada aqui.
2. Concluir a configuração/verificações da Clara como Tech Provider, aplicativo/permissões e configuração de Embedded Signup na Meta. Conferir domínios HTTPS permitidos e a configuração efetivamente liberada para o aplicativo. O cliente autoriza sua conta no fluxo oficial; a Clara não pede senha do Facebook.
3. Configurar os segredos abaixo e webhook HTTPS público da Clara na Meta. Habilitar o onboarding somente após a configuração e revisão. Conectar o estabelecimento, concluir registro se necessário e sincronizar modelos aprovados.
4. O workflow **OFICIAL** já aponta os quatro nós HTTP para `https://gtqcehwvddvqllicnreu.supabase.co/functions/v1/whatsapp`, projeto atual da Clara; a função nova ainda não foi publicada. Para homologação em outro projeto, trocar a origem nesses quatro nós (ou gerar com `CLARA_WHATSAPP_BASE_URL`). Criar credencial Header Auth `Clara — ponte oficial` com `Authorization: Bearer <segredo da ponte>` e vinculá-la aos quatro nós HTTP e ao webhook de despertar.
5. Se usar despertar imediato, disponibilizar o webhook **n8n de produção** por HTTPS e configurar `N8N_WAKE_URL` com sua URL `/webhook/clara-operations`. Não usar `/webhook-test/`. A Meta sempre chama o webhook da Clara. Se o n8n continuar só no computador, pode operar pelo relógio consultando a função pública, sem expor o n8n.
6. Resolver o erro 130497 fora desta implementação. Validar em homologação login, retorno de WABA/número, token, registro, modelos, assinaturas e recibos reais. O SDK/Graph precisam ser homologados com a configuração da conta, pois não havia credenciais Meta utilizáveis nesta entrega.
7. Só na liberação autorizada, usar `WHATSAPP_MODE=live`, `WHATSAPP_LIVE_ENABLED=true`, habilitar o estabelecimento e publicar o workflow oficial. Há travas independentes; nenhuma delas foi ativada nesta entrega.

O servidor não usa mais `META_ACCESS_TOKEN` compartilhado. A chave de criptografia deve ter backup seguro: trocar seu valor sem recifrar os tokens exige reconectar estabelecimentos. Nunca coloque segredos em `VITE_*` ou nos JSONs dos workflows.

| Variável | Uso |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Servidor Supabase, como antes. |
| `APP_PUBLISHABLE_KEY` | Gateway `booking`, já existente. |
| `APP_ORIGIN` | Origem HTTPS pública da Clara, sem caminho, também usada em CORS. |
| `CLARA_N8N_SECRET` | Segredo da ponte, mínimo 32 caracteres aleatórios; servidor e credencial n8n. |
| `WHATSAPP_MODE` | `simulation` ou `live`. |
| `WHATSAPP_LIVE_ENABLED` | Liberação explícita do envio; começa `false`. |
| `META_APP_ID`, `META_SIGNUP_CONFIG_ID` | IDs públicos de configuração, fornecidos pelo servidor ao SDK quando habilitado. |
| `META_APP_SECRET`, `META_VERIFY_TOKEN` | Segredos da aplicação/webhook. |
| `META_GRAPH_VERSION` | Versão suportada, a conferir na homologação. |
| `META_ONBOARDING_ENABLED` | Libera o cadastro de números; começa `false`. |
| `META_SIGNUP_COEXISTENCE` | Opção de coexistência, começa `false`; validar elegibilidade antes de usar. |
| `WHATSAPP_TOKEN_ENCRYPTION_KEY` | 32 bytes aleatórios em 64 caracteres hexadecimais; exclusivamente servidor. |
| `N8N_WAKE_URL` | Opcional; URL HTTPS do webhook autenticado do workflow completo. |
| `WAHA_URL` | Somente WAHA: endereço do servidor (HTTPS; HTTP só para `localhost`, `127.0.0.1` e `host.docker.internal`). |
| `WAHA_API_KEY` | Somente WAHA: valor do `WAHA_API_KEY` do servidor, com no mínimo 16 caracteres; exclusivo do servidor. |
| `WAHA_WEBHOOK_SECRET` | Somente WAHA: chave HMAC do webhook (`hmac.key` no WAHA), com no mínimo 32 caracteres. |

Exemplo sem segredos: `integrations/whatsapp/server.env.example`. As variáveis públicas `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` e o modo local continuam como documentados na primeira entrega.

## Endereços locais e verificação

Iniciar com `npm run whatsapp:sim` e `npm run dev:whatsapp`. Painel: `http://127.0.0.1:3000/#/demo/conversas`. n8n: `http://localhost:5678/workflow/ClaraFullLocal01`. Os nós no container acessam `http://host.docker.internal:8787`; o servidor no Windows acorda o n8n em `http://127.0.0.1:5678/webhook/clara-operations-local`. São endereços diferentes porque `localhost` dentro do container é o próprio container.

O botão de entrada local também grava na inbox persistente e acorda o fluxo completo. Para desligar o servidor local, despublique o workflow LOCAL para evitar erros de conexão. O OFICIAL permanece inativo.

Verificações: **468 testes** da aplicação aprovados, **5 testes de concorrência** em PostgreSQL nativo aprovados, build aprovado (avisos antigos Lucide). Cobertura inclui token cifrado/vínculo ao estabelecimento, adulteração, autorização, sessão única/expirada, desconexão durante cadastro, replay de webhook, falha isolada com tentativas limitadas, incidente único, credencial por número, botões, pausa humana e filas concorrentes. Workflow completo executado com sucesso no n8n; entrada → encaminhamento humano → confirmação simulada → pausa conferidos no painel. Cadastro Meta/envio/entrega real ainda não foram homologados.

## Fontes consultadas

As regras de janela de atendimento, modelos e cobrança permanecem as da [política oficial](https://business.whatsapp.com/policy) e da [página de preços](https://business.whatsapp.com/products/platform-pricing). Não há franquia presumida de mil mensagens, nem HTTP aceito apresentado como entregue.

Contratos consultados na coleção oficial da Meta: [números de uma WABA](https://www.postman.com/meta/whatsapp-business-platform/request/86mq7mn/get-phone-numbers), [registro do número](https://www.postman.com/meta/whatsapp-business-platform/request/zb2u18b/register-phone) e [assinatura de eventos da WABA](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api?entity=request-13382743-eb9a6721-1056-4db2-b00a-2290e04b5b5d). O [guia oficial da Twilio](https://www.twilio.com/docs/whatsapp/isv/tech-provider-program/integration-guide) foi usado para conferir o contrato do SDK/retorno do Embedded Signup; nenhuma dependência ou conta Twilio foi adicionada. As páginas técnicas diretas da Meta responderam 429; a configuração final deve ser conferida no App Dashboard durante a homologação. Não se pressupõe que uma conexão simulada substitua a aprovação da Meta.
