import { describe, it, expect } from 'vitest';
import { parseBankCSV } from './finances.js';

// En-tête réel d'un export Caisse d'Épargne (vérifié le 09/08/2026).
const HEADER_CE = 'Date comptable;Libelle simplifie;Reference;Informations complementaires;Type operation;Debit;Credit;Date operation;Date de valeur;Pointage';

const CSV_OK = [
  HEADER_CE,
  '05/01/2026;CB KIMIKO 040126;12345620260104;CONTRAT 0000000 REM 123456;Remise CB;;+500,00;05/01/2026;06/01/2026;Non',
  '05/01/2026; CB COM KIMIKO 040126;;CONTRAT 0000000 REM 123456;Frais et extournes;-2,50;;05/01/2026;06/01/2026;Non',
  '',
].join('\n');

describe('parseBankCSV', () => {
  it('parse une remise CB : crédit positif, virgule décimale, date ISO', () => {
    const lignes = parseBankCSV(CSV_OK);
    expect(lignes).toHaveLength(2);
    expect(lignes[0]).toEqual({
      dateOperation: '2026-01-05',
      libelle: 'CB KIMIKO 040126',
      reference: '12345620260104',
      infos: 'CONTRAT 0000000 REM 123456',
      typeOperation: 'Remise CB',
      montant: 500,
    });
  });
  it('parse un débit en négatif et trime l\'espace en tête du libellé', () => {
    const lignes = parseBankCSV(CSV_OK);
    expect(lignes[1].montant).toBeCloseTo(-2.5, 6);
    expect(lignes[1].libelle).toBe('CB COM KIMIKO 040126');
  });
  it('accepte les fins de ligne CRLF et ignore les lignes vides', () => {
    expect(parseBankCSV(CSV_OK.replace(/\n/g, '\r\n'))).toHaveLength(2);
  });
  it('rejette un CSV sans les colonnes attendues, sans rien retourner', () => {
    expect(() => parseBankCSV('a;b;c\n1;2;3')).toThrow(/Format de CSV inattendu/);
  });
  it('rejette un fichier vide', () => {
    expect(() => parseBankCSV('')).toThrow(/Format de CSV inattendu/);
  });
  it('rejette une ligne au montant illisible', () => {
    const csv = [HEADER_CE, '05/01/2026;X;;;Remise CB;;abc;05/01/2026;;Non'].join('\n');
    expect(() => parseBankCSV(csv)).toThrow(/Format de CSV inattendu/);
  });
});
