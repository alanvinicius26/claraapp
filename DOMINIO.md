# Domínio minhaclara.com

## Estado — 07/10/2026

Atualização de e-mails: além dos registros do site abaixo, os quatro registros da Brevo foram adicionados à Hostinger; domínio autenticado e remetente Clara verificado. Site URL e Redirect URL do Supabase agora usam `https://minhaclara.com`. Telefone verificado e SMTP Brevo conectado ao Supabase com autorização explícita do usuário; falta testar entrega com destinatário indicado. Estado completo e valores em `EMAILS.md`.

Domínio comprado na Hostinger. `minhaclara.com` e `www.minhaclara.com` foram vinculados ao projeto Vercel `encaixa` (`prj_GdJAEDPFnURqmlHXASsh13BdahS5`), conforme pedido do usuário. O endereço com `www` redireciona com HTTP 308 para `https://minhaclara.com`.

DNS configurado na Hostinger e reconhecido pela Vercel (`misconfigured: false` nos dois nomes). O antigo apontamento `2.57.91.91` foi substituído pelos dois endereços abaixo; `www` foi atualizado para o CNAME recomendado. Os três registros usam TTL de 300 segundos. Os servidores DNS permanecem na Hostinger: `helios.dns-parking.com` e `aster.dns-parking.com`.

## Registros recomendados pela API da Vercel

Valores consultados especificamente para este projeto em 07/10/2026, por `GET /v6/domains/{domain}/config`:

| Tipo | Nome na Hostinger | Destino |
| --- | --- | --- |
| A | @ | 216.198.79.1 |
| A | @ | 64.29.17.1 |
| CNAME | www | 21167071923b4bea.vercel-dns-017.com |

Aplicados e conferidos na tabela DNS da Hostinger. Havia apenas o A do domínio estacionado e o CNAME de www; não havia registros de e-mail. Cópia dos valores anteriores em `.local/vercel/hostinger-dns-before-20261007.json`. Não houve transferência do domínio nem mudança de nameservers.

## Verificação

1. Três registros conferidos na tabela da Hostinger; Vercel confirma ambos os nomes sem configuração inválida.
2. DNS confirmado em 1.1.1.1, 8.8.8.8 e nos dois servidores autoritativos da Hostinger.
3. HTTPS de `minhaclara.com` verificado no IP recomendado com validação normal do certificado: HTTP200, servidor Vercel, título Clara e bundle `index-clara-64ae4532b705e8db.js`. `www` retorna HTTP308 para `https://minhaclara.com/`. Evidências em `.local/vercel/clara-domain-https-headers.txt` e `clara-domain-live.html`.
4. Após expirar o cache local, `https://minhaclara.com/` abriu corretamente no navegador às 12:22 UTC, com título Clara, frase original e formulário de entrada. Conexão do domínio concluída. A integração de e-mails e URLs do Supabase é a etapa seguinte, ainda pendente.

Evidência da Vercel: `.local/vercel/clara-domain-status.json`. Credencial de implantação já existente é lida via DPAPI pelo script; nunca copiar seu valor para documentação ou mensagens.

Referências oficiais: [Configurar domínio na Vercel](https://vercel.com/docs/domains/set-up-custom-domain) e [Gerenciar DNS na Hostinger](https://www.hostinger.com/support/1583249-how-to-manage-dns-records-at-hostinger/).
