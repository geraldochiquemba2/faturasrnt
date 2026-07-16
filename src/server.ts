import express from 'express';
import cors from 'cors';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import https from 'https';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Force no cache for everything
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  next();
});

app.use(express.static(join(__dirname, '..', 'public')));

const CONFIG_PATH = join(__dirname, '..', 'config.json');
const LOGS_PATH = join(__dirname, '..', 'emitidas.json');

// Read config
function getConfig() {
  if (!existsSync(CONFIG_PATH)) return { prestadores: [], adquirente: {} };
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
}

// Write config
function saveConfig(data: any) {
  const config = getConfig();
  Object.assign(config, data);
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// Read logs
function getLogs() {
  if (!existsSync(LOGS_PATH)) return [];
  return JSON.parse(readFileSync(LOGS_PATH, 'utf8'));
}

// API Routes
app.get('/api/config', (req, res) => {
  res.json(getConfig());
});

app.post('/api/config', (req, res) => {
  saveConfig(req.body);
  res.json({ success: true });
});

app.get('/api/logs', (req, res) => {
  res.json(getLogs());
});

app.get('/api/pdf/:nif/:numero', (req, res) => {
  const downloadsDir = join(__dirname, '..', 'downloads');
  if (!existsSync(downloadsDir)) return res.status(404).json({ error: 'PDF not found' });
  
  let files = readdirSync(downloadsDir).filter((f: string) => f.startsWith(req.params.nif) && f.endsWith('.pdf'));
  
  if (req.params.numero) {
    const safeNum = req.params.numero.replace(/[^a-zA-Z0-9]/g, '_');
    const specific = files.find((f: string) => f.includes(safeNum));
    if (specific) {
      return res.sendFile(join(downloadsDir, specific));
    }
  }
  
  if (files.length > 0) {
    const latest = files.sort((a: string, b: string) => statSync(join(downloadsDir, b)).mtimeMs - statSync(join(downloadsDir, a)).mtimeMs)[0];
    res.sendFile(join(downloadsDir, latest));
  } else {
    res.status(404).json({ error: 'PDF not found' });
  }
});

app.get('/api/pdf/:nif', (req, res) => {
  const downloadsDir = join(__dirname, '..', 'downloads');
  if (!existsSync(downloadsDir)) return res.status(404).json({ error: 'PDF not found' });
  const files = readdirSync(downloadsDir).filter((f: string) => f.startsWith(req.params.nif) && f.endsWith('.pdf'));
  if (files.length > 0) {
    const latest = files.sort((a: string, b: string) => statSync(join(downloadsDir, b)).mtimeMs - statSync(join(downloadsDir, a)).mtimeMs)[0];
    res.sendFile(join(downloadsDir, latest));
  } else {
    res.status(404).json({ error: 'PDF not found' });
  }
});

// Listar PDFs baixados
app.get('/api/pdfs', (req, res) => {
  const downloadsDir = join(__dirname, '..', 'downloads');
  if (!existsSync(downloadsDir)) return res.json([]);
  const files = readdirSync(downloadsDir)
    .filter((f: string) => f.endsWith('.pdf'))
    .map((f: string) => {
      const stat = statSync(join(downloadsDir, f));
      return { name: f, size: stat.size, modified: stat.mtime };
    })
    .sort((a: any, b: any) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
  res.json(files);
});

// Extrair dados de factura via Groq
app.post('/api/extract', async (req, res) => {
  const { pdfBase64, apiKey } = req.body;
  const config = getConfig();
  const key = apiKey || config.groqApiKey;

  if (!key) {
    return res.status(400).json({ error: 'API key do Groq não configurada' });
  }

  if (!pdfBase64) {
    return res.status(400).json({ error: 'PDF não fornecido' });
  }

  try {
    // Extrair texto do PDF com pdf-parse
    const pdfParse = require('pdf-parse');
    const buffer = Buffer.from(pdfBase64, 'base64');
    const pdfData = await pdfParse(buffer);
    const text = pdfData.text;

    if (!text || text.trim().length < 20) {
      return res.status(400).json({ error: 'Não foi possível extrair texto do PDF. O PDF pode ser uma imagem.' });
    }

    console.log('[extract] Texto extraído do PDF (' + text.length + ' caracteres)');

    const prompt = `Analisa este texto de uma factura electrónica da AGT (Angola) e extrai os dados em JSON:
{
  "localPrestacao": "Local de prestação de bens/serviços",
  "descricao": "Descrição do serviço (SEM prefixo SG. ou SE.)",
  "tipoOperacao": "Tipo de operação (ex: Prestação de serviço (geral))",
  "valor": valor numérico total em Kz (apenas o número)
}
Responde APENAS com o JSON, sem texto adicional.

Texto da factura:
${text}`;

    const body = JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
      temperature: 0.1
    });

    const options = {
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      }
    };

    const groqReq = https.request(options, (groqRes) => {
      let data = '';
      groqRes.on('data', (chunk) => { data += chunk; });
      groqRes.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            return res.status(400).json({ error: parsed.error.message || 'Erro na API Groq' });
          }
          const content = parsed.choices?.[0]?.message?.content || '';
          console.log('[extract] Resposta Groq:', content);
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const extracted = JSON.parse(jsonMatch[0]);
            config.referencia = {
              localPrestacao: extracted.localPrestacao || '',
              descricao: (extracted.descricao || '').replace(/^SG\.?\s*/i, '').replace(/^SE\.?\s*/i, ''),
              tipoOperacao: extracted.tipoOperacao || 'Prestação de serviço (geral)',
              notas: config.referencia?.notas || ''
            };
            writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
            res.json(extracted);
          } else {
            res.status(400).json({ error: 'Não foi possível extrair dados. Resposta: ' + content.substring(0, 200) });
          }
        } catch (e: any) {
          res.status(500).json({ error: 'Erro ao processar resposta: ' + e.message });
        }
      });
    });

    groqReq.on('error', (e) => {
      res.status(500).json({ error: 'Erro de conexão com Groq: ' + e.message });
    });

    groqReq.write(body);
    groqReq.end();
  } catch (e: any) {
    res.status(500).json({ error: 'Erro ao processar PDF: ' + e.message });
  }
});

