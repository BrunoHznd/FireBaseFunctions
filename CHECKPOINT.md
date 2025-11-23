     # Checkpoint de Trabalhos Realizados

## 1. Configuração do Firebase
- Inicialização com Cloud Functions e Firebase Hosting em modo SPA.
- Ajuste do `firebase.json` para usar `dist/` como pasta pública e rewrite para `index.html`.

## 2. Front-end Expo/React
- Manutenção do `App.js` como ponto de entrada do app.
- Atualização do `config.js` para apontar a API pública `https://firebasefunctions.onrender.com/edit`.
- Definição do fluxo: editar `App.js` → `npm run build` → `firebase deploy --only hosting`.

## 3. Correções de Lint
- Remoção dos imports não utilizados e ajuste de espaçamento em `functions/index.js` para liberar o predeploy.

## 4. CI/CD (GitHub Actions)
- Atualização dos workflows `firebase-hosting-merge.yml` e `firebase-hosting-pull-request.yml`, adicionando `npm ci` antes de `npm run build` para evitar `expo: not found`.

## 5. Deploy do Hosting
- Deploy manual com `firebase deploy --only hosting`. Observação: não editar `dist/index.html` diretamente, pois o Expo regenera a cada build.

## 6. Backend
- Separação do servidor Express em `server/` com `package.json` próprio.
- Deploy do backend no Render como Serviço Web (Root: `server`, Build: `npm install`, Start: `npm start`).
- Verificação de saúde via `/health` e uso da URL `https://firebasefunctions.onrender.com`.

## 7. Próximos Passos Sugeridos
- Rodar `npm run build` antes de cada deploy do Hosting.
- Manter variáveis sensíveis (`OPENAI_API_KEY`) exclusivamente no Render.
- Considerar autenticação própria para a API e melhorias de monitoramento/logs.
