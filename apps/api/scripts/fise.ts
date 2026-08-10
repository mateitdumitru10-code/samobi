/**
 * Recipes transcribed from the scanned sheets in docs/.
 *
 * The sheets carry a material name, a unit and a quantity — no SAGA codes, no
 * dimensions, no formulas. So every line is mode `fixa`, the codes are matched
 * against the catalogue by name, and the dimensions below are placeholders a
 * tehnolog has to correct. They are marked as such in the model description.
 */

export interface LinieFisa {
  nr: number
  denumire: string
  um: string
  cantitate: string
  grup: string
  /** Fabric changes from one order to the next; the code is picked per bon. */
  variabil?: boolean
}

export interface Fisa {
  cod: string
  denumire: string
  familie: 'PAT' | 'CANAPEA' | 'COLTAR' | 'SALTEA' | 'ALTELE'
  sursa: string
  /** Placeholder, in millimetres. The sheets do not state dimensions. */
  dimensiune: { cod: string; lungime: string; latime: string; inaltime: string }
  linii: LinieFisa[]
}

const S = 'STRUCTURA'
const T = 'TAPITERIE'
const SP = 'SPUMA'
const A = 'ACCESORII'
const AM = 'AMBALAJ'

export const FISE: Fisa[] = [
  {
    cod: 'TABURETE',
    denumire: 'TABURET',
    familie: 'ALTELE',
    sursa: 'fișa scanată TABURETE',
    dimensiune: { cod: 'STANDARD', lungime: '600', latime: '600', inaltime: '450' },
    linii: [
      { nr: 1, denumire: 'STOFA', um: 'ML', cantitate: '0.75', grup: T, variabil: true },
      { nr: 2, denumire: 'CHERESTEA', um: 'MC', cantitate: '0.006', grup: S },
      { nr: 3, denumire: 'MDF 2.5', um: 'MP', cantitate: '0.7', grup: S },
      { nr: 4, denumire: 'PAL', um: 'MP', cantitate: '0.38', grup: S },
      { nr: 5, denumire: 'VATELINA', um: 'MP', cantitate: '1.5', grup: T },
      { nr: 6, denumire: 'TNT', um: 'MP', cantitate: '0.25', grup: T },
      { nr: 7, denumire: 'CAPSE 38/12', um: 'SUTEB', cantitate: '0.3', grup: A },
      { nr: 8, denumire: 'PICIOARE', um: 'MIIB', cantitate: '0.004', grup: A },
      { nr: 9, denumire: 'POL2542', um: 'KG', cantitate: '0.24', grup: SP },
    ],
  },

  {
    cod: 'CANAPEA-MARIA',
    denumire: 'CANAPEA MARIA',
    familie: 'CANAPEA',
    sursa: 'fișa scanată CANAPEA MARIA, rev. 28.01.2022',
    dimensiune: { cod: 'STANDARD', lungime: '2000', latime: '900', inaltime: '850' },
    linii: [
      { nr: 1, denumire: 'STOFA ENJOY', um: 'ML', cantitate: '10.5', grup: T, variabil: true },
      { nr: 2, denumire: 'CHERESTEA RAS', um: 'MC', cantitate: '0.0255', grup: S },
      { nr: 3, denumire: 'CHER FAG', um: 'MC', cantitate: '0.0234', grup: S },
      { nr: 4, denumire: 'PAL 16 MM', um: 'MP', cantitate: '0.6', grup: S },
      { nr: 5, denumire: 'HDF MELAM 2.5 MM ALB', um: 'MP', cantitate: '1.133', grup: S },
      { nr: 6, denumire: 'PAL MELAM ALB', um: 'MP', cantitate: '1', grup: S },
      { nr: 7, denumire: 'MDF 4MM', um: 'MP', cantitate: '1.44', grup: S },
      { nr: 8, denumire: 'HDF BRUT 2.5MM', um: 'MP', cantitate: '2.871', grup: S },
      { nr: 9, denumire: 'POL.2538 1900x680x40', um: 'BUC', cantitate: '1', grup: SP },
      { nr: 10, denumire: 'POL.2538 1900x680x30', um: 'BUC', cantitate: '1', grup: SP },
      { nr: 11, denumire: 'POL.2542 2000x130x60', um: 'BUC', cantitate: '3', grup: SP },
      { nr: 12, denumire: 'POL.2542 2000x130x40', um: 'BUC', cantitate: '6.1', grup: SP },
      { nr: 13, denumire: 'FELTRU 1000 GR', um: 'MP', cantitate: '3', grup: T },
      { nr: 14, denumire: 'PLASA BONELL 186x60x13', um: 'BUC', cantitate: '2', grup: S },
      { nr: 15, denumire: 'ADEZIV', um: 'KG', cantitate: '0.24', grup: A },
      { nr: 16, denumire: 'HSURUB STAS 5/50', um: 'SUTEB', cantitate: '0.08', grup: A },
      { nr: 17, denumire: 'HSURUB STAS 5/35', um: 'SUTEB', cantitate: '0.08', grup: A },
      { nr: 18, denumire: 'HSURUB 5/25', um: 'SUTEB', cantitate: '0.02', grup: A },
      { nr: 19, denumire: 'HSURUB 4/25', um: 'SUTEB', cantitate: '0.14', grup: A },
      { nr: 20, denumire: 'CUIE', um: 'MIIB', cantitate: '0.06', grup: A },
      { nr: 21, denumire: 'BALAMA PAFTA 40x253', um: 'BUC', cantitate: '2', grup: A },
      { nr: 22, denumire: 'ROTILA H32 L50 D28', um: 'BUC', cantitate: '2', grup: A },
      { nr: 23, denumire: 'ROTILA H35 L45 D30', um: 'BUC', cantitate: '2', grup: A },
      { nr: 24, denumire: 'CAPSE 92/35', um: 'MIIB', cantitate: '0.3', grup: A },
      { nr: 25, denumire: 'CAPSE 380/14', um: 'MIIB', cantitate: '2', grup: A },
      { nr: 26, denumire: 'CAPSE 380/16', um: 'MIIB', cantitate: '0.22', grup: A },
      { nr: 27, denumire: 'CAPSE 92/25', um: 'MIIB', cantitate: '0.02', grup: A },
      { nr: 28, denumire: 'PICIOARE PLASTIC', um: 'MIIBUC', cantitate: '0.004', grup: A },
      { nr: 29, denumire: 'VATELINA 100 GR', um: 'ML', cantitate: '10', grup: T },
      { nr: 30, denumire: 'TNT ALB 40', um: 'MP', cantitate: '8', grup: T },
      { nr: 31, denumire: 'TNT NEGRU 60', um: 'MP', cantitate: '2', grup: T },
      { nr: 32, denumire: 'FERMOAR', um: 'M', cantitate: '4', grup: A },
      { nr: 33, denumire: 'CHEITE', um: 'BUC', cantitate: '4', grup: A },
      { nr: 34, denumire: 'PERNA CORINA AMESTEC', um: 'BUC', cantitate: '2', grup: T },
      { nr: 35, denumire: 'FILAN', um: 'BUC', cantitate: '0.05', grup: A },
      { nr: 36, denumire: 'AMESTEC FIBRA', um: 'KG', cantitate: '3', grup: T },
      { nr: 37, denumire: 'FOLIE', um: 'KG', cantitate: '0.8', grup: AM },
      { nr: 38, denumire: 'FOLIE STRETCH', um: 'BUC', cantitate: '0.13', grup: AM },
      { nr: 39, denumire: 'DESEURI DIN CROIRE', um: 'KG', cantitate: '2', grup: AM },
      { nr: 40, denumire: 'BANDA SCOTCH', um: 'BUC', cantitate: '0.2', grup: AM },
    ],
  },

  {
    cod: 'CANAPEA-CORINA',
    denumire: 'CANAPEA CORINA',
    familie: 'CANAPEA',
    sursa: 'fișa scanată CANAPEA CORINA',
    dimensiune: { cod: 'STANDARD', lungime: '2000', latime: '900', inaltime: '850' },
    linii: [
      { nr: 1, denumire: 'STOFA ENJOY', um: 'ML', cantitate: '12', grup: T, variabil: true },
      { nr: 2, denumire: 'PVC', um: 'ML', cantitate: '0.4', grup: T },
      { nr: 3, denumire: 'CHERESTEA RAS', um: 'MC', cantitate: '0.0237', grup: S },
      { nr: 4, denumire: 'CHER FAG', um: 'MC', cantitate: '0.02', grup: S },
      { nr: 5, denumire: 'PAL 16 MM', um: 'MP', cantitate: '1.7', grup: S },
      { nr: 6, denumire: 'HDF MELAM 2.5 MM ALB', um: 'MP', cantitate: '1.33', grup: S },
      { nr: 7, denumire: 'PAL MELAM ALB', um: 'MP', cantitate: '1.2', grup: S },
      { nr: 8, denumire: 'MDF 4MM', um: 'MP', cantitate: '1.44', grup: S },
      { nr: 9, denumire: 'MDF BRUT 2.5MM', um: 'MP', cantitate: '4', grup: S },
      { nr: 10, denumire: 'POL.2538 1900x710x30', um: 'BUC', cantitate: '1', grup: SP },
      { nr: 11, denumire: 'POL.2538 1900x680x30', um: 'BUC', cantitate: '1', grup: SP },
      { nr: 12, denumire: 'POL.2542 2000x130x60', um: 'BUC', cantitate: '3', grup: SP },
      { nr: 13, denumire: 'POL.2542 2000x130x40', um: 'BUC', cantitate: '6.1', grup: SP },
      { nr: 14, denumire: 'POL.2538 1000x560x10', um: 'BUC', cantitate: '4', grup: SP },
      { nr: 15, denumire: 'POL.2538 1000x175x20', um: 'BUC', cantitate: '2', grup: SP },
      { nr: 16, denumire: 'FELTRU 1000 GR', um: 'MP', cantitate: '3', grup: T },
      { nr: 17, denumire: 'PLASA BONELL 186x66x13', um: 'BUC', cantitate: '1', grup: S },
      { nr: 18, denumire: 'PLASA BONELL 186x60x13', um: 'BUC', cantitate: '1', grup: S },
      { nr: 19, denumire: 'ADEZIV', um: 'KG', cantitate: '0.25', grup: A },
      { nr: 20, denumire: 'HSURUB STAS 5/50', um: 'SUTEB', cantitate: '0.08', grup: A },
      { nr: 21, denumire: 'HSURUB STAS 5/40', um: 'SUTEB', cantitate: '0.08', grup: A },
      { nr: 22, denumire: 'HSURUB 8/100', um: 'SUTEB', cantitate: '0.04', grup: A },
      { nr: 23, denumire: 'PIULITE M8', um: 'SUTEB', cantitate: '0.04', grup: A },
      { nr: 24, denumire: 'SAIBE PLATE M8x24x2', um: 'SUTEB', cantitate: '0.04', grup: A },
      { nr: 25, denumire: 'HSURUB 5/20', um: 'SUTEB', cantitate: '0.02', grup: A },
      { nr: 26, denumire: 'HSURUB 4/25', um: 'SUTEB', cantitate: '0.14', grup: A },
      { nr: 27, denumire: 'CUIE', um: 'MIIB', cantitate: '0.05', grup: A },
      { nr: 28, denumire: 'BALAMA PAFTA', um: 'BUC', cantitate: '2', grup: A },
      { nr: 29, denumire: 'ROTILA H32', um: 'BUC', cantitate: '4', grup: A },
      { nr: 30, denumire: 'CAPSE 92/35', um: 'MIIB', cantitate: '0.3', grup: A },
      { nr: 31, denumire: 'CAPSE 380/14', um: 'MIIB', cantitate: '1.1', grup: A },
      { nr: 32, denumire: 'CAPSE 380/16', um: 'MIIB', cantitate: '0.22', grup: A },
      { nr: 33, denumire: 'PICIOARE PLASTIC', um: 'MIIBUC', cantitate: '0.004', grup: A },
      { nr: 34, denumire: 'VATELINA 100 GR', um: 'ML', cantitate: '10.1', grup: T },
      { nr: 35, denumire: 'TNT', um: 'MP', cantitate: '4.5', grup: T },
      { nr: 36, denumire: 'FERMOAR', um: 'M', cantitate: '2.1', grup: A },
      { nr: 37, denumire: 'CURSORI', um: 'BUC', cantitate: '3', grup: A },
      { nr: 38, denumire: 'PERNA', um: 'BUC', cantitate: '3', grup: T },
      { nr: 39, denumire: 'FILAN', um: 'BUC', cantitate: '0.05', grup: A },
      { nr: 40, denumire: 'OPRITORI PLASTIC', um: 'BUC', cantitate: '2', grup: A },
      { nr: 41, denumire: 'CARTON MUCAVA', um: 'BUC', cantitate: '2', grup: AM },
      { nr: 42, denumire: 'FOLIE', um: 'KG', cantitate: '0.8', grup: AM },
      { nr: 43, denumire: 'FOLIE STRETCH', um: 'BUC', cantitate: '0.13', grup: AM },
      { nr: 44, denumire: 'DESEURI DIN CROIRE', um: 'KG', cantitate: '2', grup: AM },
      { nr: 45, denumire: 'BANDA SCOTCH', um: 'BUC', cantitate: '0.2', grup: AM },
    ],
  },
]
