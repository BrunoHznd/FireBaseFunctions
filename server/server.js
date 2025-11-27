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

function montarSuperPrompt(descricao, promptUser, temPessoa) {
  const chavesRoupaPrioritarias = [
    'tipo_de_peca',
    'modelagem_e_corte',
    'estrutura_da_roupa',
    'texturas_e_materiais',
    'cor_e_padrao',
    'visao_geral',
  ];

  // Junta as partes mais importantes da descrição da roupa
  const partesRoupa = chavesRoupaPrioritarias
    .filter((k) => descricao && descricao[k])
    .map((k) => descricao[k])
    .join(' ');

  const descricaoRoupa =
    partesRoupa ||
    Object.values(descricao || {})
      .filter((v) => typeof v === 'string')
      .join(' ');

  const corPrincipal = descricao?.cor_principal_hex;
  const coresSecundarias = Array.isArray(descricao?.cores_secundarias_hex)
    ? descricao.cores_secundarias_hex
    : [];

  const blocoCor = corPrincipal
    ? `COLOR FIDELITY (HIGH PRIORITY)
- The main color of the clothing must stay visually close to hex ${corPrincipal}.
- Keep the perceived hue and overall brightness consistent with this color. Small adjustments are allowed ONLY to keep realistic studio lighting.
${
  coresSecundarias.length
    ? `- Secondary colors on details, trims or patterns must stay coherent with: ${coresSecundarias.join(
        ', '
      )}.`
    : '- Keep secondary colors coherent with the original reference image.'
}
`
    : `COLOR FIDELITY (HIGH PRIORITY)
- Keep the main color of the clothing as close as possible to the original reference image.
- Do not recolor the garment. Only allow minimal adjustments required for realistic studio lighting.
`;

  const instrucoesManequimExtra = temPessoa
    ? `- If the original image contains a real person, REPLACE them with a neutral mannequin while preserving the garment’s fit, folds and gravity.
- Do NOT reproduce the original person’s face, identity or any recognizable likeness.`
    : `- Use a neutral mannequin. Do NOT add any real person or realistic celebrity look-alike.`;

  return `
Generate a single full-body studio product photo of a neutral white mannequin wearing the reference clothing item described below.

GOAL (TOP PRIORITY)
- Recreate the same garment design, fit and construction from the reference image with maximum fidelity.
- Apply ONLY the edit described in "EDIT REQUEST" and do not change anything else.

MANNEQUIN AND POSE
- Show EXACTLY ONE mannequin.
- Neutral white mannequin body, smooth face, no recognizable identity.
- Full-body view from head to toe, the entire body must be inside the frame.
- Simple fashion pose, similar to a clothing catalog: the mannequin can stand with one hand resting on the hip and legs slightly apart.

BACKGROUND
- Clean light gray to white gradient studio background, like a professional fashion catalog.
- No objects, furniture, logos, text, labels, accessories, or props.
- Add only a very soft, subtle shadow on the floor under the mannequin. Avoid strong or dramatic shadows.

LIGHTING AND RENDERING
- Bright, soft, even studio lighting across the entire garment.
- No harsh shadows, no strong directional spotlights, no colored lights.
- Photo-realistic look, high resolution, high sharpness (not a drawing, not an illustration).
- Avoid noise, glitches, artifacts or surreal distortions.

${instrucoesManequimExtra}

CLOTHING DESCRIPTION (REFERENCE, DO NOT CHANGE THE DESIGN)
${descricaoRoupa}

${blocoCor}
EDIT REQUEST (ONLY CHANGE ALLOWED)
${promptUser}

CONSTRAINTS
- Do NOT change the garment’s overall cut, tailoring, structure, length, neckline, lapels, pockets, buttons, seams or silhouette, except where strictly necessary to apply the edit.
- Do NOT add or remove extra garments, accessories, logos, text or graphic prints that are not part of the reference.
- Do NOT turn this into a UI screenshot, mockup, phone frame, computer screen or any software interface.
- Do NOT add watermarks, icons, labels, color swatches or typography of any kind.

FINAL STYLE
- The final image must look like a professional studio product photo ready for an online store: clean, minimal, realistic and focused entirely on the mannequin and the clothing.
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
