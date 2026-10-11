# Checklist da Minha Clara — 06/10/2026

## Planos por equipe — implementação local em 07/10/2026
- [x] Quatro mensalidades: 1=29,90; 2–3=59,90; 4=79,90; 5=99,90. Proprietário incluído.
- [x] Limite de cinco no banco/interface, inclusive reativação e concorrência. Histórico preservado.
- [x] Escolha e confirmação; upgrade proporcional após pagamento, redução com equipe compatível; retomada sem duplicação.
- [x] Testes: 406 da aplicação, 6 de concorrência PostgreSQL, build e UI desktop/celular. Detalhes em PLANOS.md.
- [ ] Conectar conta/sandbox Stripe e homologar cartões, alterações e eventos reais de teste.
- [ ] Preparar publicação revisada, obter aprovação para migração/funções/frontend e publicar.
- [ ] Configurar ambiente live e ativar cobrança somente após homologação e autorização.

## Saída da conta — correção local em 07/10/2026
- [x] Botão “Sair” no topo e “Sair da conta” no menu. A pedido do usuário, menu desktop fixo SEM rolagem; espaçamentos adaptam-se à altura e preservam opções/saída. Menu móvel mantém rolagem.
- [x] Validar retorno ao login e falha/retry com sessão fictícia; conferir desktop e celular.
- [x] Pacote isolado atualizado clara-logout-fixed-sidebar-20261007, sem planos/agendamento/reenvio. Substitui clara-logout-only-20261007.
- [ ] Obter aprovação e publicar a correção de saída.

## Identidade atual — publicação visual concluída
- [x] Marca visual Clara, sem o antigo sufixo, no domínio escolhido minhaclara.com.
- [x] Frase “Você cuida. A Clara organiza.” e textos anteriores restaurados; personagem, paleta e layout preservados.
- [x] Nova logo profissional com monograma C, símbolo e favicon publicados; frase original e remoção do sufixo verificadas.
- [x] Usuário informou que comprou minhaclara.com.
- [x] Conectar minhaclara.com à Vercel: DNS aplicado na Hostinger, www redireciona à raiz, HTTPS validado e configuração reconhecida pela Vercel.
- [x] Atualizar as URLs de autenticação do Supabase junto da configuração de e-mails.
- [x] Publicar a identidade visual após aprovação: dpl_CLX7DEbh5fHCSsAwdDVGzgj752FU, READY. Pacote visual isolado a partir da versão anterior de produção.
- [ ] Autorizar explicitamente a migração de agendamento antes de publicar o build completo; revisão automática rejeitou ampliação do escopo visual. Nenhuma migração ou função aplicada neste deploy.
- [x] Usuário criar conta Brevo e verificar telefone; autenticar domínio/remetente, configurar SMTP e URLs.
- [x] Usuário confirmou funcionamento do e-mail de confirmação no cadastro.
- [ ] Validar recuperação de senha (usuário decidiu testar depois); publicar reenvio após aprovação (fonte local pronta).
- [ ] Implementar avisos transacionais de vencimento/pagamento junto à etapa de cobrança; não fazem parte do SMTP Auth.

## Publicação autorizada
- [x] Usuário pediu deploy; banco, funções e frontend publicados em 06/10/2026.
- [x] Vercel READY, domínio atualizado e verificação pública sem erros capturados.
- [x] Cobrança desativada até configurar Stripe; nenhum prazo iniciado ou estúdio bloqueado.
- [ ] Ativar cobrança somente após configuração/testes e aprovação própria; demais pendências externas abaixo continuam abertas.

## Revisão atual — alterações locais

- [x] Sessão protegida contra respostas antigas, recuperação e nova tentativa após falha.
- [x] Prazos de rede, erros amigáveis, bloqueio de cliques repetidos e alternativa para erro de tela.
- [x] Paginação por cursor e atualização por revisão do estúdio; índices preparados em migração.
- [x] Imagens principais reduzidas em 94,6%; cabeçalhos de cache/segurança preparados para Vercel.
- [x] Código de assinatura: 7 dias grátis + R$ 29,90/mês; pagamento hospedado, eventos assinados e acesso imposto pelo banco.
- [x] Migrações exercitadas em PostgreSQL local; rotas de pagamento exercitadas com provedor simulado.
- [x] Roteiro de carga de 1.000 usuários; proteção contra execução de testes de escrita na produção conhecida.
- [ ] Conta Stripe pessoa física/CPF e ambiente de teste configurados; validar ciclo de cobrança externo.
- [ ] SMTP/URLs de Auth e entrega real de e-mails de acesso validados.
- [ ] Integração completa e carga de leitura/escrita em homologação; relatório de capacidade aprovado.
- [ ] Backup, restauração e alertas de produção verificados.
- [ ] Aprovação do usuário e publicação coordenada de banco/funções/front-end.

Plano e procedimento completos: [PRODUCAO.md](PRODUCAO.md). Os itens abaixo registram o histórico; não significam que a revisão atual foi publicada.

## Concluído
- [x] Conta, catálogo e agenda por estúdio.
- [x] Link exclusivo, compartilhamento manual no WhatsApp e QR Code.
- [x] Vários serviços com soma de duração e valor; proteção contra sobreposição.
- [x] Sugestões dos próximos dias com espaço para o atendimento completo.
- [x] Remarcação usa o horizonte real do estúdio.
- [x] Reservas pagas explicam a restrição e não oferecem alterações públicas.
- [x] Consulta atualizada após uma tentativa de alteração recusada.
- [x] Troca do link com preservação dos endereços anteriores e proteção contra uso por outro estúdio.
- [x] Migração prioritária aplicada no Supabase.
- [x] 13 testes locais e build aprovados; testes SQL de regressão e produto aprovados com rollback.

## Antes da publicação
- [x] Validar variáveis no build, fixar Node 24.x e bloquear compartilhamento de links nos previews Vercel.
- [x] APP_PUBLISHABLE_KEY configurada no projeto conectado; booking v6 publicada e validada em 02/10/2026. Projetos novos exigem sua própria configuração.
- [x] Frontend publicado em https://encaixa-eta.vercel.app/ na Vercel (bertunesinc-3931/encaixa), com configuração pública do Supabase incorporada ao build. Sem integração Git.
- [ ] Configurar URLs públicas de autenticação e validar e-mails de cadastro/recuperação.
- [ ] Conferir catálogo, preços, durações e expediente reais de cada estúdio.
- [ ] Validar link e QR Code em celular fora do computador de desenvolvimento.
- [ ] Validar fluxo completo publicado e repetir testes de isolamento/concorrência em ambiente de teste.
- [ ] Conferir backup, recuperação e acompanhamento de erros.

## Produto concluído nesta etapa
- [x] Revisão e unificação de clientes pela profissional, com confirmação explícita, histórico e observações preservados. Sem associação automática por contato não verificado e sem unificar clientes reais nesta implementação.
- [x] WhatsApp com DDD obrigatório e e-mail opcional na reserva pública; validação no navegador e banco.
- [x] Busca de sugestões em uma consulta por período, com até 14 dias e três sugestões por chamada.
- [x] Troca do endereço mantendo links e QR Codes antigos funcionais a partir desta versão.

## Opcionais
- [x] Várias profissionais por salão: cadastro, expediente individual, filtro de agenda, bloqueios independentes e escolha na reserva pública. Administração pela conta do salão; catálogo compartilhado.
- [ ] Confirmações e lembretes automáticos.
- [ ] Sinal/pagamento online da cliente.
- [ ] Cobrança de assinatura de profissionais.
- [ ] Domínio próprio.
