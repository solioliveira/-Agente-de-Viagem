# Security Specification — Agente de Viagem

## 1. Data Invariants
1. **Master Gate (Membership Sync)**: Every subcollection document (`itens`, `monitores`, `gastos`, `checklist`, `meta`) belongs to a parent `/viagens/{viagemId}` document. Only authenticated, email-verified users whose email is in `get(/databases/$(database)/documents/viagens/$(viagemId)).data.membros` may read or write any subcollection document.
2. **Creator Exclusivity for Invites**: Only the trip creator (`criadorUid == request.auth.uid`) may update the `membros` or `nome` of `/viagens/{viagemId}`, or delete the trip.
3. **Immutable Ownership & Timestamps**: `criadorUid`, `criadorEmail`, `viagemId`, `createdAt`, `autorUid`, `autor`, and `ts` are immutable after document creation. `createdAt` and `updatedAt` must match `request.time`.
4. **Strict Keys & Volumetric Bounds**: Every create and update operation enforces `hasAll` and `hasOnly` key allowlists, string length bounds, numeric bounds, and array size bounds.
5. **Query Enforcer**: All `list` operations check `resource.data` (`request.auth.token.email in resource.data.membros` for `/viagens`, and `resource.data.viagemId == viagemId && isTripMember(viagemId)` for subcollections).

## 2. The "Dirty Dozen" Payloads

1. **Unverified Email Spoofing on Viagem Create**:
   `{ "nome": "Férias", "criadorUid": "u1", "criadorEmail": "victim@test.com", "membros": ["victim@test.com"], "createdAt": "SERVER_TIME", "updatedAt": "SERVER_TIME" }` (with `email_verified: false`)
2. **Identity Spoofing (`criadorUid` mismatch)**:
   `{ "nome": "Férias", "criadorUid": "other_uid", "criadorEmail": "me@test.com", "membros": ["me@test.com"], "createdAt": "SERVER_TIME", "updatedAt": "SERVER_TIME" }`
3. **Shadow Field Injection on Viagem Update**:
   `{ "nome": "Férias 2", "isAdmin": true, "updatedAt": "SERVER_TIME" }`
4. **Non-Creator Member Escalation (Updating `membros` as invited member)**:
   `{ "membros": ["creator@test.com", "invited@test.com", "hacker@test.com"], "updatedAt": "SERVER_TIME" }`
5. **Orphaned Item Creation (Non-existent or unauthorized `viagemId`)**:
   `{ "viagemId": "non_existent_trip", "tipo": "hotel", "titulo": "Hotel", "valor": 500, "nota": "", "data": "", "autor": "me@test.com", "autorUid": "u1", "ts": 1000, "votos": [], "comentarios": [], "pago": false, "prazo": "", "createdAt": "SERVER_TIME", "updatedAt": "SERVER_TIME" }`
6. **Denial-of-Wallet String Overflow on Item `titulo` (>200 chars)**:
   `{ "viagemId": "trip1", "tipo": "hotel", "titulo": "A".repeat(500), "valor": 500, "nota": "", "data": "", "autor": "me@test.com", "autorUid": "u1", "ts": 1000, "votos": [], "comentarios": [], "pago": false, "prazo": "", "createdAt": "SERVER_TIME", "updatedAt": "SERVER_TIME" }`
7. **Invalid Enum on Item `tipo`**:
   `{ "viagemId": "trip1", "tipo": "hacked_type", "titulo": "Item", "valor": 100, "nota": "", "data": "", "autor": "me@test.com", "autorUid": "u1", "ts": 1000, "votos": [], "comentarios": [], "pago": false, "prazo": "", "createdAt": "SERVER_TIME", "updatedAt": "SERVER_TIME" }`
8. **Immutable Field Mutation (`autorUid` changed during Item update)**:
   `{ "autorUid": "someone_else", "pago": true, "updatedAt": "SERVER_TIME" }`
9. **Client Timestamp Forgery (`createdAt` != `request.time`)**:
   `{ "viagemId": "trip1", "cat": "Bagagem", "texto": "Mala", "feito": false, "ts": 1000, "createdAt": "2020-01-01T00:00:00Z", "updatedAt": "SERVER_TIME" }`
10. **Array Overflow on `membros` (>20 emails)**:
    `{ "nome": "Férias", "criadorUid": "u1", "criadorEmail": "me@test.com", "membros": ["1@a.com","2@a.com","3@a.com","4@a.com","5@a.com","6@a.com","7@a.com","8@a.com","9@a.com","10@a.com","11@a.com","12@a.com","13@a.com","14@a.com","15@a.com","16@a.com","17@a.com","18@a.com","19@a.com","20@a.com","21@a.com"], "createdAt": "SERVER_TIME", "updatedAt": "SERVER_TIME" }`
11. **Unauthorized Read of Another Trip's `gastos`**:
    `GET /viagens/other_trip/gastos/g1` as user not in `other_trip.membros`.
12. **Value Poisoning on `meta/pessoas` (`nomes` not a list of strings)**:
    `{ "viagemId": "trip1", "nomes": [12345], "createdAt": "SERVER_TIME", "updatedAt": "SERVER_TIME" }`
