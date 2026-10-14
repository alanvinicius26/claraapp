# Aplicação das 15 poses — 11/10/2026

Implementação local baseada no commit `65dbe5b`, após conferir o histórico, CONTEXTO.md e as mudanças de encaixes em Serviços, Equipe e agenda. No início, só as artes geradas estavam sem versionamento; nenhum arquivo de código tinha modificações pendentes.

As regras de encaixes, consultas, autenticação, pagamentos, reservas e persistência foram preservadas. Nenhuma migração, publicação ou alteração de registros remotos foi realizada. A conferência de dados nesta entrega foi do estado local e das fixtures; não foi uma nova auditoria do banco de produção.

## Uso das imagens

| Pose | Contexto |
| --- | --- |
| 01 — Boas-vindas | Criação de conta |
| 02 — Aprovação | E-mail enviado e agenda selecionada com todos os atendimentos concluídos |
| 03 — Direita | Cabeçalho de Equipe |
| 04 — Esquerda | Cartão para compartilhar a página de agendamento |
| 05 — Baixo | Tela de entrada |
| 06 — Ideia | Agenda livre e primeiro serviço |
| 07 — Pensando | Falha ao atualizar, buscas sem resultado e chat consultando |
| 08 — Celebrando | Conquista do primeiro serviço |
| 09 — Coração | Conquista do primeiro atendimento concluído |
| 10 — Apresentando | Configuração inicial do espaço |
| 11 — Agenda | Resumo do dia e lista de horários vazia |
| 12 — Celular | Revisão da mensagem após remarcação |
| 13 — Anotando | Cadastro da primeira cliente |
| 14 — Lembrete | Próximo atendimento da data selecionada em até 60 minutos |
| 15 — Confiança | Avatar do chat e recuperação/confirmação de acesso |

## Arquivos e desempenho

`src/ClaraArt.jsx` centraliza as 15 imagens decorativas. Arquivos para entrega em `src/assets/clara-poses`: WebP de 768 × 768, preservando transparência, total de 1.157.502 bytes. Os PNGs originais continuam nesta pasta. O navegador carrega as imagens usadas na tela; as artes secundárias usam carregamento adiado.

Para reproduzir a conversão: `python scripts/optimize-clara-poses.py`, com Pillow instalado. Não regrava os originais.

## Validação

Revisão de alinhamento em 12/10/2026: retirados os posicionamentos absolutos da agenda e do acesso, substituído o float do compartilhamento por grade e alinhadas as ilustrações com seus textos. Imagens quadradas com proporção preservada. Ajustada a largura da página online em 320px e as margens das conquistas. Conferência visual em computador/celular, medições em 320/768/1280px e cinco estados da agenda sem sobreposição entre arte e texto. Build final aprovado. Alteração somente local de apresentação.

- 436 testes existentes aprovados, incluindo encaixes e regras de agendamento.
- Build aprovado; avisos já existentes de `use client` no Lucide.
- Conferência visual local em desktop e celular de 390 px: entrada, cadastro, agenda, Equipe, compartilhamento, chat, estados vazios, conquistas e mensagem de remarcação.
- Prévia com componentes reais e dados fictícios em `http://127.0.0.1:3000/.local/clara-presence-preview.html`. O seletor permite verificar as poses de agenda, lembrete, conclusão, agenda livre e erro. Não integra o build de produção.
- Sem rolagem horizontal nas telas verificadas. Imagens renderizadas com dimensões declaradas e descrição vazia por serem decorativas; nomes dos botões e mensagens permanecem acessíveis.

A publicação continua separada: o projeto contém mudanças anteriores de agendamento/encaixes que dependem de migrações ainda não publicadas, conforme CONTEXTO.md. Não publicar `dist` diretamente contra o backend antigo.
