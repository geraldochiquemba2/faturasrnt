import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

export interface AGTConfig {
  taxRegistrationNumber: string;
  productId: string;
  productVersion: string;
  softwareValidationNumber: string;
  privateKeyPem: string;
  environment: 'hml' | 'prod';
}

export function loadConfig(): AGTConfig {
  const privateKeyPath = process.env.AGT_PRIVATE_KEY_PATH;
  let privateKeyPem = process.env.AGT_PRIVATE_KEY_PEM || '';

  if (privateKeyPath && !privateKeyPem) {
    const fullPath = path.resolve(privateKeyPath);
    if (fs.existsSync(fullPath)) {
      privateKeyPem = fs.readFileSync(fullPath, 'utf-8');
    } else {
      throw new Error(`Ficheiro de chave privada não encontrado: ${fullPath}`);
    }
  }

  if (!privateKeyPem) {
    throw new Error('Chave privada não configurada. Defina AGT_PRIVATE_KEY_PEM ou AGT_PRIVATE_KEY_PATH no .env');
  }

  return {
    taxRegistrationNumber: process.env.AGT_TAX_ID || '',
    productId: process.env.AGT_PRODUCT_ID || 'SoftwareFacturacao',
    productVersion: process.env.AGT_PRODUCT_VERSION || '1.0.0',
    softwareValidationNumber: process.env.AGT_VALIDATION_NUMBER || '0000',
    privateKeyPem,
    environment: (process.env.AGT_ENVIRONMENT as 'hml' | 'prod') || 'hml',
  };
}

export interface InvoiceLine {
  lineNumber: string;
  productCode: string;
  productDescription: string;
  quantity: string;
  unitOfMeasure: string;
  unitPrice: string;
  unitPriceBase: string;
  taxes: {
    taxType: string;
    taxCountryRegion: string;
    taxCode: string;
    taxPercentage: string;
  }[];
  settlementAmount: string;
}

export interface InvoiceData {
  documentNo: string;
  documentDate: string;
  customerTaxID: string;
  customerCountry: string;
  companyName: string;
  lines: InvoiceLine[];
  documentTotals: {
    taxPayable: string;
    netTotal: string;
    grossTotal: string;
  };
}
