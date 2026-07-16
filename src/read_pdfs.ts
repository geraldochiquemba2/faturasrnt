import * as fs from 'fs';
import * as path from 'path';
import pdfParse from 'pdf-parse';

async function main() {
  const dir = 'C:/Users/geral/Downloads/logs';
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.pdf'));
  console.log('PDFs encontrados:', files.length);

  for (const f of files) {
    const content = fs.readFileSync(path.join(dir, f));
    try {
      const data = await pdfParse(content);
      const text = data.text;
      // Procurar linhas que contenham "local" ou "prestação"
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.toLowerCase().includes('local') || line.toLowerCase().includes('prest')) {
          console.log(`${f}: "${line.trim()}"`);
        }
      }
      if (text.length < 10) {
        console.log(`${f}: PDF sem texto extraível (image-based)`);
      }
    } catch (e) {
      console.log(`${f}: Erro: ${e}`);
    }
  }
}

main();
