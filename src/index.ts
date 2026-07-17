import puppeteer from 'puppeteer-core';
import * as fs from 'fs';
import * as path from 'path';

const DOWNLOAD_DIR = path.resolve('downloads');
const SCREENSHOTS_DIR = path.resolve('screenshots');

interface Config {
  adquirente: { nif: string; nome: string; contacto: string };
  prestadores: { nif: string; password: string; nome?: string }[];
  chromePath: string;
  valorMinimo: number;
  valorMaximo: number;
  groqApiKey?: string;
  referencia?: { 
    localPrestacao: string; 
    descricao: string; 
    tipoOperacao: string; 
    notas: string; 
    quantidade?: number; 
    valor?: number;
    precoUnitario?: number;
    desconto?: number;
    iva?: number;
    impostoSelo?: number;
    iec?: number;
    retencaoFonte?: number;
    taxaRetencao?: string;
    dataEmissao?: string;
    numeroFactura?: string;
  };
}

interface ReferenciaFactura {
  localPrestacao: string;
  descricao: string;
  valor: number;
  quantidade: number;
}

interface FacturaEmitida {
  prestadorNif: string;
  nome: string;
  numeroFactura: string;
  valor: number;
  data: string;
  localPrestacao: string;
  descricao: string;
  pdfPath: string;
  timestamp: string;
}

function loadConfig(): Config {
  return {
    adquirente: { nif: '5410778197', nome: 'REDE NACIONAL DE TRANSPORTE DE ELECTRICIDADE', contacto: '923636157' },
    prestadores: [],
    chromePath: '',
    valorMinimo: 50000,
    valorMaximo: 250000,
    groqApiKey: process.env.GROQ_API_KEY || '',
    referencia: {
      localPrestacao: 'SE Cachiungo',
      descricao: 'Servicos de limpeza a SE Cachiungo',
      tipoOperacao: 'Prestação de serviço (geral)',
      notas: '',
      quantidade: 1,
      valor: 0,
    }
  };
}

