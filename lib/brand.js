// Single source of truth for unit identity — used by emails, PDFs, sheets and UI.
export const UNIT = {
  wing:      'NCC AIRWING',
  flight:    'FLIGHT-B',
  squadron:  '6 KAR AIR SQN NCC',
  motto:     'UNITY AND DISCIPLINE',
  greeting:  'JAI HIND',
};
export const UNIT_LINE  = `${UNIT.wing} · ${UNIT.flight} · ${UNIT.squadron}`;
export const UNIT_SHORT = `${UNIT.wing} ${UNIT.flight}`;
