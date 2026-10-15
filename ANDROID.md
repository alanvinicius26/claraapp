# App Android (Capacitor)

Capacitor 8, `appId` `com.minhaclara.app` (definitivo: vai para a loja), `webDir` `dist`. Pasta `android/` gerada pelo Capacitor e versionada junto com o projeto. Gradle usa JVM 21.

## Desenvolver com atualização ao vivo (dia a dia)

1. Conecte o celular (Depuração USB) ou abra um emulador no Android Studio.
2. Terminal 1: `npm run dev`
3. Terminal 2: `npm run android:live`

O app no aparelho carrega o servidor local (`localhost:3000`, por túnel `adb reverse`, sem expor o computador na rede). Cada alteração no código aparece no aparelho sozinha. O app continua usando o banco de produção definido em `.env.local`: reservas feitas nele são reais.

O mesmo código roda no navegador em `http://localhost:3000`; a maior parte do desenvolvimento pode continuar no navegador e o aparelho serve para conferir.

## Gerar a versão empacotada (sem servidor local)

`npm run android:release` e depois `npm run android:open` → Run ou Build. O comando gera o site, sincroniza e remove qualquer resto do modo ao vivo.

## Proteções

- O modo ao vivo aponta o app para `http://localhost:3000` e libera conexão sem HTTPS. O Capacitor desfaz isso com Ctrl+C; `android:live` também limpa restos ao iniciar e ao encerrar (`scripts/android-guard.mjs`).
- O Gradle recusa qualquer build **release** (APK/AAB de loja) se ainda houver esses restos (`checkNoLiveReload` em `android/app/build.gradle`). Builds de teste (debug) não são afetados.
- Backup desligado: `allowBackup=false` e `data_extraction_rules.xml` excluem os dados do app (incluindo a sessão de login) do backup na nuvem e da transferência entre celulares.

## Pendências antes das lojas

- Liberar a origem do app (`https://localhost`) na função `billing` e nas URLs de autenticação do Supabase.
- Links de e-mail (confirmação/recuperação) apontarem para minhaclara.com ou deep link.
- Checkout Stripe no navegador externo; regra da Apple para assinatura no iOS.
- Avisos: adaptador `@capacitor/local-notifications` em `createAlertDelivery`; push com o app fechado (FCM/APNs). Ver AVISOS-RESERVAS.md.
- iOS exige Mac com Xcode (ou build na nuvem) e conta Apple Developer.
