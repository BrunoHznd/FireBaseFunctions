# Backend mínimo (Express) para edição com GPT Image 1

## Requisitos
- Node.js LTS

## Instalação
```bash
npm install
```

## Configuração
1. Copie `.env.example` para `.env` e defina:
```
OPENAI_API_KEY=coloque_sua_chave_aqui
```
2. (Opcional) defina `PORT=3000` no `.env`.

## Executar
```bash
npm start
```
O servidor sobe em `http://localhost:3000`.

## Endpoint
- `POST /edit`
  - Form-data (multipart):
    - `prompt`: texto
    - `image`: arquivo de imagem
  - Resposta (JSON):
    - `{ "imageBase64": "<BASE64>" }`

## Testar do aplicativo Expo
- Descubra o IP da sua máquina na rede (ex.: 192.168.0.10)
- No app React Native, edite `config.js`:
```js
export const API_URL = "http://SEU_IP_LOCAL:3000/edit";
export const API_KEY = ""; // deixe vazio no app
```
- Inicie o app com `npm run start` na pasta raiz.

## Observações
- A chave da OpenAI deve ficar somente no servidor (.env). Não exponha no app.