// Guardar referência manualmente
app.post('/api/referencia', (req, res) => {
  const config = getConfig();
  config.referencia = { ...config.referencia, ...req.body };
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  res.json({ success: true });
});

// Extrair e identificar factura por NIF
app.post('/api/extract-single', async (req, res) => {
  const { pdfBase64, prestadores } = req.body;
  const config = getConfig();
  const key = config.groqApiKey;

  if (!key) return res.status(400).json({ error: 'API key do Groq não configurada' });
  if (!pdfBase64) return res.status(400).json({ error: 'PDF não fornecido' });

  try {
    const pdfParse = require('pdf-parse');
    const buffer = Buffer.from(pdfBase64, 'base64');
    const pdfData = await pdfParse(buffer);
    const text = pdfData.text;

    if (!text || text.trim().length < 20) {
      return res.status(400).json({ error: 'Não foi possível extrair texto do PDF' });
    }

    // NIFs dos prestadores selecionados
    const nifs = prestadores || config.prestadores.map((p: any) => p.nif);
    const nifList = nifs.join(', ');

    const prompt = `Analisa esta factura electrónica da AGT (Angola) e extrai TODOS os dados em JSON.

Primeiro, procura na factura um dos seguintes NIFs: ${nifList}
O NIF encontrado deve ser retornado no campo "nifMatch". Se nenhum for encontrado, "nifMatch" deve ser null.

Dados a extrair:
{
  "nifMatch": "NIF do fornecedor encontrado na factura (deve ser um dos listados acima, ou null)",
  "nomeFornecedor": "Nome do fornecedor/prestador",
  "nifAdquirente": "NIF do adquirente/cliente",
  "nomeAdquirente": "Nome do adquirente",
  "localizacaoAdquirente": "Localização do adquirente",
  "contactoAdquirente": "Contacto do adquirente",
  "localPrestacao": "Local de prestação de bens/serviços",
  "descricao": "Descrição do serviço (SEM prefixo SG. ou SE.)",
  "tipoOperacao": "Tipo de operação (ex: Prestação de serviço (geral))",
  "valor": "VALOR TOTAL em Kwanzas. IMPORTANTE: No formato português, ponto é separador de milhar e vírgula é decimal. Exemplo: 195.000,00 = cento e noventa e cinco mil. Retorna APENAS o número SEM pontos nem vírgulas: 195000",
  "precoUnitario": "Preço unitário em Kz (apenas número)",
  "quantidade": quantidade de items/serviços (número inteiro, padrão 1 se não encontrado),
  "desconto": "Valor de desconto em Kz (apenas número, 0 se não houver)",
  "iva": "Valor de IVA em Kz (apenas número, 0 se não houver)",
  "impostoSelo": "Imposto de Selo IS em Kz (apenas número, 0 se não houver)",
  "iec": "IEC em Kz (apenas número, 0 se não houver)",
  "retencaoFonte": "Retenção na fonte IRT em Kz (apenas número, 0 se não houver)",
  "taxaRetencao": "Taxa de retenção na fonte (ex: 6.5)",
  "dataEmissao": "Data de emissão da factura (formato DD/MM/AAAA)",
  "numeroFactura": "Número da factura (ex: FT FT3426P7177N/27)"
}

Responde APENAS com o JSON, sem texto adicional.

Texto da factura:
${text}`;

    const body = JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
      temperature: 0.1
    });

    const options = {
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      }
    };

    const groqReq = https.request(options, (groqRes) => {
      let data = '';
      groqRes.on('data', (chunk) => { data += chunk; });
      groqRes.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            return res.status(400).json({ error: parsed.error.message });
          }
          const content = parsed.choices?.[0]?.message?.content || '';
          console.log('[extract-single] Resposta:', content);
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const extracted = JSON.parse(jsonMatch[0]);
            // Validar que nifMatch é um prestador conhecido
            if (extracted.nifMatch) {
              const prestador = config.prestadores.find((p: any) => p.nif === extracted.nifMatch);
              if (prestador) {
                extracted.nomePrestador = prestador.nome;
              } else {
                extracted.nifMatch = null;
                extracted.nomePrestador = null;
              }
            }
            extracted.descricao = (extracted.descricao || '').replace(/^SG\.?\s*/i, '').replace(/^SE\.?\s*/i, '');
            // Garantir que valor é inteiro (remover pontos de milhar e vírgulas decimais)
            if (extracted.valor) {
              const valorStr = String(extracted.valor).replace(/\./g, '').replace(',', '.');
              extracted.valor = Math.round(parseFloat(valorStr));
            }
            res.json(extracted);
          } else {
            res.status(400).json({ error: 'Não foi possível extrair dados' });
          }
        } catch (e: any) {
          res.status(500).json({ error: 'Erro ao processar: ' + e.message });
        }
      });
    });

    groqReq.on('error', (e) => {
      res.status(500).json({ error: 'Erro de conexão: ' + e.message });
    });

    groqReq.write(body);
    groqReq.end();
  } catch (e: any) {
    res.status(500).json({ error: 'Erro ao processar PDF: ' + e.message });
  }
});