async function loadConfigWithPasswords(): Promise<Config> {
  const config = loadConfig();
  const port = process.env.PORT || 3000;

  try {
    const http = require('http');
    const data = await new Promise<string>((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/api/internal/config`, (res: any) => {
        let body = '';
        res.on('data', (c: Buffer) => { body += c; });
        res.on('end', () => resolve(body));
      }).on('error', reject);
    });
    const remote = JSON.parse(data);
    if (remote.prestadores && remote.prestadores.length > 0) {
      config.prestadores = remote.prestadores;
    }
    if (remote.adquirente) config.adquirente = remote.adquirente;
    if (remote.referencia) config.referencia = { ...config.referencia, ...remote.referencia };
  } catch (e) {
    console.log('[index] Sem acesso ao servidor, a usar dados por defeito');
  }

  return config;
}

function loadLog(): FacturaEmitida[] {
  return [];
}

function saveLog(log: FacturaEmitida[]): void {
  const http = require('http');
  const port = process.env.PORT || 3000;
  for (const entry of log) {
    let pdfData: string | null = null;
    if (entry.pdfPath) {
      const pdfFull = path.join(DOWNLOAD_DIR, entry.pdfPath);
      if (fs.existsSync(pdfFull)) {
        pdfData = fs.readFileSync(pdfFull).toString('base64');
      }
    }
    const payload = { ...entry, pdfData };
    const data = JSON.stringify(payload);
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/api/logs',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, (res: any) => {
      let body = '';
      res.on('data', (c: Buffer) => { body += c; });
      res.on('end', () => { console.log(`[${entry.prestadorNif}] Log guardado: ${body}`); });
    });
    req.on('error', (e: any) => console.error('Erro ao guardar log:', e.message));
    req.write(data);
    req.end();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getRandomDate(): string {
  const now = new Date();
  const daysAgo = Math.floor(Math.random() * 30) + 1;
  const date = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function getRandomValor(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min)) + min;
}

async function waitForAny(page: any, selectors: string[], timeout = 5000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    for (const sel of selectors) {
      const el = await page.$(sel);
      if (el) return true;
    }
    await sleep(200);
  }
  return false;
}

async function login(page: any, nif: string, password: string): Promise<boolean> {
  console.log(`[${nif}] A fazer login...`);

  for (let attempt = 0; attempt < 7; attempt++) {
    try {
      console.log(`[${nif}] Attempt ${attempt}: navigating to auth...`);
      await page.goto('https://quiosqueagt.minfin.gov.ao/auth', { waitUntil: 'domcontentloaded', timeout: 30000 });
      console.log(`[${nif}] Page loaded, waiting for elements...`);
      await waitForAny(page, ['button', 'input'], 8000);

      // Desactivar autofill do browser
      await page.evaluate(() => {
        document.querySelectorAll('input').forEach(inp => {
          inp.setAttribute('autocomplete', 'off');
        });
      });

      // Screenshot para debug
      try { await page.screenshot({ path: `screenshots/login_${nif}_attempt${attempt}.png`, fullPage: true }); } catch { /* ignore */ }

      console.log(`[${nif}] Looking for Portal do Contribuinte button...`);
      try {
        await page.waitForSelector('button', { timeout: 5000 });
        const clicked = await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const portalBtn = btns.find(b => b.textContent?.includes('Portal do Contribuinte'));
          if (portalBtn) { (portalBtn as HTMLElement).click(); return true; }
          return false;
        });
        console.log(`[${nif}] Portal do Contribuinte clicked: ${clicked}`);
      } catch (e: any) {
        console.log(`[${nif}] Portal click error: ${e.message}`);
      }

      try { await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {}); } catch {}
    await sleep(200);
    console.log(`[${nif}] After portal wait...`);

      // Screenshot após clicar "Portal do Contribuinte"
      try { await page.screenshot({ path: `screenshots/login_${nif}_portal${attempt}.png`, fullPage: true }); } catch {}
      console.log(`[${nif}] screenshot done, looking for NIF input...`);

      const nifInput = await page.$('input[type="text"], input[type="number"]');
      console.log(`[${nif}] NIF input found: ${!!nifInput}`);
      if (nifInput) { await nifInput.click({ clickCount: 3 }); await nifInput.type(nif, { delay: 5 }); }
      await sleep(100);

      const passInput = await page.$('input[type="password"]');
      console.log(`[${nif}] Pass input found: ${!!passInput}`);
      if (passInput) { await passInput.click({ clickCount: 3 }); await passInput.type(password, { delay: 5 }); }
      await sleep(100);
      console.log(`[${nif}] Inputs filled, taking before_submit screenshot...`);

      // Screenshot antes de submeter
      await page.screenshot({ path: `screenshots/login_${nif}_before_submit${attempt}.png`, fullPage: true });

      console.log(`[${nif}] Looking for Iniciar Sessão button...`);
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const loginBtn = btns.find(b => b.textContent?.includes('Iniciar Sessão'));
        if (loginBtn) (loginBtn as HTMLElement).click();
      });
      console.log(`[${nif}] Iniciar Sessão clicked`);

      for (let i = 0; i < 10; i++) {
        await sleep(1000);
        const url = page.url();
        console.log(`[${nif}] URL actual: ${url}`);
        if (!url.includes('auth')) {
          console.log(`[${nif}] ✓ Login OK`);
          return true;
        }
        if (i === 2) {
          await page.screenshot({ path: `screenshots/login_${nif}_waiting${attempt}.png`, fullPage: true });
          const errorMsg = await page.evaluate(() => {
            const alerts = document.querySelectorAll('.alert, .error, .message, [class*="error"], [class*="alert"], .p-toast-message');
            return Array.from(alerts).map(a => a.textContent?.trim()).join(' | ');
          });
          if (errorMsg) console.log(`[${nif}] Erro na página: ${errorMsg}`);
        }
        if (i === 3 && attempt < 6) {
          console.log(`[${nif}] Retry login...`);
          break;
        }
      }
    } catch (e: any) {
      console.log(`[${nif}] Attempt ${attempt} error: ${e.message}`);
    }
  }

  // Screenshot final do falhanço
  await page.screenshot({ path: `screenshots/login_${nif}_failed.png`, fullPage: true });
  console.log(`[${nif}] ✗ Falha no login`);
  return false;
}

async function emitirFactura(
  browser: any,
  config: Config,
  prestador: { nif: string; password: string; nome?: string },
  numero: number
): Promise<FacturaEmitida | null> {
  let page: any = null;
  try {
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    const client = await page.target().createCDPSession();
    try {
      await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOAD_DIR });
    } catch {
      try {
        await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOAD_DIR, eventsEnabled: true });
      } catch { /* ignore */ }
    }

    console.log(`\n========== [${prestador.nif}] Factura #${numero} ==========`);

    const loggedIn = await login(page, prestador.nif, prestador.password);
    if (!loggedIn) return null;

    // Usar dados de referência do config (extraídos do PDF)
    const referencia: ReferenciaFactura = {
      localPrestacao: config.referencia?.localPrestacao || 'SE Cachiungo',
      descricao: config.referencia?.descricao || 'Servicos de limpeza a SE Cachiungo',
      valor: config.referencia?.valor || getRandomValor(config.valorMinimo, config.valorMaximo),
      quantidade: config.referencia?.quantidade || 1
    };

    // Processar notas do utilizador com IA - entende linguagem natural
    const notas = config.referencia?.notas || '';
    if (notas && config.groqApiKey) {
      try {
        const https = require('https');
        const prompt = `Analisa estas notas do utilizador e extrai os campos que quer alterar no formato JSON.

Campos possíveis:
- valor: número (preço unitário em Kz)
- local: texto (local de prestação)
- descricao: texto (descrição do serviço)
- quantidade: número inteiro

Notas do utilizador: "${notas}"

Se o utilizador não mencionar um campo, não o incluas no JSON.
Responde APENAS com o JSON ex: {"valor": 2000} ou {"local": "Luanda", "valor": 50000}`;

        const body = JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 200,
          temperature: 0.1
        });

        const overrides = await new Promise<any>((resolve) => {
          const groqReq = https.request({
            hostname: 'api.groq.com',
            path: '/openai/v1/chat/completions',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${config.groqApiKey}`
            }
          }, (groqRes: any) => {
            let data = '';
            groqRes.on('data', (chunk: Buffer) => { data += chunk; });
            groqRes.on('end', () => {
              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.message?.content || '';
                const jsonMatch = content.match(/\{[\s\S]*\}/);
                if (jsonMatch) resolve(JSON.parse(jsonMatch[0]));
                else resolve({});
              } catch { resolve({}); }
            });
          });
          groqReq.on('error', () => resolve({}));
          groqReq.write(body);
          groqReq.end();
        });

        if (overrides.valor && !isNaN(Number(overrides.valor))) {
          referencia.valor = Number(overrides.valor);
          console.log(`[${prestador.nif}] Override valor via notas: ${referencia.valor}`);
        }
        if (overrides.local) {
          referencia.localPrestacao = overrides.local;
          console.log(`[${prestador.nif}] Override local via notas: ${referencia.localPrestacao}`);
        }
        if (overrides.descricao) {
          referencia.descricao = overrides.descricao;
          console.log(`[${prestador.nif}] Override descrição via notas: ${referencia.descricao}`);
        }
        if (overrides.quantidade && !isNaN(Number(overrides.quantidade))) {
          referencia.quantidade = Number(overrides.quantidade);
          console.log(`[${prestador.nif}] Override quantidade via notas: ${referencia.quantidade}`);
        }
      } catch (e) {
        console.log(`[${prestador.nif}] Erro ao processar notas: ${e}`);
      }
    }

    console.log(`[${prestador.nif}] Referência: ${referencia.localPrestacao} - ${referencia.descricao} - Qtd: ${referencia.quantidade} - Valor: ${referencia.valor}`);

    // Navegar para emitir
    await page.goto('https://quiosqueagt.minfin.gov.ao/facturacao-eletronica/emitir-factura', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const dropdownFound =     await waitForAny(page, ['p-dropdown'], 15000);
    if (!dropdownFound) {
      console.log(`[${prestador.nif}] ⚠ p-dropdown não encontrado, tentando again...`);
      await sleep(1000);
      await waitForAny(page, ['p-dropdown'], 15000);
    }

    // Desactivar autofill do browser
    await page.evaluate(() => {
      document.querySelectorAll('input').forEach(inp => {
        inp.setAttribute('autocomplete', 'off');
      });
    });

    const valor = referencia.valor;

    // 1. Tipo documento = Factura
    await page.click('p-dropdown').catch(() => {});
    await sleep(500);
    await page.waitForSelector('.p-dropdown-panel', { timeout: 5000 }).catch(() => {});
    await sleep(300);

    let tipoSelected = await page.evaluate(() => {
      const panel = document.querySelector('.p-dropdown-panel');
      if (!panel) return null;
      const items = Array.from(panel.querySelectorAll('.p-dropdown-item'));
      for (const item of items) {
        if (item.textContent?.trim() === 'Factura') {
          (item as HTMLElement).click();
          return 'Factura';
        }
      }
      return null;
    });

    if (!tipoSelected) {
      await page.keyboard.press('Escape');
      await sleep(150);
      await page.click('p-dropdown').catch(() => {});
      await sleep(500);
      await page.keyboard.press('ArrowDown');
      await sleep(100);
      await page.keyboard.press('Enter');
      await sleep(200);
      tipoSelected = 'via-teclado';
    }
    
    await page.screenshot({ path: `screenshots/${prestador.nif}_tipo_doc.png`, fullPage: true });
    console.log(`[${prestador.nif}] ✓ Tipo: ${tipoSelected}`);
    await sleep(300);

    // 2. NIF adquirente
    await page.evaluate((nif: string) => {
      const inputs = Array.from(document.querySelectorAll('input')) as HTMLInputElement[];
      for (const input of inputs) {
        if (input.placeholder?.includes('Informe o nº')) {
          const ns = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          if (ns) ns.call(input, nif);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    }, config.adquirente.nif);
    await sleep(200);
    console.log(`[${prestador.nif}] ✓ NIF: ${config.adquirente.nif}`);

    // 3. Lupa
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      for (const btn of btns) {
        if (btn.querySelector('svg') && btn.textContent?.trim() === '') { btn.click(); break; }
      }
    });
    await sleep(500);
    console.log(`[${prestador.nif}] ✓ Lupa`);

    // 4. Nome
    await page.evaluate((nome: string) => {
      const inputs = Array.from(document.querySelectorAll('input')) as HTMLInputElement[];
      for (const input of inputs) {
        const container = input.closest('.form-group') || input.closest('.col');
        const label = container?.querySelector('label')?.textContent || '';
        if (label.toLowerCase().includes('nome') && !input.placeholder?.toLowerCase().includes('nif')) {
          const ns = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          if (ns) ns.call(input, nome);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    }, config.adquirente.nome);
    await sleep(200);
    console.log(`[${prestador.nif}] ✓ Nome`);

    // 5. Data - usar data do utilizador ou data de hoje
    let dataServico = config.referencia?.dataEmissao || new Date().toISOString().split('T')[0];
    // Garantir que não é futura
    const hojeISO = new Date().toISOString().split('T')[0];
    if (dataServico > hojeISO) dataServico = hojeISO;
    await page.evaluate((isoDate: string) => {
      const input = document.querySelector('input[formcontrolname="dateServiceProvision"]') as HTMLInputElement;
      if (input) {
        input.type = 'text';
        const ns = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        ns.call(input, isoDate);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('blur', { bubbles: true }));
        (input as HTMLElement).blur();
      }
    }, dataServico);
    await sleep(200);
    console.log(`[${prestador.nif}] ✓ Data: ${dataServico}`);

    // 6. Local de prestação
    await page.evaluate((local: string) => {
      const input = document.querySelector('input[formcontrolname="placeServiceProvision"]') as HTMLInputElement;
      if (input) {
        const ns = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (ns) ns.call(input, local);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, referencia.localPrestacao);
    await sleep(200);
    console.log(`[${prestador.nif}] ✓ Local: ${referencia.localPrestacao}`);

    // 7. Adicionar item - clicar "Adicionar a lista" para abrir painel
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      for (const btn of btns) { if (btn.textContent?.includes('Adicionar a lista')) { btn.click(); break; } }
    });
    await sleep(800);
    await page.screenshot({ path: `screenshots/${prestador.nif}_panel_open.png`, fullPage: true });

    // 8a. Tipo Operação = Prestação de serviço (geral) - sempre
    // Encontrar dropdown pelo label "Tipo de Operação"
    await page.evaluate(() => {
      const labels = document.querySelectorAll('label');
      for (const label of labels) {
        if (label.textContent?.includes('Tipo de Operação')) {
          const field = label.closest('.field, .col, .row, [class*="field"]') || label.parentElement;
          if (field) {
            const dd = field.querySelector('p-dropdown') as HTMLElement;
            if (dd) {
              const trigger = dd.querySelector('.p-dropdown, a, div') as HTMLElement;
              if (trigger) trigger.click();
            }
          }
        }
      }
    });
    await sleep(500);

    let selected = await page.evaluate(() => {
      const panels = document.querySelectorAll('.p-dropdown-panel');
      for (const panel of panels) {
        if ((panel as HTMLElement).offsetParent === null) continue;
        const items = panel.querySelectorAll('.p-dropdown-item, li');
        for (const item of items) {
          const text = item.textContent?.trim() || '';
          if (text.toLowerCase().includes('prestação') && text.toLowerCase().includes('geral')) {
            (item as HTMLElement).click();
            return text;
          }
        }
      }
      return null;
    });

    if (!selected) {
      await page.keyboard.press('Escape');
      await sleep(150);
      await page.evaluate(() => {
        const labels = document.querySelectorAll('label');
        for (const label of labels) {
          if (label.textContent?.includes('Tipo de Operação')) {
            const field = label.closest('.field, .col, .row, [class*="field"]') || label.parentElement;
            if (field) {
              const dd = field.querySelector('p-dropdown') as HTMLElement;
              if (dd) {
                const trigger = dd.querySelector('.p-dropdown, a, div') as HTMLElement;
                if (trigger) trigger.click();
              }
            }
          }
        }
      });
      await sleep(400);
      await page.keyboard.press('ArrowDown');
      await sleep(100);
      await page.keyboard.press('Enter');
      await sleep(200);
      selected = 'via-teclado';
    }

    await page.screenshot({ path: `screenshots/${prestador.nif}_tipo_selected.png`, fullPage: true });
    console.log(`[${prestador.nif}] ✓ Tipo de Operação: ${selected}`);
    await sleep(300);

    // 8b. Descrição - procurar textarea pelo label
    await page.evaluate((desc: string) => {
      const labels = document.querySelectorAll('label');
      for (const label of labels) {
        if (label.textContent?.includes('Descrição')) {
          const field = label.closest('.field, .col, .row, [class*="field"]') || label.parentElement;
          if (field) {
            const ta = field.querySelector('textarea') as HTMLTextAreaElement;
            if (ta) {
              ta.focus();
              const ns = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
              if (ns) ns.call(ta, desc);
              ta.dispatchEvent(new Event('input', { bubbles: true }));
              ta.dispatchEvent(new Event('change', { bubbles: true }));
              ta.dispatchEvent(new Event('blur', { bubbles: true }));
              return;
            }
          }
        }
      }
      // Fallback
      const textareas = document.querySelectorAll('textarea');
      for (const ta of textareas) {
        if ((ta as HTMLElement).offsetParent !== null) {
          ta.focus();
          const ns = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
          if (ns) ns.call(ta, desc);
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          ta.dispatchEvent(new Event('change', { bubbles: true }));
          break;
        }
      }
    }, referencia.descricao);
    await sleep(200);
    console.log(`[${prestador.nif}] ✓ Descrição`);

    // 8c. Preço unitário - portal espera valor × 100 (divide por 100 internamente)
    const priceStr = (valor * 100).toString();
    const allInputsInfo = await page.evaluate(() => {
      const inputs = document.querySelectorAll('input');
      return Array.from(inputs).map((inp, i) => ({
        i,
        placeholder: inp.placeholder,
        value: inp.value,
        type: inp.type,
        visible: (inp as HTMLElement).offsetParent !== null,
        rect: inp.getBoundingClientRect()
      })).filter(x => x.visible && x.rect.width > 0);
    });
    console.log(`[${prestador.nif}] Inputs visíveis:`, JSON.stringify(allInputsInfo.map(x => ({ i: x.i, ph: x.placeholder, val: x.value }))));

    // Encontrar input do preço - procurar label "Preço unitário" e depois o input dentro do mesmo field
    const priceInput = await page.evaluateHandle(() => {
      const labels = document.querySelectorAll('label');
      for (const label of labels) {
        if (label.textContent?.includes('Preço unitário (sem')) {
          // Subir ao field container e procurar input dentro
          let container = label.parentElement;
          for (let i = 0; i < 5 && container; i++) {
            const inp = container.querySelector('input:not([type="hidden"])');
            if (inp) return inp;
            container = container.parentElement;
          }
        }
      }
      return null;
    });

    if (priceInput && priceInput.asElement()) {
      const el = priceInput.asElement()!;
      await el.click({ clickCount: 3 });
      await sleep(100);
      await page.keyboard.press('Backspace');
      await sleep(100);
      await el.type(priceStr, { delay: 30 });
      await sleep(100);
      await page.keyboard.press('Tab');
      await sleep(200);
      console.log(`[${prestador.nif}] ✓ Preço typed: ${priceStr}`);
    } else {
      console.log(`[${prestador.nif}] ✗ Preço input NÃO encontrado`);
    }
    await page.screenshot({ path: `screenshots/${prestador.nif}_price_debug.png`, fullPage: true });

    // 8d. Quantidade - usar element.click() + keyboard.type()
    const qty = referencia.quantidade || 1;
    const qtyInputs = await page.$$('input');
    for (const inp of qtyInputs) {
      const ph = await inp.evaluate((el: HTMLInputElement) => el.placeholder || '');
      const val = await inp.evaluate((el: HTMLInputElement) => el.value || '');
      if (val === '1' || ph.includes('Quantidade')) {
        const box = await inp.boundingBox();
        if (box && box.y > 0) {
          await inp.click({ clickCount: 3 });
          await sleep(100);
          await page.keyboard.press('Backspace');
          await sleep(100);
          await inp.type(String(qty), { delay: 30 });
          await page.keyboard.press('Tab');
          await sleep(100);
          break;
        }
      }
    }
    console.log(`[${prestador.nif}] ✓ Quantidade: ${qty}`);

    // 8e. Toggle imposto OFF
    await page.evaluate(() => {
      const switches = document.querySelectorAll('agt-switch, [class*="switch"], [class*="toggle"], p-inputswitch');
      for (const sw of switches) {
        if ((sw as HTMLElement).offsetParent !== null) {
          const input = sw.querySelector('input[type="checkbox"]') as HTMLInputElement;
          const slider = sw.querySelector('.p-inputswitch-slider, span.slider, .slider, [class*="slider"]') as HTMLElement;
          if (input && input.checked && slider) {
            slider.click();
          }
        }
      }
    });
    await sleep(300);
    console.log(`[${prestador.nif}] ✓ Imposto OFF`);

    await page.screenshot({ path: `screenshots/${prestador.nif}_before_add.png`, fullPage: true });
    
    // Clicar "Adicionar" no painel (topo direito)
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      for (const btn of btns) {
        if (btn.textContent?.trim() === 'Adicionar') {
          const rect = btn.getBoundingClientRect();
          if (rect.y < 150 && rect.x > 800 && rect.width > 0) {
            btn.click();
            break;
          }
        }
      }
    });
    await sleep(1000);

    // Screenshot após click
    await page.screenshot({ path: `screenshots/${prestador.nif}_after_add.png`, fullPage: true });

    // Verificar item adicionado
    const itemAdded = await page.evaluate(() => {
      const rows = document.querySelectorAll('.p-datatable-tbody tr, table tbody tr');
      return rows.length;
    });
    console.log(`[${prestador.nif}] ✓ Items na tabela: ${itemAdded}`);

    if (itemAdded === 0) {
      const validationErrors = await page.evaluate(() => {
        const errors = document.querySelectorAll('.p-error, [class*="error"]');
        return Array.from(errors).filter(e => (e as HTMLElement).offsetParent !== null).map(e => e.textContent?.trim()).filter(Boolean);
      });
      if (validationErrors.length > 0) {
        console.log(`[${prestador.nif}] Erros: ${validationErrors.join(' | ')}`);
      }
      
      // Retry
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        for (const btn of btns) {
          if (btn.textContent?.trim() === 'Adicionar') {
            const rect = btn.getBoundingClientRect();
            if (rect.y < 150 && rect.x > 800) {
              btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            }
          }
        }
      });
      await sleep(1000);
    }

    // 9. Submeter
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const subBtn = btns.find(b => b.offsetParent !== null && b.textContent?.includes('Submeter'));
      if (subBtn) (subBtn as HTMLElement).click();
    });
    await sleep(1500);

    // 10. Verificar sucesso
    const sucesso = await page.evaluate(() => document.body.innerText.includes('Sucesso'));
    if (!sucesso) {
      console.log(`[${prestador.nif}] ✗ Factura NÃO emitida`);
      return null;
    }

    // Fechar diálogo de sucesso
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      for (const btn of btns) { if (btn.textContent?.trim() === 'Não') { btn.click(); break; } }
    });
    await sleep(500);

    // Extrair número da factura
    const numeroFactura = await page.evaluate(() => {
      const body = document.body.innerText;
      const m = body.match(/FT\s*FT\d+P\d+N\/\d+/);
      return m ? m[0] : `FT-${Date.now()}`;
    });

    console.log(`[${prestador.nif}] ✓ Factura emitida: ${numeroFactura} - ${valor} AKZ`);

    // 11. Download - ir directamente à consulta e baixar o PDF mais recente
    await page.goto('https://quiosqueagt.minfin.gov.ao/facturacao-eletronica/consulta', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForAny(page, ['table tbody tr', '.p-datatable-tbody tr'], 10000);
    await sleep(500);
    await page.screenshot({ path: `screenshots/${prestador.nif}_consulta.png`, fullPage: true });

    // Configurar download CDP em todas as tabs
    const setupDownload = async (target: any) => {
      try {
        const client = await target.createCDPSession();
        await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOAD_DIR });
      } catch {
        try {
          const client = await target.createCDPSession();
          await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOAD_DIR, eventsEnabled: true });
        } catch { /* ignore */ }
      }
    };
    await setupDownload(page);

    // Clicar "Acções" na primeira linha
    await page.evaluate(() => {
      const rows = document.querySelectorAll('table tbody tr, .p-datatable-tbody tr');
      if (rows.length > 0) {
        const btns = rows[0].querySelectorAll('button');
        for (const btn of Array.from(btns)) {
          if (btn.textContent?.includes('Acções') || btn.querySelector('.pi-ellipsis-v, .pi-bars')) {
            (btn as HTMLElement).click(); return;
          }
        }
      }
    });
    await sleep(400);
    await page.screenshot({ path: `screenshots/${prestador.nif}_acoes.png`, fullPage: true });

    // Clicar "Ver documento"
    await page.evaluate(() => {
      const items = document.querySelectorAll('.p-menuitem, [class*="menu-item"], li, a, span');
      for (const item of Array.from(items)) {
        const text = item.textContent?.trim() || '';
        if (text.toLowerCase().includes('ver documento')) {
          (item as HTMLElement).click(); return;
        }
      }
    });
    await sleep(2500);
    await page.screenshot({ path: `screenshots/${prestador.nif}_documento.png`, fullPage: true });

    // Procurar botão de download no modal
    const downloadClicked = await page.evaluate(() => {
      // 1. Procurar por botões com ícone de download (SVG com path de seta para baixo)
      const allBtns = document.querySelectorAll('button');
      const actionBtns: { el: HTMLElement; x: number; y: number }[] = [];
      for (const btn of Array.from(allBtns)) {
        const rect = (btn as HTMLElement).getBoundingClientRect();
        if (rect.width > 0 && rect.width < 100 && rect.y > 0 && rect.y < 200 && rect.x > 800) {
          actionBtns.push({ el: btn as HTMLElement, x: rect.x, y: rect.y });
        }
      }
      // Ordenar por x (menor = mais à esquerda = download)
      actionBtns.sort((a, b) => a.x - b.x);
      if (actionBtns.length > 0) {
        actionBtns[0].el.click();
        return true;
      }
      return false;
    });

    if (downloadClicked) {
      console.log(`[${prestador.nif}] ✓ Botão de download clicado`);
    } else {
      console.log(`[${prestador.nif}] ⚠ Botão de download não encontrado, tentando link directo`);
      // Tentar encontrar link de download no modal
      await page.evaluate(() => {
        const links = document.querySelectorAll('a[href*="download"], a[href*="pdf"], a[download]');
        for (const link of Array.from(links)) {
          (link as HTMLElement).click(); return;
        }
      });
    }
    
    await sleep(1500);

    // Verificar todas as tabs abertas
    const pages = await page.browser().pages();
    console.log(`[${prestador.nif}] Tabs abertas: ${pages.length}`);
    for (const p of pages) {
      const url = p.url();
      console.log(`[${prestador.nif}] Tab URL: ${url}`);
      // Se encontrou tab com PDF, configurar download e fechar
      if (url.includes('.pdf') || url.includes('download') || url.includes('documento')) {
        if (p !== page) {
          await setupDownload(p);
          await sleep(1000);
          await p.close();
        }
      }
    }

    await sleep(1000);

    // Verificar pasta downloads do projecto E pasta Downloads do user
    let dlFiles = fs.readdirSync(DOWNLOAD_DIR).filter(f => f.endsWith('.pdf'));
    
    // Se não encontrou no projecto, procurar na pasta Downloads do user
    if (dlFiles.length === 0) {
      const userDlDir = path.join('C:\\Users\\geral\\Downloads');
      if (fs.existsSync(userDlDir)) {
        const userFiles = fs.readdirSync(userDlDir).filter(f => f.endsWith('.pdf'));
        for (const f of userFiles) {
          const src = path.join(userDlDir, f);
          const safeNum = numeroFactura.replace(/[^a-zA-Z0-9]/g, '_');
          const newName = `${prestador.nif}_${safeNum}.pdf`;
          const dest = path.join(DOWNLOAD_DIR, newName);
          fs.copyFileSync(src, dest);
          console.log(`[${prestador.nif}] ✓ PDF copiado: ${newName}`);
        }
        dlFiles = fs.readdirSync(DOWNLOAD_DIR).filter(f => f.endsWith('.pdf'));
      }
    }

    console.log(`[${prestador.nif}] PDFs na pasta downloads: ${dlFiles.length}`);

    // Renomear PDF com número da factura
    try {
      if (dlFiles.length > 0) {
        const latest = dlFiles.sort((a, b) => fs.statSync(path.join(DOWNLOAD_DIR, b)).mtimeMs - fs.statSync(path.join(DOWNLOAD_DIR, a)).mtimeMs)[0];
        const safeNum = numeroFactura.replace(/[^a-zA-Z0-9]/g, '_');
        const newName = `${prestador.nif}_${safeNum}.pdf`;
        const oldPath = path.join(DOWNLOAD_DIR, latest);
        const newPath = path.join(DOWNLOAD_DIR, newName);
        if (oldPath !== newPath) fs.renameSync(oldPath, newPath);
        console.log(`[${prestador.nif}] ✓ PDF: ${newName}`);
      } else {
        console.log(`[${prestador.nif}] ⚠ Nenhum PDF encontrado`);
      }
    } catch (e) { console.log(`[${prestador.nif}] ⚠ Erro ao renomear PDF: ${e}`); }

    const pdfName = `${prestador.nif}_${numeroFactura.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;

    return {
      prestadorNif: prestador.nif,
      nome: prestador.nome,
      numeroFactura,
      valor,
      data: dataServico,
      localPrestacao: referencia.localPrestacao,
      descricao: referencia.descricao,
      pdfPath: pdfName,
      timestamp: new Date().toLocaleString('pt-AO', { timeZone: 'Africa/Luanda' }),
    };

  } catch (error) {
    console.error(`[${prestador.nif}] ✗ Erro: ${error}`);
    return null;
  } finally {
    await page?.close().catch(() => {});
  }
}

async function main() {
  const args = process.argv.slice(2);
  const nifFilter = args.find(a => !a.startsWith('--'));

  for (const dir of [DOWNLOAD_DIR, SCREENSHOTS_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  const config = await loadConfigWithPasswords();
  const log = loadLog();

  console.log('=========================================');
  console.log('  AGT - Emissão Automática de Facturas');
  console.log('=========================================');
  console.log(`Adquirente: ${config.adquirente.nome}`);
  console.log(`NIF: ${config.adquirente.nif}`);
  console.log(`Prestadores: ${config.prestadores.length}`);
  if (nifFilter) console.log(`Filtro NIF: ${nifFilter}`);
  console.log('=========================================\n');

  const chromePath = fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : config.chromePath;
  console.log(`Chrome: ${chromePath}`);

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: 'new' as any,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--window-size=1280,900',
      `--user-data-dir=${path.resolve('chrome-profile-' + Date.now()).replace(/\\/g, '/')}`,
      `--download-default-directory=${DOWNLOAD_DIR.replace(/\\/g, '/')}`,
      '--disable-popup-blocking',
      '--disable-gpu',
    ],
    defaultViewport: { width: 1280, height: 900 },
  });

  const prestadores = nifFilter
    ? config.prestadores.filter(p => p.nif === nifFilter)
    : config.prestadores;

  if (prestadores.length === 0) {
    console.log('Nenhum prestador encontrado para o NIF fornecido.');
    await browser.close();
    return;
  }

  for (let i = 0; i < prestadores.length; i++) {
    const p = prestadores[i];
    const resultado = await emitirFactura(browser, config, p, i + 1);
    if (resultado) {
      log.push(resultado);
      saveLog([resultado]);
    }
    await sleep(300);
  }

  await browser.close();

  console.log('\n=========================================');
  console.log('  CONCLUÍDO!');
  console.log(`  Total emitido: ${log.length} facturas`);
  console.log('=========================================');
}

main().catch((error) => {
  console.error('Erro fatal:', error);
  process.exit(1);
});
