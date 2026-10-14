# Clara + n8n + WhatsApp — implementação local

> **Atualização posterior, 13/10/2026:** o fluxo completo e a conexão individual dos estabelecimentos foram implementados em [WHATSAPP-ATENDIMENTO.md](WHATSAPP-ATENDIMENTO.md). A fila simples abaixo foi despublicada e substituída por `ClaraFullLocal01`; o token global foi substituído por credenciais cifradas por estabelecimento. As seções abaixo registram a primeira entrega e o roteiro original de simulação.

Estado em 13/10/2026: percurso implementado e testado em **simulação**. Nenhum envio real, credencial Meta, migração remota ou deploy foi executado. O erro 130497 não foi investigado. As mudanças anteriores do projeto foram preservadas.

## Projeto e responsabilidades

- Interface: React 19 + Vite 8; painel existente, rotas por hash e página pública de reservas.
- Banco/autenticação: PostgreSQL/Supabase + Supabase Auth. `studios.owner_id = auth.uid()` define o proprietário; filhos usam `studio_id`, RLS e referências compostas para impedir cruzamento de estabelecimentos. Nesta versão, profissionais cadastrados não ganham acesso de operador: a permissão continua sendo a do proprietário existente.
- Agenda: `appointments.starts_at/ends_at` são `timestamptz`; profissional em `professional_id`, serviços preservados em `service_items/service_name/service_ids`, cliente em `client_id`, estados existentes e link privado por `manage_token`. São mantidas as regras atuais de agenda, expediente, recursos e encaixes. O fuso suportado continua `America/Sao_Paulo`, sem permitir configurar um fuso incompatível com a agenda.
- Reserva pública: Edge Function `booking` autentica a chave publicável, valida os parâmetros, limita requisições e chama RPCs privilegiadas. A nova `book_appointment_whatsapp` envolve a `book_appointment_team` existente numa transação com consentimento, idempotência e fila.
- **Clara:** fonte de verdade, regras determinísticas, autorização, isolamento, consentimento, conversa, pausa humana, cálculo de horários, fila persistente, deduplicação, envio substituível e recibos da Meta.
- **n8n:** relógio/orquestração; chama `POST /process` a cada minuto. Recebe somente contadores, sem telefone, texto, token de gerenciamento ou chave Supabase. O segundo workflow gera uma mensagem fictícia para exercitar a entrada. Não guarda regras de agendamento e não repete envios por conta própria.
- **Meta, futuramente:** recebe o envio no adaptador oficial e entrega entradas/recibos ao webhook autenticado da Clara. O webhook direto reduz exposição de dados pessoais e mantém as decisões numa única camada. Não há IA generativa nesse atendimento.

## Comportamento

A primeira mensagem de uma sessão gera saudação com `1 — Agendar` e `2 — Falar com atendente`. `Agendar`/`1` devolve o slug do estabelecimento vinculado ao número oficial. `Falar com atendente`/`2` registra a solicitação e pausa todas as saídas automáticas dessa conversa, inclusive notificações. O proprietário pode assumir, responder e encerrar no menu **Conversas WhatsApp**. Encerrar descarta respostas antigas do menu e libera notificações ainda válidas. A saudação não se repete a cada mensagem; reaparece após 24 horas de inatividade ou mediante `menu`.

A reserva oferece uma caixa opcional, inicialmente desmarcada, para confirmação, alterações e lembrete. São registrados estabelecimento, reserva, cliente, telefone normalizado, data, origem, versão e texto da autorização. Reservas antigas não são autorizadas retroativamente. `SAIR`, `PARAR`, `STOP` ou `cancelar notificações` revogam o consentimento e suprimem o bot; atendimento humano solicitado pela cliente continua disponível. A revogação não é revertida automaticamente; nova adesão após opt-out exige um fluxo explícito de reautorização, ainda não incluído.

Confirmação, remarcação, cancelamento e lembrete incluem estabelecimento, data, horário de São Paulo, serviços, profissional e URL de gerenciamento. O lembrete começa em **24 horas**, configurável por estabelecimento entre 5 minutos e 7 dias. Reservas feitas com antecedência menor recebem somente confirmação; o lembrete fica cancelado com motivo `short_notice`. Alterar a antecedência recalcula lembretes ainda pendentes; mensagens já canceladas/enviadas não são recriadas. Remarcações incrementam a revisão, cancelam a fila antiga e preparam os novos horários. Cancelamentos suprimem lembretes. Mensagens vencidas não são enviadas.

