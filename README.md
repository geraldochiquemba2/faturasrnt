# Automação de Facturas Electrónicas AGT

Script para emissão automática de facturas electrónicas junto da AGT (Administração Geral Tributária) de Angola.

## Pré-requisitos

1. **Registo na AGT** - Ter conta no Portal do Contribuinte
2. **Chaves Digitais** - Obter chave pública e privada no portal
3. **Software Validado** - Ter software certificado pela AGT
4. **Node.js** - Versão 18 ou superior

## Como Obter as Chaves

1. Acesse: https://quiosqueagt.minfin.gov.ao/
2. Inicie sessão com o seu NIF
3. Navegue até "Facturação Electrónica"
4. Gere as chaves pública e privada
5. Guarde a chave privada num ficheiro `.pem`

## Instalação

```bash
cd agt-invoice-automation
npm install
```

## Configuração

1. Copie o ficheiro de exemplo:
```bash
cp .env.example .env
```

2. Edite o ficheiro `.env` com os seus dados:
- `AGT_TAX_ID` - O seu NIF
- `AGT_PRODUCT_ID` - Nome do software
- `AGT_VALIDATION_NUMBER` - Número de validação da AGT
- `AGT_PRIVATE_KEY_PATH` - Caminho para a chave privada

3. Coloque a chave privada na pasta `keys/`:
```bash
mkdir keys
# Copie o ficheiro da chave privada para keys/private_key.pem
```

## Uso

### Emitir factura de teste

```bash
npm run emitir
```

### Modo produção

Altere o `.env`:
```
AGT_ENVIRONMENT=prod
```

## Estrutura da Factura

O script emite facturas com a seguinte estrutura:

```typescript
{
  documentNo: 'FT 2026/1',
  documentDate: '2026-07-14',
  customerTaxID: '5417123456',
  customerCountry: 'AO',
  companyName: 'Cliente Exemplo Lda',
  lines: [
    {
      lineNumber: '1',
      productCode: 'P001',
      productDescription: 'Produto',
      quantity: '1',
      unitOfMeasure: 'UN',
      unitPrice: '1000.00',
      unitPriceBase: '1000.00',
      taxes: [
        {
          taxType: 'IVA',
          taxCountryRegion: 'AO',
          taxCode: 'NOR',
          taxPercentage: '14'
        }
      ],
      settlementAmount: '1140.00'
    }
  ],
  documentTotals: {
    taxPayable: '140.00',
    netTotal: '1000.00',
    grossTotal: '1140.00'
  }
}
```

## Personalizar Facturas

Edite o ficheiro `src/index.ts` para modificar:
- Dados do cliente
- Produtos/serviços
- Valores e impostos
- Número do documento

## Notas Importantes

- **Ambiente hml** - Para testes (não gera facturas válidas)
- **Ambiente prod** - Para produção (facturas oficiais)
- Guarde a chave privada em local seguro
- Nunca partilhe a chave privada
- Documente todos os números de facturas emitidos

## Suporte

- Portal AGT: https://quiosqueagt.minfin.gov.ao/
- Documentação: https://quiosqueagt.minfin.gov.ao/doc-agt/
- SDK GitHub: https://github.com/anvimaa/agt-fe-sdk
