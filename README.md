# Formulário simples (Ateliê) – React Native (Expo)

## Requisitos
- Node.js LTS
- Expo CLI (`npm i -g expo`)

## Instalação
```bash
npm install
npm run start
```

## Configuração da API
Edite o arquivo `config.js`:
```js
export const API_URL = "https://sua-api-gpt-imagem1.exemplo.com/editar";
export const API_KEY = ""; // se necessário
```

O app envia `multipart/form-data` com:
- `prompt`: texto das instruções
- `image`: arquivo da imagem

A API deve responder com:
- `imageUrl` em JSON, ou `imageBase64` em JSON, ou binário da imagem no corpo

## Fluxo
1. Digite o texto de instrução.
2. Selecione a imagem de referência.
3. Toque em "Enviar para edição" para chamar sua API do GPT Imagem 1.
