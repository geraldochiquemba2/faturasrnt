import { AGTClient, AGTSigner, DocumentType } from 'agt-fe-sdk';
import { InvoiceData } from './config';
import * as fs from 'fs';
import * as path from 'path';

interface NIFConfig {
  nif: string;
  privateKeyPath: string;
  nome: string;
}

const EMPRESA = {
  nif: '5410778197',
  nome: 'REDE NACIONAL DE TRANSPORTE DE ELECTRICIDADE',
};

const PRESTADORES: NIFConfig[] = [
  { nif: '000255073HO034', privateKeyPath: './keys/000255073HO034.pem', nome: 'Prestador 1' },
  { nif: '000968836HO032', privateKeyPath: './keys/000968836HO032.pem', nome: 'Prestador 2' },
  { nif: '002844805HO037', privateKeyPath: './keys/002844805HO037.pem', nome: 'Prestador 3' },
  { nif: '003498353HO034', privateKeyPath: './keys/003498353HO034.pem', nome: 'Prestador 4' },
  { nif: '003863014HO037', privateKeyPath: './keys/003863014HO037.pem', nome: 'Prestador 5' },
  { nif: '005565221HO046', privateKeyPath: './keys/005565221HO046.pem', nome: 'Prestador 6' },
  { nif: '005659634BE040', privateKeyPath: './keys/005659634BE040.pem', nome: 'Prestador 7' },
  { nif: '006096198LA040', privateKeyPath: './keys/006096198LA040.pem', nome: 'Prestador 8' },
  { nif: '006925318HO045', privateKeyPath: './keys/006925318HO045.pem', nome: 'Prestador 9' },
  { nif: '010052877BE046', privateKeyPath: './keys/010052877BE046.pem', nome: 'Prestador 10' },
  { nif: '020105623BE057', privateKeyPath: './keys/020105623BE057.pem', nome: 'Prestador 11' },
  { nif: '020750724HO052', privateKeyPath: './keys/020750724HO052.pem', nome: 'Prestador 12' },
  { nif: '021453297HO055', privateKeyPath: './keys/021453297HO055.pem', nome: 'Prestador 13' },
];

function getRandomDate(): string {
  const now = new Date();
  const daysAgo = Math.floor(Math.random() * 30);
  const date = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  return date.toISOString().split('T')[0];
}

function getRandomAmount(): { net: string; tax: string; gross: string } {
  const net = Math.floor(Math.random() * 200000) + 50000;
  const tax = 0;
  const gross = net;
  return {
    net: net.toFixed(2),
    tax: tax.toFixed(2),
    gross: gross.toFixed(2),
  };
}

async function emitirFactura(prestador: NIFConfig, docNumber: number): Promise<void> {
  const privateKeyPath = path.resolve(prestador.privateKeyPath);

  if (!fs.existsSync(privateKeyPath)) {
    console.log(`Chave não encontrada para ${prestador.nif} (${prestador.nome})`);
    return;
  }

  const privateKeyPem = fs.readFileSync(privateKeyPath, 'utf-8');
  const amounts = getRandomAmount();
  const docDate = getRandomDate();

  const client = new AGTClient({
    taxRegistrationNumber: prestador.nif,
    productId: 'SoftwareFacturacao',
    productVersion: '1.0.0',
    softwareValidationNumber: '0000',
    privateKeyPem,
    environment: 'prod',
  });

  const invoice: InvoiceData = {
    documentNo: `FT ${new Date().getFullYear()}/${docNumber}`,
    documentDate: docDate,
    customerTaxID: EMPRESA.nif,
    customerCountry: 'AO',
    companyName: EMPRESA.nome,
    lines: [
      {
        lineNumber: '1',
        productCode: 'SRV001',
        productDescription: 'Prestação de Serviço de Transporte/Trabalho',
        quantity: '1',
        unitOfMeasure: 'UN',
        unitPrice: amounts.net,
        unitPriceBase: amounts.net,
        taxes: [
          {
            taxType: 'IVA',
            taxCountryRegion: 'AO',
            taxCode: 'NOR',
            taxPercentage: '14',
          },
        ],
        settlementAmount: amounts.gross,
      },
    ],
    documentTotals: {
      taxPayable: amounts.tax,
      netTotal: amounts.net,
      grossTotal: amounts.gross,
    },
  };

  try {
    const jwsDocumentSignature = await AGTSigner.signRequest(
      {
        documentNo: invoice.documentNo,
        taxRegistrationNumber: prestador.nif,
        documentType: 'FT',
        documentDate: invoice.documentDate,
        customerTaxID: invoice.customerTaxID,
        customerCountry: invoice.customerCountry,
        companyName: invoice.companyName,
        documentTotals: invoice.documentTotals,
      },
      privateKeyPem,
    );

    const response = await client.registerInvoice([
      {
        documentNo: invoice.documentNo,
        documentStatus: 'N',
        documentDate: invoice.documentDate,
        documentType: DocumentType.FT,
        jwsDocumentSignature,
        eacCode: '00000',
        systemEntryDate: new Date().toISOString(),
        customerTaxID: invoice.customerTaxID,
        customerCountry: invoice.customerCountry,
        companyName: invoice.companyName,
        lines: invoice.lines,
        documentTotals: invoice.documentTotals,
      },
    ]);

    console.log(`✓ ${prestador.nome} (${prestador.nif}) → ${EMPRESA.nome} | Factura: ${invoice.documentNo} | Valor: ${amounts.gross} AKZ`);
  } catch (error) {
    console.error(`✗ ${prestador.nome} (${prestador.nif}) - Erro: ${error}`);
  }
}

async function main(): Promise<void> {
  console.log('=========================================');
  console.log('AUTOFACTURAÇÃO - REDE NAC. TRANS. ELECT.');
  console.log(`Empresa: ${EMPRESA.nome} (${EMPRESA.nif})`);
  console.log(`Prestadores: ${PRESTADORES.length}`);
  console.log('=========================================\n');

  for (let i = 0; i < PRESTADORES.length; i++) {
    await emitirFactura(PRESTADORES[i], i + 1);
  }

  console.log('\nConcluído!');
}

main().catch((error) => {
  console.error('Erro fatal:', error);
  process.exit(1);
});
