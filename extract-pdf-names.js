const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');

const PDF_DIR = path.join('C:\\Users\\geral\\Downloads\\logs');
const CONFIG_PATH = path.join('C:\\Users\\geral\\agt-invoice-automation\\config.json');

async function main() {
  const files = fs.readdirSync(PDF_DIR).filter(f => f.endsWith('.pdf'));
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));

  console.log('Encontrados ' + files.length + ' PDFs\n');

  for (const file of files) {
    const dataBuffer = fs.readFileSync(path.join(PDF_DIR, file));
    const data = await pdf(dataBuffer);
    const text = data.text;

    const nifMatch = text.match(/Nº\s*de\s*Contribuinte[:\s]*(\S+)/i);
    const nif = nifMatch ? nifMatch[1].trim() : null;

    const lines = text.split('\n').map(l => l.trim());
    let nome = null;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('Identificação do Fornecedor')) {
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          if (lines[j] && !lines[j].includes('Nº') && !lines[j].includes('RUA') && !lines[j].includes('Tel') && lines[j].length > 5) {
            nome = lines[j];
            break;
          }
        }
        break;
      }
    }

    console.log(file + ':');
    console.log('  NIF: ' + (nif || 'N/A'));
    console.log('  Nome: ' + (nome || 'N/A'));

    if (nif && nome) {
      const prestador = config.prestadores.find(p => p.nif === nif);
      if (prestador) {
        prestador.nome = nome;
        console.log('  ✓ Guardado no config');
      } else {
        console.log('  ⚠ NIF não encontrado no config');
      }
    }
    console.log('');
  }

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  console.log('Config actualizado!');
}

main().catch(console.error);
