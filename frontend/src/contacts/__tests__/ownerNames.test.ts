import { describe, expect, it } from 'vitest';
import { countyOwnerName, splitPersonName, traceNameFor } from '../ownerNames';
import { newOwner } from '../types';

describe('countyOwnerName — real Cook County 2026 samples', () => {
  it.each([
    ['THOMAS J LIZAK', 'THOMAS', 'LIZAK'],
    ['RHIANNA F JONES', 'RHIANNA', 'JONES'],
    ['JULIO C BENDEZU SR', 'JULIO', 'BENDEZU'],
    ['ANDREW STEPHEN FOX', 'ANDREW', 'FOX'],
    ['Jeff Bell', 'Jeff', 'Bell'],
    ['ELIZABETH BENTKOWSKI &', 'ELIZABETH', 'BENTKOWSKI'],
    ['GREGORY BASIL & LOIS B', 'GREGORY', 'BASIL'],
    ['NICHOLAS C PUSKARZ & K', 'NICHOLAS', 'PUSKARZ'], // 22 chars, but complete before "&"
    ['ANGELA & JESUS LAGUNAS', null, null], // 22 chars: shared surname at the cut point
    ['ANA & JOSE LAGUNAS', 'ANA', 'LAGUNAS'], // same pattern, short → trusted
    ["MARY O'BRIEN-SMITH", 'MARY', "O'BRIEN-SMITH"],
  ])('%s → %s %s', (raw, first, last) => {
    expect(countyOwnerName(raw)).toEqual(first ? { first, last } : null);
  });

  it.each([
    'MIGUEL ANGEL ORTEGA RA', // 22 chars: surname possibly truncated
    'MEESHA MASOUDEH RASHED', // 22 chars even if it looks whole — not trusted
    'ROBERT F DONOVAN DECLA', // declaration of trust
    'FRANCES CUNNINGHAM TRU',
    'RUPAL SATRA ANKUSH T D',
    'JOHN ANDREW KLEMEN TRU',
    'E CONDE', // initial only
    'D CONNOLLY',
    'CRM PROPERTIES GROUP',
    'CHICAGO CITY OF',
    '5001 N DAMEN LLC',
    'ROSEHILL CEMETERY',
    'CURRENT OWNER',
    'MADONNA',
    'P SKOKOWSKI & A ZALEWS',
    '',
  ])('%s → no name (address trace)', (raw) => {
    expect(countyOwnerName(raw)).toBeNull();
  });
});

describe('splitPersonName (typed contact person)', () => {
  it('first + last, middle and suffix ignored', () => {
    expect(splitPersonName('Jane Q. Public Jr.')).toEqual({ first: 'Jane', last: 'Public' });
    expect(splitPersonName('José de la Cruz')).toEqual({ first: 'José', last: 'Cruz' });
  });

  it('rejects single words, initials and junk', () => {
    expect(splitPersonName('Jane')).toBeNull();
    expect(splitPersonName('J Public')).toBeNull();
    expect(splitPersonName('=cmd 123')).toBeNull();
    expect(splitPersonName('Jr')).toBeNull();
  });
});

describe('traceNameFor', () => {
  it('a typed contact person wins, even for a company owner', () => {
    const o = newOwner({ name: 'CRM PROPERTIES GROUP', isCompany: true, contactPerson: 'Pat Example' });
    expect(traceNameFor(o)).toEqual({ first: 'Pat', last: 'Example', source: 'contact' });
  });

  it('individual county owners are used; companies are not', () => {
    expect(traceNameFor(newOwner({ name: 'THOMAS J LIZAK' }))).toEqual({ first: 'THOMAS', last: 'LIZAK', source: 'county' });
    expect(traceNameFor(newOwner({ name: 'CRM PROPERTIES GROUP', isCompany: true }))).toBeNull();
    expect(traceNameFor(newOwner({ name: 'MIGUEL ANGEL ORTEGA RA' }))).toBeNull();
  });

  it('an unusable contact person falls back to the county name', () => {
    expect(traceNameFor(newOwner({ name: 'THOMAS J LIZAK', contactPerson: 'Tom' }))).toMatchObject({ source: 'county' });
  });
});