## Executar a simulação

Requer Node 24, dependências do projeto (`npm install`) e duas janelas de terminal na raiz:

```powershell
# Terminal 1: banco local persistente e ponte HTTP, sem Supabase remoto
npm run whatsapp:sim

# Terminal 2: frontend explicitamente conectado ao simulador
npm run dev:whatsapp
```

Abra `http://127.0.0.1:3000/#/demo/conversas`. Esse modo ignora a configuração real do Supabase e usa dados sintéticos em `.local/whatsapp-sim/database`. A demonstração comum (`npm run dev`) não habilita a ponte de simulação. O servidor gera segredos locais em `.local/whatsapp-sim/server-secrets.json`, ignorado pelo Git. Não copie esse arquivo para o frontend.

1. **Iniciar conversa** e **Processar fila simulada**: uma saudação, estado `Simulada`.
2. **Escolher Agendar**: link `/booking/clara-simulacao`. A fixture `clara-simulacao-b` existe para isolamento; seu canal é `sim-studio-2`.
3. **Pedir atendente**: painel marca atendimento humano. Mensagens automáticas aguardam; escreva em **Resposta manual**, prepare e processe. **Encerrar atendimento** retoma o bot.
4. Abra **Agendamento fictício**, selecione serviço/profissional/horário futuro, informe uma cliente fictícia e telefone `(11) 90000-0101`. Marque a autorização e confirme. O link privado existente continua permitindo consultar/remarcar/cancelar.
5. Execute a fila pelo n8n ou botão do painel: confirmação aparece como simulada. O lembrete permanece programado.
6. **Antecipar lembretes na simulação** torna os lembretes sintéticos pendentes disponíveis agora; processe novamente. Esse atalho só existe no servidor de simulação e não altera a data da reserva.
7. Remarque/cancele pelo link e processe; confira mensagens e motivos de cancelamento. **Revogar autorização** permite conferir a supressão. Use outro telefone sintético numa nova reserva para continuar testes após revogação.

Parar/reiniciar o servidor preserva banco, deduplicação e segredos. Ele recarrega as funções SQL locais ao iniciar; mudanças estruturais futuras exigem uma migração local apropriada. O painel simulado se autentica na ponte por um cabeçalho adicionado pelo Vite, sem expor o segredo ao navegador. Não exponha Vite/porta 8787 à Internet.

## n8n e endereços Docker

Arquivos importáveis, sem segredos e inicialmente inativos:

- `integrations/n8n/clara-queue.simulation.json` — ID `ClaraWaQueueSim01`; manual + relógio de um minuto.
- `integrations/n8n/clara-inbound.simulation.json` — ID `ClaraWaInboxSim01`; entrada sintética + processamento.

Ambos foram importados e executados no n8n local **2.42.7**. **A fila está publicada/ativa nesta instalação, a cada minuto, somente contra o simulador; a entrada fictícia permanece manual.** O fluxo inicial `fWw0sNDvnpUn1Vr1` foi preservado; cópia em `.local/whatsapp-sim/initial-workflow-backup.json`. A credencial `Clara — ponte local (simulação)` foi criada no gerenciador do n8n. Os JSONs não contêm seu valor. A geração pode ser repetida com `npm run whatsapp:workflows`.

Ao terminar os testes, despublique a fila no n8n se for desligar o simulador, para evitar execuções com erro de conexão. Isso não altera o histórico nem envia mensagens reais.

| Origem | Destino correto |
| --- | --- |
| Navegador do computador → Clara | `http://127.0.0.1:3000` |
| Navegador do computador → n8n | `http://localhost:5678` |
| Computador → ponte local | `http://127.0.0.1:8787` |
| n8n no Docker Desktop → ponte local | `http://host.docker.internal:8787` |
| Meta → Clara oficial, futuramente | `https://<projeto>.supabase.co/functions/v1/whatsapp/webhook` |

