// EUR/MWh→EUR/kWh and Finnish electricity VAT conversion helpers.

// Finnish electricity VAT (25.5%).
export const ELECTRICITY_VAT = 0.255;

export function mwhToKwh(eurPerMwh: number): number {
  return eurPerMwh / 1000;
}

export function applyVat(priceNoTax: number): number {
  return priceNoTax * (1 + ELECTRICITY_VAT);
}
