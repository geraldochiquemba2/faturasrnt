import * as fs from 'fs';
import * as path from 'path';
import pdfParse from 'pdf-parse';

const PDF_DIR = path.resolve('C:\\Users\\geral\\Downloads\\logs');
const CONFIG_PATH = path.resolve('config.json');

async function main() {
  const files = fs.readdirSync(PDF_DIR).filter(f => f.endsWith('.pdf'));
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));

  console.log(`Encontrados ${files.length} PDFs\n`);

  for (const file of files) {
    const dataBuffer = fs.readFileSync(path.join(PDF_DIR, file));
    const data = await pdfParse(dataBuffer);
    const text = data.text;

    // Extrair NIF do fornecedor
    const nifMatch = text.match(/Nº\s*de\s*Contribuinte[:\s]*(\S+)/i);
    const nif = nifMatch ? nifMatch[1].trim() : null;

    // Extrair nome do fornecedor (linha após "Identificação do Fornecedor")
    const nomeMatch = text.match(/Identificação do Fornecedor[\s\S]*?([A-ZÁÉÍÓÚÃÕÊÔ][A-ZÁÉÍÓÚÃÕÊÔ\s]{5,})/);
    const nome = nomeMatch ? nomeMatch[1].trim() : null;

    console.log(`${file}:`);
    console.log(`  NIF: ${nif || 'N/A'}`);
    console.log(`  Nome: ${nome || 'N/A'}`);

    // Actualizar config se encontrar o NIF
    if (nif && nome) {
      const prestador = config.prestadores.find((p: any) => p.nif === nif);
      if (prestador) {
        prestador.nome = nome;
        console.log(`  ✓ Guardado no config`);
      } else {
        console.log(`  ⚠ NIF não encontrado no config`);
      }
    }
    console.log('');
  }

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  console.log('Config actualizado!');
}

main().catch(console.error);
