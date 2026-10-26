import React, { useEffect, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import {
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  serverTimestamp,
  getDoc,
} from 'firebase/firestore';
import { jsPDF } from 'jspdf';
import {
  auth,
  db,
  firebaseProjectId,
  loginWithGoogle,
  logoutUser,
  handleFirestoreError,
  OperationType,
} from './firebase';

type AreaKey = 'home' | 'planejar' | 'roteiro' | 'dinheiro';
type SecKey =
  | 'home'
  | 'ferias'
  | 'fds'
  | 'comp'
  | 'datas'
  | 'roteiro'
  | 'mapa'
  | 'check'
  | 'orc'
  | 'gastos'
  | 'milhas';

interface ViagemDoc {
  id: string;
  nome: string;
  criadorUid: string;
  criadorEmail: string;
  membros: string[];
}

interface ComentarioItem {
  autor: string;
  texto: string;
  ts: number;
}

interface RoteiroItem {
  id: string;
  viagemId?: string;
  tipo: 'passagem' | 'hotel' | 'restaurante' | 'passeio' | 'gasto' | 'nota' | 'destino';
  titulo: string;
  valor: number;
  nota: string;
  data: string;
  autor: string;
  autorUid: string;
  ts: number;
  votos: string[];
  comentarios: ComentarioItem[];
  pago: boolean;
  prazo: string;
}

interface RegMonitor {
  valor: number;
  ts: number;
}

interface MonitorItem {
  id: string;
  viagemId?: string;
  nome: string;
  data: string;
  alvo: number;
  regs: RegMonitor[];
  ts: number;
}

interface GastoItem {
  id: string;
  viagemId?: string;
  desc: string;
  valor: number;
  pagador: string;
  dividir: string[];
  ts: number;
}

interface CheckItem {
  id: string;
  viagemId?: string;
  cat: string;
  texto: string;
  feito: boolean;
  ts: number;
}

interface HospedagemSugestao {
  nome?: string;
  tipo?: string;
  faixa_diaria_brl?: number;
}

interface FeriasSugestao {
  destino: string;
  pais: string;
  tipo: string;
  porque: string;
  custos: {
    passagens: number;
    hospedagem: number;
    alimentacao: number;
    passeios: number;
    transporte_local: number;
    total: number;
  };
  hospedagem: (HospedagemSugestao | string)[];
  passagem: {
    onde_comprar: string;
    milhas_ou_dinheiro: string;
  };
  pagar_antes: string;
  reserva_destino_brl: number;
  roteiro: string[];
  restaurantes: string[];
  passeios: string[];
  dicas_economia: string[];
  economia_estimada_brl: number;
  sala_vip_milhas: string;
}

interface FdsOpcao {
  destino: string;
  distancia: string;
  porque: string;
  roteiro: string[];
  restaurantes: string[];
  hospedagem: string;
  custo_estimado_brl: number;
  dica_crianca: string;
  dicas_economia: string[];
  clima_tipico: string;
}

interface DestinoComp {
  destino: string;
  custo_total_brl: number;
  custo_por_dia_brl: number;
  nota_custo_beneficio: number;
  passagens: number;
  hospedagem: number;
  alimentacao_passeios: number;
  melhor_epoca_barata: string;
  pros: string[];
  contras: string[];
}

interface CompResult {
  destinos: DestinoComp[];
  recomendacao: string;
}

interface MesSazonal {
  mes: string;
  nivel: 'alta' | 'media' | 'baixa' | string;
  indice: number;
  nota: string;
}

interface DatasResult {
  resumo: string;
  melhores_meses: string[];
  meses: MesSazonal[];
}

interface MapaPonto {
  titulo: string;
  lat: number;
  lng: number;
}

interface MapaGrupo {
  nome: string;
  itens: MapaPonto[];
}

interface MapaResult {
  grupos: MapaGrupo[];
  dica: string;
  economia_deslocamento: string;
}

interface MilhasResult {
  resumo: string;
  passos: string[];
  como_juntar_milhas: string[];
  sala_vip: string[];
  alertas: string[];
}

const AREAS: Record<AreaKey, { n: string; s: [SecKey, string][] }> = {
  home: { n: 'Início', s: [['home', '']] },
  planejar: {
    n: 'Planejar',
    s: [
      ['ferias', 'Férias'],
      ['fds', 'Fim de semana'],
      ['comp', 'Comparar'],
      ['datas', 'Datas e preços'],
    ],
  },
  roteiro: {
    n: 'Nosso roteiro',
    s: [
      ['roteiro', 'Itens e agenda'],
      ['mapa', 'Mapa'],
      ['check', 'Checklist'],
    ],
  },
  dinheiro: {
    n: 'Dinheiro',
    s: [
      ['orc', 'Orçamento'],
      ['gastos', 'Dividir gastos'],
      ['milhas', 'Milhas e VIP'],
    ],
  },
};

const HELP: Record<SecKey, string> = {
  home: 'Escolha por onde começar o planejamento da sua viagem.',
  ferias:
    'Preencha o que souber e toque em Sugerir destinos. Os campos em "Mais opções" são opcionais.',
  fds: 'Escolha com quem vai e o orçamento. Se estiver em cima da hora, use Escapada de última hora.',
  comp: 'Digite 2 ou 3 destinos que você está em dúvida e veja qual compensa mais.',
  datas: 'Veja em que época do ano costuma ser mais barato viajar para um destino.',
  roteiro:
    'Aqui vocês juntam passagens, hotéis e passeios. Tudo que um adicionar aparece para o outro.',
  mapa: 'Agrupa os passeios do roteiro que ficam perto uns dos outros. Adicione os lugares na aba Itens e agenda antes.',
  check: 'Gere uma lista do que levar e providenciar, e vá marcando o que já está pronto.',
  orc: 'Veja quanto vai gastar, quanto guardar por mês e o que já foi pago.',
  gastos: 'Para viagens em grupo: registre quem pagou cada gasto e veja quem deve a quem.',
  milhas: 'Descubra se vale usar milhas e como entrar em sala VIP gastando pouco.',
};

const LBL: Record<string, string> = {
  passagem: 'Passagem',
  hotel: 'Hotel',
  restaurante: 'Restaurante',
  passeio: 'Passeio',
  gasto: 'Gasto',
  nota: 'Nota',
  destino: 'Destino',
};

const brl = (n: unknown) =>
  Number(n || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  });

const arr = <T,>(a: unknown): T[] => (Array.isArray(a) ? (a as T[]) : []);

const fmtD = (d: string) => {
  const p = String(d || '').split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : d;
};

const clampStr = (s: unknown, max: number) => String(s ?? '').trim().slice(0, max);

const loadLocal = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