`localhost` dentro do container aponta para o próprio container. Em Linux, pode ser necessário mapear `host.docker.internal:host-gateway` no Compose; com ambos os serviços em containers, prefira o nome do serviço na mesma rede. `APP_ORIGIN` é o endereço que **a cliente** abrirá, nunca o hostname interno do Docker. Meta não consegue acessar seu localhost.

Para importar em outro n8n: importe os dois JSONs pela interface; crie uma credencial **Header Auth** com nome de cabeçalho `Authorization` e valor `Bearer <CLARA_N8N_SECRET do servidor>`, selecione-a nos nós HTTP e confira os endereços. Execute manualmente a entrada e depois a fila. Publique/ative somente a fila quando quiser o relógio contínuo; mantenha a entrada fictícia manual. Não configure `Retry On Fail` nos nós: o banco controla as tentativas.

Neste computador, `scripts/configure-n8n-local.ps1` reproduz a importação via Docker, preservando o fluxo inicial. É específico ao container `n8n` e ao projeto local `HvuMHDLU0Bfw59Ms`; adapte os parâmetros/contexto antes de usar em outra instalação. Não reimporte sobre alterações feitas depois na interface sem revisá-las. O arquivo temporário de credencial é removido do host/container após importação.

## Contrato da integração

Na Edge Function, o prefixo é `/functions/v1/whatsapp`; no simulador local, a raiz da porta 8787.

| Método/caminho | Autenticação e efeito |
| --- | --- |
| `POST /process`, corpo `{}` | Bearer `CLARA_N8N_SECRET` com pelo menos 32 caracteres. Reivindica/processa até 20 mensagens, limite suave de 45 segundos por lote. Retorna contadores `processed/simulated/accepted/failed/retry/uncertain`. |
| `POST /simulate-inbound` | Mesmo Bearer, exclusivamente `WHATSAPP_MODE=simulation`. Corpo: `channel`, `event_id`, `phone`, `text`, `timestamp` ISO. Canal sintético resolve o estabelecimento. |
| `GET /webhook` | Desafio `hub.mode=subscribe`, `hub.verify_token` e `hub.challenge`; comparação com `META_VERIFY_TOKEN`. |
| `POST /webhook` | Assinatura HMAC-SHA256 do corpo bruto em `X-Hub-Signature-256`, conferida com `META_APP_SECRET`; somente modo live explicitamente habilitado. Recebe eventos Meta de `messages` e `statuses`. |

O gateway Supabase tem `verify_jwt=false` **somente porque a função faz essas verificações próprias**; isso não torna o processamento anônimo. O painel usa o JWT normal do Supabase para `whatsapp_owner`, com ações `list/history/settings/take/close/send`. O proprietário não pode mudar canal, modo, credenciais ou aprovação de modelos por essa RPC. `send` exige `conversation_id`, `body`, `request_id` UUID; `template_key` pode ser somente `human_followup`.

O gateway `booking` inclui `book_appointment_whatsapp` com os campos existentes (`p_slug`, `p_services`, `p_start`, `p_name`, `p_email`, `p_phone`, `p_notes`, `p_professional`), mais `p_whatsapp_opt_in` boolean e `p_request_id` UUID. Retorna `{id, token}`. Reutilizar o mesmo UUID e os mesmos dados devolve a mesma reserva; dados diferentes com a mesma chave são rejeitados. A interface preserva essa chave em tentativas do mesmo formulário.

Eventos persistentes: entrada do cliente; confirmação transacional da reserva; atualização de horário/profissional/serviços/cliente/estado; vencimento do prazo do lembrete; revogação; solicitação/encerramento humano; recibos do provedor. A fila é a outbox; não há webhook frágil disparado pelo navegador após reservar.

## Segurança, estados e limites

