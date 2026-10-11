# Auditoria e reengenharia dos agendamentos — 06/10/2026

Implementação concluída localmente. **Ainda não aplicada nem publicada em produção.** A migração é nova: `supabase/scheduling_integrity.sql`, após `billing.sql`. Não reaplicar migrações antigas.

## Evidências e brechas encontradas

Foram revisados o painel, o link público, a remarcação pelo token, as propostas da Clara, a Data API autenticada, os triggers, as permissões e a sequência completa de migrações. A consulta remota foi exclusivamente de leitura, sem nomes, contatos ou tokens de clientes.

| Situação anterior | Consequência | Correção |
|---|---|---|
| `normalize_appointment`, em `supabase/multiservice.sql`, já somava durações, preservava preço/duração históricos e calculava limpeza. | Essa parte já era consistente; não era necessário substituir a soma por cálculos do navegador. | Mantida como fonte autoritativa, com testes de adulteração dos campos e de ampliação atômica. |
| `appointments_professional_overlap`, em `supabase/team.sql`, já usava exclusão GiST por profissional. | A mesma profissional já estava protegida contra sobreposição, inclusive simultânea. | Constraint preservada; a nova proteção complementa esse mecanismo. |
| Não existiam salas, macas nem alocações de recursos. | Profissionais diferentes podiam ocupar a mesma maca. | Cadastro de recursos, vínculo ao serviço, alocações transacionais e exclusão GiST por recurso. |
| `Editor`, em `src/main.jsx`, inseria/alterava reservas diretamente, com horário digitado e aviso explícito permitindo atendimento fora do expediente. O trigger não checava expediente. | Bypass de almoço, folga e fechamento pela Data API ou pelo painel. | Trigger obrigatório após normalização, compartilhando a regra de expediente usada nas consultas. Painel mostra horários livres. |
| A disponibilidade online fazia a validação de expediente em funções de consulta. Alterações de horários de trabalho não participavam de um protocolo comum com todas as escritas. | Mudanças concorrentes de configuração podiam deixar uma reserva incompatível com o expediente final. | Mutex transacional por estúdio para reservas/configurações; mudança de expediente incompatível com reserva futura é recusada. |
| Alteração do horário de uma profissional inativa, mantendo o mesmo ID, não passava novamente pela checagem de profissional ativa. | O painel podia remarcar para uma agenda inativa. | Revalidação nas mudanças de horário, profissional, duração ou recursos. |
| O painel montava instantes concatenando `-03:00`; o gateway aceitava datas sem offset explícito. | Dependência de uma hipótese de offset, sem contrato de fuso na entrada pública. | Conversão por IANA no painel; gateway exige ISO com offset/Z; banco usa `timestamptz` e `America/Sao_Paulo`. |
| Conflitos eram retornados como erro HTTP 400 e mensagens transitórias. | A cliente/profissional podia perder a explicação e continuar com uma seleção antiga. | HTTP 409 para conflito, mensagens de negócio, aviso persistente e nova consulta de disponibilidade. |

**Estado remoto observado:** 15 migrações aplicadas, até `clara_billing_inactive`; constraint de exclusão por profissional presente; tabelas de recursos ausentes. Havia 3 registros de agenda, 1 futuro confirmado, nenhum intervalo não finito/vazio e nenhuma reserva futura fora do expediente. São observações desse instante, não uma promessa sobre o estado após a consulta.

## Regra final de ocupação

```text
duração = soma das durações dos serviços, na ordem escolhida
término = início + duração
ocupação = [início, término + limpeza)
```

Exemplo: manicure de 45 minutos + progressiva de 180 minutos iniciadas às 13h terminam às 16h45. Com limpeza de 10 minutos, profissional e recursos ficam ocupados até 16h55. Não há intervalo entre procedimentos. O intervalo é fechado no início e aberto no fim: outro atendimento pode começar exatamente quando a limpeza termina.

O banco calcula duração/preço a partir do catálogo no cadastro ou na mudança de serviços. Remarcações preservam a duração, o preço e a limpeza da reserva. Alterar o buffer do estúdio afeta reservas novas/seleções de serviços alteradas, sem alongar silenciosamente reservas existentes. O campo de buffer já existe em Meu espaço, inclusive com opções de 0, 5 e 10 minutos.

Cada procedimento pode indicar uma sala/maca específica ou declarar que não usa recurso compartilhado. Uma reserva com vários procedimentos ocupa a união dos recursos, sem duplicatas, por **todo o intervalo contínuo, incluindo limpeza**. Essa decisão é conservadora: não libera uma sala no meio da sequência e não escolhe automaticamente entre macas equivalentes.