export default function App() {
  const [sec, setSec] = useState<SecKey>('home');
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Auth & Trips state
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [unauthorizedDomain, setUnauthorizedDomain] = useState<string | null>(null);
  const [viagens, setViagens] = useState<ViagemDoc[]>([]);
  const [activeViagemId, setActiveViagemId] = useState<string>('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [newTripName, setNewTripName] = useState('');
  const [showNewTrip, setShowNewTrip] = useState(false);

  // Shared Trip Data (Firestore when logged in, localStorage fallback when logged out)
  const [items, setItems] = useState<RoteiroItem[]>(() =>
    loadLocal('av_items', [])
  );
  const [mons, setMons] = useState<MonitorItem[]>(() =>
    loadLocal('av_mons', [])
  );
  const [gastos, setGastos] = useState<GastoItem[]>(() =>
    loadLocal('av_gastos', [])
  );
  const [checks, setChecks] = useState<CheckItem[]>(() =>
    loadLocal('av_checks', [])
  );
  const [pessoas, setPessoas] = useState<string[]>(() =>
    loadLocal('av_pessoas', [])
  );

  // Férias Form
  const [fSaida, setFSaida] = useState('');
  const [fQuando, setFQuando] = useState('');
  const [fDias, setFDias] = useState(10);
  const [fAdultos, setFAdultos] = useState(2);
  const [fCriancas, setFCriancas] = useState('');
  const [fOrc, setFOrc] = useState('');
  const [fTipo, setFTipo] = useState('nacional e internacional');
  const [fMilhas, setFMilhas] = useState('');
  const [fEstilo, setFEstilo] = useState('');
  const [fFoco, setFFoco] = useState('Econômico (melhor custo-benefício)');
  const [fLoading, setFLoading] = useState(false);
  const [fErr, setFErr] = useState('');
  const [fSugestoes, setFSugestoes] = useState<FeriasSugestao[]>([]);

  // Fim de semana Form
  const [wSaida, setWSaida] = useState('');
  const [wPerfil, setWPerfil] = useState('casal');
  const [wCriancas, setWCriancas] = useState('');
  const [wRaio, setWRaio] = useState('até 1h30 de carro');
  const [wOrc, setWOrc] = useState('');
  const [wQuando, setWQuando] = useState('');
  const [wFoco, setWFoco] = useState('Econômico (melhor custo-benefício)');
  const [wLoading, setWLoading] = useState(false);
  const [wErr, setWErr] = useState('');
  const [wOpcoes, setWOpcoes] = useState<FdsOpcao[]>([]);

  // Comparar Form
  const [c1, setC1] = useState('');
  const [c2, setC2] = useState('');
  const [c3, setC3] = useState('');
  const [cSaida, setCSaida] = useState('');
  const [cDias, setCDias] = useState(7);
  const [cPess, setCPess] = useState('');
  const [cLoading, setCLoading] = useState(false);
  const [cErr, setCErr] = useState('');
  const [cResult, setCResult] = useState<CompResult | null>(null);

  // Datas e preços Form
  const [dDest, setDDest] = useState('');
  const [dSaida, setDSaida] = useState('');
  const [dDias, setDDias] = useState(7);
  const [dLoading, setDLoading] = useState(false);
  const [dErr, setDErr] = useState('');
  const [dResult, setDResult] = useState<DatasResult | null>(null);

  // Monitor de preço Form
  const [pNome, setPNome] = useState('');
  const [pData, setPData] = useState('');
  const [pAlvo, setPAlvo] = useState('');
  const [priceInputs, setPriceInputs] = useState<Record<string, string>>({});

  // Roteiro Form & Comments
  const [iTipo, setITipo] = useState<RoteiroItem['tipo']>('passagem');
  const [iTitulo, setITitulo] = useState('');
  const [iValor, setIValor] = useState('');
  const [iData, setIData] = useState('');
  const [iNota, setINota] = useState('');
  const [openComments, setOpenComments] = useState<Record<string, boolean>>({});
  const [commentInputs, setCommentInputs] = useState<Record<string, string>>({});

  // Mapa Form
  const [mpCidade, setMpCidade] = useState('');
  const [mpDias, setMpDias] = useState(3);
  const [mpLoading, setMpLoading] = useState(false);
  const [mpErr, setMpErr] = useState('');
  const [mpResult, setMpResult] = useState<MapaResult | null>(null);

  // Checklist Form
  const [kDest, setKDest] = useState('');
  const [kEpoca, setKEpoca] = useState('');
  const [kCri, setKCri] = useState('');
  const [kTipo, setKTipo] = useState('nacional');
  const [kNovo, setKNovo] = useState('');
  const [kLoading, setKLoading] = useState(false);
  const [kErr, setKErr] = useState('');

  // Orçamento State
  const [meses, setMeses] = useState(6);
  const [maxB, setMaxB] = useState(0);

  // Dividir gastos Form
  const [gPessInput, setGPessInput] = useState(() =>
    loadLocal<string[]>('av_pessoas', []).join(', ')
  );
  const [gDesc, setGDesc] = useState('');
  const [gVal, setGVal] = useState('');
  const [gPag, setGPag] = useState(() => loadLocal<string[]>('av_pessoas', [])[0] || '');
  const [gDivSelected, setGDivSelected] = useState<string[]>(() =>
    loadLocal<string[]>('av_pessoas', [])
  );

  // Milhas e VIP Form
  const [mPreco, setMPreco] = useState('');
  const [mMilhas, setMMilhas] = useState('');
  const [mTaxas, setMTaxas] = useState('0');
  const [mCusto, setMCusto] = useState('');
  const [mProg, setMProg] = useState('');
  const [mCart, setMCart] = useState('');
  const [mViag, setMViag] = useState('');
  const [mLoading, setMLoading] = useState(false);
  const [mErr, setMErr] = useState('');
  const [mResult, setMResult] = useState<MilhasResult | null>(null);

  const toast = (m: string) => {
    setToastMsg(m);
  };

  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 3200);
    return () => clearTimeout(t);
  }, [toastMsg]);

  // Save to localStorage when not logged in
  useEffect(() => {
    if (user) return;
    try {
      localStorage.setItem('av_items', JSON.stringify(items));
      localStorage.setItem('av_mons', JSON.stringify(mons));
      localStorage.setItem('av_gastos', JSON.stringify(gastos));
      localStorage.setItem('av_checks', JSON.stringify(checks));
      localStorage.setItem('av_pessoas', JSON.stringify(pessoas));
    } catch {
      // ignore storage quota errors
    }
  }, [user, items, mons, gastos, checks, pessoas]);

  // Listen to Auth State
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
      if (u) setUnauthorizedDomain(null);
    });
    return () => unsub();
  }, []);

  // Listen to user's Viagens in Firestore
  useEffect(() => {
    if (!authReady || !user || !user.email) {
      setViagens([]);
      setActiveViagemId('');
      return;
    }

    const q = query(collection(db, 'viagens'), where('membros', 'array-contains', user.email));
    let createdDefault = false;

    const unsub = onSnapshot(
      q,
      async (snap) => {
        const list: ViagemDoc[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<ViagemDoc, 'id'>),
        }));

        if (list.length === 0 && !createdDefault && user.email) {
          createdDefault = true;
          try {
            const ref = await addDoc(collection(db, 'viagens'), {
              nome: 'Nossa Viagem',
              criadorUid: user.uid,
              criadorEmail: user.email,
              membros: [user.email],
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
            setActiveViagemId(ref.id);
          } catch (e) {
            handleFirestoreError(e, OperationType.CREATE, 'viagens');
          }
          return;
        }

        setViagens(list);
        setActiveViagemId((prev) =>
          prev && list.some((v) => v.id === prev) ? prev : list[0]?.id || ''
        );
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'viagens');
      }
    );

    return () => unsub();
  }, [authReady, user]);

  // Listen to subcollections of activeViagemId
  useEffect(() => {
    if (!authReady || !user || !activeViagemId) return;

    const itensPath = `viagens/${activeViagemId}/itens`;
    const monsPath = `viagens/${activeViagemId}/monitores`;
    const gastosPath = `viagens/${activeViagemId}/gastos`;
    const checkPath = `viagens/${activeViagemId}/checklist`;
    const pessoasPath = `viagens/${activeViagemId}/meta/pessoas`;

    const unsubItens = onSnapshot(
      query(
        collection(db, 'viagens', activeViagemId, 'itens'),
        where('viagemId', '==', activeViagemId)
      ),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<RoteiroItem, 'id'>) }))
          .sort((a, b) => b.ts - a.ts);
        setItems(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, itensPath)
    );

    const unsubMons = onSnapshot(
      query(
        collection(db, 'viagens', activeViagemId, 'monitores'),
        where('viagemId', '==', activeViagemId)
      ),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<MonitorItem, 'id'>) }))
          .sort((a, b) => b.ts - a.ts);
        setMons(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, monsPath)
    );

    const unsubGastos = onSnapshot(
      query(
        collection(db, 'viagens', activeViagemId, 'gastos'),
        where('viagemId', '==', activeViagemId)
      ),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<GastoItem, 'id'>) }))
          .sort((a, b) => b.ts - a.ts);
        setGastos(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, gastosPath)
    );

    const unsubChecks = onSnapshot(
      query(
        collection(db, 'viagens', activeViagemId, 'checklist'),
        where('viagemId', '==', activeViagemId)
      ),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<CheckItem, 'id'>) }))
          .sort((a, b) => a.ts - b.ts);
        setChecks(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, checkPath)
    );

    const unsubPessoas = onSnapshot(
      doc(db, 'viagens', activeViagemId, 'meta', 'pessoas'),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          const nomes = arr<string>(data.nomes);
          setPessoas(nomes);
          setGPessInput(nomes.join(', '));
          setGPag((prev) => (nomes.includes(prev) ? prev : nomes[0] || ''));
          setGDivSelected(nomes);
        } else {
          setPessoas([]);
          setGPessInput('');
          setGPag('');
          setGDivSelected([]);
        }
      },
      (err) => handleFirestoreError(err, OperationType.GET, pessoasPath)
    );

    return () => {
      unsubItens();
      unsubMons();
      unsubGastos();
      unsubChecks();
      unsubPessoas();
    };
  }, [authReady, user, activeViagemId]);

  const activeViagem = viagens.find((v) => v.id === activeViagemId) || null;
  const currentArea: AreaKey =
    (Object.keys(AREAS) as AreaKey[]).find((k) =>
      AREAS[k].s.some((x) => x[0] === sec)
    ) || 'home';

  const go = (target: SecKey) => {
    setSec(target);
    window.scrollTo(0, 0);
  };

  const handleGoogleLoginClick = async () => {
    try {
      setUnauthorizedDomain(null);
      await loginWithGoogle();
    } catch (err: any) {
      const code = err?.code || '';
      if (code === 'auth/unauthorized-domain') {
        setUnauthorizedDomain(window.location.hostname);
        toast('Domínio ainda não liberado no Firebase. Veja as instruções abaixo.');
      } else if (code === 'auth/popup-closed-by-user') {
        toast('Janela de login foi fechada antes de concluir.');
      } else {
        toast('Não foi possível entrar com o Google agora.');
      }
    }
  };

  // Call Server-Side Gemini API
  async function askGemini<T>(
    prompt: string,
    setLoading: (b: boolean) => void,
    setError: (s: string) => void
  ): Promise<T | null> {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      if (!res.ok) {
        setError('Não consegui gerar agora. Tente de novo em instantes.');
        return null;
      }
      const data = (await res.json()) as T;
      return data;
    } catch {
      setError('Não consegui gerar agora. Tente de novo em instantes.');
      return null;
    } finally {
      setLoading(false);
    }
  }

  // Trip Management
  const handleCreateTrip = async () => {
    if (!user || !user.email) return toast('Faça login com o Google primeiro.');
    const nome = clampStr(newTripName, 100);
    if (!nome) return toast('Dê um nome para a viagem.');
    try {
      const ref = await addDoc(collection(db, 'viagens'), {
        nome,
        criadorUid: user.uid,
        criadorEmail: user.email,
        membros: [user.email],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setActiveViagemId(ref.id);
      setNewTripName('');
      setShowNewTrip(false);
      toast('Nova viagem criada!');
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, 'viagens');
    }
  };

  const handleInviteMember = async () => {
    if (!user || !activeViagem) return;
    if (activeViagem.criadorUid !== user.uid) {
      return toast('Apenas quem criou a viagem pode convidar membros.');
    }
    const email = clampStr(inviteEmail.toLowerCase(), 254);
    if (!email || !email.includes('@') || email.length < 3) {
      return toast('Informe um e-mail válido.');
    }
    if (activeViagem.membros.includes(email)) {
      return toast('Essa pessoa já faz parte da viagem.');
    }
    if (activeViagem.membros.length >= 20) {
      return toast('Limite de 20 membros por viagem atingido.');
    }
    try {
      await updateDoc(doc(db, 'viagens', activeViagem.id), {
        membros: [...activeViagem.membros, email],
        updatedAt: serverTimestamp(),
      });
      setInviteEmail('');
      toast(`Convite liberado para ${email}! Basta entrar com esse e-mail.`);
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `viagens/${activeViagem.id}`);
    }
  };

  const handleRemoveMember = async (emailToRemove: string) => {
    if (!user || !activeViagem) return;
    if (activeViagem.criadorUid !== user.uid) return;
    if (emailToRemove === activeViagem.criadorEmail) {
      return toast('Quem criou a viagem não pode ser removido.');
    }
    try {
      await updateDoc(doc(db, 'viagens', activeViagem.id), {
        membros: activeViagem.membros.filter((m) => m !== emailToRemove),
        updatedAt: serverTimestamp(),
      });
      toast('Membro removido da viagem.');
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `viagens/${activeViagem.id}`);
    }
  };

  // CRUD Helpers for Roteiro Items
  const addItem = async (partial: {
    tipo: RoteiroItem['tipo'];
    titulo: string;
    valor?: number;
    nota?: string;
    data?: string;
  }) => {
    const ts = Date.now();
    const cleanTitulo = clampStr(partial.titulo, 200) || 'Item';
    const cleanNota = clampStr(partial.nota || '', 2000);
    const cleanData = clampStr(partial.data || '', 20);
    const cleanValor = Math.max(0, Math.min(100000000, Number(partial.valor) || 0));

    if (user && user.email && activeViagemId) {
      const path = `viagens/${activeViagemId}/itens`;
      try {
        await addDoc(collection(db, 'viagens', activeViagemId, 'itens'), {
          viagemId: activeViagemId,
          tipo: partial.tipo,
          titulo: cleanTitulo,
          valor: cleanValor,
          nota: cleanNota,
          data: cleanData,
          autor: user.email,
          autorUid: user.uid,
          ts,
          votos: [],
          comentarios: [],
          pago: false,
          prazo: '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (e) {
        toast('Sem permissão para editar este roteiro.');
        handleFirestoreError(e, OperationType.CREATE, path);
      }
    } else {
      const localItem: RoteiroItem = {
        id: 'l' + ts + Math.random(),
        tipo: partial.tipo,
        titulo: cleanTitulo,
        valor: cleanValor,
        nota: cleanNota,
        data: cleanData,
        autor: 'você',
        autorUid: 'local',
        ts,
        votos: [],
        comentarios: [],
        pago: false,
        prazo: '',
      };
      setItems((prev) => [localItem, ...prev]);
    }
  };

  const delItem = async (id: string) => {
    if (user && activeViagemId) {
      const path = `viagens/${activeViagemId}/itens/${id}`;
      try {
        await deleteDoc(doc(db, 'viagens', activeViagemId, 'itens', id));
      } catch (e) {
        toast('Sem permissão para apagar.');
        handleFirestoreError(e, OperationType.DELETE, path);
      }
    } else {
      setItems((prev) => prev.filter((i) => i.id !== id));
    }
  };

  const mutateItem = async (id: string, patch: Partial<RoteiroItem>) => {
    if (user && activeViagemId) {
      const path = `viagens/${activeViagemId}/itens/${id}`;
      try {
        await updateDoc(doc(db, 'viagens', activeViagemId, 'itens', id), {
          ...patch,
          updatedAt: serverTimestamp(),
        });
      } catch (e) {
        toast('Sem permissão para editar.');
        handleFirestoreError(e, OperationType.UPDATE, path);
      }
    } else {
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
    }
  };

  const handleVote = (item: RoteiroItem) => {
    const meId = user?.email || 'local';
    const v = arr<string>(item.votos);
    const nextVotos = v.includes(meId)
      ? v.filter((x) => x !== meId)
      : v.concat(meId).slice(0, 50);
    mutateItem(item.id, { votos: nextVotos });
  };

  const handleComment = (item: RoteiroItem) => {
    const text = clampStr(commentInputs[item.id] || '', 500);
    if (!text) return;
    const meId = user?.email || 'Você';
    const nextComments = arr<ComentarioItem>(item.comentarios)
      .concat({ autor: meId, texto: text, ts: Date.now() })
      .slice(0, 100);
    setCommentInputs((prev) => ({ ...prev, [item.id]: '' }));
    setOpenComments((prev) => ({ ...prev, [item.id]: true }));
    mutateItem(item.id, { comentarios: nextComments });
  };

  // Férias Handler
  const handleSuggestFerias = async () => {
    const p = `Você é um agente de viagens brasileiro experiente. Responda SOMENTE com JSON válido, sem markdown.
Perfil: saída de ${fSaida.trim() || 'cidade não informada'}; período ${fQuando.trim() || 'flexível'}; ${fDias} dias; ${fAdultos} adulto(s); crianças com idades: ${fCriancas.trim() || 'nenhuma'}; tipo: ${fTipo}; orçamento total R$ ${fOrc.trim() || 'não informado'}; milhas: ${fMilhas.trim() || '0'}; preferências: ${fEstilo.trim() || 'nenhuma'}.
Foco: ${fFoco}. Se o foco for econômico, priorize destinos e épocas com melhor custo-benefício (baixa temporada, datas flexíveis, aeroportos alternativos, hospedagem em apartamento ou pousada, bagagem e transfers) e explique como economizar sem estragar a viagem. Sugira 3 destinos adequados à época e à família. Todos os valores em reais (números), estimativas realistas e arredondadas para o total do grupo; não invente preços exatos nem prometa tarifas.
Formato: {"sugestoes":[{"destino":"","pais":"","tipo":"nacional|internacional","porque":"","custos":{"passagens":0,"hospedagem":0,"alimentacao":0,"passeios":0,"transporte_local":0,"total":0},"hospedagem":[{"nome":"","tipo":"hotel|resort|pousada","faixa_diaria_brl":0}],"passagem":{"onde_comprar":"","milhas_ou_dinheiro":""},"pagar_antes":"","reserva_destino_brl":0,"roteiro":["Dia 1: ..."],"restaurantes":[""],"passeios":[""],"dicas_economia":[""],"economia_estimada_brl":0,"sala_vip_milhas":""}]}
Em "milhas_ou_dinheiro" diga quando vale usar milhas considerando o saldo informado. Em "pagar_antes" diga o que convém quitar antecipadamente e o que guardar para gastar no destino. Roteiro resumido (até 6 itens). Em "dicas_economia" liste 3 a 5 ações concretas; em "economia_estimada_brl" o quanto isso pode reduzir o total; em "sala_vip_milhas" dê dica de milhas e de como acessar sala VIP nos aeroportos dessa viagem, sem afirmar regras exatas de cartões ou programas.`;

    const r = await askGemini<{ sugestoes?: FeriasSugestao[] }>(p, setFLoading, setFErr);
    if (r) {
      setFSugestoes(arr<FeriasSugestao>(r.sugestoes));
    }
  };

  const saveFeriasDest = async (s: FeriasSugestao) => {
    const c = s.custos || ({} as FeriasSugestao['custos']);
    await addItem({
      tipo: 'destino',
      titulo: s.destino,
      valor: 0,
      nota: arr<string>(s.roteiro).join(' · '),
    });
    const costEntries: [RoteiroItem['tipo'], keyof FeriasSugestao['custos'], string][] = [
      ['passagem', 'passagens', 'Passagens'],
      ['hotel', 'hospedagem', 'Hospedagem'],
      ['gasto', 'alimentacao', 'Alimentação'],
      ['passeio', 'passeios', 'Passeios'],
      ['gasto', 'transporte_local', 'Transporte local'],
    ];
    for (const [t, k, n] of costEntries) {
      if (c[k]) {
        await addItem({
          tipo: t,
          titulo: `${n} (estim.) — ${s.destino}`,
          valor: Number(c[k]),
          nota: '',
        });
      }
    }
    for (const r of arr<string>(s.restaurantes).slice(0, 3)) {
      await addItem({
        tipo: 'restaurante',
        titulo: String(r),
        valor: 0,
        nota: s.destino,
      });
    }
    toast('Salvo no roteiro compartilhado.');
  };

  // Fim de semana Handler
  const handleSuggestFds = async (isLastMinute = false, overrideQuando?: string) => {
    const epocaStr = overrideQuando ?? wQuando.trim() ?? 'este fim de semana';
    const p = `Você é um agente de viagens brasileiro. Responda SOMENTE com JSON válido, sem markdown.
Sugira 4 escapadas de fim de semana saindo de ${wSaida.trim() || 'cidade não informada'}, para ${wPerfil}${wCriancas.trim() ? ' (crianças: ' + wCriancas.trim() + ' anos)' : ''}, ${wRaio}, orçamento ~R$ ${wOrc.trim() || 'não informado'}, época: ${epocaStr || 'este fim de semana'}. ${isLastMinute ? 'Escapada de última hora para o próximo fim de semana: priorize opções fáceis de reservar em cima da hora e informe o clima típico da época (você não tem a previsão real: diga para conferir). ' : ''}Foco: ${wFoco}; se for econômico, priorize opções baratas e dê dicas de como economizar. Inclua interior e opções perto. Valores em reais, estimativas gerais sem prometer preços exatos.
Formato: {"opcoes":[{"destino":"","distancia":"","porque":"","roteiro":["Sábado: ...","Domingo: ..."],"restaurantes":[""],"hospedagem":"","custo_estimado_brl":0,"dica_crianca":"","dicas_economia":[""],"clima_tipico":""}]}`;

    const r = await askGemini<{ opcoes?: FdsOpcao[] }>(p, setWLoading, setWErr);
    if (r) {
      setWOpcoes(arr<FdsOpcao>(r.opcoes));
    }
  };

  const handleLastMinuteFds = () => {
    const d = new Date();
    const k = (6 - d.getDay() + 7) % 7;
    const s = new Date(d.getTime() + k * 864e5);
    const u = new Date(s.getTime() + 864e5);
    const f = (x: Date) => x.toLocaleDateString('pt-BR');
    const nextStr = `próximo fim de semana (${f(s)} e ${f(u)})`;
    setWQuando(nextStr);
    handleSuggestFds(true, nextStr);
  };

  const saveFdsDest = async (s: FdsOpcao) => {
    await addItem({
      tipo: 'destino',
      titulo: `${s.destino} (fim de semana)`,
      valor: 0,
      nota: arr<string>(s.roteiro).join(' · '),
    });
    if (s.custo_estimado_brl) {
      await addItem({
        tipo: 'gasto',
        titulo: `Custo estimado — ${s.destino}`,
        valor: Number(s.custo_estimado_brl),
        nota: '',
      });
    }
    toast('Salvo no roteiro compartilhado.');
  };

  // Comparar Handler
  const handleComparar = async () => {
    const ds = [c1.trim(), c2.trim(), c3.trim()].filter(Boolean);
    if (ds.length < 2) return toast('Informe pelo menos 2 destinos.');
    const p = `Você é especialista em viagem econômica. Responda SOMENTE com JSON válido, sem markdown.
Compare estes destinos: ${ds.join('; ')}. Saída de ${cSaida.trim() || 'cidade não informada'}; ${cDias} dias; viajantes: ${cPess.trim() || '2 adultos'}. Valores em reais para o grupo todo, estimativas gerais, sem prometer preços. nota_custo_beneficio de 0 a 10, considerando custo e qualidade da viagem.
Formato: {"destinos":[{"destino":"","custo_total_brl":0,"custo_por_dia_brl":0,"nota_custo_beneficio":0,"passagens":0,"hospedagem":0,"alimentacao_passeios":0,"melhor_epoca_barata":"","pros":[""],"contras":[""]}],"recomendacao":""}`;

    const r = await askGemini<CompResult>(p, setCLoading, setCErr);
    if (r) setCResult(r);
  };

  // Datas baratas Handler
  const handleDatasBaratas = async () => {
    if (!dDest.trim()) return toast('Informe o destino.');
    const p = `Você é especialista em viagem econômica. Responda SOMENTE com JSON válido, sem markdown.
Destino: ${dDest.trim()}; saída de ${dSaida.trim() || 'cidade não informada'}; ${dDias} dias. Para os 12 meses do ano, classifique a sazonalidade típica de preços de passagem e hospedagem (alta, media ou baixa), com índice de 1 (mais barato) a 5 (mais caro) e uma nota curta sobre clima, feriados ou eventos. Não afirme preços atuais.
Formato: {"resumo":"","melhores_meses":[""],"meses":[{"mes":"Janeiro","nivel":"alta|media|baixa","indice":1,"nota":""}]}`;

    const r = await askGemini<DatasResult>(p, setDLoading, setDErr);
    if (r) setDResult(r);
  };

  // Monitor de preço Handlers
  const handleAddMonitor = async () => {
    const n = clampStr(pNome, 150);
    if (!n) return toast('Dê um nome ao monitor.');
    const ts = Date.now();
    const cleanData = clampStr(pData, 20);
    const cleanAlvo = Math.max(0, Math.min(100000000, Number(pAlvo) || 0));

    if (user && activeViagemId) {
      const path = `viagens/${activeViagemId}/monitores`;
      try {
        await addDoc(collection(db, 'viagens', activeViagemId, 'monitores'), {
          viagemId: activeViagemId,
          nome: n,
          data: cleanData,
          alvo: cleanAlvo,
          regs: [],
          ts,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (e) {
        toast('Sem permissão para editar.');
        handleFirestoreError(e, OperationType.CREATE, path);
      }
    } else {
      setMons((prev) => [
        { id: 'm' + ts, nome: n, data: cleanData, alvo: cleanAlvo, regs: [], ts },
        ...prev,
      ]);
    }
    setPNome('');
    setPData('');
    setPAlvo('');
  };

  const handleRegisterPrice = async (m: MonitorItem) => {
    const val = Number(priceInputs[m.id]);
    if (!(val > 0)) return toast('Informe um valor válido.');
    const nextRegs = arr<RegMonitor>(m.regs)
      .concat({ valor: val, ts: Date.now() })
      .slice(0, 200);
    setPriceInputs((prev) => ({ ...prev, [m.id]: '' }));

    if (user && activeViagemId) {
      const path = `viagens/${activeViagemId}/monitores/${m.id}`;
      try {
        await updateDoc(doc(db, 'viagens', activeViagemId, 'monitores', m.id), {
          regs: nextRegs,
          updatedAt: serverTimestamp(),
        });
      } catch (e) {
        toast('Sem permissão para editar.');
        handleFirestoreError(e, OperationType.UPDATE, path);
      }
    } else {
      setMons((prev) => prev.map((x) => (x.id === m.id ? { ...x, regs: nextRegs } : x)));
    }
  };

  const handleDelMonitor = async (id: string) => {
    if (user && activeViagemId) {
      const path = `viagens/${activeViagemId}/monitores/${id}`;
      try {
        await deleteDoc(doc(db, 'viagens', activeViagemId, 'monitores', id));
      } catch (e) {
        toast('Sem permissão para apagar.');
        handleFirestoreError(e, OperationType.DELETE, path);
      }
    } else {
      setMons((prev) => prev.filter((m) => m.id !== id));
    }
  };

  // Mapa Handler
  const handleGerarMapa = async () => {
    const L = items.filter((i) => ['passeio', 'restaurante', 'hotel'].includes(i.tipo));
    const cid = mpCidade.trim();
    if (L.length < 2) {
      return toast('Adicione pelo menos 2 lugares (passeio, restaurante ou hotel) ao roteiro.');
    }
    if (!cid) return toast('Informe a cidade ou região.');

    const p = `Você é planejador de roteiros. Responda SOMENTE com JSON válido, sem markdown.
Cidade ou região: ${cid}. Dias disponíveis: ${mpDias || 1}. Lugares: ${L.map((i) => `${i.titulo} [${i.tipo}]`).join('; ')}.
Estime coordenadas aproximadas (lat e lng decimais) de cada lugar e agrupe os que ficam perto, um grupo por dia, na melhor ordem de visita para reduzir deslocamento. Se não souber onde fica um lugar, use o centro da cidade e diga isso na dica. Use exatamente os títulos informados.
Formato: {"grupos":[{"nome":"Dia 1","itens":[{"titulo":"","lat":0,"lng":0}]}],"dica":"","economia_deslocamento":""}`;

    const r = await askGemini<MapaResult>(p, setMpLoading, setMpErr);
    if (r) setMpResult(r);
  };

  // Checklist Handlers
  const addCheckItem = async (cat: string, texto: string, offsetTs = 0) => {
    const ts = Date.now() + offsetTs;
    const cleanCat = clampStr(cat || 'Outros', 60);
    const cleanTexto = clampStr(texto, 250);
    if (!cleanTexto) return;

    if (user && activeViagemId) {
      const path = `viagens/${activeViagemId}/checklist`;
      try {
        await addDoc(collection(db, 'viagens', activeViagemId, 'checklist'), {
          viagemId: activeViagemId,
          cat: cleanCat,
          texto: cleanTexto,
          feito: false,
          ts,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (e) {
        toast('Sem permissão para editar.');
        handleFirestoreError(e, OperationType.CREATE, path);
      }
    } else {
      setChecks((prev) => [
        ...prev,
        { id: 'ck' + ts + Math.random(), cat: cleanCat, texto: cleanTexto, feito: false, ts },
      ]);
    }
  };

  const toggleCheckItem = async (id: string, feito: boolean) => {
    if (user && activeViagemId) {
      const path = `viagens/${activeViagemId}/checklist/${id}`;
      try {
        await updateDoc(doc(db, 'viagens', activeViagemId, 'checklist', id), {
          feito,
          updatedAt: serverTimestamp(),
        });
      } catch (e) {
        toast('Sem permissão para editar.');
        handleFirestoreError(e, OperationType.UPDATE, path);
      }
    } else {
      setChecks((prev) => prev.map((c) => (c.id === id ? { ...c, feito } : c)));
    }
  };

  const delCheckItem = async (id: string) => {
    if (user && activeViagemId) {
      const path = `viagens/${activeViagemId}/checklist/${id}`;
      try {
        await deleteDoc(doc(db, 'viagens', activeViagemId, 'checklist', id));
      } catch (e) {
        toast('Sem permissão para apagar.');
        handleFirestoreError(e, OperationType.DELETE, path);
      }
    } else {
      setChecks((prev) => prev.filter((c) => c.id !== id));
    }
  };

  const handleGerarChecklist = async () => {
    if (!kDest.trim()) return toast('Informe o destino.');
    const p = `Você é planejador de viagens. Responda SOMENTE com JSON válido, sem markdown.
Gere um checklist de viagem para ${kDest.trim()} (${kTipo}), época ${kEpoca.trim() || 'não informada'}, crianças com idades: ${kCri.trim() || 'nenhuma'}. Até 30 itens curtos e objetivos nas categorias Documentos, Bagagem, Saúde e vacinas, Criança (só se houver), Dinheiro e celular, Antes de sair. Para vacinas e exigências de entrada, escreva "conferir exigência oficial" em vez de afirmar regras exatas.
Formato: {"itens":[{"cat":"","texto":""}]}`;

    const r = await askGemini<{ itens?: { cat: string; texto: string }[] }>(
      p,
      setKLoading,
      setKErr
    );
    if (r) {
      const list = arr<{ cat: string; texto: string }>(r.itens).slice(0, 30);
      for (let idx = 0; idx < list.length; idx++) {
        await addCheckItem(list[idx].cat || 'Outros', String(list[idx].texto || ''), idx);
      }
    }
  };

  // Dividir Gastos Handlers
  const handleSavePessoas = async () => {
    const nomes = gPessInput
      .split(',')
      .map((x) => clampStr(x, 80))
      .filter(Boolean)
      .slice(0, 30);
    if (nomes.length < 2) return toast('Informe pelo menos 2 pessoas.');

    if (user && activeViagemId) {
      const path = `viagens/${activeViagemId}/meta/pessoas`;
      try {
        const ref = doc(db, 'viagens', activeViagemId, 'meta', 'pessoas');
        const snap = await getDoc(ref);
        if (snap.exists()) {
          await updateDoc(ref, {
            nomes,
            updatedAt: serverTimestamp(),
          });
        } else {
          await setDoc(ref, {
            viagemId: activeViagemId,
            nomes,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
        toast('Pessoas salvas.');
      } catch (e) {
        toast('Sem permissão para editar.');
        handleFirestoreError(e, OperationType.WRITE, path);
      }
    } else {
      setPessoas(nomes);
      setGPag(nomes[0] || '');
      setGDivSelected(nomes);
      toast('Pessoas salvas.');
    }
  };

  const handleAddGasto = async () => {
    const val = Number(gVal);
    const desc = clampStr(gDesc, 200);
    const pag = clampStr(gPag, 80);
    const dv = gDivSelected.filter((n) => pessoas.includes(n));
    if (!desc || !(val > 0) || !pag || !dv.length) {
      return toast('Preencha descrição, valor, quem pagou e com quem divide.');
    }
    const ts = Date.now();
    if (user && activeViagemId) {
      const path = `viagens/${activeViagemId}/gastos`;
      try {
        await addDoc(collection(db, 'viagens', activeViagemId, 'gastos'), {
          viagemId: activeViagemId,
          desc,
          valor: val,
          pagador: pag,
          dividir: dv,
          ts,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (e) {
        toast('Sem permissão para editar.');
        handleFirestoreError(e, OperationType.CREATE, path);
      }
    } else {
      setGastos((prev) => [
        { id: 'g' + ts, desc, valor: val, pagador: pag, dividir: dv, ts },
        ...prev,
      ]);
    }
    setGDesc('');
    setGVal('');
  };

  const handleDelGasto = async (id: string) => {
    if (user && activeViagemId) {
      const path = `viagens/${activeViagemId}/gastos/${id}`;
      try {
        await deleteDoc(doc(db, 'viagens', activeViagemId, 'gastos', id));
      } catch (e) {
        toast('Sem permissão para apagar.');
        handleFirestoreError(e, OperationType.DELETE, path);
      }
    } else {
      setGastos((prev) => prev.filter((g) => g.id !== id));
    }
  };

  // Milhas IA Strategy Handler
  const handleMilhasStrategy = async () => {
    const p = `Você é especialista em milhas e viagem econômica no Brasil. Responda SOMENTE com JSON válido, sem markdown.
Perfil: programas e saldo: ${mProg.trim() || 'não informado'}; cartões: ${mCart.trim() || 'não informado'}; viagem pretendida: ${mViag.trim() || 'não informada'}.
Monte uma estratégia prática para gastar menos e viajar bem. Não afirme regras, preços ou benefícios exatos de cartões e programas; diga o que conferir.
Formato: {"resumo":"","passos":[""],"como_juntar_milhas":[""],"sala_vip":[""],"alertas":[""]}`;

    const r = await askGemini<MilhasResult>(p, setMLoading, setMErr);
    if (r) setMResult(r);
  };

  // Export Summary Text & PDF
  const buildResumo = () => {
    const L = ['ROTEIRO DE VIAGEM', ''];
    const ag = items.filter((i) => i.data).sort((x, y) => (x.data < y.data ? -1 : 1));
    if (ag.length) {
      L.push('AGENDA');
      let last = '';
      ag.forEach((i) => {
        if (i.data !== last) {
          L.push(fmtD(i.data));
          last = i.data;
        }
        L.push(`- ${i.titulo}${i.valor ? ` (${brl(i.valor)})` : ''}`);
      });
      L.push('');
    }
    L.push('ITENS');
    items.forEach((i) =>
      L.push(
        `- [${LBL[i.tipo] || i.tipo}] ${i.titulo}${i.valor ? ` - ${brl(i.valor)}` : ''}${
          i.nota ? ` (${i.nota})` : ''
        }`
      )
    );
    L.push(
      '',
      `Total estimado: ${brl(items.reduce((s, i) => s + (Number(i.valor) || 0), 0))}`
    );
    return L.join('\n').replace(/\u00a0/g, ' ');
  };

  const handleCopyResumo = async () => {
    if (!items.length) return toast('O roteiro está vazio.');
    try {
      await navigator.clipboard.writeText(buildResumo());
      toast('Texto copiado.');
    } catch {
      toast('Não consegui copiar neste ambiente.');
    }
  };

  const handleDownloadPdf = () => {
    if (!items.length) return toast('O roteiro está vazio.');
    try {
      const d = new jsPDF();
      d.setFontSize(11);
      let y = 15;
      const lines = d.splitTextToSize(buildResumo(), 180);
      lines.forEach((l: string) => {
        if (y > 280) {
          d.addPage();
          y = 15;
        }
        d.text(l, 15, y);
        y += 6;
      });
      d.save('roteiro-de-viagem.pdf');
      toast('PDF baixado com sucesso!');
    } catch {
      toast('Não foi possível gerar o PDF. Use Copiar texto ou WhatsApp.');
    }
  };

  const renderLista = (title: string, list: unknown) => {
    const a = arr<unknown>(list);
    if (!a.length) return null;
    return (
      <>
        <h4>{title}</h4>
        <ul>
          {a.map((x, idx) => {
            if (typeof x === 'string') return <li key={idx}>{x}</li>;
            const obj = x as HospedagemSugestao;
            if (obj && obj.nome) {
              return (
                <li key={idx}>
                  {obj.nome}
                  {obj.tipo ? ` (${obj.tipo})` : ''}
                  {obj.faixa_diaria_brl ? ` · ~${brl(obj.faixa_diaria_brl)}/noite` : ''}
                </li>
              );
            }
            return <li key={idx}>{JSON.stringify(x)}</li>;
          })}
        </ul>
      </>
    );
  };

  // Calculations for Orçamento
  const antTotal = items
    .filter((i) => ['passagem', 'hotel'].includes(i.tipo))
    .reduce((s, i) => s + (Number(i.valor) || 0), 0);
  const destTotal = items
    .filter((i) => ['restaurante', 'passeio', 'gasto'].includes(i.tipo))
    .reduce((s, i) => s + (Number(i.valor) || 0), 0);
  const totOrc = antTotal + destTotal;
  const paidItemsList = items
    .filter((i) => Number(i.valor) > 0)
    .sort((a, b) => ((a.prazo || '9999') < (b.prazo || '9999') ? -1 : 1));
  const pagoSum = paidItemsList
    .filter((i) => i.pago)
    .reduce((s, i) => s + Number(i.valor), 0);
  const totPlano = paidItemsList.reduce((s, i) => s + Number(i.valor), 0);
  const faltaPagar = totPlano - pagoSum;
  const hojeIso = new Date().toLocaleDateString('sv-SE');

  // Calculations for Dividir gastos
  const computeGastosSettlement = () => {
    const saldo: Record<string, number> = {};
    pessoas.forEach((n) => (saldo[n] = 0));
    const G = gastos.slice().sort((a, b) => b.ts - a.ts);
    G.forEach((g) => {
      const dd = arr<string>(g.dividir).length ? arr<string>(g.dividir) : pessoas;
      const s = g.valor / Math.max(1, dd.length);
      saldo[g.pagador] = (saldo[g.pagador] || 0) + g.valor;
      dd.forEach((n) => (saldo[n] = (saldo[n] || 0) - s));
    });
    const cred: [string, number][] = [];
    const dev: [string, number][] = [];
    Object.keys(saldo).forEach((n) => {
      const v = Math.round(saldo[n] * 100) / 100;
      if (v > 0.5) cred.push([n, v]);
      else if (v < -0.5) dev.push([n, -v]);
    });
    const acc: string[] = [];
    let i = 0;
    let j = 0;
    while (i < dev.length && j < cred.length) {
      const m = Math.min(dev[i][1], cred[j][1]);
      acc.push(`${dev[i][0]} paga ${brl(m)} a ${cred[j][0]}`);
      dev[i][1] -= m;
      cred[j][1] -= m;
      if (dev[i][1] < 0.5) i++;
      if (cred[j][1] < 0.5) j++;
    }
    const tot = G.reduce((s, g) => s + g.valor, 0);
    return { saldo, acc, tot, G };
  };

  // Calculations for Milhas
  const renderMilhasCalc = () => {
    const p = Number(mPreco);
    const m = Number(mMilhas);
    const t = Number(mTaxas) || 0;
    const c = Number(mCusto);
    if (!p || !m) {
      return (
        <p className="mut" style={{ marginTop: 10 }}>
          Preencha preço e milhas para comparar.
        </p>
      );
    }
    const vm = ((p - t) / m) * 1000;
    return (
      <p className="mut" style={{ marginTop: 10 }}>
        Nesta emissão cada 1.000 milhas valem <b>{brl(vm)}</b>.{' '}
        {c ? (
          vm > c ? (
            <>
              Você paga cerca de {brl(c)} pelo milheiro, então <b>vale usar milhas</b>.
            </>
          ) : (
            <>
              Isso é menos do que o milheiro custa para você: <b>melhor pagar em dinheiro</b> e
              guardar as milhas.
            </>
          )
        ) : (
          'Informe quanto custa seu milheiro para comparar.'
        )}
      </p>
    );
  };

  // Render SVG Map
  const renderSvgMap = () => {
    if (!mpResult) return null;
    const G = arr<MapaGrupo>(mpResult.grupos);
    const pts = G.flatMap((g) => arr<MapaPonto>(g.itens)).filter(
      (x) => Number.isFinite(Number(x.lat)) && Number.isFinite(Number(x.lng))
    );
    if (!pts.length) {
      return <p className="err">Não consegui posicionar os lugares.</p>;
    }
    const la = pts.map((x) => Number(x.lat));
    const lo = pts.map((x) => Number(x.lng));
    const a = Math.min(...la);
    const b = Math.max(...la);
    const c = Math.min(...lo);
    const d = Math.max(...lo);
    const W = 600;
    const H = 340;
    const P = 40;
    const sx = (v: number) => P + (d === c ? 0.5 : (v - c) / (d - c)) * (W - 2 * P);
    const sy = (v: number) => H - P - (b === a ? 0.5 : (v - a) / (b - a)) * (H - 2 * P);
    const COR = ['#0e7c86', '#d9692c', '#7b5ea7', '#4a9d3f', '#c2415d', '#b8860b'];
    const q = (x: MapaPonto) => encodeURIComponent(`${x.titulo} ${mpCidade.trim()}`);

    return (
      <div>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          style={{
            width: '100%',
            background: 'var(--bg)',
            border: '1px solid var(--line)',
            borderRadius: 12,
            color: 'var(--ink)',
            margin: '10px 0',
          }}
        >
          {G.map((g, gi) => {
            const col = COR[gi % COR.length];
            const it = arr<MapaPonto>(g.itens).filter(
              (x) => Number.isFinite(Number(x.lat)) && Number.isFinite(Number(x.lng))
            );
            return (
              <g key={gi}>
                {it.length > 1 && (
                  <polyline
                    fill="none"
                    stroke={col}
                    strokeWidth="2"
                    strokeDasharray="5 4"
                    points={it.map((x) => `${sx(Number(x.lng))},${sy(Number(x.lat))}`).join(' ')}
                  />
                )}
                {it.map((x, n) => (
                  <g key={n}>
                    <circle
                      cx={sx(Number(x.lng))}
                      cy={sy(Number(x.lat))}
                      r="10"
                      fill={col}
                    />
                    <text
                      x={sx(Number(x.lng))}
                      y={sy(Number(x.lat)) + 4}
                      textAnchor="middle"
                      fontSize="11"
                      fill="#fff"
                    >
                      {n + 1}
                    </text>
                    <text
                      x={sx(Number(x.lng)) + 13}
                      y={sy(Number(x.lat)) + 4}
                      fontSize="11"
                      fill="currentColor"
                    >
                      {String(x.titulo).slice(0, 18)}
                    </text>
                  </g>
                ))}
              </g>
            );
          })}
        </svg>

        {G.map((g, gi) => {
          const col = COR[gi % COR.length];
          const it = arr<MapaPonto>(g.itens).filter(
            (x) => Number.isFinite(Number(x.lat)) && Number.isFinite(Number(x.lng))
          );
          const link =
            it.length > 1
              ? `https://www.google.com/maps/dir/?api=1&travelmode=walking&origin=${q(
                  it[0]
                )}&destination=${q(it[it.length - 1])}${
                  it.length > 2
                    ? `&waypoints=${it
                        .slice(1, -1)
                        .map(q)
                        .join('%7C')}`
                    : ''
                }`
              : it[0]
              ? `https://www.google.com/maps/search/?api=1&query=${q(it[0])}`
              : '';
          return (
            <div key={gi} style={{ marginBottom: 10 }}>
              <h4 style={{ color: col }}>{g.nome}</h4>
              <ol>
                {it.map((x, idx) => (
                  <li key={idx}>{x.titulo}</li>
                ))}
              </ol>
              {link && (
                <a
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--acc)', fontWeight: 600, fontSize: 14 }}
                >
                  Abrir trajeto no Google Maps
                </a>
              )}
            </div>
          );
        })}

        {mpResult.economia_deslocamento && (
          <>
            <h4>Economia no deslocamento</h4>
            <p>{mpResult.economia_deslocamento}</p>
          </>
        )}
        {mpResult.dica && <p className="mut">{mpResult.dica}</p>}
      </div>
    );
  };

  const agendasOrdenadas = items
    .filter((i) => i.data)
    .sort((x, y) => (x.data < y.data ? -1 : 1));

  return (
    <div className="wrap">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <div>
          <h1>✈️ Agente de Viagem</h1>
          <p className="sub">
            Viagem boa gastando menos: férias, fins de semana, milhas e salas VIP, com roteiro
            compartilhado.
          </p>
        </div>

        {/* Google Login & Trip Switcher */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          {user ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              {viagens.length > 0 && (
                <select
                  value={activeViagemId}
                  onChange={(e) => setActiveViagemId(e.target.value)}
                  style={{ width: 'auto', margin: 0, padding: '6px 10px', fontSize: 14 }}
                  aria-label="Selecionar viagem"
                >
                  {viagens.map((v) => (
                    <option key={v.id} value={v.id}>
                      📋 {v.nome}
                    </option>
                  ))}
                </select>
              )}
              <button
                className="btn sec"
                style={{ margin: 0, padding: '6px 10px' }}
                onClick={() => setShowNewTrip((v) => !v)}
              >
                + Nova viagem
              </button>
              <button
                className="btn sec"
                style={{ margin: 0, padding: '6px 10px' }}
                onClick={() => logoutUser()}
              >
                Sair ({user.email?.split('@')[0]})
              </button>
            </div>
          ) : (
            <button
              className="btn sec"
              style={{ margin: 0 }}
              onClick={handleGoogleLoginClick}
            >
              Entrar com Google (compartilhar roteiro)
            </button>
          )}
        </div>
      </div>

      {/* Helper box when domain is not authorized in Firebase Auth (e.g., Vercel domain) */}
      {unauthorizedDomain && (
        <div className="card" style={{ borderLeft: '4px solid var(--acc2)', marginTop: 8 }}>
          <h4>Como liberar o login com Google neste endereço ({unauthorizedDomain})</h4>
          <p className="mut" style={{ margin: '6px 0' }}>
            Por segurança, o Firebase pede que você autorize o domínio da Vercel uma única vez:
          </p>
          <ol className="mut" style={{ paddingLeft: 20 }}>
            <li>
              Copie este domínio: <b>{unauthorizedDomain}</b>{' '}
              <button
                className="btn sec"
                style={{ margin: '0 0 0 6px', padding: '2px 8px', fontSize: 12 }}
                onClick={() => {
                  navigator.clipboard.writeText(unauthorizedDomain);
                  toast('Domínio copiado!');
                }}
              >
                Copiar
              </button>
            </li>
            <li>
              Abra o{' '}
              <a
                href={`https://console.firebase.google.com/project/${firebaseProjectId}/authentication/settings`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--acc)', fontWeight: 600 }}
              >
                Painel do Firebase (Domínios autorizados)
              </a>
              , clique em <b>Adicionar domínio</b> e cole <b>{unauthorizedDomain}</b>.
            </li>
          </ol>
          <p className="mut" style={{ marginTop: 6 }}>
            Enquanto isso, você já pode usar todas as funções do app normalmente — seus dados ficam
            salvos neste aparelho.
          </p>
        </div>
      )}

      {/* Create New Trip Box */}
      {user && showNewTrip && (
        <div className="card" style={{ marginTop: 8 }}>
          <h4>Criar outra viagem compartilhada</h4>
          <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
            <input
              value={newTripName}
              onChange={(e) => setNewTripName(e.target.value)}
              placeholder="Ex.: Férias Nordeste 2027"
              style={{ flex: 1, minWidth: 180, margin: 0 }}
            />
            <button className="btn" style={{ margin: 0 }} onClick={handleCreateTrip}>
              Criar
            </button>
          </div>
        </div>
      )}

      {/* Main Areas Bar */}
      <div className="tabs" role="tablist">
        {(Object.keys(AREAS) as AreaKey[]).map((k) => (
          <button
            key={k}
            className={k === currentArea ? 'on' : ''}
            onClick={() => go(AREAS[k].s[0][0])}
          >
            {AREAS[k].n}
          </button>
        ))}
      </div>

      {/* Subtabs Bar */}
      {currentArea !== 'home' && (
        <div className="tabs subtabs" role="tablist">
          {AREAS[currentArea].s.map(([sKey, sLabel]) => (
            <button
              key={sKey}
              className={sKey === sec ? 'on' : ''}
              onClick={() => go(sKey)}
            >
              {sLabel}
            </button>
          ))}
        </div>
      )}

      {/* Help Box */}
      {HELP[sec] && <div className="help">{HELP[sec]}</div>}

      {/* INÍCIO */}
      {sec === 'home' && (
        <section>
          <div className="card">
            <h3>O que você quer fazer?</h3>
            <button className="big-btn" onClick={() => go('ferias')}>
              ✈️ Planejar uma viagem de férias
              <small>
                Diga quando e quantos vão. O app sugere destinos, custos e roteiro.
              </small>
            </button>
            <button className="big-btn" onClick={() => go('fds')}>
              🌿 Ideia para o fim de semana
              <small>Escapadas perto de casa, para casal ou família.</small>
            </button>
            <button className="big-btn" onClick={() => go('roteiro')}>
              📋 Abrir nosso roteiro
              <small>
                Passagens, hotéis e passeios juntos, compartilhado com quem viaja com você.
              </small>
            </button>
          </div>
        </section>
      )}

      {/* FÉRIAS */}
      {sec === 'ferias' && (
        <section>
          <div className="card">
            <div className="grid-form">
              <label className="field-label">
                Cidade de saída
                <input
                  value={fSaida}
                  onChange={(e) => setFSaida(e.target.value)}
                  placeholder="Ex.: sua cidade"
                />
              </label>
              <label className="field-label">
                Quando (mais ou menos)
                <input
                  value={fQuando}
                  onChange={(e) => setFQuando(e.target.value)}
                  placeholder="Ex.: julho de 2027"
                />
              </label>
              <label className="field-label">
                Dias de viagem
                <input
                  type="number"
                  min={2}
                  value={fDias}
                  onChange={(e) => setFDias(Math.max(2, Number(e.target.value) || 2))}
                />
              </label>
              <label className="field-label">
                Adultos
                <input
                  type="number"
                  min={1}
                  value={fAdultos}
                  onChange={(e) => setFAdultos(Math.max(1, Number(e.target.value) || 1))}
                />
              </label>
              <label className="field-label">
                Idades das crianças
                <input
                  value={fCriancas}
                  onChange={(e) => setFCriancas(e.target.value)}
                  placeholder="Ex.: 4, 9 (vazio = sem)"
                />
              </label>
              <label className="field-label">
                Orçamento total (R$)
                <input
                  type="number"
                  value={fOrc}
                  onChange={(e) => setFOrc(e.target.value)}
                  placeholder="Ex.: 25000"
                />
              </label>
            </div>

            <details className="adv">
              <summary>Mais opções (opcional)</summary>
              <div className="grid-form" style={{ marginTop: 8 }}>
                <label className="field-label">
                  Tipo
                  <select value={fTipo} onChange={(e) => setFTipo(e.target.value)}>
                    <option>nacional e internacional</option>
                    <option>só nacional</option>
                    <option>só internacional</option>
                  </select>
                </label>
                <label className="field-label">
                  Milhas disponíveis
                  <input
                    type="number"
                    value={fMilhas}
                    onChange={(e) => setFMilhas(e.target.value)}
                    placeholder="Ex.: 80000"
                  />
                </label>
                <label className="field-label">
                  Estilo / preferências
                  <input
                    value={fEstilo}
                    onChange={(e) => setFEstilo(e.target.value)}
                    placeholder="Praia, cultura, resort…"
                  />
                </label>
                <label className="field-label">
                  Foco
                  <select value={fFoco} onChange={(e) => setFFoco(e.target.value)}>
                    <option>Econômico (melhor custo-benefício)</option>
                    <option>Equilibrado</option>
                    <option>Conforto</option>
                  </select>
                </label>
              </div>
            </details>

            <button className="btn" disabled={fLoading} onClick={handleSuggestFerias}>
              Sugerir destinos
            </button>
            <p className="mut" style={{ marginTop: 10 }}>
              Valores são estimativas gerais, sem preços em tempo real. Confirme nos sites antes
              de comprar.
            </p>
          </div>

          {fLoading && <p className="mut">Pensando nas melhores opções…</p>}
          {fErr && <p className="err">{fErr}</p>}

          {!fLoading &&
            fSugestoes.map((s, i) => {
              const c = s.custos || ({} as FeriasSugestao['custos']);
              const ps = s.passagem || { onde_comprar: '', milhas_ou_dinheiro: '' };
              return (
                <div className="card" key={i}>
                  <h3>
                    {s.destino}
                    {s.tipo && <span className="tag">{s.tipo}</span>}
                  </h3>
                  <div className="mut">{s.pais}</div>
                  <p>{s.porque}</p>

                  <div className="cost">
                    <div>
                      Passagens<b>{brl(c.passagens)}</b>
                    </div>
                    <div>
                      Hospedagem<b>{brl(c.hospedagem)}</b>
                    </div>
                    <div>
                      Alimentação<b>{brl(c.alimentacao)}</b>
                    </div>
                    <div>
                      Passeios<b>{brl(c.passeios)}</b>
                    </div>
                    <div>
                      Transporte<b>{brl(c.transporte_local)}</b>
                    </div>
                    <div>
                      Total<b>{brl(c.total)}</b>
                    </div>
                  </div>

                  {Boolean(s.economia_estimada_brl) && (
                    <p>
                      <b>Economia possível: ~{brl(s.economia_estimada_brl)}</b>
                    </p>
                  )}

                  {renderLista('Como economizar', s.dicas_economia)}
                  {renderLista('Hospedagem', s.hospedagem)}

                  <h4>Passagem</h4>
                  <p>
                    {ps.onde_comprar} {ps.milhas_ou_dinheiro}
                  </p>

                  {s.sala_vip_milhas && (
                    <>
                      <h4>Milhas e sala VIP</h4>
                      <p>{s.sala_vip_milhas}</p>
                    </>
                  )}

                  <h4>Pagar antes e guardar</h4>
                  <p>
                    {s.pagar_antes}
                    {s.reserva_destino_brl ? (
                      <>
                        {' '}
                        Reserva para o destino: <b>{brl(s.reserva_destino_brl)}</b>.
                      </>
                    ) : null}
                  </p>

                  {renderLista('Roteiro', s.roteiro)}
                  {renderLista('Restaurantes', s.restaurantes)}
                  {renderLista('Passeios', s.passeios)}

                  <button className="btn sec" onClick={() => saveFeriasDest(s)}>
                    Salvar no roteiro compartilhado
                  </button>
                </div>
              );
            })}
        </section>
      )}

      {/* FIM DE SEMANA */}
      {sec === 'fds' && (
        <section>
          <div className="card">
            <div className="grid-form">
              <label className="field-label">
                Cidade de saída
                <input
                  value={wSaida}
                  onChange={(e) => setWSaida(e.target.value)}
                  placeholder="Ex.: sua cidade"
                />
              </label>
              <label className="field-label">
                Com quem
                <select value={wPerfil} onChange={(e) => setWPerfil(e.target.value)}>
                  <option>casal</option>
                  <option>família com criança</option>
                  <option>amigos</option>
                </select>
              </label>
              <label className="field-label">
                Idades das crianças
                <input
                  value={wCriancas}
                  onChange={(e) => setWCriancas(e.target.value)}
                  placeholder="Ex.: 5"
                />
              </label>
              <label className="field-label">
                Distância
                <select value={wRaio} onChange={(e) => setWRaio(e.target.value)}>
                  <option>até 1h30 de carro</option>
                  <option>até 3h de carro</option>
                  <option>até 5h de carro</option>
                  <option>qualquer, de avião</option>
                </select>
              </label>
              <label className="field-label">
                Orçamento (R$)
                <input
                  type="number"
                  value={wOrc}
                  onChange={(e) => setWOrc(e.target.value)}
                  placeholder="Ex.: 1500"
                />
              </label>
            </div>

            <details className="adv">
              <summary>Mais opções (opcional)</summary>
              <div className="grid-form" style={{ marginTop: 8 }}>
                <label className="field-label">
                  Quando
                  <input
                    value={wQuando}
                    onChange={(e) => setWQuando(e.target.value)}
                    placeholder="Este fim de semana"
                  />
                </label>
                <label className="field-label">
                  Foco
                  <select value={wFoco} onChange={(e) => setWFoco(e.target.value)}>
                    <option>Econômico (melhor custo-benefício)</option>
                    <option>Equilibrado</option>
                    <option>Conforto</option>
                  </select>
                </label>
              </div>
            </details>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                className="btn"
                disabled={wLoading}
                onClick={() => handleSuggestFds(false)}
              >
                Sugerir escapadas
              </button>
              <button
                className="btn sec"
                disabled={wLoading}
                onClick={handleLastMinuteFds}
                style={{ marginTop: 12, padding: '10px 16px' }}
              >
                Escapada de última hora
              </button>
            </div>
            <p className="mut" style={{ marginTop: 10 }}>
              A última hora usa o próximo fim de semana e o clima típico da época. O app não vê a
              previsão do tempo: confira antes de sair. Valores são estimativas gerais, sem preços
              em tempo real. Confirme nos sites antes de comprar.
            </p>
          </div>

          {wLoading && <p className="mut">Pensando nas melhores opções…</p>}
          {wErr && <p className="err">{wErr}</p>}

          {!wLoading &&
            wOpcoes.map((s, i) => (
              <div className="card" key={i}>
                <h3>{s.destino}</h3>
                <div className="mut">
                  {s.distancia} · ~{brl(s.custo_estimado_brl)}
                </div>
                <p>{s.porque}</p>
                {renderLista('Roteiro', s.roteiro)}
                {renderLista('Restaurantes', s.restaurantes)}
                {s.hospedagem && (
                  <>
                    <h4>Onde ficar</h4>
                    <p>{s.hospedagem}</p>
                  </>
                )}
                {s.clima_tipico && (
                  <>
                    <h4>Clima típico</h4>
                    <p>{s.clima_tipico}</p>
                  </>
                )}
                {renderLista('Como economizar', s.dicas_economia)}
                {s.dica_crianca && (
                  <>
                    <h4>Com criança</h4>
                    <p>{s.dica_crianca}</p>
                  </>
                )}
                <button className="btn sec" onClick={() => saveFdsDest(s)}>
                  Salvar no roteiro compartilhado
                </button>
              </div>
            ))}
        </section>
      )}

      {/* COMPARAR */}
      {sec === 'comp' && (
        <section>
          <div className="card">
            <h3>Comparar destinos</h3>
            <div className="grid-form">
              <label className="field-label">
                Destino 1
                <input value={c1} onChange={(e) => setC1(e.target.value)} />
              </label>
              <label className="field-label">
                Destino 2
                <input value={c2} onChange={(e) => setC2(e.target.value)} />
              </label>
              <label className="field-label">
                Destino 3 (opcional)
                <input value={c3} onChange={(e) => setC3(e.target.value)} />
              </label>
              <label className="field-label">
                Saída
                <input
                  value={cSaida}
                  onChange={(e) => setCSaida(e.target.value)}
                  placeholder="Sua cidade"
                />
              </label>
              <label className="field-label">
                Dias
                <input
                  type="number"
                  min={2}
                  value={cDias}
                  onChange={(e) => setCDias(Math.max(2, Number(e.target.value) || 2))}
                />
              </label>
            </div>
            <details className="adv">
              <summary>Mais opções (opcional)</summary>
              <div className="grid-form" style={{ marginTop: 8 }}>
                <label className="field-label">
                  Viajantes
                  <input
                    value={cPess}
                    onChange={(e) => setCPess(e.target.value)}
                    placeholder="Ex.: 2 adultos e 1 criança de 6"
                  />
                </label>
              </div>
            </details>
            <button className="btn" disabled={cLoading} onClick={handleComparar}>
              Comparar
            </button>
            <p className="mut" style={{ marginTop: 10 }}>
              Valores são estimativas gerais, sem preços em tempo real. Confirme nos sites antes
              de comprar.
            </p>
          </div>

          {cLoading && <p className="mut">Pensando nas melhores opções…</p>}
          {cErr && <p className="err">{cErr}</p>}

          {!cLoading && cResult && (
            <>
              <div className="grid-form">
                {(() => {
                  const D = arr<DestinoComp>(cResult.destinos);
                  const minC = Math.min(...D.map((d) => Number(d.custo_total_brl) || Infinity));
                  const maxN = Math.max(
                    ...D.map((d) => Number(d.nota_custo_beneficio) || 0)
                  );
                  return D.map((d, idx) => (
                    <div className="card" key={idx}>
                      <h3>{d.destino}</h3>
                      {Number(d.custo_total_brl) === minC && (
                        <span className="tag" style={{ margin: '0 4px 0 0' }}>
                          mais barato
                        </span>
                      )}
                      {Number(d.nota_custo_beneficio) === maxN && (
                        <span className="tag" style={{ margin: 0 }}>
                          melhor custo-benefício
                        </span>
                      )}
                      <div className="cost">
                        <div>
                          Total<b>{brl(d.custo_total_brl)}</b>
                        </div>
                        <div>
                          Por dia<b>{brl(d.custo_por_dia_brl)}</b>
                        </div>
                        <div>
                          Nota<b>{d.nota_custo_beneficio}/10</b>
                        </div>
                      </div>
                      <div className="mut">
                        Passagens {brl(d.passagens)} · Hospedagem {brl(d.hospedagem)} · Alimentação
                        e passeios {brl(d.alimentacao_passeios)}
                      </div>
                      {d.melhor_epoca_barata && (
                        <>
                          <h4>Época mais barata</h4>
                          <p>{d.melhor_epoca_barata}</p>
                        </>
                      )}
                      {renderLista('Vantagens', d.pros)}
                      {renderLista('Pontos de atenção', d.contras)}
                    </div>
                  ));
                })()}
              </div>
              {cResult.recomendacao && (
                <div className="card">
                  <h4>Recomendação</h4>
                  <p>{cResult.recomendacao}</p>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* DATAS E PREÇOS */}
      {sec === 'datas' && (
        <section>
          <div className="card">
            <h3>Calendário de datas baratas</h3>
            <div className="grid-form">
              <label className="field-label">
                Destino
                <input value={dDest} onChange={(e) => setDDest(e.target.value)} />
              </label>
              <label className="field-label">
                Saída
                <input
                  value={dSaida}
                  onChange={(e) => setDSaida(e.target.value)}
                  placeholder="Sua cidade"
                />
              </label>
              <label className="field-label">
                Dias
                <input
                  type="number"
                  min={2}
                  value={dDias}
                  onChange={(e) => setDDias(Math.max(2, Number(e.target.value) || 2))}
                />
              </label>
            </div>
            <button className="btn" disabled={dLoading} onClick={handleDatasBaratas}>
              Ver melhores épocas
            </button>
            <p className="mut" style={{ marginTop: 10 }}>
              Mostra a sazonalidade típica (alta, média, baixa). Não é o preço de hoje: confira nos
              sites.
            </p>

            {dLoading && <p className="mut">Pensando nas melhores opções…</p>}
            {dErr && <p className="err">{dErr}</p>}

            {!dLoading && dResult && (
              <div style={{ marginTop: 12 }}>
                <p>{dResult.resumo}</p>
                <div
                  className="cost"
                  style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}
                >
                  {arr<MesSazonal>(dResult.meses).map((m, idx) => {
                    const cor: Record<string, string> = {
                      baixa: 'rgba(14,124,134,.28)',
                      media: 'rgba(224,170,60,.3)',
                      alta: 'rgba(217,105,44,.3)',
                    };
                    return (
                      <div
                        key={idx}
                        style={{
                          background: cor[m.nivel] || 'var(--bg)',
                          color: 'var(--ink)',
                        }}
                      >
                        <b>{m.mes}</b>
                        {m.nivel}
                        <br />
                        <span className="mut">{m.nota}</span>
                      </div>
                    );
                  })}
                </div>
                {renderLista('Melhores meses para gastar menos', dResult.melhores_meses)}
              </div>
            )}
          </div>

          <div className="card">
            <h3>Monitor de preço</h3>
            <p className="mut">
              O app não consulta preços sozinho. Você registra os valores que vê nos sites, e ele
              mostra se o preço caiu e se chegou no seu alvo. Fica compartilhado com quem edita o
              roteiro.
            </p>
            <div className="grid-form">
              <label className="field-label">
                Rota ou hotel
                <input
                  value={pNome}
                  onChange={(e) => setPNome(e.target.value)}
                  placeholder="Ex.: Voo ida e volta"
                />
              </label>
              <label className="field-label">
                Data da viagem
                <input
                  type="date"
                  value={pData}
                  onChange={(e) => setPData(e.target.value)}
                />
              </label>
              <label className="field-label">
                Preço-alvo (R$)
                <input
                  type="number"
                  value={pAlvo}
                  onChange={(e) => setPAlvo(e.target.value)}
                />
              </label>
            </div>
            <button className="btn" onClick={handleAddMonitor}>
              Criar monitor
            </button>

            <div style={{ marginTop: 12 }}>
              {mons.length === 0 ? (
                <p className="mut">Nenhum monitor ainda.</p>
              ) : (
                mons.map((m) => {
                  const r = arr<RegMonitor>(m.regs);
                  const last = r.length ? r[r.length - 1].valor : null;
                  const min = r.length ? Math.min(...r.map((x) => x.valor)) : null;
                  const first = r.length ? r[0].valor : null;
                  const ok = Boolean(m.alvo && last != null && last <= m.alvo);
                  const dv = last != null && first != null ? last - first : 0;

                  return (
                    <div className="row-item" key={m.id}>
                      <div style={{ flex: 1 }}>
                        <b>{m.nome}</b>
                        {m.data ? <span className="mut"> · {fmtD(m.data)}</span> : null}
                        {m.alvo ? <span className="tag">alvo {brl(m.alvo)}</span> : null}
                        <div>
                          {last == null ? (
                            <span className="mut">Sem registros ainda</span>
                          ) : (
                            <span>
                              {ok && <b style={{ color: 'var(--acc)' }}>Chegou no alvo! </b>}
                              Último: <b>{brl(last)}</b> · menor: {brl(min)}
                              {r.length > 1
                                ? ` · desde o primeiro registro: ${
                                    dv <= 0 ? 'caiu ' : 'subiu '
                                  }${brl(Math.abs(dv))}`
                                : ''}
                              {m.alvo && !ok
                                ? ` · faltam ${brl(last - m.alvo)} para o alvo`
                                : ''}
                            </span>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                          <input
                            type="number"
                            placeholder="Preço visto hoje (R$)"
                            value={priceInputs[m.id] || ''}
                            onChange={(e) =>
                              setPriceInputs((prev) => ({ ...prev, [m.id]: e.target.value }))
                            }
                            style={{ margin: 0, maxWidth: 220 }}
                          />
                          <button
                            className="btn sec"
                            style={{ margin: 0 }}
                            onClick={() => handleRegisterPrice(m)}
                          >
                            Registrar
                          </button>
                        </div>
                      </div>
                      <button
                        className="x-btn"
                        aria-label="Apagar"
                        onClick={() => handleDelMonitor(m.id)}
                      >
                        ×
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </section>
      )}

      {/* ROTEIRO: ITENS E AGENDA */}
      {sec === 'roteiro' && (
        <section>
          {/* Compartilhamento / Membros da Viagem */}
          <div className="card">
            <h3>Roteiro compartilhado</h3>
            {user && activeViagem ? (
              <div style={{ marginBottom: 12 }}>
                <p className="mut" style={{ marginBottom: 6 }}>
                  Membros desta viagem ({activeViagem.nome}):{' '}
                  <b>{activeViagem.membros.join(', ')}</b>
                </p>
                {activeViagem.criadorUid === user.uid && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="E-mail de quem viaja com você"
                      style={{ flex: 1, minWidth: 200, margin: 0 }}
                    />
                    <button
                      className="btn sec"
                      style={{ margin: 0 }}
                      onClick={handleInviteMember}
                    >
                      Convidar por e-mail
                    </button>
                  </div>
                )}
                {activeViagem.criadorUid === user.uid && activeViagem.membros.length > 1 && (
                  <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {activeViagem.membros
                      .filter((em) => em !== activeViagem.criadorEmail)
                      .map((em) => (
                        <span key={em} className="tag" style={{ marginLeft: 0 }}>
                          {em}{' '}
                          <button
                            onClick={() => handleRemoveMember(em)}
                            style={{
                              border: 0,
                              background: 'none',
                              color: 'inherit',
                              cursor: 'pointer',
                              padding: '0 2px',
                            }}
                            title="Remover membro"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                  </div>
                )}
              </div>
            ) : (
              <p className="mut">
                Faça login com o Google no topo da página para sincronizar o roteiro em tempo real
                e convidar quem viaja com você pelo e-mail.
              </p>
            )}

            <div className="grid-form">
              <label className="field-label">
                Tipo
                <select
                  value={iTipo}
                  onChange={(e) => setITipo(e.target.value as RoteiroItem['tipo'])}
                >
                  <option value="passagem">Passagem</option>
                  <option value="hotel">Hotel / resort</option>
                  <option value="restaurante">Restaurante</option>
                  <option value="passeio">Passeio</option>
                  <option value="gasto">Outro gasto</option>
                  <option value="nota">Nota / ideia</option>
                </select>
              </label>
              <label className="field-label">
                Título
                <input
                  value={iTitulo}
                  onChange={(e) => setITitulo(e.target.value)}
                  placeholder="Ex.: Voo GRU–LIS"
                />
              </label>
              <label className="field-label">
                Valor (R$)
                <input
                  type="number"
                  value={iValor}
                  onChange={(e) => setIValor(e.target.value)}
                  placeholder="0"
                />
              </label>
              <label className="field-label">
                Data
                <input
                  type="date"
                  value={iData}
                  onChange={(e) => setIData(e.target.value)}
                />
              </label>
              <label className="field-label">
                Detalhe ou link
                <input value={iNota} onChange={(e) => setINota(e.target.value)} />
              </label>
            </div>
            <button
              className="btn"
              onClick={() => {
                if (!iTitulo.trim()) return toast('Dê um título ao item.');
                addItem({
                  tipo: iTipo,
                  titulo: iTitulo.trim(),
                  valor: Number(iValor) || 0,
                  nota: iNota.trim(),
                  data: iData,
                });
                setITitulo('');
                setIValor('');
                setINota('');
                setIData('');
              }}
            >
              Adicionar
            </button>
          </div>

          <div className="card">
            <h3>Exportar</h3>
            <p className="mut">Gere um resumo do roteiro para quem não tem acesso ao app.</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              {items.length > 0 ? (
                <a
                  className="btn sec"
                  style={{ textDecoration: 'none', margin: 0 }}
                  href={`https://wa.me/?text=${encodeURIComponent(buildResumo())}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  WhatsApp
                </a>
              ) : (
                <button
                  className="btn sec"
                  style={{ margin: 0 }}
                  onClick={() => toast('O roteiro está vazio.')}
                >
                  WhatsApp
                </button>
              )}
              <button className="btn sec" style={{ margin: 0 }} onClick={handleCopyResumo}>
                Copiar texto
              </button>
              <button className="btn sec" style={{ margin: 0 }} onClick={handleDownloadPdf}>
                Baixar PDF
              </button>
            </div>
          </div>

          <div className="card">
            <h3>Agenda</h3>
            {agendasOrdenadas.length === 0 ? (
              <p className="mut">Adicione datas aos itens para montar a agenda da viagem.</p>
            ) : (
              (() => {
                let last = '';
                return agendasOrdenadas.map((i) => {
                  const showHeader = last !== i.data;
                  last = i.data;
                  return (
                    <React.Fragment key={i.id}>
                      {showHeader && <h4>{fmtD(i.data)}</h4>}
                      <div>
                        • {i.titulo}{' '}
                        {i.valor ? <span className="mut">{brl(i.valor)}</span> : null}
                      </div>
                    </React.Fragment>
                  );
                });
              })()
            )}
          </div>

          <div className="card">
            {items.length === 0 ? (
              <p className="mut">
                Nada por aqui ainda. Adicione itens ou salve sugestões das outras abas.
              </p>
            ) : (
              <>
                <p className="mut">
                  Total estimado:{' '}
                  <b>{brl(items.reduce((s, i) => s + (Number(i.valor) || 0), 0))}</b>
                </p>
                {items.map((i) => {
                  const meId = user?.email || 'você';
                  const voteId = user?.email || 'local';
                  const v = arr<string>(i.votos);
                  const c = arr<ComentarioItem>(i.comentarios);
                  const isOpen = Boolean(openComments[i.id]);
                  return (
                    <div className="row-item" key={i.id}>
                      <div style={{ flex: 1 }}>
                        <b>{i.titulo}</b>
                        <span className="tag">{LBL[i.tipo] || i.tipo}</span>
                        {i.valor ? <span className="mut"> · {brl(i.valor)}</span> : null}
                        {i.data ? <span className="mut"> · {fmtD(i.data)}</span> : null}
                        {i.nota ? <div className="mut">{i.nota}</div> : null}
                        <div className="mut">
                          {i.autor && (i.autor === meId || i.autor === 'local')
                            ? 'adicionado por você'
                            : i.autor
                            ? `adicionado por ${i.autor}`
                            : ''}
                        </div>

                        <div style={{ marginTop: 4 }}>
                          <button
                            className={`btn${v.includes(voteId) ? '' : ' sec'}`}
                            style={{ margin: '0 6px 0 0', padding: '3px 10px', fontSize: 14 }}
                            onClick={() => handleVote(i)}
                          >
                            👍 {v.length}
                          </button>
                          <button
                            className="btn sec"
                            style={{ margin: 0, padding: '3px 10px', fontSize: 14 }}
                            onClick={() =>
                              setOpenComments((prev) => ({ ...prev, [i.id]: !prev[i.id] }))
                            }
                          >
                            💬 {c.length}
                          </button>
                        </div>

                        {isOpen && (
                          <div style={{ marginTop: 6 }}>
                            {c.map((cm, idx) => (
                              <div className="mut" key={idx}>
                                {cm.autor === meId ? 'Você' : cm.autor || 'Outra pessoa'}:{' '}
                                {cm.texto}
                              </div>
                            ))}
                            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                              <input
                                value={commentInputs[i.id] || ''}
                                onChange={(e) =>
                                  setCommentInputs((prev) => ({
                                    ...prev,
                                    [i.id]: e.target.value,
                                  }))
                                }
                                placeholder="Comentar…"
                                style={{ margin: 0 }}
                              />
                              <button
                                className="btn sec"
                                style={{ margin: 0 }}
                                onClick={() => handleComment(i)}
                              >
                                Enviar
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                      <button
                        className="x-btn"
                        aria-label="Apagar"
                        onClick={() => delItem(i.id)}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </section>
      )}

      {/* MAPA */}
      {sec === 'mapa' && (
        <section>
          <div className="card">
            <h3>Mapa e rotas</h3>
            <p className="mut">
              Usa os passeios, restaurantes e hotéis do roteiro. É um mapa esquemático, com
              posições aproximadas estimadas pela IA, não um mapa real. Os links abrem o trajeto no
              Google Maps.
            </p>
            <div className="grid-form">
              <label className="field-label">
                Cidade ou região
                <input
                  value={mpCidade}
                  onChange={(e) => setMpCidade(e.target.value)}
                  placeholder="Ex.: Lisboa"
                />
              </label>
              <label className="field-label">
                Dias disponíveis
                <input
                  type="number"
                  min={1}
                  value={mpDias}
                  onChange={(e) => setMpDias(Math.max(1, Number(e.target.value) || 1))}
                />
              </label>
            </div>
            <button className="btn" disabled={mpLoading} onClick={handleGerarMapa}>
              Agrupar por proximidade
            </button>
            {mpLoading && (
              <p className="mut" style={{ marginTop: 10 }}>
                Pensando nas melhores opções…
              </p>
            )}
            {mpErr && (
              <p className="err" style={{ marginTop: 10 }}>
                {mpErr}
              </p>
            )}
            {!mpLoading && renderSvgMap()}
          </div>
        </section>
      )}

      {/* CHECKLIST */}
      {sec === 'check' && (
        <section>
          <div className="card">
            <h3>Checklist de viagem</h3>
            <div className="grid-form">
              <label className="field-label">
                Destino
                <input value={kDest} onChange={(e) => setKDest(e.target.value)} />
              </label>
              <label className="field-label">
                Época
                <input
                  value={kEpoca}
                  onChange={(e) => setKEpoca(e.target.value)}
                  placeholder="Ex.: julho"
                />
              </label>
              <label className="field-label">
                Idades das crianças
                <input
                  value={kCri}
                  onChange={(e) => setKCri(e.target.value)}
                  placeholder="Vazio = sem"
                />
              </label>
              <label className="field-label">
                Tipo
                <select value={kTipo} onChange={(e) => setKTipo(e.target.value)}>
                  <option>nacional</option>
                  <option>internacional</option>
                </select>
              </label>
            </div>
            <button className="btn" disabled={kLoading} onClick={handleGerarChecklist}>
              Gerar checklist
            </button>
            <p className="mut" style={{ marginTop: 10 }}>
              Documentos e vacinas variam por destino e mudam: confirme em fontes oficiais
              (consulado, Anvisa, posto de saúde) antes de viajar.
            </p>
            {kLoading && <p className="mut">Pensando nas melhores opções…</p>}
            {kErr && <p className="err">{kErr}</p>}

            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
              <input
                value={kNovo}
                onChange={(e) => setKNovo(e.target.value)}
                placeholder="Item extra (ex.: remédios)"
                style={{ margin: 0 }}
              />
              <button
                className="btn sec"
                style={{ margin: 0 }}
                onClick={() => {
                  if (!kNovo.trim()) return;
                  addCheckItem('Extras', kNovo.trim());
                  setKNovo('');
                }}
              >
                Adicionar
              </button>
            </div>
          </div>

          <div className="card">
            {checks.length === 0 ? (
              <p className="mut">Nada ainda. Gere um checklist ou adicione itens.</p>
            ) : (
              (() => {
                const okCount = checks.filter((c) => c.feito).length;
                const cats = Array.from(new Set(checks.map((c) => c.cat || 'Outros')));
                return (
                  <>
                    <p className="mut">
                      {okCount} de {checks.length} itens prontos
                    </p>
                    {cats.map((cat) => (
                      <div key={cat}>
                        <h4>{cat}</h4>
                        {checks
                          .filter((c) => (c.cat || 'Outros') === cat)
                          .map((i) => (
                            <div
                              className="row-item"
                              style={{ padding: '5px 0' }}
                              key={i.id}
                            >
                              <label
                                style={{
                                  display: 'flex',
                                  gap: 8,
                                  alignItems: 'center',
                                  color: 'var(--ink)',
                                  fontSize: 15,
                                  cursor: 'pointer',
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={Boolean(i.feito)}
                                  onChange={(e) => toggleCheckItem(i.id, e.target.checked)}
                                />
                                <span
                                  style={
                                    i.feito
                                      ? {
                                          textDecoration: 'line-through',
                                          color: 'var(--mut)',
                                        }
                                      : undefined
                                  }
                                >
                                  {i.texto}
                                </span>
                              </label>
                              <button
                                className="x-btn"
                                aria-label="Apagar"
                                onClick={() => delCheckItem(i.id)}
                              >
                                ×
                              </button>
                            </div>
                          ))}
                      </div>
                    ))}
                  </>
                );
              })()
            )}
          </div>
        </section>
      )}

      {/* ORÇAMENTO */}
      {sec === 'orc' && (
        <section>
          <div className="card">
            <h3>Quanto guardar</h3>
            <div className="grid-form">
              <label className="field-label">
                Meses até a viagem
                <input
                  type="number"
                  min={1}
                  value={meses}
                  onChange={(e) => setMeses(Math.max(1, Number(e.target.value) || 1))}
                />
              </label>
              <label className="field-label">
                Meu limite de gasto (R$)
                <input
                  type="number"
                  value={maxB || ''}
                  onChange={(e) => setMaxB(Number(e.target.value) || 0)}
                />
              </label>
            </div>

            <div className="cost">
              <div>
                Total estimado<b>{brl(totOrc)}</b>
              </div>
              <div>
                Pagar antes (passagem + hotel)<b>{brl(antTotal)}</b>
              </div>
              <div>
                Guardar para gastar lá<b>{brl(destTotal)}</b>
              </div>
            </div>

            <p>
              Guardando por mês:{' '}
              <span className="big">{brl(totOrc / Math.max(1, meses))}</span>
            </p>

            {maxB > 0 && (
              <p>
                {totOrc <= maxB ? (
                  <>
                    Dentro do limite, sobram <b>{brl(maxB - totOrc)}</b>.
                  </>
                ) : (
                  <>
                    <b className="err">Acima do limite em {brl(totOrc - maxB)}.</b> Revise
                    passagens e hospedagem, que pesam mais.
                  </>
                )}
              </p>
            )}

            <p className="mut">
              Dica geral: passagem e hospedagem costumam ser as partes mais caras e as que mais
              sobem perto da data, então vale quitar essas primeiro e juntar o restante em
              paralelo. Confira se há cancelamento gratuito e compare pagar em dinheiro com usar
              milhas. Valores são estimativas gerais, sem preços em tempo real. Confirme nos sites
              antes de comprar.
            </p>
          </div>

          <div className="card">
            <h3>Plano de pagamento</h3>
            {paidItemsList.length === 0 ? (
              <p className="mut">
                Adicione itens com valor no roteiro para acompanhar o que já foi pago.
              </p>
            ) : (
              <>
                <div className="cost">
                  <div>
                    Já pago<b>{brl(pagoSum)}</b>
                  </div>
                  <div>
                    Falta pagar<b>{brl(faltaPagar)}</b>
                  </div>
                </div>
                <p>
                  Para quitar o que falta em {meses} meses:{' '}
                  <b>{brl(faltaPagar / Math.max(1, meses))}</b> por mês.
                </p>

                {paidItemsList.map((i) => {
                  const atrasado = !i.pago && i.prazo && i.prazo < hojeIso;
                  return (
                    <div className="row-item" key={i.id}>
                      <div>
                        <label
                          style={{
                            display: 'flex',
                            gap: 8,
                            alignItems: 'center',
                            color: 'var(--ink)',
                            cursor: 'pointer',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={Boolean(i.pago)}
                            onChange={(e) => mutateItem(i.id, { pago: e.target.checked })}
                          />
                          <span
                            style={
                              i.pago ? { textDecoration: 'line-through' } : undefined
                            }
                          >
                            {i.titulo} · {brl(i.valor)}
                          </span>
                        </label>
                        {atrasado && <div className="err">Prazo vencido</div>}
                      </div>
                      <input
                        type="date"
                        style={{ width: 150, margin: 0 }}
                        value={i.prazo || ''}
                        onChange={(e) => mutateItem(i.id, { prazo: e.target.value })}
                      />
                    </div>
                  );
                })}

                <p className="mut" style={{ marginTop: 10 }}>
                  Defina o prazo de cada pagamento, por exemplo a passagem antes de a tarifa subir
                  e o hotel antes do fim do cancelamento gratuito.
                </p>
              </>
            )}
          </div>
        </section>
      )}

      {/* DIVIDIR GASTOS */}
      {sec === 'gastos' && (
        <section>
          <div className="card">
            <h3>Divisão de gastos</h3>
            <label className="field-label">
              Quem divide (separe por vírgula)
              <input
                value={gPessInput}
                onChange={(e) => setGPessInput(e.target.value)}
                placeholder="Ex.: Ana, Bruno, Carla"
              />
            </label>
            <button className="btn sec" onClick={handleSavePessoas}>
              Salvar pessoas
            </button>

            <div className="grid-form" style={{ marginTop: 10 }}>
              <label className="field-label">
                Descrição
                <input value={gDesc} onChange={(e) => setGDesc(e.target.value)} />
              </label>
              <label className="field-label">
                Valor (R$)
                <input
                  type="number"
                  value={gVal}
                  onChange={(e) => setGVal(e.target.value)}
                />
              </label>
              <label className="field-label">
                Quem pagou
                <select value={gPag} onChange={(e) => setGPag(e.target.value)}>
                  {pessoas.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div style={{ marginTop: 8 }}>
              {pessoas.length === 0 ? (
                <span className="mut">Cadastre as pessoas acima.</span>
              ) : (
                <>
                  <span className="mut" style={{ marginRight: 8 }}>
                    Dividir entre:
                  </span>
                  {pessoas.map((n) => (
                    <label
                      key={n}
                      style={{
                        display: 'inline-flex',
                        gap: 4,
                        alignItems: 'center',
                        marginRight: 10,
                        color: 'var(--ink)',
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={gDivSelected.includes(n)}
                        onChange={(e) => {
                          setGDivSelected((prev) =>
                            e.target.checked
                              ? [...prev, n]
                              : prev.filter((x) => x !== n)
                          );
                        }}
                      />
                      {n}
                    </label>
                  ))}
                </>
              )}
            </div>

            <button className="btn" onClick={handleAddGasto}>
              Registrar gasto
            </button>
          </div>

          {(() => {
            const { saldo, acc, tot, G } = computeGastosSettlement();
            return (
              <>
                <div className="card">
                  <h3>Quem deve a quem</h3>
                  <p className="mut">
                    Total gasto: <b>{brl(tot)}</b>
                  </p>
                  {acc.length > 0 ? (
                    <ul>
                      {acc.map((x, idx) => (
                        <li key={idx}>{x}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mut">Tudo acertado por enquanto.</p>
                  )}
                  {Object.keys(saldo).map((n) => (
                    <div className="mut" key={n}>
                      {n}: {saldo[n] >= 0 ? 'tem a receber ' : 'deve '}
                      {brl(Math.abs(saldo[n]))}
                    </div>
                  ))}
                </div>

                <div className="card">
                  {G.length === 0 ? (
                    <p className="mut">Nenhum gasto registrado.</p>
                  ) : (
                    G.map((g) => (
                      <div className="row-item" key={g.id}>
                        <div>
                          <b>{g.desc}</b> · {brl(g.valor)}
                          <div className="mut">
                            Pago por {g.pagador} · dividido entre{' '}
                            {arr<string>(g.dividir).join(', ') || 'todos'}
                          </div>
                        </div>
                        <button
                          className="x-btn"
                          aria-label="Apagar"
                          onClick={() => handleDelGasto(g.id)}
                        >
                          ×
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </>
            );
          })()}
        </section>
      )}

      {/* MILHAS E VIP */}
      {sec === 'milhas' && (
        <section>
          <div className="card">
            <h3>Vale usar milhas?</h3>
            <div className="grid-form">
              <label className="field-label">
                Preço em dinheiro (R$)
                <input
                  type="number"
                  value={mPreco}
                  onChange={(e) => setMPreco(e.target.value)}
                />
              </label>
              <label className="field-label">
                Milhas pedidas
                <input
                  type="number"
                  value={mMilhas}
                  onChange={(e) => setMMilhas(e.target.value)}
                />
              </label>
              <label className="field-label">
                Taxas pagas em dinheiro (R$)
                <input
                  type="number"
                  value={mTaxas}
                  onChange={(e) => setMTaxas(e.target.value)}
                />
              </label>
              <label className="field-label">
                Quanto custa seu milheiro (R$)
                <input
                  type="number"
                  value={mCusto}
                  onChange={(e) => setMCusto(e.target.value)}
                  placeholder="Ex.: 20"
                />
              </label>
            </div>
            {renderMilhasCalc()}
          </div>

          <div className="card">
            <h3>Estratégia de milhas com IA</h3>
            <div className="grid-form">
              <label className="field-label">
                Programas e saldo
                <input
                  value={mProg}
                  onChange={(e) => setMProg(e.target.value)}
                  placeholder="Ex.: 50 mil em um programa"
                />
              </label>
              <label className="field-label">
                Cartões que você tem
                <input
                  value={mCart}
                  onChange={(e) => setMCart(e.target.value)}
                  placeholder="Ex.: cartão X, banco Y"
                />
              </label>
              <label className="field-label">
                Viagem pretendida
                <input
                  value={mViag}
                  onChange={(e) => setMViag(e.target.value)}
                  placeholder="Destino e época"
                />
              </label>
            </div>
            <button className="btn" disabled={mLoading} onClick={handleMilhasStrategy}>
              Montar estratégia
            </button>
            {mLoading && (
              <p className="mut" style={{ marginTop: 10 }}>
                Pensando nas melhores opções…
              </p>
            )}
            {mErr && (
              <p className="err" style={{ marginTop: 10 }}>
                {mErr}
              </p>
            )}
            {!mLoading && mResult && (
              <div style={{ marginTop: 10 }}>
                <p>{mResult.resumo}</p>
                {renderLista('Passos', mResult.passos)}
                {renderLista('Como juntar milhas', mResult.como_juntar_milhas)}
                {renderLista('Sala VIP', mResult.sala_vip)}
                {renderLista('Atenção', mResult.alertas)}
              </div>
            )}
          </div>

          <div className="card">
            <h3>Sala VIP gastando pouco</h3>
            <ul>
              <li>
                Cartão de crédito: alguns dão acessos a salas (rede de salas ou salas próprias), em
                número limitado por ano. Veja o benefício no app do banco antes de pagar anuidade
                só por isso.
              </li>
              <li>
                Status em programa de fidelidade ou voo em classe executiva podem liberar as salas
                da companhia ou da aliança.
              </li>
              <li>
                Entrada avulsa: várias salas vendem acesso por um valor fixo. Compare com o que
                gastaria comendo no aeroporto.
              </li>
              <li>
                Assinatura de clube de salas só compensa se você voa várias vezes por ano.
              </li>
              <li>Confira se acompanhante e crianças entram de graça ou pagam à parte.</li>
              <li>
                Regras mudam com frequência: confirme no site do cartão ou da sala antes de contar
                com o benefício.
              </li>
            </ul>
            <h3 style={{ marginTop: 14 }}>Dicas rápidas de milhas</h3>
            <ul>
              <li>
                Calcule o valor do milheiro antes de decidir: se a passagem em dinheiro estiver
                barata, pague em dinheiro e guarde as milhas.
              </li>
              <li>
                Milhas rendem mais em passagens caras (internacional, alta temporada, executiva).
              </li>
              <li>
                Compre ou transfira pontos só em promoção de bônus, e só o que vai usar em breve.
              </li>
              <li>Atenção a validade das milhas e às taxas de embarque.</li>
              <li>
                Dá para misturar: passagem em milhas e hotel em dinheiro, ou o contrário, conforme
                sair mais barato.
              </li>
            </ul>
          </div>
        </section>
      )}

      {toastMsg && <div className="toast-box">{toastMsg}</div>}
    </div>
  );
}