// Emitir facturas identificadas
app.post('/api/emitir-facturas', async (req, res) => {
  const { facturas, notas } = req.body;
  const config = getConfig();

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const send = (data: any) => {
    res.write(JSON.stringify(data) + '\n');
  };

  const { spawn } = require('child_process');

  for (const f of facturas) {
    send({ text: `[${f.nif}] A iniciar ${f.nome || f.nif}...`, type: 'info' });

    // Actualizar referencia no config com os dados extraídos do PDF
    config.referencia = {
      localPrestacao: f.local || config.referencia?.localPrestacao || 'SE Cachiungo',
      descricao: f.descricao || config.referencia?.descricao || 'Servicos de limpeza',
      tipoOperacao: f.tipo || config.referencia?.tipoOperacao || 'Prestação de serviço (geral)',
      notas: notas || config.referencia?.notas || '',
      quantidade: f.quantidade || 1,
      valor: f.valor || config.referencia?.valor || 0,
      precoUnitario: f.precoUnitario || f.valor || config.referencia?.precoUnitario || 0,
      desconto: f.desconto || 0,
      iva: f.iva || 0,
      impostoSelo: f.impostoSelo || 0,
      iec: f.iec || 0,
      retencaoFonte: f.retencaoFonte || 0,
      taxaRetencao: f.taxaRetencao || '',
      dataEmissao: f.dataEmissao || '',
      numeroFactura: f.numeroFactura || ''
    };
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, ['node_modules/ts-node/dist/bin.js', '--transpile-only', 'src/index.ts', f.nif], {
          cwd: join(__dirname, '..'),
          timeout: 300000,
          env: { ...process.env, TS_NODE_TRANSPILE_ONLY: '1' }
        });

        child.stdout.on('data', (data: Buffer) => {
          const lines = data.toString().split('\n').filter((l: string) => l.trim());
          for (const line of lines) {
            if (line.includes('✓') || line.includes('sucesso')) send({ text: `[${f.nif}] ${line.trim()}`, type: 'ok' });
            else if (line.includes('✗') || line.includes('Erro') || line.includes('NÃO')) send({ text: `[${f.nif}] ${line.trim()}`, type: 'err' });
            else send({ text: `[${f.nif}] ${line.trim()}`, type: 'info' });
          }
        });

        child.stderr.on('data', (data: Buffer) => {
          send({ text: `[${f.nif}] ${data.toString().trim()}`, type: 'err' });
        });

        child.on('close', (code: number) => {
          if (code === 0) {
            send({ text: `[${f.nif}] ${f.nome || f.nif} - Factura emitida com sucesso`, type: 'ok' });
            resolve();
          } else {
            send({ text: `[${f.nif}] ${f.nome || f.nif} - Erro (exit code ${code})`, type: 'err' });
            reject(new Error(`Exit code ${code}`));
          }
        });

        child.on('error', (err: Error) => {
          send({ text: `[${f.nif}] Erro: ${err.message}`, type: 'err' });
          reject(err);
        });
      });
    } catch (e) {}
  }

  send({ done: true });
  res.end();
});