- RLS e RPCs verificam proprietário e estabelecimento; canal oficial tem associação única, configurada no servidor. Não é aceito um `studio_id` escolhido pela Meta/cliente para rotear uma entrada.
- Unicidade persistente por estabelecimento + evento/reserva/revisão; lock transacional para reserva; `FOR UPDATE SKIP LOCKED` e lease para trabalhadores simultâneos. Repetir o processamento não duplica mensagens.
- Tentativas limitadas a quatro, com recuos de 30/60/120 segundos para rejeição recuperável explícita. Timeout, resposta ambígua/5xx e lease vencida ficam `uncertain`, sem reenvio automático. O erro 130497 fica como falha, sem tentativa de contornar o bloqueio.
- Não existe garantia de transação única entre PostgreSQL e a API externa. Um envio já em andamento pode anteceder uma pausa/cancelamento; uma falha depois da aceitação pode deixar resultado incerto. Nesses casos, conferir o provedor e reconciliar antes de decidir qualquer novo envio. Não transformar `uncertain` em `pending` automaticamente.
- `pending` → `sending` → `simulated` **ou** `accepted`. Somente recibos autenticados da Meta alteram mensagens oficiais para `sent/delivered/read/failed`; recibos antecipados são reconciliados. Resposta HTTP aceita não significa entrega. Mensagens simuladas nunca recebem o selo de entrega real.
- Texto livre manual é limitado à janela no SQL e expira ao fechá-la. Modelo proativo exige aprovação e consentimento, novamente conferido ao processar. O modelo de retomada é estático; editar o textarea não muda o texto aprovado enviado pela Meta.
- Telefones/textos/tokens não são registrados nos logs de aplicação nem enviados ao workflow da fila; o histórico operacional permanece no banco sob RLS. Links de gerenciamento são credenciais da cliente. Não exportar esse histórico ou expor os tokens em logs. O painel lista até 200 conversas e 200 mensagens; retenção/arquivamento de longo prazo deve ser definido antes da operação real.
- As credenciais ficam em Edge Function/servidor e no gerenciador de credenciais do n8n. Proteja backups e a chave de criptografia do n8n. A simulação só contém dados fictícios.

## Regras oficiais verificadas