## Proteção no PostgreSQL

1. `a0_lock_schedule` atualiza uma linha privada por estúdio dentro da transação. Reservas, bloqueios, pagamentos e mudanças de catálogo/expediente/recursos compartilham a trava. A linha atualizada também provoca erro de serialização quando uma transação `REPEATABLE READ` tenta escrever usando uma configuração antiga.
2. Os triggers existentes calculam a sequência e o intervalo real, sem confiar em `ends_at`, `occupied`, `price` ou itens enviados pelo navegador.
3. `z_validate_schedule` valida instantes finitos, profissional ativa, expediente individual/fallback do salão, almoço, folgas semanais, antecedência, horizonte e recursos necessários. Não há exceção por `source='manual'` para escapar do expediente. Bloqueios representam indisponibilidade e podem atravessar pausas/dias; a exclusão continua impedindo sobreposição com reservas.
4. A constraint `appointments_professional_overlap` continua protegendo a profissional. `appointment_resources_no_overlap` protege cada sala/maca com `EXCLUDE USING gist (studio_id WITH =, resource_id WITH =, occupied WITH &&)`.
5. `sync_appointment_resources` grava/remove as alocações na mesma transação do agendamento. Se qualquer recurso conflitar, PostgreSQL desfaz o agendamento e todas as alocações. Na reserva pública, desfaz também a criação da cliente.
6. Cancelar libera recursos. Concluir mantém o histórico. Transferir profissional, alterar serviços ou remarcar exige novamente um intervalo compatível; uma falha preserva a reserva anterior.
7. Ao vincular/trocar um recurso em Serviços, o trigger recalcula as alocações das reservas futuras confirmadas, preservando seus horários e valores. Se houver conflito, **o vínculo e todas as atualizações são revertidos**. Isso também permite configurar recursos para reservas anteriores à migração.
8. Alterações de expediente que invalidariam reservas futuras são recusadas. Recursos com ocupação futura não podem ser desativados. Profissionais inativas mantêm o histórico, mas não recebem novas reservas/remarcações.

As tabelas novas usam RLS por estúdio e chaves estrangeiras compostas. O usuário autenticado não pode escrever diretamente em `appointment_resources` ou `schedule_locks`. As funções auxiliares são privadas, com `search_path` fechado e privilégios revogados. A RPC `owner_available_slots` verifica o proprietário.

O mutex é propositalmente conservador: escritas do mesmo estúdio são serializadas, embora profissionais sem conflitos possam ambas confirmar. Estúdios diferentes têm travas distintas. As constraints permanecem como barreira final. Um deadlock/timeout de trava/erro de serialização pode recusar uma tentativa; isso é tratado como nova consulta de horários, sem repetir automaticamente uma escrita. Não se promete ausência de falhas de rede, indisponibilidade ou capacidade de carga não medida.