// SSE endpoint for real-time logs
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  (req as any).res = res;
});

// Emit invoices
app.post('/api/emitir', async (req, res) => {
  const { prestadores, referenciaNif } = req.body;
  const config = getConfig();

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const send = (data: any) => {
    res.write(JSON.stringify(data) + '\n');
  };

  const runEmit = async () => {
    for (const nif of prestadores) {
      send({ text: `[${nif}] A iniciar...`, type: 'info' });

      try {
        await new Promise<void>((resolve, reject) => {
          const { spawn } = require('child_process');
          const child = spawn(process.execPath, ['node_modules/ts-node/dist/bin.js', '--transpile-only', 'src/index.ts', nif], {
            cwd: join(__dirname, '..'),
            timeout: 300000,
            env: { ...process.env, TS_NODE_TRANSPILE_ONLY: '1' }
          });

          child.stdout.on('data', (data: Buffer) => {
            const lines = data.toString().split('\n').filter((l: string) => l.trim());
            for (const line of lines) {
              if (line.includes('✓')) send({ text: `[${nif}] ${line.trim()}`, type: 'ok' });
              else if (line.includes('✗')) send({ text: `[${nif}] ${line.trim()}`, type: 'err' });
              else send({ text: `[${nif}] ${line.trim()}`, type: 'info' });
            }
          });

          child.stderr.on('data', (data: Buffer) => {
            send({ text: `[${nif}] ${data.toString().trim()}`, type: 'err' });
          });

          child.on('close', (code: number) => {
            if (code === 0) resolve();
            else reject(new Error(`Exit code ${code}`));
          });

          child.on('error', (err: Error) => reject(err));
        });

        send({ text: `[${nif}] ✓ Concluído`, type: 'ok' });
      } catch (err: any) {
        send({ text: `[${nif}] ✗ Erro: ${err.message}`, type: 'err' });
      }
    }

    send({ text: 'Concluído!', type: 'info', done: true });
    res.end();
  };

  runEmit();
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Servidor iniciado em http://localhost:${PORT}\n`);
});
});

export default app;
