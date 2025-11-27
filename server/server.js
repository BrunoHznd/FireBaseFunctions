import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());
app.use(cors({ origin: true }));

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const IMAGE_SIZE = process.env.IMAGE_SIZE || '1024x1024';

// --- preparar pastas ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outDir = path.join(__dirname, 'outputs');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
app.use('/outputs', express.static(outDir));

app.get('/health', (_req, res) => res.json({ ok: true }));

// utilitário para chamadas de chat
async function callChatAPI(body, label = 'GPT') {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  const data = await resp.json();
  if (!resp.ok) throw new Error(`Erro ${label}: ${JSON.stringify(data)}`);

  const text = data.choices?.[0]?.message?.content || '';
  console.log(`🧠 [${label}] 🔹 Resposta completa:\n${text}\n`);
  return { text, data };
}

// 1️⃣ Detecção de presença humana
async function detectarPessoa(buffer) {
  console.log('🧩 [1] Detectando presença humana...');
  const base64 = buffer.toString('base64');

  const body = {
    model: 'gpt-4o-mini',
    temperature: 0.1,
    messages: [
      {
        role: 'system',
        content: `Responda apenas em JSON:
{
  "tem_pessoa": true|false,
  "confianca": 0.0-1.0,
  "descricao": "resumo objetivo do que aparece"
}`,
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Esta imagem contém uma pessoa, parte humana ou manequim?' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } },
        ],
      },
    ],
  };

  const { text, data } = await callChatAPI(body, 'Detecção');
  try {
    const parsed = JSON.parse(text);
    return { ...parsed, _rawText: text, _rawData: data };
  } catch {
    return {
      tem_pessoa: false,
      confianca: 0.0,
      descricao: text,
      _rawText: text,
      _rawData: data,
    };
  }
}

// 2️⃣ Descrição detalhada (realismo + moda + captura de cores HEX)
async function descreverImagemRealista(buffer) {
  console.log('🧩 [2] Gerando descrição detalhada com foco em moda e realismo...');
  const base64 = buffer.toString('base64');

  const body = {
    model: 'gpt-4o-mini',
    temperature: 0.1,
    messages: [
      {
        role: 'system',
        content: `
Você é um analista visual e fotógrafo profissional especializado em realismo físico e moda.  
Descreva imagens com foco técnico e detalhamento têxtil, como faria um fotógrafo e designer de roupas.

Gere um JSON puro e válido descrevendo a imagem com realismo físico e riqueza de detalhes de moda.

Formato de saída JSON obrigatório:
{
  "visao_geral": "...",
  "tipo_de_peca": "...",
  "modelagem_e_corte": "...",
  "estrutura_da_roupa": "...",
  "texturas_e_materiais": "...",
  "cor_e_padrao": "...",
  "cor_principal_hex": "#RRGGBB",
  "cores_secundarias_hex": ["#RRGGBB", "#RRGGBB"],
  "luz_e_iluminacao": "...",
  "config_camera": "...",
  "profundidade_de_campo": "...",
  "imperfeicoes_naturais": "...",
  "ambiente_e_fundo": "...",
  "atmosfera": "...",
  "estilo_fotografico": "..."
}

Regras:
- Sempre inicie com { e termine com }.
- "cor_principal_hex" deve ser um código aproximado da cor principal da roupa (tecido dominante).
- "cores_secundarias_hex" deve listar até 2 ou 3 cores importantes visíveis na roupa (sombras, detalhes, estampas).
- Informe se a roupa é longa ou curta, tem decote, gola, fenda, mangas, cauda, transparência, etc.
- Descreva o tipo de tecido, textura e comportamento da luz.
- Fale como um fotógrafo e estilista, não como um crítico.
- Evite invenções: descreva apenas o que está visível.
`,
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Descreva tecnicamente esta imagem:' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } },
        ],
      },
    ],
  };

  const { text, data } = await callChatAPI(body, 'Descrição');
  try {
    const parsed = JSON.parse(text);
    return { ...parsed, _rawText: text, _rawData: data };
  } catch {
    return { visao_geral: text, _rawText: text, _rawData: data };
  }
}
// SuperPrompt — foco em FIDELIDADE, 1 roupa, 1 manequim, 1 foto, fundo branco
function montarSuperPrompt(descricao, promptUser, temPessoa) {
  const chavesRoupaPrioritarias = [
    'tipo_de_peca',
    'modelagem_e_corte',
    'estrutura_da_roupa',
    'texturas_e_materiais',
    'cor_e_padrao',
    'visao_geral',
  ];

  const partesRoupa = chavesRoupaPrioritarias
    .filter((k) => descricao && descricao[k])
    .map((k) => `${k}: ${descricao[k]}`)
    .join('\n');

  const tecnicosBase = Object.entries(descricao || {})
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');

  const contextoRoupa = partesRoupa || tecnicosBase;

  const corPrincipal = descricao?.cor_principal_hex;
  const coresSecundarias = descricao?.cores_secundarias_hex;

  const blocoCoresHex = corPrincipal
    ? `
Cor da peça (prioridade máxima):
- A cor principal da roupa deve corresponder ao código ${corPrincipal}.
- Não altere o tom (hue), a saturação ou o brilho dessa cor, salvo ajustes mínimos para manter o realismo de luz de estúdio.
${Array.isArray(coresSecundarias) && coresSecundarias.length
  ? `- Cores secundárias relevantes: ${coresSecundarias.join(
      ', '
    )}. Mantenha coerência visual com essas cores.`
  : ''}
`
    : '';

  const instrucoesManequim = temPessoa
    ? 'Mostre a roupa em UM ÚNICO manequim humano genérico de estúdio, corpo neutro, sem copiar rosto ou identidade da pessoa original.'
    : 'Mostre a roupa em UM ÚNICO manequim humano genérico de estúdio, corpo neutro, sem adicionar nenhuma pessoa específica.';

  return `
Roupa original (descrição técnica):
${contextoRoupa}

${blocoCoresHex}

Objetivo:
Gerar UMA ÚNICA foto de produto da MESMA roupa descrita acima, o mais fiel possível à peça original, como se fosse a mesma foto apenas retocada.

Mudança permitida:
Apenas o seguinte pedido de edição na roupa:
"${promptUser}"

Regras de fidelidade (muito importantes):
- Considere esta tarefa como uma EDIÇÃO mínima da roupa original, não uma nova criação.
- Mantenha o mesmo tipo de peça, modelagem, corte, comprimento, posição e formato dos bolsos, largura das lapelas, quantidade de botões e proporções gerais.
- Não redesenhe o terno, não invente novos detalhes estruturais.
- Se houver conflito entre inventar algo novo e manter o design original, SEMPRE mantenha o design original.

Composição da imagem:
- Single shot: mostre APENAS UM manequim, de corpo inteiro, em UM ÚNICO enquadramento contínuo.
- Produza APENAS UMA fotografia em um único quadro.
- Não mostre múltiplos manequins, múltiplos ângulos, frente e costas, ou variações lado a lado.
- Não crie colagens, grids, mosaicos, split-screen ou painéis múltiplos.
- Não inclua recortes de detalhe, zooms, janelas extras ou closes separados.
- Não inclua textos, logos, ícones, etiquetas, paletas de cor, amostras de tecido, barras laterais ou qualquer elemento gráfico adicional.

Cor:
- A roupa deve manter a mesma cor da peça original. Se houver conflito entre qualquer outra instrução e a cor ${
    corPrincipal || 'original da roupa'
  }, priorize SEMPRE manter essa cor o mais fiel possível.
- Não aplique filtros de cor que mudem a tonalidade do tecido.

Cenário:
- Fundo totalmente branco, puro e uniforme (estúdio de produto).
- Sem gradiente, sem textura, sem paredes, sem objetos, sem linha de horizonte.
- Ignore qualquer descrição de ambiente ou fundo da análise original; use SEMPRE fundo branco neutro.
- Permita apenas uma sombra suave e discreta sob os pés, sem quebrar o fundo branco.

Outras regras:
- Não copie rosto, corpo ou identidade da pessoa original.
- Preserve tipo de peça, caimento, tecido e textura; altere somente o que o pedido de edição exigir.
- Não adicione pessoas reais, celebridades ou logotipos reais.

Estilo:
- Foto de produto simples e realista em estúdio, fundo branco, nitidez alta, sem aparência de ilustração ou cartoon.
${instrucoesManequim}
`;
}