Consulta em 13/10/2026 à [política oficial do WhatsApp Business](https://business.whatsapp.com/policy) e à [página oficial de preços](https://business.whatsapp.com/products/platform-pricing): atendimento livre depende da janela de 24 horas desde a última mensagem da cliente; fora dela, usar modelos aprovados, com a autorização aplicável. Há obrigação de respeitar a recusa e oferecer escalonamento humano. Agendar no site, clicar no link ou enviar uma mensagem pelo painel **não** abre/renova essa janela.

A cobrança depende de entrega, categoria e mercado, com condições/exceções nas tabelas vigentes. Esta integração **não assume mil mensagens gratuitas**, não fixa valores nem usa suposta gratuidade para escolher texto/modelo. Conferir a tabela vigente e a categoria efetivamente aprovada imediatamente antes de ativar o canal. Algumas páginas técnicas de developers.facebook.com responderam 429 nesta consulta; a validação final do canal/versionamento e de seus modelos permanece necessária. A compatibilidade n8n foi conferida com a [documentação oficial de CLI](https://docs.n8n.io/hosting/cli-commands/) e executada na instalação local.

## Habilitar o oficial depois

1. Resolver o bloqueio Meta 130497 fora desta entrega. Ter WABA/número habilitado, token de servidor com as permissões pertinentes, App Secret e Verify Token. Escolher uma versão Graph suportada; nenhuma versão é presumida no código.
2. Homologar o banco e publicar o conjunto, respeitando `PRODUCAO.md`/`ENCAIXES.md`. Ordem relevante: todas as migrações atuais até `platform_admin.sql`, depois `scheduling_integrity.sql`, `parallel_bookings.sql` e por último `whatsapp.sql`. Não reaplicar migrações já executadas. O simulador/testes usam a ordem de `tests/scheduling-fixture.js`. A nova migração é aditiva e não foi aplicada remotamente.
3. Publicar as funções `booking` e `whatsapp` e só depois o frontend correspondente. Publicar apenas o frontend quebraria a nova reserva por falta da RPC. Manter modo simulado enquanto valida a homologação.
4. Configurar segredos no Supabase e `APP_ORIGIN` HTTPS público. Vincular cada `whatsapp_settings.studio_id` ao `phone_number_id` correto no servidor. O painel só ativa/pausa e configura a antecedência. Não reutilizar dados/IDs da fixture.
5. Submeter os rascunhos de `integrations/whatsapp/templates.json`; a Meta decide aprovação/categoria. Confirmação, lembrete, alteração e cancelamento esperam seis parâmetros de corpo na ordem documentada; retomada humana é estática. Copiar somente `name/language/approved` realmente aprovados para as respectivas chaves em `whatsapp_settings.templates`; validar que finalidade/categoria/consentimento autorizam a retomada humana, ou deixá-la desabilitada. A simulação não equivale a aprovação.
6. Configurar webhook **HTTPS público** com a URL acima, verificar desafio e assinar `messages` na WABA. Validar assinaturas, entradas, entrega/leitura/falhas e reentregas em homologação. n8n pode continuar privado; a Meta fala com a Clara.
7. Criar uma cópia do workflow de fila apontando para a Edge Function, com credencial própria desse ambiente. Não reutilizar o workflow de entrada fictícia no canal oficial.
8. Somente na liberação real, alterar explicitamente `WHATSAPP_MODE=live`, `WHATSAPP_LIVE_ENABLED=true` e o modo do estabelecimento para `live`. Os três precisam concordar. Linhas antigas de simulação nunca são convertidas em envios reais. Conferir acompanhamento de falhas/incertezas e parar o processamento se houver problema.

## Variáveis de ambiente, sem valores secretos

| Nome | Onde / finalidade |
| --- | --- |
| `SUPABASE_URL` | Servidor; fornecida pelo Supabase à função. |
| `SUPABASE_SERVICE_ROLE_KEY` | Exclusivamente servidor; RPCs privilegiadas. |
| `APP_PUBLISHABLE_KEY` | Configuração já existente da função `booking`; deve corresponder à chave pública do frontend. |
| `APP_ORIGIN` | Servidor; origem pública dos links da cliente. |
| `CLARA_N8N_SECRET` | Servidor + credencial Header Auth do n8n; mínimo 32 caracteres aleatórios. |
| `WHATSAPP_MODE` | Servidor; `simulation` por padrão, `live` somente na liberação. |
| `WHATSAPP_LIVE_ENABLED` | Servidor; `false` por padrão, trava explícita do envio real. |
| `META_APP_SECRET` | Servidor oficial; valida assinatura do webhook. |
| `META_VERIFY_TOKEN` | Servidor oficial + cadastro de webhook na Meta. |
| `META_ACCESS_TOKEN` | Servidor oficial; nunca frontend/workflow JSON. |
| `META_GRAPH_VERSION` | Servidor oficial; versão Graph validada na ativação. |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | Configuração pública já existente do frontend. |
| `VITE_WHATSAPP_SIMULATION` | Marcador público, definido automaticamente por `dev:whatsapp`; não ativa envio real. |
| `PANEL_SECRET` | Gerado no arquivo local ignorado pelo Git; usado somente pelo proxy Vite/simulador. Não é variável da função oficial. |

Exemplo sem segredos: `integrations/whatsapp/server.env.example`. No simulador, os valores seguros são gerados/definidos pelo script; não são necessárias credenciais da Meta ou do Supabase.

## Validação

- `npm test`: **455 testes aprovados**, incluindo 16 da nova integração (ciclo persistente, consentimento, revogação antes do processamento, janela, permissões, isolamento, remarcação/cancelamento, falhas e recibos).
- `npm run test:whatsapp:concurrency`: **4 testes aprovados** em PostgreSQL nativo temporário; oito entradas repetidas, oito reservas concorrentes e trabalhadores simultâneos. O teste usa o runtime PostgreSQL local existente em `.local/pg-test`; não conecta ao Supabase.
- `npm run build`: aprovado; somente avisos já existentes do Lucide sobre `use client`.
- n8n local: ambos os workflows executados com sucesso; a fila processou a confirmação criada pelo formulário real da simulação. O relógio publicado também transformou uma resposta pendente em simulada sem intervenção manual.
- Navegador: saudação, link correto, pausa/retomada, resposta manual, reserva com autorização, confirmação e antecipação de lembrete conferidos em desktop. O controle de viewport da ferramenta não aplicou a largura solicitada; a nova tela não tem validação visual móvel concluída nesta sessão.

Saídas de teste estão em `.local/whatsapp-*.log` (ignoradas pelo Git). Nada desta validação certifica entrega real pela Meta.
