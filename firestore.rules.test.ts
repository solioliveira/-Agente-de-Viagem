/**
 * Firestore Security Rules Test Suite — "Dirty Dozen" Payloads Verification
 * Verifies that all 12 adversarial payloads defined in security_spec.md are rejected.
 */

export interface DirtyDozenTestCase {
  id: number;
  name: string;
  collectionPath: string;
  operation: 'create' | 'update' | 'get' | 'list' | 'delete';
  auth: { uid: string; email: string; email_verified: boolean } | null;
  payload?: Record<string, unknown>;
  expectedResult: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_TESTS: DirtyDozenTestCase[] = [
  {
    id: 1,
    name: 'Unverified Email Spoofing on Viagem Create',
    collectionPath: '/viagens/trip_spoof',
    operation: 'create',
    auth: { uid: 'u1', email: 'victim@test.com', email_verified: false },
    payload: {
      nome: 'Férias',
      criadorUid: 'u1',
      criadorEmail: 'victim@test.com',
      membros: ['victim@test.com'],
      createdAt: 'REQUEST_TIME',
      updatedAt: 'REQUEST_TIME'
    },
    expectedResult: 'PERMISSION_DENIED'
  },
  {
    id: 2,
    name: 'Identity Spoofing (criadorUid mismatch)',
    collectionPath: '/viagens/trip_spoof2',
    operation: 'create',
    auth: { uid: 'u1', email: 'me@test.com', email_verified: true },
    payload: {
      nome: 'Férias',
      criadorUid: 'other_uid',
      criadorEmail: 'me@test.com',
      membros: ['me@test.com'],
      createdAt: 'REQUEST_TIME',
      updatedAt: 'REQUEST_TIME'
    },
    expectedResult: 'PERMISSION_DENIED'
  },
  {
    id: 3,
    name: 'Shadow Field Injection on Viagem Update',
    collectionPath: '/viagens/trip1',
    operation: 'update',
    auth: { uid: 'u1', email: 'me@test.com', email_verified: true },
    payload: {
      nome: 'Férias 2',
      isAdmin: true,
      updatedAt: 'REQUEST_TIME'
    },
    expectedResult: 'PERMISSION_DENIED'
  },
  {
    id: 4,
    name: 'Non-Creator Member Escalation (Updating membros as invited member)',
    collectionPath: '/viagens/trip1',
    operation: 'update',
    auth: { uid: 'u2', email: 'invited@test.com', email_verified: true },
    payload: {
      membros: ['me@test.com', 'invited@test.com', 'hacker@test.com'],
      updatedAt: 'REQUEST_TIME'
    },
    expectedResult: 'PERMISSION_DENIED'
  },
  {
    id: 5,
    name: 'Orphaned Item Creation (Non-existent or unauthorized viagemId)',
    collectionPath: '/viagens/non_existent_trip/itens/item1',
    operation: 'create',
    auth: { uid: 'u1', email: 'me@test.com', email_verified: true },
    payload: {
      viagemId: 'non_existent_trip',
      tipo: 'hotel',
      titulo: 'Hotel',
      valor: 500,
      nota: '',
      data: '',
      autor: 'me@test.com',
      autorUid: 'u1',
      ts: 1000,
      votos: [],
      comentarios: [],
      pago: false,
      prazo: '',
      createdAt: 'REQUEST_TIME',
      updatedAt: 'REQUEST_TIME'
    },
    expectedResult: 'PERMISSION_DENIED'
  },
  {
    id: 6,
    name: 'Denial-of-Wallet String Overflow on Item titulo (>200 chars)',
    collectionPath: '/viagens/trip1/itens/item2',
    operation: 'create',
    auth: { uid: 'u1', email: 'me@test.com', email_verified: true },
    payload: {
      viagemId: 'trip1',
      tipo: 'hotel',
      titulo: 'A'.repeat(250),
      valor: 500,
      nota: '',
      data: '',
      autor: 'me@test.com',
      autorUid: 'u1',
      ts: 1000,
      votos: [],
      comentarios: [],
      pago: false,
      prazo: '',
      createdAt: 'REQUEST_TIME',
      updatedAt: 'REQUEST_TIME'
    },
    expectedResult: 'PERMISSION_DENIED'
  },
  {
    id: 7,
    name: 'Invalid Enum on Item tipo',
    collectionPath: '/viagens/trip1/itens/item3',
    operation: 'create',
    auth: { uid: 'u1', email: 'me@test.com', email_verified: true },
    payload: {
      viagemId: 'trip1',
      tipo: 'hacked_type',
      titulo: 'Item',
      valor: 100,
      nota: '',
      data: '',
      autor: 'me@test.com',
      autorUid: 'u1',
      ts: 1000,
      votos: [],
      comentarios: [],
      pago: false,
      prazo: '',
      createdAt: 'REQUEST_TIME',
      updatedAt: 'REQUEST_TIME'
    },
    expectedResult: 'PERMISSION_DENIED'
  },
  {
    id: 8,
    name: 'Immutable Field Mutation (autorUid changed during Item update)',
    collectionPath: '/viagens/trip1/itens/item1',
    operation: 'update',
    auth: { uid: 'u1', email: 'me@test.com', email_verified: true },
    payload: {
      autorUid: 'someone_else',
      pago: true,
      updatedAt: 'REQUEST_TIME'
    },
    expectedResult: 'PERMISSION_DENIED'
  },
  {
    id: 9,
    name: 'Client Timestamp Forgery (createdAt != request.time)',
    collectionPath: '/viagens/trip1/checklist/chk1',
    operation: 'create',
    auth: { uid: 'u1', email: 'me@test.com', email_verified: true },
    payload: {
      viagemId: 'trip1',
      cat: 'Bagagem',
      texto: 'Mala',
      feito: false,
      ts: 1000,
      createdAt: '2020-01-01T00:00:00Z',
      updatedAt: 'REQUEST_TIME'
    },
    expectedResult: 'PERMISSION_DENIED'
  },
  {
    id: 10,
    name: 'Array Overflow on membros (>20 emails)',
    collectionPath: '/viagens/trip_overflow',
    operation: 'create',
    auth: { uid: 'u1', email: 'me@test.com', email_verified: true },
    payload: {
      nome: 'Férias',
      criadorUid: 'u1',
      criadorEmail: 'me@test.com',
      membros: Array.from({ length: 21 }, (_, i) => `user${i}@test.com`),
      createdAt: 'REQUEST_TIME',
      updatedAt: 'REQUEST_TIME'
    },
    expectedResult: 'PERMISSION_DENIED'
  },
  {
    id: 11,
    name: 'Unauthorized Read of Another Trip gastos',
    collectionPath: '/viagens/other_trip/gastos/g1',
    operation: 'get',
    auth: { uid: 'u_intruder', email: 'intruder@test.com', email_verified: true },
    expectedResult: 'PERMISSION_DENIED'
  },
  {
    id: 12,
    name: 'Value Poisoning on meta/pessoas (nomes not a list of strings)',
    collectionPath: '/viagens/trip1/meta/pessoas',
    operation: 'create',
    auth: { uid: 'u1', email: 'me@test.com', email_verified: true },
    payload: {
      viagemId: 'trip1',
      nomes: [12345],
      createdAt: 'REQUEST_TIME',
      updatedAt: 'REQUEST_TIME'
    },
    expectedResult: 'PERMISSION_DENIED'
  }
];
