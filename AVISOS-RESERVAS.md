# Avisos de reservas em tempo real

Estado em 14/10/2026: migração `clara_booking_notifications` **aplicada em produção**; frontend ainda **não publicado** (funciona no app local, que usa o banco de produção).

## O que a profissional vê

- Sino no topo do painel com o número de avisos novos; o título da aba ganha o contador, por exemplo "(2) Clara".
- Ao chegar uma reserva online, remarcação ou cancelamento feito pela cliente, aparece na hora uma mensagem na tela, toca um som curto (desligável por aparelho) e a agenda é recarregada.
- Com a aba em segundo plano e permissão concedida, o navegador mostra uma notificação do sistema.
- Ao abrir o sino, os avisos são marcados como vistos; clicar num aviso abre a agenda no dia do atendimento, com ele em destaque.
- Ações da própria dona (painel ou Clara) não geram aviso.
- Com o painel fechado não há aviso; ele fica no sino para quando ela voltar. A conferência a cada minuto continua como reserva caso o tempo real caia.
- A demonstração mostra avisos de exemplo, sem acesso à rede.

## Como funciona

- `supabase/booking_notifications.sql`: tabela `studio_notifications` (um evento por ação da cliente), gatilho `zz_notify_owner` em `appointments` (só chamadas sem usuário logado, ou seja, o link público), RPC `mark_notifications_seen` e inclusão da tabela na publicação `supabase_realtime`. RLS: só a dona lê os avisos do próprio estabelecimento.
- `src/booking-alerts.js`: textos, contador do título, preferências por aparelho e **entrega** (`createAlertDelivery`).
- `src/BookingAlerts.jsx`: sino, assinatura em tempo real e leitura de recuperação a cada (re)conexão.
- Testes: `tests/booking-notifications.test.js` (banco, RLS e regras de texto/entrega).

## Retenção

`supabase/booking_notifications_retention.sql` (aplicada em produção em 15/10/2026, migração 20261015131715): avisos com mais de 90 dias são apagados por estabelecimento quando chega um aviso novo ou a dona abre o sino.

## Publicação (quando autorizada)

1. Aplicar `supabase/booking_notifications.sql` no Supabase de produção (depois de `parallel_bookings`).
2. Conferir que `studio_notifications` está na publicação `supabase_realtime`.
3. Publicar o frontend. Publicar o site antes do banco não quebra nada, mas o sino ficaria vazio e o tempo real tentaria reconectar.

## Caminho para o app Capacitor (Android/iOS)

- O tempo real e o sino funcionam igual dentro do app aberto.
- Trocar apenas `createAlertDelivery` por um adaptador com `@capacitor/local-notifications` (a API de notificação do navegador não existe no app).
- Para avisar com o app fechado: `@capacitor/push-notifications` (FCM no Android, APNs no iOS), uma tabela de tokens por aparelho e uma Edge Function que envia o push a cada nova linha de `studio_notifications` (Database Webhook ou fila). O mesmo evento pode alimentar e-mail ou WhatsApp.
- Ajustes do app: liberar `capacitor://localhost` e `https://localhost` nas URLs de autenticação do Supabase e nas funções que conferem `APP_ORIGIN`; revisar a regra da Apple para assinaturas vendidas dentro do app; conta Apple Developer para push no iOS.
