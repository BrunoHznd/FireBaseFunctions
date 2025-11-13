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
  return text;
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

  const text = await callChatAPI(body, 'Detecção');
  try {
    return JSON.parse(text);
  } catch {
    return { tem_pessoa: false, confianca: 0.0, descricao: text };
  }
}

// 2️⃣ Descrição detalhada (realismo + moda)
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

Gere um JSON *puro* e *válido* descrevendo a imagem com realismo físico e riqueza de detalhes de moda.

🧩 **Formato de saída JSON obrigatório:**
{
  "visao_geral": "...",
  "tipo_de_peca": "...",
  "modelagem_e_corte": "...",
  "estrutura_da_roupa": "...",
  "texturas_e_materiais": "...",
  "cor_e_padrao": "...",
  "luz_e_iluminacao": "...",
  "config_camera": "...",
  "profundidade_de_campo": "...",
  "imperfeicoes_naturais": "...",
  "ambiente_e_fundo": "...",
  "atmosfera": "...",
  "estilo_fotografico": "..."
}

⚙️ Regras:
- Sempre inicie com { e termine com }.
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

  const text = await callChatAPI(body, 'Descrição');
  try {
    return JSON.parse(text);
  } catch {
    return { visao_geral: text };
  }
}

// 3️⃣ Novo SuperPrompt — com foco em EDIÇÃO explícita e realismo
function montarSuperPrompt(descricao, promptUser, temPessoa) {
  const tecnicos = Object.entries(descricao)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');

  const regrasHumanas = temPessoa
    ? `
- Preserve fielmente a pessoa ou manequim: pose, proporções, iluminação e textura natural.
- As edições devem parecer fotografadas de verdade, com o mesmo corpo, tecido e fundo.`
    : `
- Não adicione pessoas.
- As edições devem afetar apenas o tecido, cor, forma ou textura da roupa, mantendo realismo.`

  return `
📸 CONTEXTO FOTOGRÁFICO ORIGINAL (para referência visual):
${tecnicos}

🎯 TAREFA DE EDIÇÃO:
A partir da descrição acima, **gere uma nova versão da imagem** com aparência **fotográfica realista**, aplicando com precisão o seguinte pedido:

➡️ "${promptUser}"

A edição deve ser claramente visível, mantendo coerência com luz, perspectiva e materiais reais.  
Não ignore o pedido nem o suavize — o resultado final deve refletir claramente essa alteração, sem afetar o restante da imagem.

🔧 REGRAS DE REALISMO:
- Preserve enquadramento, luz, ângulo e textura originais.
- Aplique as mudanças diretamente sobre o objeto ou roupa indicada.
- A edição deve parecer uma foto real, sem aparência digital ou redesenhada.
- Se houver tecido, mantenha o comportamento físico da luz e sombra.
- Se houver pessoa, mantenha rosto e corpo idênticos, apenas alterando o item descrito.

🧭 ESTILO FOTOGRÁFICO:
Fotografia de moda editorial com realismo físico, luz natural difusa, textura nítida e equilíbrio de cores.  
Evite visual de ilustração ou render 3D.
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
      .resize(targetW, targetH, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
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
    res.json({ success: true, url, analise, descricao });
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