Referências do mecanismo: [exclusão de intervalos no PostgreSQL](https://www.postgresql.org/docs/current/rangetypes.html#RANGETYPES-CONSTRAINT) e [travas transacionais](https://www.postgresql.org/docs/current/explicit-locking.html).

## Frontend, backend e fuso

- `src/OwnerSlots.jsx`: horários consultados para a profissional, serviços, data e reserva em edição; ignora respostas de seleções anteriores. A lista não revela os dados de outras clientes.
- `src/main.jsx`: consulta novamente antes de criar, remarcar ou alterar serviços; o banco revalida na escrita. Horários antigos fora da grade de 15 minutos continuam verificáveis para alteração dos serviços.
- `src/Resources.jsx` e `src/Team.jsx`: cadastro/ativação de salas e macas em Equipe; seleção do recurso no editor de Serviços. Falha ao carregar recursos não permite salvar um vínculo vazio acidentalmente.
- `src/booking.jsx`: disponibilidade pública passa a considerar recursos, inclusive sugestões de próximas datas; retorno de foco/conexão atualiza a consulta. Conflito mantém aviso e exige nova seleção.
- `supabase/functions/booking/validation.js`: rejeita instantes sem offset/Z e datas inválidas; o gateway devolve 409 em conflito de horário/trava, preservando 400 para outros dados inválidos.
- `src/scheduling.js`: conversão por `Intl` com a zona IANA, independente do fuso do dispositivo; horários inexistentes/ambíguos são recusados.
- As RPCs antigas e a Clara continuam compatíveis. Consultas de remarcação incluem os recursos da reserva e a confirmação passa pelos mesmos triggers.

O fuso de negócio continua sendo **America/Sao_Paulo** em todo o aplicativo. Esta implementação não adiciona um seletor de fusos por estúdio. Instantes são armazenados com fuso; apresentação e expediente usam a zona de negócio. Uma página pública pausada não impede consultas da agenda interna autenticada.

## Validação realizada

- `npm run check:release`: **379 testes passaram**, zero falhas; build de produção concluído. Log: `.local/scheduling-release.log`. Avisos existentes do Lucide sobre `use client` permanecem sem impedir o build.
- `tests/scheduling.test.js`: PostgreSQL/PGlite com todas as migrações reais; somas, limpeza, adulteração de campos, almoço, fechamento, folgas/bloqueios, profissional inativa, recursos, rollback de expansão, snapshots, RLS, datas não finitas, horários antigos fora da grade e página pública pausada.
- Os roteiros SQL de reservas, unificação de clientes, equipe e Clara foram executados com rollback após a nova migração. Fixtures antigas que dependiam de atendimento fora do expediente foram adequadas à regra estrita, com verificações explícitas das novas recusas.
- `tests/scheduling.concurrent.test.js`: **9 testes passaram**, zero falhas, em PostgreSQL **18.4 nativo**, escutando apenas em `127.0.0.1`, com 8 conexões distintas. Disputa de 8 reservas da mesma profissional; disputa entre profissionais pela mesma maca; 8 chamadas públicas com apenas uma cliente nova; reservas sem conflito; duas remarcações para o mesmo destino; reserva concorrendo com fechamento de expediente; associação de recurso concorrendo com reserva; snapshot `REPEATABLE READ` desatualizado. O servidor de teste foi encerrado no `finally`. Log: `.local/scheduling-concurrency.log`.
- Navegador com fixture isolada: seleção de 2 serviços → 75 minutos + 10 de limpeza; erro de concorrência → seleção limpa, aviso persistente e lista atualizada → nova seleção e reserva confirmada. Cadastro de recurso e vínculo no serviço conferidos; nenhum erro de execução registrado. A fixture bloqueia rede externa e não grava no Supabase.
- Produção: somente consultas agregadas de leitura. Nenhuma reserva real criada/alterada, nenhuma migração aplicada e nenhum deploy realizado nesta revisão.

Para repetir a concorrência neste Windows, o runtime de teste está separado das dependências do aplicativo:

```powershell
npm install --prefix .local/pg-test embedded-postgres@18.4.0-beta.17 pg@8 --no-audit --no-fund
npm run test:scheduling:concurrency
```

O teste cria um cluster novo dentro de `.local/scheduling-pg-*`, usa a porta local 55439 e mantém os logs para auditoria. No sandbox deste computador, iniciar PostgreSQL exigiu execução fora do sandbox; isso não alterou produção. `npm test` não exige esse runtime nativo.

## Aplicação após aprovação

1. Confirmar backup e repetir a leitura de compatibilidade se os dados tiverem mudado. A regra de aprovação está em `CONTEXTO.md`: “Não faça nenhuma publicaçao sem minha aprovaçao ou pedido. Sempre pergunte”.
2. Aplicar **somente** `supabase/scheduling_integrity.sql`, uma vez, após as migrações já publicadas. A migração é transacional, aditiva e não altera horários/preços existentes. Caso a trava de DDL não seja obtida em 5 segundos, ela falha sem aplicação parcial.
3. Publicar a função `booking`, incluindo `index.ts` **e `validation.js`**, preservando seus secrets e a configuração de JWT atual.
4. Publicar o frontend compilado depois da migração. O frontend novo depende da tabela `resources` e da RPC `owner_available_slots`.
5. Cadastrar as salas/macas físicas e vincular os serviços que as utilizam. **O banco só protege os recursos efetivamente cadastrados/vinculados**; não é possível inferir qual maca um serviço usa. A associação das reservas futuras é atômica e recusa conflitos já existentes.
6. Conferir criação/remarcação/cancelamento em ambiente de homologação e realizar um smoke test de leitura em produção. Testes de carga de 1.000 usuários e falhas de infraestrutura continuam fora da certificação desta revisão.

Reverter apenas o frontend mantém as barreiras no banco, mas telas antigas podem receber recusas onde antes permitiam horários inválidos. Não remover as constraints para contornar uma recusa. A migração não deve ser “desfeita” apagando tabelas com alocações reais; eventual correção deve usar nova migração.