// 4️⃣ Pipeline principal
async function handleGenerate(req, res) {
  try {
    const { prompt } = req.body;
    const file = req.file;
    if (!prompt || !file)
      return res.status(400).json({ error: 'Campos obrigatórios: prompt e image' });

    const [wStr, hStr] = IMAGE_SIZE.split('x');
    const targetW = parseInt(wStr, 10);
    const targetH = parseInt(hStr, 10);

    const imagePng = await sharp(file.buffer)
      .ensureAlpha()
      .resize(targetW, targetH, {
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .png()
      .toBuffer();

    const refName = `ref_${Date.now()}.png`;
    fs.writeFileSync(path.join(outDir, refName), imagePng);

    const analise = await detectarPessoa(imagePng);
    console.log('📊 [Analise Pessoa]:', analise);

    const descricao = await descreverImagemRealista(imagePng);
    console.log('📊 [Descricao Detalhada]:', descricao);

    const descPath = path.join(outDir, `desc_${Date.now()}.json`);
    fs.writeFileSync(descPath, JSON.stringify(descricao, null, 2));

    const superPrompt = montarSuperPrompt(descricao, prompt, analise.tem_pessoa);
    const promptFile = path.join(outDir, `prompt_${Date.now()}.txt`);
    fs.writeFileSync(promptFile, superPrompt);

    console.log('🧾 [SuperPrompt Preview]:', superPrompt.slice(0, 600));

    const resp = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: superPrompt,
        size: `${targetW}x${targetH}`,
        n: 1,
      }),
    });

    const data = await resp.json();
    if (!resp.ok) throw new Error('Erro DALL·E 3: ' + JSON.stringify(data));
    const url = data.data?.[0]?.url;
    if (!url) throw new Error('Sem imagem retornada');

    console.log('✅ Edição gerada com realismo e fidelidade:', url);
    res.json({ success: true, imageUrl: url, analise, descricao, dalleRaw: data, superPrompt });
  } catch (err) {
    console.error('💥 Erro interno:', err);
    res.status(500).json({ error: err.message });
  }
}

app.post('/generate', upload.single('image'), handleGenerate);
app.post('/edit', upload.single('image'), handleGenerate);

app.listen(PORT, () =>
  console.log(`🚀 Servidor DALL·E 3 Realista + Edição rodando em http://localhost:${PORT}`)
);
