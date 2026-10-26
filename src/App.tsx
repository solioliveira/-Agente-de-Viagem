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
  checkAuthRedirectResult,
  logoutUser,
  handleFirestoreError,
  OperationType,
} from './firebase';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

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
  destino?: string;
  dataInicio?: string;
  moeda?: string;
  cotacao?: number;
  idadesCriancas?: string;
  criadorUid: string;
  criadorEmail: string;
  membros: string[];
}

interface ComentarioItem {
  autor: string;
  texto: string;
  ts: number;
}

type ItemTipo =
  | 'passagem'
  | 'hotel'
  | 'restaurante'
  | 'passeio'
  | 'seguro'
  | 'gasto'
  | 'nota'
  | 'destino';

interface RoteiroItem {
  id: string;
  viagemId?: string;
  tipo: ItemTipo;
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
  site?: string;
  dataRef?: string;
}

interface MonitorItem {
  id: string;
  viagemId?: string;
  nome: string;
  data: string;
  alvo: number;
  saida?: string;
  destino?: string;
  dias?: number;
  adultos?: number;
  flexDias?: number;
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
    seguro_viagem?: number;
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

interface ChatMsg {
  role: 'user' | 'agent';
  texto: string;
  dicas?: string[];
  conferir?: string;
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
  home: 'Escolha sua viagem, acompanhe o resumo e veja por onde começar.',
  ferias:
    'Preencha o que souber e toque em Sugerir destinos. Os campos em "Mais opções" são opcionais.',
  fds: 'Escolha com quem vai e o orçamento. Se estiver em cima da hora, use Escapada de última hora.',
  comp: 'Digite 2 ou 3 destinos que você está em dúvida e veja qual compensa mais.',
  datas: 'Veja em que época do ano costuma ser mais barato viajar para um destino.',
  roteiro:
    'Aqui vocês juntam passagens, hotéis, seguro e passeios. Tudo que um adicionar aparece para o outro.',
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
  seguro: 'Seguro viagem',
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

const fmtDateTime = (ts: number) => {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
};

const addDaysIso = (isoDate: string, daysToAdd: number): string => {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return '';
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + daysToAdd));
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toISOString().slice(0, 10);
};

const countChildrenFromStr = (s?: string): number => {
  const clean = String(s || '').trim();
  if (!clean) return 0;
  return clean
    .split(/[,;e\s]+/)
    .map((x) => x.trim())
    .filter((x) => /^\d+$/.test(x)).length;
};

const buildComparisonLinks = (params: {
  mode: 'passagens' | 'hoteis';
  saida?: string;
  destino: string;
  dataIda?: string;
  dias?: number;
  adultos?: number;
  criancasCount?: number;
}) => {
  const dest = (params.destino || '').trim() || 'Brasil';
  const orig = (params.saida || '').trim();
  const hasValidDate = Boolean(params.dataIda && /^\d{4}-\d{2}-\d{2}$/.test(params.dataIda));
  const dias = Math.max(1, Number(params.dias) || 5);
  const checkin = hasValidDate ? params.dataIda! : '';
  const checkout = hasValidDate ? addDaysIso(checkin, dias) : '';
  const adultos = Math.max(1, Number(params.adultos) || 2);
  const criancas = Math.max(0, Number(params.criancasCount) || 0);
  const totalViajantes = adultos + criancas;

  if (params.mode === 'passagens') {
    const qGoogle = hasValidDate
      ? `Voos${orig ? ` de ${orig}` : ''} para ${dest} ida ${checkin} volta ${checkout} para ${totalViajantes} passageiros`
      : `Voos${orig ? ` de ${orig}` : ''} para ${dest}`;
    const googleUrl = `https://www.google.com/travel/flights?hl=pt-BR&curr=BRL&q=${encodeURIComponent(
      qGoogle
    )}`;

    const bookingUrl = hasValidDate
      ? `https://www.booking.com/flights/index.pt-br.html?from=${encodeURIComponent(
          orig
        )}&to=${encodeURIComponent(dest)}&depart=${checkin}&return=${checkout}&adults=${adultos}&children=${criancas}`
      : `https://www.booking.com/flights/index.pt-br.html?to=${encodeURIComponent(
          dest
        )}&adults=${adultos}`;

    const decolarUrl = hasValidDate
      ? `https://www.decolar.com/passagens-aereas/?from=${encodeURIComponent(
          orig
        )}&to=${encodeURIComponent(
          dest
        )}&departureDate=${checkin}&returnDate=${checkout}&adults=${adultos}&children=${criancas}`
      : `https://www.decolar.com/passagens-aereas/?to=${encodeURIComponent(dest)}`;

    return [
      { nome: 'Google Voos', url: googleUrl },
      { nome: 'Booking.com', url: bookingUrl },
      { nome: 'Decolar (BR)', url: decolarUrl },
    ];
  } else {
    const qGoogle = hasValidDate
      ? `Hotéis em ${dest} check-in ${checkin} check-out ${checkout} para ${adultos} adultos${
          criancas > 0 ? ` e ${criancas} crianças` : ''
        }`
      : `Hotéis em ${dest}`;
    const googleUrl = `https://www.google.com/travel/hotels?hl=pt-BR&curr=BRL&q=${encodeURIComponent(
      qGoogle
    )}`;

    const bookingUrl = hasValidDate
      ? `https://www.booking.com/searchresults.pt-br.html?ss=${encodeURIComponent(
          dest
        )}&checkin=${checkin}&checkout=${checkout}&group_adults=${adultos}&no_rooms=1&group_children=${criancas}`
      : `https://www.booking.com/searchresults.pt-br.html?ss=${encodeURIComponent(
          dest
        )}&group_adults=${adultos}&no_rooms=1&group_children=${criancas}`;

    const decolarUrl = hasValidDate
      ? `https://www.decolar.com/hoteis/?destination=${encodeURIComponent(
          dest
        )}&checkin=${checkin}&checkout=${checkout}&adults=${adultos}`
      : `https://www.decolar.com/hoteis/?destination=${encodeURIComponent(dest)}`;

    return [
      { nome: 'Google Hotéis', url: googleUrl },
      { nome: 'Booking.com', url: bookingUrl },
      { nome: 'Decolar (BR)', url: decolarUrl },
    ];
  }
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

const DEFAULT_LOCAL_TRIP: ViagemDoc = {
  id: 'local_default',
  nome: 'Nossa Viagem',
  destino: '',
  dataInicio: '',
  moeda: '',
  cotacao: 0,
  idadesCriancas: '',
  criadorUid: 'local',
  criadorEmail: 'você',
  membros: ['você'],
};

export default function App() {
  const [sec, setSec] = useState<SecKey>('home');
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Accessibility: Font scale (0 = 16px, 1 = 18px, 2 = 20px)
  const [fontScale, setFontScale] = useState<number>(() =>
    loadLocal('av_font_scale', 0)
  );

  // Online / Offline & PWA Install State
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  // Auth & Trips state
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [unauthorizedDomain, setUnauthorizedDomain] = useState<string | null>(null);
  const [authErrorCode, setAuthErrorCode] = useState<string | null>(null);

  const [localViagens, setLocalViagens] = useState<ViagemDoc[]>(() =>
    loadLocal<ViagemDoc[]>('av_local_viagens', [DEFAULT_LOCAL_TRIP])
  );
  const [cloudViagens, setCloudViagens] = useState<ViagemDoc[]>([]);
  const [activeViagemId, setActiveViagemId] = useState<string>(() =>
    loadLocal('av_active_viagem_id', DEFAULT_LOCAL_TRIP.id)
  );

  const [inviteEmail, setInviteEmail] = useState('');
  const [newTripName, setNewTripName] = useState('');
  const [newTripDestino, setNewTripDestino] = useState('');
  const [newTripData, setNewTripData] = useState('');
  const [showNewTrip, setShowNewTrip] = useState(false);

  // Shared Trip Data
  const [items, setItems] = useState<RoteiroItem[]>([]);
  const [mons, setMons] = useState<MonitorItem[]>([]);
  const [gastos, setGastos] = useState<GastoItem[]>([]);
  const [checks, setChecks] = useState<CheckItem[]>([]);
  const [pessoas, setPessoas] = useState<string[]>([]);

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

  // Monitor de preço & "Achar mais barato" Form/State
  const [pNome, setPNome] = useState('');
  const [pData, setPData] = useState('');
  const [pAlvo, setPAlvo] = useState('');
  const [priceInputs, setPriceInputs] = useState<Record<string, string>>({});
  const [siteInputs, setSiteInputs] = useState<Record<string, string>>({});
  const [alvoInputs, setAlvoInputs] = useState<Record<string, string>>({});
  const [acharMode, setAcharMode] = useState<Record<string, 'passagens' | 'hoteis' | null>>({});
  const [flexDaysMap, setFlexDaysMap] = useState<Record<string, number>>({});
  const [baseDateMap, setBaseDateMap] = useState<Record<string, string>>({});
  const [flexPriceInputs, setFlexPriceInputs] = useState<Record<string, string>>({});
  const [flexSiteInputs, setFlexSiteInputs] = useState<Record<string, string>>({});

  // Roteiro Form & Comments
  const [iTipo, setITipo] = useState<ItemTipo>('passagem');
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
  const [gPessInput, setGPessInput] = useState('');
  const [gDesc, setGDesc] = useState('');
  const [gVal, setGVal] = useState('');
  const [gPag, setGPag] = useState('');
  const [gDivSelected, setGDivSelected] = useState<string[]>([]);

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

  // Conversa com o Agente (Floating Chat)
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([
    {
      role: 'agent',
      texto:
        'Olá! Sou seu agente de viagem econômico. Pergunte sobre seu roteiro, onde economizar, bagagem, passeios ou milhas!',
    },
  ]);

  const viagens = user ? cloudViagens : localViagens;
  const activeViagem = viagens.find((v) => v.id === activeViagemId) || viagens[0] || null;

  const toast = (m: string) => {
    setToastMsg(m);
  };

  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 3200);
    return () => clearTimeout(t);
  }, [toastMsg]);

  // Apply font scale to <html>
  useEffect(() => {
    document.documentElement.setAttribute('data-font-scale', String(fontScale));
    try {
      localStorage.setItem('av_font_scale', JSON.stringify(fontScale));
    } catch {
      // ignore
    }
  }, [fontScale]);

  // Track online/offline & PWA install prompt
  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true);
      toast('Conexão restabelecida! Sincronizando dados...');
    };
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(isStandalone);

    const ua = window.navigator.userAgent.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(ua));

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstallPwa = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
    }
  };

  // Persist activeViagemId and localViagens
  useEffect(() => {
    try {
      if (activeViagemId) {
        localStorage.setItem('av_active_viagem_id', JSON.stringify(activeViagemId));
      }
      if (!user) {
        localStorage.setItem('av_local_viagens', JSON.stringify(localViagens));
      }
    } catch {
      // ignore
    }
  }, [activeViagemId, localViagens, user]);

  // Load local per-trip data when not logged in (or as offline cache)
  useEffect(() => {
    if (user) return;
    const tid = activeViagem?.id || 'local_default';
    const loadedItems = loadLocal<RoteiroItem[]>(
      `av_items_${tid}`,
      tid === 'local_default' ? loadLocal('av_items', []) : []
    );
    const loadedMons = loadLocal<MonitorItem[]>(
      `av_mons_${tid}`,
      tid === 'local_default' ? loadLocal('av_mons', []) : []
    );
    const loadedGastos = loadLocal<GastoItem[]>(
      `av_gastos_${tid}`,
      tid === 'local_default' ? loadLocal('av_gastos', []) : []
    );
    const loadedChecks = loadLocal<CheckItem[]>(
      `av_checks_${tid}`,
      tid === 'local_default' ? loadLocal('av_checks', []) : []
    );
    const loadedPessoas = loadLocal<string[]>(
      `av_pessoas_${tid}`,
      tid === 'local_default' ? loadLocal('av_pessoas', []) : []
    );

    setItems(loadedItems);
    setMons(loadedMons);
    setGastos(loadedGastos);
    setChecks(loadedChecks);
    setPessoas(loadedPessoas);
    setGPessInput(loadedPessoas.join(', '));
    setGPag(loadedPessoas[0] || '');
    setGDivSelected(loadedPessoas);
  }, [user, activeViagem?.id]);

  // Save per-trip data to localStorage for offline consultation
  useEffect(() => {
    const tid = activeViagem?.id || 'local_default';
    try {
      localStorage.setItem(`av_items_${tid}`, JSON.stringify(items));
      localStorage.setItem(`av_mons_${tid}`, JSON.stringify(mons));
      localStorage.setItem(`av_gastos_${tid}`, JSON.stringify(gastos));
      localStorage.setItem(`av_checks_${tid}`, JSON.stringify(checks));
      localStorage.setItem(`av_pessoas_${tid}`, JSON.stringify(pessoas));
    } catch {
      // ignore
    }
  }, [activeViagem?.id, items, mons, gastos, checks, pessoas]);

  // Listen to Auth State
  useEffect(() => {
    checkAuthRedirectResult().catch((err: any) => {
      if (err?.code) {
        setAuthErrorCode(err.code);
        if (err.code === 'auth/unauthorized-domain') {
          setUnauthorizedDomain(window.location.hostname);
        }
      }
    });
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
      if (u) {
        setUnauthorizedDomain(null);
        setAuthErrorCode(null);
      }
    });
    return () => unsub();
  }, []);

  // Listen to user's Viagens in Firestore
  useEffect(() => {
    if (!authReady || !user || !user.email) {
      setCloudViagens([]);
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
              destino: '',
              dataInicio: '',
              moeda: '',
              cotacao: 0,
              idadesCriancas: '',
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

        setCloudViagens(list);
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

  // Listen to subcollections of activeViagem
  useEffect(() => {
    if (!authReady || !user || !activeViagem || activeViagem.id === 'local_default') return;
    const vid = activeViagem.id;

    const itensPath = `viagens/${vid}/itens`;
    const monsPath = `viagens/${vid}/monitores`;
    const gastosPath = `viagens/${vid}/gastos`;
    const checkPath = `viagens/${vid}/checklist`;
    const pessoasPath = `viagens/${vid}/meta/pessoas`;

    const unsubItens = onSnapshot(
      query(collection(db, 'viagens', vid, 'itens'), where('viagemId', '==', vid)),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<RoteiroItem, 'id'>) }))
          .sort((a, b) => b.ts - a.ts);
        setItems(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, itensPath)
    );

    const unsubMons = onSnapshot(
      query(collection(db, 'viagens', vid, 'monitores'), where('viagemId', '==', vid)),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<MonitorItem, 'id'>) }))
          .sort((a, b) => b.ts - a.ts);
        setMons(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, monsPath)
    );

    const unsubGastos = onSnapshot(
      query(collection(db, 'viagens', vid, 'gastos'), where('viagemId', '==', vid)),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<GastoItem, 'id'>) }))
          .sort((a, b) => b.ts - a.ts);
        setGastos(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, gastosPath)
    );

    const unsubChecks = onSnapshot(
      query(collection(db, 'viagens', vid, 'checklist'), where('viagemId', '==', vid)),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<CheckItem, 'id'>) }))
          .sort((a, b) => a.ts - b.ts);
        setChecks(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, checkPath)
    );

    const unsubPessoas = onSnapshot(
      doc(db, 'viagens', vid, 'meta', 'pessoas'),
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
  }, [authReady, user, activeViagem?.id]);

  // Currency Conversion Helper (#4 CÂMBIO E SEGURO)
  const moedaAtiva = activeViagem?.moeda?.trim().toUpperCase() || '';
  const cotacaoAtiva = Number(activeViagem?.cotacao) || 0;

  const fmtMoney = (valorBrl: unknown) => {
    const n = Number(valorBrl || 0);
    const base = brl(n);
    if (moedaAtiva && cotacaoAtiva > 0 && n > 0) {
      const conv = Math.round(n / cotacaoAtiva);
      return `${base} (~${moedaAtiva} ${conv.toLocaleString('pt-BR')})`;
    }
    return base;
  };

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
      setAuthErrorCode(null);
      await loginWithGoogle();
    } catch (err: any) {
      const code = err?.code || 'erro-desconhecido';
      setAuthErrorCode(code);
      if (code === 'auth/unauthorized-domain') {
        setUnauthorizedDomain(window.location.hostname);
        toast('Domínio ainda não liberado no Firebase. Veja o passo a passo abaixo.');
      } else if (code === 'auth/popup-closed-by-user') {
        setAuthErrorCode(null);
        toast('Janela de login foi fechada antes de concluir.');
      } else {
        setUnauthorizedDomain(window.location.hostname);
        toast(`Erro no login (${code}). Veja como resolver abaixo.`);
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

  // Trip Management (#1 VÁRIAS VIAGENS)
  const handleCreateTrip = async () => {
    const nome = clampStr(newTripName, 100);
    const destino = clampStr(newTripDestino, 100);
    const dataInicio = clampStr(newTripData, 20);
    if (!nome) return toast('Dê um nome para a viagem.');

    if (user && user.email) {
      try {
        const ref = await addDoc(collection(db, 'viagens'), {
          nome,
          destino,
          dataInicio,
          moeda: '',
          cotacao: 0,
          idadesCriancas: '',
          criadorUid: user.uid,
          criadorEmail: user.email,
          membros: [user.email],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        setActiveViagemId(ref.id);
        setNewTripName('');
        setNewTripDestino('');
        setNewTripData('');
        setShowNewTrip(false);
        toast('Nova viagem criada!');
      } catch (e) {
        handleFirestoreError(e, OperationType.CREATE, 'viagens');
      }
    } else {
      const newDoc: ViagemDoc = {
        id: 'local_' + Date.now(),
        nome,
        destino,
        dataInicio,
        moeda: '',
        cotacao: 0,
        idadesCriancas: '',
        criadorUid: 'local',
        criadorEmail: 'você',
        membros: ['você'],
      };
      setLocalViagens((prev) => [...prev, newDoc]);
      setActiveViagemId(newDoc.id);
      setNewTripName('');
      setNewTripDestino('');
      setNewTripData('');
      setShowNewTrip(false);
      toast('Nova viagem criada neste aparelho!');
    }
  };

  const updateTripMeta = async (patch: Partial<ViagemDoc>) => {
    if (!activeViagem) return;
    const cleanPatch: Record<string, unknown> = {};
    if (patch.destino !== undefined) cleanPatch.destino = clampStr(patch.destino, 100);
    if (patch.dataInicio !== undefined) cleanPatch.dataInicio = clampStr(patch.dataInicio, 20);
    if (patch.moeda !== undefined) cleanPatch.moeda = clampStr(patch.moeda.toUpperCase(), 10);
    if (patch.cotacao !== undefined) {
      cleanPatch.cotacao = Math.max(0, Math.min(100000, Number(patch.cotacao) || 0));
    }
    if (patch.idadesCriancas !== undefined) {
      cleanPatch.idadesCriancas = clampStr(patch.idadesCriancas, 50);
    }

    if (user && activeViagem.id !== 'local_default' && !activeViagem.id.startsWith('local_')) {
      try {
        await updateDoc(doc(db, 'viagens', activeViagem.id), {
          ...cleanPatch,
          updatedAt: serverTimestamp(),
        });
      } catch (e) {
        handleFirestoreError(e, OperationType.UPDATE, `viagens/${activeViagem.id}`);
      }
    } else {
      setLocalViagens((prev) =>
        prev.map((v) => (v.id === activeViagem.id ? { ...v, ...cleanPatch } : v))
      );
    }
  };

  const handleInviteMember = async () => {
    if (!activeViagem) return;
    if (!user) {
      return toast('Entre com o Google para convidar outra pessoa por e-mail.');
    }
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
    tipo: ItemTipo;
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

    if (
      user &&
      user.email &&
      activeViagem &&
      activeViagem.id !== 'local_default' &&
      !activeViagem.id.startsWith('local_')
    ) {
      const vid = activeViagem.id;
      const path = `viagens/${vid}/itens`;
      try {
        await addDoc(collection(db, 'viagens', vid, 'itens'), {
          viagemId: vid,
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
    if (
      user &&
      activeViagem &&
      activeViagem.id !== 'local_default' &&
      !activeViagem.id.startsWith('local_')
    ) {
      const vid = activeViagem.id;
      const path = `viagens/${vid}/itens/${id}`;
      try {
        await deleteDoc(doc(db, 'viagens', vid, 'itens', id));
      } catch (e) {
        toast('Sem permissão para apagar.');
        handleFirestoreError(e, OperationType.DELETE, path);
      }
    } else {
      setItems((prev) => prev.filter((i) => i.id !== id));
    }
  };

  const mutateItem = async (id: string, patch: Partial<RoteiroItem>) => {
    if (
      user &&
      activeViagem &&
      activeViagem.id !== 'local_default' &&
      !activeViagem.id.startsWith('local_')
    ) {
      const vid = activeViagem.id;
      const path = `viagens/${vid}/itens/${id}`;
      try {
        await updateDoc(doc(db, 'viagens', vid, 'itens', id), {
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
    if (fCriancas.trim()) {
      updateTripMeta({ idadesCriancas: fCriancas.trim() });
    }
    const p = `Você é um agente de viagens brasileiro experiente. Responda SOMENTE com JSON válido, sem markdown.
Perfil: saída de ${fSaida.trim() || 'cidade não informada'}; período ${fQuando.trim() || activeViagem?.dataInicio || 'flexível'}; ${fDias} dias; ${fAdultos} adulto(s); crianças com idades: ${fCriancas.trim() || activeViagem?.idadesCriancas || 'nenhuma'}; tipo: ${fTipo}; orçamento total R$ ${fOrc.trim() || 'não informado'}; milhas: ${fMilhas.trim() || '0'}; preferências: ${fEstilo.trim() || 'nenhuma'}.
Foco: ${fFoco}. Se o foco for econômico, priorize destinos e épocas com melhor custo-benefício (baixa temporada, datas flexíveis, aeroportos alternativos, hospedagem em apartamento ou pousada, bagagem e transfers) e explique como economizar sem estragar a viagem. Sugira 3 destinos adequados à época e à família. Todos os valores em reais (números), estimativas realistas e arredondadas para o total do grupo; não invente preços exatos nem prometa tarifas.
Formato: {"sugestoes":[{"destino":"","pais":"","tipo":"nacional|internacional","porque":"","custos":{"passagens":0,"hospedagem":0,"alimentacao":0,"passeios":0,"transporte_local":0,"seguro_viagem":0,"total":0},"hospedagem":[{"nome":"","tipo":"hotel|resort|pousada","faixa_diaria_brl":0}],"passagem":{"onde_comprar":"","milhas_ou_dinheiro":""},"pagar_antes":"","reserva_destino_brl":0,"roteiro":["Dia 1: ..."],"restaurantes":[""],"passeios":[""],"dicas_economia":[""],"economia_estimada_brl":0,"sala_vip_milhas":""}]}
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
    const costEntries: [ItemTipo, keyof FeriasSugestao['custos'], string][] = [
      ['passagem', 'passagens', 'Passagens'],
      ['hotel', 'hospedagem', 'Hospedagem'],
      ['seguro', 'seguro_viagem', 'Seguro viagem'],
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
    if (wCriancas.trim()) {
      updateTripMeta({ idadesCriancas: wCriancas.trim() });
    }
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

  // Monitor de preço & "Achar mais barato" Handlers
  const handleAddMonitor = async () => {
    const n = clampStr(pNome, 150);
    if (!n) return toast('Dê um nome ao monitor.');
    const ts = Date.now();
    const cleanData = clampStr(pData || activeViagem?.dataInicio || '', 20);
    const cleanAlvo = Math.max(0, Math.min(100000000, Number(pAlvo) || 0));
    const cleanDestino = clampStr(dDest || activeViagem?.destino || n, 100);
    const cleanSaida = clampStr(dSaida || fSaida || wSaida || cSaida || '', 100);

    if (
      user &&
      activeViagem &&
      activeViagem.id !== 'local_default' &&
      !activeViagem.id.startsWith('local_')
    ) {
      const vid = activeViagem.id;
      const path = `viagens/${vid}/monitores`;
      try {
        await addDoc(collection(db, 'viagens', vid, 'monitores'), {
          viagemId: vid,
          nome: n,
          data: cleanData,
          alvo: cleanAlvo,
          saida: cleanSaida,
          destino: cleanDestino,
          dias: Math.max(1, Number(dDias) || 7),
          adultos: Math.max(1, Number(fAdultos) || 2),
          flexDias: 0,
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
        {
          id: 'm' + ts,
          nome: n,
          data: cleanData,
          alvo: cleanAlvo,
          saida: cleanSaida,
          destino: cleanDestino,
          dias: Math.max(1, Number(dDias) || 7),
          adultos: Math.max(1, Number(fAdultos) || 2),
          flexDias: 0,
          regs: [],
          ts,
        },
        ...prev,
      ]);
    }
    setPNome('');
    setPData('');
    setPAlvo('');
  };

  const recordPriceToMonitor = async (opts: {
    existingMonitor?: MonitorItem | null;
    monitorNome: string;
    valor: number;
    site: string;
    dataViagem?: string;
    dataRef?: string;
    alvoSugerido?: number;
    saida?: string;
    destino?: string;
    dias?: number;
    adultos?: number;
    flexDias?: number;
  }) => {
    const val = Math.max(0, Math.min(100000000, Number(opts.valor) || 0));
    if (!(val > 0)) return toast('Informe um valor válido em R$.');
    const cleanSite = clampStr(opts.site || 'Site de busca', 80);
    const cleanDataRef = opts.dataRef ? clampStr(opts.dataRef, 20) : undefined;
    const newReg: RegMonitor = {
      valor: val,
      ts: Date.now(),
      site: cleanSite,
      ...(cleanDataRef ? { dataRef: cleanDataRef } : {}),
    };

    const targetMon =
      opts.existingMonitor ||
      mons.find((m) => m.nome.toLowerCase() === opts.monitorNome.toLowerCase()) ||
      null;

    if (targetMon) {
      const nextRegs = arr<RegMonitor>(targetMon.regs).concat(newReg).slice(0, 200);
      const nextAlvo =
        opts.alvoSugerido !== undefined && opts.alvoSugerido > 0
          ? opts.alvoSugerido
          : targetMon.alvo;
      const nextData = opts.dataViagem || targetMon.data || '';
      const nextFlex =
        opts.flexDias !== undefined ? opts.flexDias : targetMon.flexDias ?? 0;

      if (
        user &&
        activeViagem &&
        activeViagem.id !== 'local_default' &&
        !activeViagem.id.startsWith('local_')
      ) {
        const vid = activeViagem.id;
        const path = `viagens/${vid}/monitores/${targetMon.id}`;
        try {
          await updateDoc(doc(db, 'viagens', vid, 'monitores', targetMon.id), {
            regs: nextRegs,
            alvo: nextAlvo,
            data: clampStr(nextData, 20),
            flexDias: Math.max(0, Math.min(7, Number(nextFlex) || 0)),
            updatedAt: serverTimestamp(),
          });
        } catch (e) {
          toast('Sem permissão para editar.');
          handleFirestoreError(e, OperationType.UPDATE, path);
        }
      } else {
        setMons((prev) =>
          prev.map((x) =>
            x.id === targetMon.id
              ? {
                  ...x,
                  regs: nextRegs,
                  alvo: nextAlvo,
                  data: clampStr(nextData, 20),
                  flexDias: Math.max(0, Math.min(7, Number(nextFlex) || 0)),
                }
              : x
          )
        );
      }
      const chegou = nextAlvo > 0 && val <= nextAlvo;
      toast(
        chegou
          ? `🎉 Chegou no alvo! Preço ${brl(val)} registrado em "${targetMon.nome}".`
          : `Preço ${brl(val)} (${cleanSite}) salvo no Monitor de preço!`
      );
    } else {
      const ts = Date.now();
      const nomeClean = clampStr(opts.monitorNome, 150) || 'Monitor de preço';
      const dataClean = clampStr(opts.dataViagem || activeViagem?.dataInicio || '', 20);
      const alvoClean = Math.max(0, Math.min(100000000, Number(opts.alvoSugerido) || 0));
      const saidaClean = clampStr(opts.saida || '', 100);
      const destinoClean = clampStr(opts.destino || activeViagem?.destino || '', 100);
      const diasClean = Math.max(1, Math.min(365, Number(opts.dias) || 7));
      const adultosClean = Math.max(1, Math.min(30, Number(opts.adultos) || 2));
      const flexClean = Math.max(0, Math.min(7, Number(opts.flexDias) || 0));

      if (
        user &&
        activeViagem &&
        activeViagem.id !== 'local_default' &&
        !activeViagem.id.startsWith('local_')
      ) {
        const vid = activeViagem.id;
        const path = `viagens/${vid}/monitores`;
        try {
          await addDoc(collection(db, 'viagens', vid, 'monitores'), {
            viagemId: vid,
            nome: nomeClean,
            data: dataClean,
            alvo: alvoClean,
            saida: saidaClean,
            destino: destinoClean,
            dias: diasClean,
            adultos: adultosClean,
            flexDias: flexClean,
            regs: [newReg],
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
          {
            id: 'm' + ts,
            nome: nomeClean,
            data: dataClean,
            alvo: alvoClean,
            saida: saidaClean,
            destino: destinoClean,
            dias: diasClean,
            adultos: adultosClean,
            flexDias: flexClean,
            regs: [newReg],
            ts,
          },
          ...prev,
        ]);
      }
      const chegou = alvoClean > 0 && val <= alvoClean;
      toast(
        chegou
          ? `🎉 Chegou no alvo! Monitor "${nomeClean}" criado com ${brl(val)}.`
          : `Monitor "${nomeClean}" salvo com ${brl(val)} (${cleanSite})!`
      );
    }
  };

  const handleRegisterPrice = async (m: MonitorItem) => {
    const val = Number(priceInputs[m.id]);
    if (!(val > 0)) return toast('Informe um valor válido.');
    const site = siteInputs[m.id] || 'Google Voos / Hotéis';
    setPriceInputs((prev) => ({ ...prev, [m.id]: '' }));
    await recordPriceToMonitor({
      existingMonitor: m,
      monitorNome: m.nome,
      valor: val,
      site,
    });
  };

  const handleDelMonitor = async (id: string) => {
    if (
      user &&
      activeViagem &&
      activeViagem.id !== 'local_default' &&
      !activeViagem.id.startsWith('local_')
    ) {
      const vid = activeViagem.id;
      const path = `viagens/${vid}/monitores/${id}`;
      try {
        await deleteDoc(doc(db, 'viagens', vid, 'monitores', id));
      } catch (e) {
        toast('Sem permissão para apagar.');
        handleFirestoreError(e, OperationType.DELETE, path);
      }
    } else {
      setMons((prev) => prev.filter((m) => m.id !== id));
    }
  };

  // Render SVG Simple Line Chart for Monitor Price History (#2 REGISTRAR O QUE ACHOU)
  const renderPriceHistoryChart = (regsList: RegMonitor[], alvo: number) => {
    const r = arr<RegMonitor>(regsList)
      .filter((x) => Number(x.valor) > 0)
      .slice()
      .sort((a, b) => a.ts - b.ts);
    if (r.length === 0) return null;

    const vals = r.map((x) => Number(x.valor));
    const allVals = alvo > 0 ? [...vals, alvo] : vals;
    const minV = Math.min(...allVals);
    const maxV = Math.max(...allVals);
    const padV = Math.max(50, (maxV - minV) * 0.18);
    const low = Math.max(0, minV - padV);
    const high = maxV + padV;

    const W = 520;
    const H = 160;
    const PL = 48;
    const PR = 24;
    const PT = 22;
    const PB = 28;

    const sx = (idx: number) =>
      r.length === 1 ? W / 2 : PL + (idx / (r.length - 1)) * (W - PL - PR);
    const sy = (v: number) =>
      high === low ? H / 2 : H - PB - ((v - low) / (high - low)) * (H - PT - PB);

    const lastReg = r[r.length - 1];
    const minReg = r.reduce((acc, cur) => (cur.valor < acc.valor ? cur : acc), r[0]);
    const chegouAlvo = Boolean(alvo > 0 && (lastReg.valor <= alvo || minReg.valor <= alvo));

    return (
      <div style={{ marginTop: 10 }}>
        {chegouAlvo && (
          <div
            style={{
              background: 'rgba(11, 107, 116, 0.15)',
              border: '1px solid var(--acc)',
              color: 'var(--acc)',
              borderRadius: 8,
              padding: '6px 10px',
              fontWeight: 700,
              marginBottom: 8,
              fontSize: '0.9rem',
            }}
            role="status"
          >
            🎯 Chegou no alvo! Menor preço registrado: {fmtMoney(minReg.valor)} (alvo:{' '}
            {fmtMoney(alvo)})
          </div>
        )}

        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Gráfico de linha do histórico de preços registrados"
          style={{
            width: '100%',
            maxWidth: 560,
            background: 'var(--card)',
            border: '1px solid var(--line)',
            borderRadius: 10,
            display: 'block',
          }}
        >
          {/* Linha de preço-alvo */}
          {alvo > 0 && (
            <g>
              <line
                x1={PL}
                y1={sy(alvo)}
                x2={W - PR}
                y2={sy(alvo)}
                stroke="var(--acc2)"
                strokeWidth="1.5"
                strokeDasharray="4 4"
              />
              <text
                x={W - PR}
                y={Math.max(12, sy(alvo) - 4)}
                textAnchor="end"
                fontSize="10"
                fill="var(--acc2)"
                fontWeight="bold"
              >
                Alvo: {brl(alvo)}
              </text>
            </g>
          )}

          {/* Linha conectando o histórico */}
          {r.length > 1 && (
            <polyline
              fill="none"
              stroke="var(--acc)"
              strokeWidth="2.5"
              points={r.map((pt, idx) => `${sx(idx)},${sy(pt.valor)}`).join(' ')}
            />
          )}

          {/* Pontos do histórico */}
          {r.map((pt, idx) => (
            <g key={idx}>
              <circle
                cx={sx(idx)}
                cy={sy(pt.valor)}
                r="4.5"
                fill={alvo > 0 && pt.valor <= alvo ? 'var(--acc)' : 'var(--acc2)'}
              />
              <text
                x={sx(idx)}
                y={Math.max(13, sy(pt.valor) - 7)}
                textAnchor="middle"
                fontSize="10"
                fill="currentColor"
                fontWeight="600"
              >
                {brl(pt.valor)}
              </text>
              <text
                x={sx(idx)}
                y={H - 8}
                textAnchor="middle"
                fontSize="9"
                fill="var(--mut)"
              >
                {fmtDateTime(pt.ts).split(' ')[0]}
              </text>
            </g>
          ))}
        </svg>

        {/* Lista resumida de registros com data, hora e site */}
        <div className="mut" style={{ marginTop: 6, fontSize: '0.8rem' }}>
          <b>Histórico registrado ({r.length}):</b>{' '}
          {r
            .slice()
            .reverse()
            .slice(0, 6)
            .map((x, idx) => (
              <span key={idx} style={{ marginRight: 10, display: 'inline-block' }}>
                • <b>{fmtMoney(x.valor)}</b>
                {x.site ? ` em ${x.site}` : ''}
                {x.dataRef ? ` (ida ${fmtD(x.dataRef)})` : ''} — {fmtDateTime(x.ts)}
              </span>
            ))}
        </div>
      </div>
    );
  };

  // Reusable "Achar mais barato" Component (#1, #2, #3, #4)
  const renderAcharMaisBarato = (cfg: {
    cardKey: string;
    destino: string;
    saida?: string;
    dataSugerida?: string;
    dias?: number;
    adultos?: number;
    criancasStr?: string;
    alvoPassagens?: number;
    alvoHoteis?: number;
    existingMonitor?: MonitorItem;
  }) => {
    const mode = acharMode[cfg.cardKey] || null;
    const destClean = (cfg.destino || activeViagem?.destino || '').trim();
    const saidaClean = (
      cfg.saida ||
      cfg.existingMonitor?.saida ||
      fSaida ||
      wSaida ||
      cSaida ||
      dSaida ||
      ''
    ).trim();
    const diasNum = Math.max(1, Number(cfg.dias || cfg.existingMonitor?.dias) || 7);
    const adultosNum = Math.max(1, Number(cfg.adultos || cfg.existingMonitor?.adultos || fAdultos) || 2);
    const criancasCount = countChildrenFromStr(
      cfg.criancasStr || activeViagem?.idadesCriancas || fCriancas || wCriancas
    );

    // Base departure date (YYYY-MM-DD if available)
    const rawCandidateDate =
      baseDateMap[cfg.cardKey] ??
      cfg.existingMonitor?.data ??
      cfg.dataSugerida ??
      activeViagem?.dataInicio ??
      '';
    const baseDateIso = /^\d{4}-\d{2}-\d{2}$/.test(rawCandidateDate) ? rawCandidateDate : '';

    // Monitor name based on mode or existing monitor
    const activeMode: 'passagens' | 'hoteis' = mode || 'passagens';
    const monitorNome = cfg.existingMonitor
      ? cfg.existingMonitor.nome
      : `${activeMode === 'passagens' ? 'Passagens' : 'Hotel'} — ${destClean || 'Viagem'}`;

    const matchedMonitor =
      cfg.existingMonitor ||
      mons.find((m) => m.nome.toLowerCase() === monitorNome.toLowerCase()) ||
      mons.find(
        (m) =>
          destClean &&
          m.nome.toLowerCase().includes(destClean.toLowerCase()) &&
          m.nome
            .toLowerCase()
            .includes(activeMode === 'passagens' ? 'passag' : 'hote')
      ) ||
      null;

    const defaultAlvo =
      matchedMonitor?.alvo ||
      (activeMode === 'passagens' ? cfg.alvoPassagens : cfg.alvoHoteis) ||
      cfg.alvoPassagens ||
      cfg.alvoHoteis ||
      0;

    const currentAlvoInput =
      alvoInputs[cfg.cardKey] !== undefined
        ? Number(alvoInputs[cfg.cardKey]) || 0
        : defaultAlvo;

    const flexDias =
      flexDaysMap[cfg.cardKey] !== undefined
        ? flexDaysMap[cfg.cardKey]
        : matchedMonitor?.flexDias ?? 0;

    const handleOpenSearchMode = (selectedMode: 'passagens' | 'hoteis') => {
      setAcharMode((prev) => ({ ...prev, [cfg.cardKey]: selectedMode }));
      const defaultSite =
        selectedMode === 'passagens' ? 'Google Voos' : 'Google Hotéis';
      setSiteInputs((prev) => ({
        ...prev,
        [cfg.cardKey]: prev[cfg.cardKey] || defaultSite,
      }));
      // Open primary comparison search in a new tab via anchor element
      const links = buildComparisonLinks({
        mode: selectedMode,
        saida: saidaClean,
        destino: destClean,
        dataIda: baseDateIso,
        dias: diasNum,
        adultos: adultosNum,
        criancasCount,
      });
      if (links[0]?.url) {
        const a = document.createElement('a');
        a.href = links[0].url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    };

    const currentLinks = buildComparisonLinks({
      mode: activeMode,
      saida: saidaClean,
      destino: destClean,
      dataIda: baseDateIso,
      dias: diasNum,
      adultos: adultosNum,
      criancasCount,
    });

    // Build flexible dates array (-flexDias ... +flexDias)
    const flexDatesList: { offset: number; iso: string }[] = [];
    if (flexDias > 0 && baseDateIso) {
      for (let off = -flexDias; off <= flexDias; off++) {
        const dIso = addDaysIso(baseDateIso, off);
        if (dIso) flexDatesList.push({ offset: off, iso: dIso });
      }
    }

    // Lookup lowest recorded price for each date in matchedMonitor.regs
    const regs = arr<RegMonitor>(matchedMonitor?.regs);
    const getLowestForDate = (dIso: string): number | null => {
      const matching = regs.filter(
        (r) =>
          r.dataRef === dIso ||
          (!r.dataRef && dIso === baseDateIso && matchedMonitor?.data === baseDateIso)
      );
      if (!matching.length) return null;
      return Math.min(...matching.map((x) => Number(x.valor)));
    };

    const originalDatePrice = baseDateIso ? getLowestForDate(baseDateIso) : null;
    const recordedFlexPrices = flexDatesList
      .map((fd) => ({ ...fd, minVal: getLowestForDate(fd.iso) }))
      .filter((fd): fd is { offset: number; iso: string; minVal: number } => fd.minVal !== null);

    const cheapestFlex =
      recordedFlexPrices.length > 0
        ? recordedFlexPrices.reduce((best, cur) => (cur.minVal < best.minVal ? cur : best))
        : null;

    return (
      <div style={{ marginTop: 10 }}>
        {/* #1 Botões "Ver passagens" e "Ver hotéis" */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            className={`btn${mode === 'passagens' ? '' : ' sec'}`}
            style={{ margin: 0, padding: '7px 13px', fontSize: '0.875rem' }}
            onClick={() => handleOpenSearchMode('passagens')}
          >
            ✈️ Ver passagens
          </button>
          <button
            type="button"
            className={`btn${mode === 'hoteis' ? '' : ' sec'}`}
            style={{ margin: 0, padding: '7px 13px', fontSize: '0.875rem' }}
            onClick={() => handleOpenSearchMode('hoteis')}
          >
            🏨 Ver hotéis
          </button>
          {mode && (
            <button
              type="button"
              className="btn sec"
              style={{ margin: 0, padding: '5px 10px', fontSize: '0.78rem' }}
              onClick={() => setAcharMode((prev) => ({ ...prev, [cfg.cardKey]: null }))}
            >
              Fechar busca
            </button>
          )}
        </div>

        {/* Se já houver histórico salvo mesmo com o painel fechado, mostra o gráfico */}
        {!mode && matchedMonitor && matchedMonitor.regs.length > 0 && (
          <div style={{ marginTop: 8 }}>
            {renderPriceHistoryChart(matchedMonitor.regs, matchedMonitor.alvo)}
          </div>
        )}

        {/* Painel Achar mais barato aberto */}
        {mode && (
          <div className="achar-box">
            <div className="achar-layout">
              <div>
                <h4 style={{ marginTop: 0 }}>
                  🔍 Achar mais barato —{' '}
                  {activeMode === 'passagens' ? 'Passagens aéreas' : 'Hospedagem'} em{' '}
                  {destClean || 'seu destino'}
                </h4>

                {/* 3 Sites de comparação em nova aba */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                  {currentLinks.map((lk) => (
                    <a
                      key={lk.nome}
                      href={lk.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="site-link"
                      onClick={() =>
                        setSiteInputs((prev) => ({ ...prev, [cfg.cardKey]: lk.nome }))
                      }
                    >
                      ↗ Abrir em {lk.nome}
                    </a>
                  ))}
                </div>

                {/* Legenda obrigatória #1 */}
                <p className="mut" style={{ marginTop: 8, marginBottom: 8 }}>
                  <b>O preço aparece no site e pode mudar. Volte e registre aqui o que achou.</b>
                </p>

                {/* #2 REGISTRAR O QUE ACHOU */}
                <div
                  style={{
                    background: 'var(--card)',
                    border: '1px solid var(--line)',
                    borderRadius: 10,
                    padding: 10,
                    marginTop: 8,
                  }}
                >
                  <div className="grid-form">
                    <label className="field-label">
                      Preço que achei (R$)
                      <input
                        type="number"
                        placeholder="Ex.: 1450"
                        value={priceInputs[cfg.cardKey] || ''}
                        onChange={(e) =>
                          setPriceInputs((prev) => ({
                            ...prev,
                            [cfg.cardKey]: e.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="field-label">
                      Site onde achou
                      <select
                        value={
                          siteInputs[cfg.cardKey] ||
                          (activeMode === 'passagens' ? 'Google Voos' : 'Google Hotéis')
                        }
                        onChange={(e) =>
                          setSiteInputs((prev) => ({
                            ...prev,
                            [cfg.cardKey]: e.target.value,
                          }))
                        }
                      >
                        <option value="Google Voos">Google Voos</option>
                        <option value="Google Hotéis">Google Hotéis</option>
                        <option value="Booking.com">Booking.com</option>
                        <option value="Decolar (BR)">Decolar (BR)</option>
                        <option value="Companhia / Hotel direto">Companhia / Hotel direto</option>
                        <option value="Outro site">Outro site</option>
                      </select>
                    </label>
                    <label className="field-label">
                      Preço-alvo (R$)
                      <input
                        type="number"
                        placeholder="Meta de preço"
                        value={
                          alvoInputs[cfg.cardKey] !== undefined
                            ? alvoInputs[cfg.cardKey]
                            : defaultAlvo || ''
                        }
                        onChange={(e) =>
                          setAlvoInputs((prev) => ({
                            ...prev,
                            [cfg.cardKey]: e.target.value,
                          }))
                        }
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    className="btn"
                    style={{ marginTop: 8, padding: '8px 14px', fontSize: '0.9rem' }}
                    onClick={async () => {
                      const v = Number(priceInputs[cfg.cardKey]);
                      if (!(v > 0)) return toast('Digite o preço que achou (R$).');
                      const site =
                        siteInputs[cfg.cardKey] ||
                        (activeMode === 'passagens' ? 'Google Voos' : 'Google Hotéis');
                      setPriceInputs((prev) => ({ ...prev, [cfg.cardKey]: '' }));
                      await recordPriceToMonitor({
                        existingMonitor: matchedMonitor,
                        monitorNome,
                        valor: v,
                        site,
                        dataViagem: baseDateIso,
                        dataRef: baseDateIso || undefined,
                        alvoSugerido: currentAlvoInput,
                        saida: saidaClean,
                        destino: destClean,
                        dias: diasNum,
                        adultos: adultosNum,
                        flexDias,
                      });
                    }}
                  >
                    Salvar no Monitor de preço
                  </button>

                  {/* Gráfico de linha simples + Alerta "Chegou no alvo!" */}
                  {matchedMonitor &&
                    matchedMonitor.regs.length > 0 &&
                    renderPriceHistoryChart(
                      matchedMonitor.regs,
                      currentAlvoInput || matchedMonitor.alvo
                    )}
                </div>

                {/* #3 DATAS FLEXÍVEIS (0 a 7 dias) */}
                <div
                  style={{
                    background: 'var(--card)',
                    border: '1px solid var(--line)',
                    borderRadius: 10,
                    padding: 10,
                    marginTop: 10,
                  }}
                >
                  <h4 style={{ marginTop: 0 }}>📅 Testar datas flexíveis</h4>
                  <div className="grid-form">
                    <label className="field-label">
                      Data original de ida
                      <input
                        type="date"
                        value={baseDateIso}
                        onChange={(e) =>
                          setBaseDateMap((prev) => ({
                            ...prev,
                            [cfg.cardKey]: e.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="field-label">
                      Posso mudar a data em até X dias (0 a 7)
                      <select
                        value={flexDias}
                        onChange={(e) => {
                          const n = Math.max(0, Math.min(7, Number(e.target.value) || 0));
                          setFlexDaysMap((prev) => ({ ...prev, [cfg.cardKey]: n }));
                        }}
                      >
                        {[0, 1, 2, 3, 4, 5, 6, 7].map((d) => (
                          <option key={d} value={d}>
                            {d === 0
                              ? '0 dias (só na data original)'
                              : `Até ${d} ${d === 1 ? 'dia' : 'dias'} para mais ou para menos`}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  {flexDias > 0 && !baseDateIso && (
                    <p className="mut" style={{ marginTop: 8 }}>
                      Escolha a <b>Data original de ida</b> acima para gerar os links de busca de
                      cada data possível (+/- {flexDias} {flexDias === 1 ? 'dia' : 'dias'}).
                    </p>
                  )}

                  {flexDias > 0 && baseDateIso && (
                    <div style={{ marginTop: 8 }}>
                      <p className="mut" style={{ marginBottom: 6 }}>
                        Abra as buscas das datas vizinhas e registre o menor preço que encontrar em
                        cada uma:
                      </p>
                      {flexDatesList.map((fd) => {
                        const linksForDate = buildComparisonLinks({
                          mode: activeMode,
                          saida: saidaClean,
                          destino: destClean,
                          dataIda: fd.iso,
                          dias: diasNum,
                          adultos: adultosNum,
                          criancasCount,
                        });
                        const fKey = `${cfg.cardKey}_${fd.iso}`;
                        const savedMin = getLowestForDate(fd.iso);
                        const labelOffset =
                          fd.offset === 0
                            ? 'Data original'
                            : fd.offset > 0
                            ? `+${fd.offset} ${fd.offset === 1 ? 'dia' : 'dias'}`
                            : `${fd.offset} ${fd.offset === -1 ? 'dia' : 'dias'}`;

                        return (
                          <div className="flex-date-row" key={fd.iso}>
                            <div style={{ minWidth: 165 }}>
                              <b>{fmtD(fd.iso)}</b>{' '}
                              <span className="tag" style={{ marginLeft: 4 }}>
                                {labelOffset}
                              </span>
                              {savedMin !== null && (
                                <div className="mut" style={{ fontSize: '0.78rem', marginTop: 2 }}>
                                  Menor registrado: <b>{fmtMoney(savedMin)}</b>
                                </div>
                              )}
                            </div>

                            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                              {linksForDate.map((lk) => (
                                <a
                                  key={lk.nome}
                                  href={lk.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="site-link"
                                  style={{ padding: '4px 8px', fontSize: '0.78rem' }}
                                  onClick={() =>
                                    setFlexSiteInputs((prev) => ({
                                      ...prev,
                                      [fKey]: lk.nome,
                                    }))
                                  }
                                >
                                  ↗ {lk.nome}
                                </a>
                              ))}
                            </div>

                            <div
                              style={{
                                display: 'flex',
                                gap: 6,
                                alignItems: 'center',
                                flexWrap: 'wrap',
                              }}
                            >
                              <input
                                type="number"
                                placeholder="Menor preço (R$)"
                                value={flexPriceInputs[fKey] || ''}
                                onChange={(e) =>
                                  setFlexPriceInputs((prev) => ({
                                    ...prev,
                                    [fKey]: e.target.value,
                                  }))
                                }
                                style={{ width: 145, margin: 0, padding: '6px 8px' }}
                                aria-label={`Menor preço para ${fmtD(fd.iso)}`}
                              />
                              <button
                                type="button"
                                className="btn sec"
                                style={{ margin: 0, padding: '6px 10px' }}
                                onClick={async () => {
                                  const v = Number(flexPriceInputs[fKey]);
                                  if (!(v > 0)) return toast('Informe o preço encontrado (R$).');
                                  const sName =
                                    flexSiteInputs[fKey] ||
                                    siteInputs[cfg.cardKey] ||
                                    (activeMode === 'passagens'
                                      ? 'Google Voos'
                                      : 'Google Hotéis');
                                  setFlexPriceInputs((prev) => ({ ...prev, [fKey]: '' }));
                                  await recordPriceToMonitor({
                                    existingMonitor: matchedMonitor,
                                    monitorNome,
                                    valor: v,
                                    site: sName,
                                    dataViagem: baseDateIso,
                                    dataRef: fd.iso,
                                    alvoSugerido: currentAlvoInput,
                                    saida: saidaClean,
                                    destino: destClean,
                                    dias: diasNum,
                                    adultos: adultosNum,
                                    flexDias,
                                  });
                                }}
                              >
                                Salvar
                              </button>
                            </div>
                          </div>
                        );
                      })}

                      {/* Resumo obrigatório #3 */}
                      {cheapestFlex && (
                        <div
                          style={{
                            marginTop: 10,
                            padding: '10px 12px',
                            borderRadius: 9,
                            background: 'rgba(11, 107, 116, 0.12)',
                            border: '1px solid var(--acc)',
                            fontSize: '0.9rem',
                          }}
                          role="status"
                        >
                          {originalDatePrice !== null ? (
                            cheapestFlex.minVal < originalDatePrice ? (
                              <>
                                💡{' '}
                                <b>
                                  A data mais barata que você achou foi {fmtD(cheapestFlex.iso)} (
                                  {fmtMoney(cheapestFlex.minVal)}) e economiza{' '}
                                  {fmtMoney(originalDatePrice - cheapestFlex.minVal)} em relação à
                                  data original.
                                </b>
                              </>
                            ) : (
                              <>
                                💡{' '}
                                <b>
                                  A data mais barata que você achou foi {fmtD(cheapestFlex.iso)} (
                                  {fmtMoney(cheapestFlex.minVal)}) e economiza R$ 0 em relação à
                                  data original (a data original já tem o menor valor registrado).
                                </b>
                              </>
                            )
                          ) : (
                            <>
                              💡{' '}
                              <b>
                                A data mais barata que você achou até agora foi{' '}
                                {fmtD(cheapestFlex.iso)} ({fmtMoney(cheapestFlex.minVal)}).
                              </b>{' '}
                              Registre também o preço da data original ({fmtD(baseDateIso)}) para
                              calcular a economia.
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* #4 DICAS DE COMO ECONOMIZAR ao lado de cada busca */}
              <aside className="achar-tips" aria-label="Dicas rápidas para economizar na busca">
                <h4 style={{ marginTop: 0 }}>💡 3 lembretes antes de fechar</h4>
                <ul style={{ paddingLeft: 18, margin: '6px 0 0' }}>
                  <li style={{ marginBottom: 6 }}>
                    <b>Comparar aeroportos próximos:</b> veja se voar por uma cidade vizinha sai
                    mais em conta.
                  </li>
                  <li style={{ marginBottom: 6 }}>
                    <b>Verificar bagagem e taxas inclusas:</b> confira se a tarifa inclui mala de
                    mão ou despachada e taxas finais.
                  </li>
                  <li>
                    <b>Ver se o hotel tem cancelamento gratuito:</b> garante um bom preço hoje e
                    permite trocar se achar opção mais barata depois.
                  </li>
                </ul>
              </aside>
            </div>
          </div>
        )}
      </div>
    );
  };

  // Mapa Handler
  const handleGerarMapa = async () => {
    const L = items.filter((i) => ['passeio', 'restaurante', 'hotel'].includes(i.tipo));
    const cid = mpCidade.trim() || activeViagem?.destino || '';
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

    if (
      user &&
      activeViagem &&
      activeViagem.id !== 'local_default' &&
      !activeViagem.id.startsWith('local_')
    ) {
      const vid = activeViagem.id;
      const path = `viagens/${vid}/checklist`;
      try {
        await addDoc(collection(db, 'viagens', vid, 'checklist'), {
          viagemId: vid,
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
    if (
      user &&
      activeViagem &&
      activeViagem.id !== 'local_default' &&
      !activeViagem.id.startsWith('local_')
    ) {
      const vid = activeViagem.id;
      const path = `viagens/${vid}/checklist/${id}`;
      try {
        await updateDoc(doc(db, 'viagens', vid, 'checklist', id), {
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
    if (
      user &&
      activeViagem &&
      activeViagem.id !== 'local_default' &&
      !activeViagem.id.startsWith('local_')
    ) {
      const vid = activeViagem.id;
      const path = `viagens/${vid}/checklist/${id}`;
      try {
        await deleteDoc(doc(db, 'viagens', vid, 'checklist', id));
      } catch (e) {
        toast('Sem permissão para apagar.');
        handleFirestoreError(e, OperationType.DELETE, path);
      }
    } else {
      setChecks((prev) => prev.filter((c) => c.id !== id));
    }
  };

  const handleGerarChecklist = async () => {
    const dest = kDest.trim() || activeViagem?.destino || '';
    if (!dest) return toast('Informe o destino.');
    if (kCri.trim()) {
      updateTripMeta({ idadesCriancas: kCri.trim() });
    }
    const p = `Você é planejador de viagens. Responda SOMENTE com JSON válido, sem markdown.
Gere um checklist de viagem para ${dest} (${kTipo}), época ${kEpoca.trim() || activeViagem?.dataInicio || 'não informada'}, crianças com idades: ${kCri.trim() || activeViagem?.idadesCriancas || 'nenhuma'}. Até 30 itens curtos e objetivos nas categorias Documentos, Bagagem, Saúde e vacinas, Criança (só se houver), Dinheiro e celular, Antes de sair. Inclua "Seguro viagem (comparar coberturas ou benefício do cartão)" em Documentos. Para vacinas e exigências de entrada, escreva "conferir exigência oficial" em vez de afirmar regras exatas.
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

    if (
      user &&
      activeViagem &&
      activeViagem.id !== 'local_default' &&
      !activeViagem.id.startsWith('local_')
    ) {
      const vid = activeViagem.id;
      const path = `viagens/${vid}/meta/pessoas`;
      try {
        const ref = doc(db, 'viagens', vid, 'meta', 'pessoas');
        const snap = await getDoc(ref);
        if (snap.exists()) {
          await updateDoc(ref, {
            nomes,
            updatedAt: serverTimestamp(),
          });
        } else {
          await setDoc(ref, {
            viagemId: vid,
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
    if (
      user &&
      activeViagem &&
      activeViagem.id !== 'local_default' &&
      !activeViagem.id.startsWith('local_')
    ) {
      const vid = activeViagem.id;
      const path = `viagens/${vid}/gastos`;
      try {
        await addDoc(collection(db, 'viagens', vid, 'gastos'), {
          viagemId: vid,
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
    if (
      user &&
      activeViagem &&
      activeViagem.id !== 'local_default' &&
      !activeViagem.id.startsWith('local_')
    ) {
      const vid = activeViagem.id;
      const path = `viagens/${vid}/gastos/${id}`;
      try {
        await deleteDoc(doc(db, 'viagens', vid, 'gastos', id));
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
Perfil: programas e saldo: ${mProg.trim() || 'não informado'}; cartões: ${mCart.trim() || 'não informado'}; viagem pretendida: ${mViag.trim() || activeViagem?.destino || 'não informada'}.
Monte uma estratégia prática para gastar menos e viajar bem. Não afirme regras, preços ou benefícios exatos de cartões e programas; diga o que conferir.
Formato: {"resumo":"","passos":[""],"como_juntar_milhas":[""],"sala_vip":[""],"alertas":[""]}`;

    const r = await askGemini<MilhasResult>(p, setMLoading, setMErr);
    if (r) setMResult(r);
  };

  // #3 CONVERSA COM O AGENTE (Floating Chat Handler)
  const handleSendChat = async () => {
    const pergunta = chatInput.trim();
    if (!pergunta || chatLoading) return;
    setChatInput('');
    setChatMsgs((prev) => [...prev, { role: 'user', texto: pergunta }]);

    const roteiroCtx = items
      .slice(0, 25)
      .map((i) => `${LBL[i.tipo] || i.tipo}: ${i.titulo} (R$ ${i.valor || 0}${i.data ? ', ' + fmtD(i.data) : ''})`)
      .join('; ');
    const gastosCtx = gastos
      .slice(0, 15)
      .map((g) => `${g.desc}: R$ ${g.valor} (pago por ${g.pagador})`)
      .join('; ');
    const criancasCtx =
      activeViagem?.idadesCriancas || fCriancas || wCriancas || kCri || 'não informadas';

    const p = `Você é o Agente de Viagem econômico do usuário, conversando em português do Brasil de forma simples, amigável e sem jargão técnico. Responda SOMENTE com JSON válido, sem markdown.
Contexto da viagem selecionada:
- Nome: ${activeViagem?.nome || 'Nossa Viagem'}
- Destino: ${activeViagem?.destino || 'ainda não definido'}
- Data aproximada: ${activeViagem?.dataInicio ? fmtD(activeViagem.dataInicio) : 'não definida'}
- Idades das crianças: ${criancasCtx}
- Moeda estrangeira: ${moedaAtiva ? `${moedaAtiva} (cotação R$ ${cotacaoAtiva})` : 'R$ (Real)'}
- Itens do roteiro (${items.length}): ${roteiroCtx || 'nenhum item ainda'}
- Gastos registrados (${gastos.length}): ${gastosCtx || 'nenhum gasto ainda'}

Regras obrigatórias:
1. Foco em economia: sugira alternativas mais baratas e práticas quando fizer sentido.
2. Nunca afirme preços exatos, regras de milhas/cartões, vacinas ou exigências de entrada em países como certos; diga sempre o que a pessoa deve conferir nos sites oficiais.
3. Formato JSON obrigatório: {"resposta":"","dicas_economia":[],"o_que_conferir":""}

Pergunta do viajante: ${pergunta}`;

    const dummyErr = () => {};
    const r = await askGemini<{
      resposta?: string;
      dicas_economia?: string[];
      o_que_conferir?: string;
    }>(p, setChatLoading, dummyErr);

    if (r && r.resposta) {
      setChatMsgs((prev) => [
        ...prev,
        {
          role: 'agent',
          texto: r.resposta || '',
          dicas: arr<string>(r.dicas_economia),
          conferir: r.o_que_conferir || '',
        },
      ]);
    } else {
      setChatMsgs((prev) => [
        ...prev,
        {
          role: 'agent',
          texto: 'Não consegui responder agora. Tente novamente em instantes.',
        },
      ]);
    }
  };

  // Export Summary Text & PDF
  const buildResumo = () => {
    const L = [
      `ROTEIRO DE VIAGEM — ${activeViagem?.nome || 'Nossa Viagem'}`,
      activeViagem?.destino ? `Destino: ${activeViagem.destino}` : '',
      activeViagem?.dataInicio ? `Data aproximada: ${fmtD(activeViagem.dataInicio)}` : '',
      '',
    ].filter((x, idx) => idx === 0 || idx === 3 || Boolean(x));

    const ag = items.filter((i) => i.data).sort((x, y) => (x.data < y.data ? -1 : 1));
    if (ag.length) {
      L.push('AGENDA');
      let last = '';
      ag.forEach((i) => {
        if (i.data !== last) {
          L.push(fmtD(i.data));
          last = i.data;
        }
        L.push(`- ${i.titulo}${i.valor ? ` (${fmtMoney(i.valor)})` : ''}`);
      });
      L.push('');
    }
    L.push('ITENS');
    items.forEach((i) =>
      L.push(
        `- [${LBL[i.tipo] || i.tipo}] ${i.titulo}${i.valor ? ` - ${fmtMoney(i.valor)}` : ''}${
          i.nota ? ` (${i.nota})` : ''
        }`
      )
    );
    L.push(
      '',
      `Total estimado: ${fmtMoney(items.reduce((s, i) => s + (Number(i.valor) || 0), 0))}`
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
                  {obj.faixa_diaria_brl ? ` · ~${fmtMoney(obj.faixa_diaria_brl)}/noite` : ''}
                </li>
              );
            }
            return <li key={idx}>{JSON.stringify(x)}</li>;
          })}
        </ul>
      </>
    );
  };

  // Calculations for Orçamento & Dashboard (#2 PAINEL NA TELA INICIAL)
  const antTotal = items
    .filter((i) => ['passagem', 'hotel', 'seguro'].includes(i.tipo))
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

  // Next payment deadline
  const unpaidWithDeadline = paidItemsList
    .filter((i) => !i.pago && i.prazo)
    .sort((a, b) => (a.prazo < b.prazo ? -1 : 1));
  const nextDeadlineItem = unpaidWithDeadline[0] || null;
  const nextDeadlineOverdue = Boolean(
    nextDeadlineItem && nextDeadlineItem.prazo < hojeIso
  );

  // Days until trip
  const computeDiasFaltam = () => {
    const dtStr = activeViagem?.dataInicio;
    if (!dtStr) return null;
    const target = new Date(dtStr + 'T00:00:00');
    if (Number.isNaN(target.getTime())) return null;
    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffDays = Math.round(
      (target.getTime() - todayMidnight.getTime()) / (1000 * 60 * 60 * 24)
    );
    return diffDays;
  };
  const diasFaltam = computeDiasFaltam();

  // Checklist progress
  const checksProntos = checks.filter((c) => c.feito).length;

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
      acc.push(`${dev[i][0]} paga ${fmtMoney(m)} a ${cred[j][0]}`);
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
    const cidRef = mpCidade.trim() || activeViagem?.destino || '';
    const q = (x: MapaPonto) => encodeURIComponent(`${x.titulo} ${cidRef}`);

    return (
      <div>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Mapa esquemático agrupando lugares por dia"
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
                  style={{ color: 'var(--acc)', fontWeight: 600, fontSize: '0.875rem' }}
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
      {/* Header with Accessibility, PWA Install, and Google Auth */}
      <header
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

        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* #6 ACESSIBILIDADE: Aumentar tamanho do texto */}
          <button
            className="btn sec"
            style={{ margin: 0, padding: '6px 10px' }}
            onClick={() => setFontScale((prev) => (prev + 1) % 3)}
            aria-label="Alternar tamanho do texto para facilitar a leitura"
            title="Aumentar ou diminuir tamanho da letra"
          >
            🔍 A+ Texto ({fontScale === 0 ? 'Normal' : fontScale === 1 ? 'Grande' : 'Extra'})
          </button>

          {/* #5 OFFLINE / PWA: Botão Instalar App */}
          {!isInstalled && deferredPrompt && (
            <button
              className="btn sec"
              style={{ margin: 0, padding: '6px 10px' }}
              onClick={handleInstallPwa}
              aria-label="Instalar aplicativo no aparelho"
            >
              📲 Instalar app
            </button>
          )}
          {!isInstalled && !deferredPrompt && isIOS && (
            <button
              className="btn sec"
              style={{ margin: 0, padding: '6px 10px' }}
              onClick={() => setShowIOSGuide((v) => !v)}
              aria-label="Como instalar no iPhone ou iPad"
            >
              📲 Instalar no iPhone
            </button>
          )}

          {/* Login Google */}
          {user ? (
            <button
              className="btn sec"
              style={{ margin: 0, padding: '6px 10px' }}
              onClick={() => logoutUser()}
              aria-label={`Sair da conta ${user.email}`}
            >
              Sair ({user.email?.split('@')[0]})
            </button>
          ) : (
            <button
              className="btn sec"
              style={{ margin: 0, padding: '6px 10px' }}
              onClick={handleGoogleLoginClick}
              aria-label="Entrar com conta do Google para compartilhar roteiro"
            >
              Entrar com Google
            </button>
          )}
        </div>
      </header>

      {/* #5 OFFLINE: Aviso de modo sem internet */}
      {!isOnline && (
        <div className="offline-banner" role="status" aria-live="polite">
          📡 <b>Você está sem internet (modo offline).</b> O roteiro, a agenda e o checklist estão
          salvos em cache para consulta. As alterações feitas offline serão enviadas quando a
          conexão voltar.
        </div>
      )}

      {/* Guia de instalação no iOS */}
      {showIOSGuide && (
        <div className="card" style={{ marginTop: 8 }}>
          <h4>Como instalar no iPhone / iPad</h4>
          <p className="mut">
            1. Toque no botão <b>Compartilhar</b> na barra do Safari.
            <br />
            2. Role para baixo e toque em <b>Adicionar à Tela de Início</b>.
          </p>
          <button
            className="btn sec"
            style={{ marginTop: 4 }}
            onClick={() => setShowIOSGuide(false)}
          >
            Fechar
          </button>
        </div>
      )}

      {/* Helper box when domain or provider needs authorization in Firebase Auth */}
      {(unauthorizedDomain || authErrorCode) && (
        <div className="card" style={{ borderLeft: '4px solid var(--acc2)', marginTop: 8 }}>
          <h4>
            Como liberar o login com Google neste endereço (
            {unauthorizedDomain || window.location.hostname})
          </h4>
          {authErrorCode && (
            <p className="mut" style={{ margin: '4px 0' }}>
              Motivo informado pelo Google/Firebase: <b>{authErrorCode}</b>
            </p>
          )}
          <ol className="mut" style={{ paddingLeft: 20, marginTop: 6 }}>
            <li>
              <b>Autorizar o domínio da Vercel:</b> Abra os{' '}
              <a
                href={`https://console.firebase.google.com/project/${firebaseProjectId}/authentication/settings`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--acc)', fontWeight: 600 }}
              >
                Domínios autorizados no Firebase
              </a>
              , clique em <b>Adicionar domínio</b> e cole:{' '}
              <b>{unauthorizedDomain || window.location.hostname}</b>{' '}
              <button
                className="btn sec"
                style={{ margin: '0 0 0 6px', padding: '2px 8px', fontSize: 12 }}
                onClick={() => {
                  navigator.clipboard.writeText(unauthorizedDomain || window.location.hostname);
                  toast('Domínio copiado!');
                }}
              >
                Copiar
              </button>
            </li>
            <li style={{ marginTop: 6 }}>
              <b>Verificar se o provedor Google está ativo:</b> Abra{' '}
              <a
                href={`https://console.firebase.google.com/project/${firebaseProjectId}/authentication/providers`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--acc)', fontWeight: 600 }}
              >
                Sign-in method (Provedores) no Firebase
              </a>
              , clique em <b>Google</b>, marque <b>Ativar (Enable)</b>, escolha seu e-mail de
              suporte e clique em <b>Salvar</b>.
            </li>
          </ol>
          <p className="mut" style={{ marginTop: 6 }}>
            Enquanto isso, você já pode usar todas as funções do app normalmente — seus dados ficam
            salvos neste aparelho.
          </p>
        </div>
      )}

      {/* Main Areas Bar */}
      <nav className="tabs" role="tablist" aria-label="Áreas principais do aplicativo">
        {(Object.keys(AREAS) as AreaKey[]).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={k === currentArea}
            className={k === currentArea ? 'on' : ''}
            onClick={() => go(AREAS[k].s[0][0])}
          >
            {AREAS[k].n}
          </button>
        ))}
      </nav>

      {/* Subtabs Bar */}
      {currentArea !== 'home' && (
        <nav className="tabs subtabs" role="tablist" aria-label="Subabas da seção atual">
          {AREAS[currentArea].s.map(([sKey, sLabel]) => (
            <button
              key={sKey}
              role="tab"
              aria-selected={sKey === sec}
              className={sKey === sec ? 'on' : ''}
              onClick={() => go(sKey)}
            >
              {sLabel}
            </button>
          ))}
        </nav>
      )}

      {/* Quick Trip Switcher Banner when not on Home */}
      {sec !== 'home' && viagens.length > 0 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            marginBottom: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <label htmlFor="top-trip-select" className="mut" style={{ fontWeight: 600 }}>
              Viagem ativa:
            </label>
            <select
              id="top-trip-select"
              value={activeViagem?.id || ''}
              onChange={(e) => setActiveViagemId(e.target.value)}
              style={{ width: 'auto', margin: 0, padding: '5px 10px', fontSize: '0.875rem' }}
            >
              {viagens.map((v) => (
                <option key={v.id} value={v.id}>
                  📋 {v.nome}
                  {v.destino ? ` (${v.destino})` : ''}
                </option>
              ))}
            </select>
          </div>
          {moedaAtiva && cotacaoAtiva > 0 && (
            <span className="tag" style={{ margin: 0 }}>
              Câmbio: 1 {moedaAtiva} = R$ {cotacaoAtiva.toFixed(2)}
            </span>
          )}
        </div>
      )}

      {/* Help Box */}
      {HELP[sec] && <div className="help">{HELP[sec]}</div>}

      {/* INÍCIO (#1 VÁRIAS VIAGENS & #2 PAINEL NA TELA INICIAL) */}
      {sec === 'home' && (
        <section>
          {/* #1 VÁRIAS VIAGENS: Seletor Minhas viagens + botão Nova viagem + convite por e-mail */}
          <div className="card">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 8,
              }}
            >
              <h3 style={{ margin: 0 }}>Minhas viagens</h3>
              <button
                className="btn sec"
                style={{ margin: 0 }}
                onClick={() => setShowNewTrip((v) => !v)}
              >
                {showNewTrip ? 'Cancelar' : '+ Nova viagem'}
              </button>
            </div>

            {viagens.length > 0 && (
              <div className="grid-form" style={{ marginTop: 10 }}>
                <label className="field-label">
                  Viagem selecionada
                  <select
                    value={activeViagem?.id || ''}
                    onChange={(e) => setActiveViagemId(e.target.value)}
                    aria-label="Selecionar viagem ativa"
                  >
                    {viagens.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.nome}
                        {v.destino ? ` — ${v.destino}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field-label">
                  Destino da viagem (opcional)
                  <input
                    value={activeViagem?.destino || ''}
                    onChange={(e) => updateTripMeta({ destino: e.target.value })}
                    placeholder="Ex.: Lisboa, Maceió…"
                  />
                </label>
                <label className="field-label">
                  Data aproximada da viagem
                  <input
                    type="date"
                    value={activeViagem?.dataInicio || ''}
                    onChange={(e) => updateTripMeta({ dataInicio: e.target.value })}
                  />
                </label>
              </div>
            )}

            {/* Formulário Nova viagem */}
            {showNewTrip && (
              <div
                style={{
                  marginTop: 12,
                  paddingTop: 12,
                  borderTop: '1px solid var(--line)',
                }}
              >
                <h4>Criar nova viagem</h4>
                <div className="grid-form">
                  <label className="field-label">
                    Nome da viagem *
                    <input
                      value={newTripName}
                      onChange={(e) => setNewTripName(e.target.value)}
                      placeholder="Ex.: Férias de Julho"
                    />
                  </label>
                  <label className="field-label">
                    Destino (opcional)
                    <input
                      value={newTripDestino}
                      onChange={(e) => setNewTripDestino(e.target.value)}
                      placeholder="Ex.: Gramado, Portugal…"
                    />
                  </label>
                  <label className="field-label">
                    Data aproximada (opcional)
                    <input
                      type="date"
                      value={newTripData}
                      onChange={(e) => setNewTripData(e.target.value)}
                    />
                  </label>
                </div>
                <button className="btn" onClick={handleCreateTrip}>
                  Salvar nova viagem
                </button>
              </div>
            )}

            {/* Convidar pessoa por e-mail */}
            {activeViagem && (
              <details className="adv" style={{ marginTop: 10 }}>
                <summary>
                  Compartilhar esta viagem ({activeViagem.membros.length}{' '}
                  {activeViagem.membros.length === 1 ? 'membro' : 'membros'})
                </summary>
                <div style={{ marginTop: 8 }}>
                  <p className="mut" style={{ marginBottom: 6 }}>
                    Quem faz parte: <b>{activeViagem.membros.join(', ')}</b>
                  </p>
                  {user ? (
                    activeViagem.criadorUid === user.uid ? (
                      <div
                        style={{
                          display: 'flex',
                          gap: 6,
                          flexWrap: 'wrap',
                          alignItems: 'center',
                        }}
                      >
                        <input
                          type="email"
                          value={inviteEmail}
                          onChange={(e) => setInviteEmail(e.target.value)}
                          placeholder="E-mail de quem vai planejar junto"
                          style={{ flex: 1, minWidth: 200, margin: 0 }}
                          aria-label="E-mail para convidar para a viagem"
                        />
                        <button
                          className="btn sec"
                          style={{ margin: 0 }}
                          onClick={handleInviteMember}
                        >
                          Convidar por e-mail
                        </button>
                      </div>
                    ) : (
                      <p className="mut">
                        Viagem criada por {activeViagem.criadorEmail}.
                      </p>
                    )
                  ) : (
                    <p className="mut">
                      Entre com o Google no topo para convidar outra pessoa pelo e-mail e editar em
                      tempo real.
                    </p>
                  )}
                </div>
              </details>
            )}
          </div>

          {/* #2 PAINEL NA TELA INICIAL: Resumo da viagem selecionada */}
          {activeViagem && (
            <div className="card" aria-label="Resumo da viagem selecionada">
              <h3>
                Resumo: {activeViagem.nome}
                {activeViagem.destino ? (
                  <span className="tag">{activeViagem.destino}</span>
                ) : null}
              </h3>

              <div className="cost">
                <div>
                  Quando
                  <b>
                    {diasFaltam === null
                      ? 'Sem data'
                      : diasFaltam > 0
                      ? `Faltam ${diasFaltam} dias`
                      : diasFaltam === 0
                      ? 'É hoje!'
                      : `Há ${Math.abs(diasFaltam)} dias`}
                  </b>
                </div>
                <div>
                  Total estimado<b>{fmtMoney(totOrc)}</b>
                </div>
                <div>
                  Já pago<b>{fmtMoney(pagoSum)}</b>
                </div>
                <div>
                  Falta pagar<b>{fmtMoney(faltaPagar)}</b>
                </div>
                <div>
                  Checklist
                  <b>
                    {checksProntos} de {checks.length} prontos
                  </b>
                </div>
              </div>

              <div className="mut" style={{ marginTop: 6 }}>
                Próximo prazo de pagamento:{' '}
                {nextDeadlineItem ? (
                  <span className={nextDeadlineOverdue ? 'err' : ''}>
                    <b>
                      {fmtD(nextDeadlineItem.prazo)} — {nextDeadlineItem.titulo} (
                      {fmtMoney(nextDeadlineItem.valor)})
                      {nextDeadlineOverdue ? ' · PRAZO VENCIDO!' : ''}
                    </b>
                  </span>
                ) : (
                  <b>Nenhum prazo pendente</b>
                )}
              </div>
            </div>
          )}

          {/* 3 Botões Grandes Originais */}
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
                {/* #4 CÂMBIO E SEGURO: Moeda e cotação em viagens internacionais */}
                <label className="field-label">
                  Moeda do destino (se internacional)
                  <input
                    value={activeViagem?.moeda || ''}
                    onChange={(e) => updateTripMeta({ moeda: e.target.value })}
                    placeholder="Ex.: USD, EUR, ARS"
                  />
                </label>
                <label className="field-label">
                  Cotação da moeda (R$)
                  <input
                    type="number"
                    step="0.01"
                    value={activeViagem?.cotacao || ''}
                    onChange={(e) => updateTripMeta({ cotacao: Number(e.target.value) || 0 })}
                    placeholder="Ex.: 5.80"
                  />
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
                      Passagens<b>{fmtMoney(c.passagens)}</b>
                    </div>
                    <div>
                      Hospedagem<b>{fmtMoney(c.hospedagem)}</b>
                    </div>
                    <div>
                      Alimentação<b>{fmtMoney(c.alimentacao)}</b>
                    </div>
                    <div>
                      Passeios<b>{fmtMoney(c.passeios)}</b>
                    </div>
                    <div>
                      Transporte<b>{fmtMoney(c.transporte_local)}</b>
                    </div>
                    {Boolean(c.seguro_viagem) && (
                      <div>
                        Seguro viagem<b>{fmtMoney(c.seguro_viagem)}</b>
                      </div>
                    )}
                    <div>
                      Total<b>{fmtMoney(c.total)}</b>
                    </div>
                  </div>

                  {Boolean(s.economia_estimada_brl) && (
                    <p>
                      <b>Economia possível: ~{fmtMoney(s.economia_estimada_brl)}</b>
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
                        Reserva para o destino: <b>{fmtMoney(s.reserva_destino_brl)}</b>.
                      </>
                    ) : null}
                  </p>

                  {renderLista('Roteiro', s.roteiro)}
                  {renderLista('Restaurantes', s.restaurantes)}
                  {renderLista('Passeios', s.passeios)}

                  {/* Achar mais barato (#1, #2, #3, #4) */}
                  {renderAcharMaisBarato({
                    cardKey: `ferias_${i}_${s.destino}`,
                    destino: s.destino,
                    saida: fSaida,
                    dataSugerida: activeViagem?.dataInicio || '',
                    dias: fDias,
                    adultos: fAdultos,
                    criancasStr: fCriancas,
                    alvoPassagens: Number(c.passagens) || 0,
                    alvoHoteis: Number(c.hospedagem) || 0,
                  })}

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
                  {s.distancia} · ~{fmtMoney(s.custo_estimado_brl)}
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

                {/* Achar mais barato (#1, #2, #3, #4) */}
                {renderAcharMaisBarato({
                  cardKey: `fds_${i}_${s.destino}`,
                  destino: s.destino,
                  saida: wSaida,
                  dataSugerida: activeViagem?.dataInicio || '',
                  dias: 2,
                  adultos: wPerfil === 'amigos' ? 3 : 2,
                  criancasStr: wCriancas,
                  alvoPassagens: Math.round((Number(s.custo_estimado_brl) || 0) * 0.4),
                  alvoHoteis: Math.round((Number(s.custo_estimado_brl) || 0) * 0.5),
                })}

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
                          Total<b>{fmtMoney(d.custo_total_brl)}</b>
                        </div>
                        <div>
                          Por dia<b>{fmtMoney(d.custo_por_dia_brl)}</b>
                        </div>
                        <div>
                          Nota<b>{d.nota_custo_beneficio}/10</b>
                        </div>
                      </div>
                      <div className="mut">
                        Passagens {fmtMoney(d.passagens)} · Hospedagem {fmtMoney(d.hospedagem)} ·
                        Alimentação e passeios {fmtMoney(d.alimentacao_passeios)}
                      </div>
                      {d.melhor_epoca_barata && (
                        <>
                          <h4>Época mais barata</h4>
                          <p>{d.melhor_epoca_barata}</p>
                        </>
                      )}
                      {renderLista('Vantagens', d.pros)}
                      {renderLista('Pontos de atenção', d.contras)}

                      {/* Achar mais barato (#1, #2, #3, #4) */}
                      {renderAcharMaisBarato({
                        cardKey: `comp_${idx}_${d.destino}`,
                        destino: d.destino,
                        saida: cSaida,
                        dataSugerida: activeViagem?.dataInicio || '',
                        dias: cDias,
                        adultos: 2,
                        alvoPassagens: Number(d.passagens) || 0,
                        alvoHoteis: Number(d.hospedagem) || 0,
                      })}
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
                  const ok = Boolean(m.alvo && ((last != null && last <= m.alvo) || (min != null && min <= m.alvo)));
                  const dv = last != null && first != null ? last - first : 0;

                  return (
                    <div className="row-item" key={m.id}>
                      <div style={{ flex: 1 }}>
                        <b>{m.nome}</b>
                        {m.data ? <span className="mut"> · {fmtD(m.data)}</span> : null}
                        {m.alvo ? <span className="tag">alvo {fmtMoney(m.alvo)}</span> : null}
                        <div>
                          {last == null ? (
                            <span className="mut">Sem registros ainda</span>
                          ) : (
                            <span>
                              {ok && <b style={{ color: 'var(--acc)' }}>Chegou no alvo! </b>}
                              Último: <b>{fmtMoney(last)}</b> · menor: {fmtMoney(min)}
                              {r.length > 1
                                ? ` · desde o primeiro registro: ${
                                    dv <= 0 ? 'caiu ' : 'subiu '
                                  }${fmtMoney(Math.abs(dv))}`
                                : ''}
                              {m.alvo && !ok
                                ? ` · faltam ${fmtMoney(last - m.alvo)} para o alvo`
                                : ''}
                            </span>
                          )}
                        </div>

                        {/* Registro rápido com valor e site */}
                        <div
                          style={{
                            display: 'flex',
                            gap: 6,
                            marginTop: 6,
                            flexWrap: 'wrap',
                            alignItems: 'center',
                          }}
                        >
                          <input
                            type="number"
                            placeholder="Preço que achei (R$)"
                            value={priceInputs[m.id] || ''}
                            onChange={(e) =>
                              setPriceInputs((prev) => ({ ...prev, [m.id]: e.target.value }))
                            }
                            style={{ margin: 0, maxWidth: 180 }}
                            aria-label={`Preço que achei para ${m.nome}`}
                          />
                          <select
                            value={siteInputs[m.id] || 'Google Voos / Hotéis'}
                            onChange={(e) =>
                              setSiteInputs((prev) => ({ ...prev, [m.id]: e.target.value }))
                            }
                            style={{ margin: 0, width: 'auto', minWidth: 165 }}
                            aria-label={`Site onde achou o preço para ${m.nome}`}
                          >
                            <option value="Google Voos / Hotéis">Google Voos / Hotéis</option>
                            <option value="Booking.com">Booking.com</option>
                            <option value="Decolar (BR)">Decolar (BR)</option>
                            <option value="Companhia / Hotel direto">Companhia / Hotel direto</option>
                            <option value="Outro site">Outro site</option>
                          </select>
                          <button
                            className="btn sec"
                            style={{ margin: 0 }}
                            onClick={() => handleRegisterPrice(m)}
                          >
                            Registrar
                          </button>
                        </div>

                        {/* Achar mais barato completo no Monitor de preço (#1, #2, #3, #4) */}
                        {renderAcharMaisBarato({
                          cardKey: `mon_${m.id}`,
                          destino: m.destino || activeViagem?.destino || m.nome,
                          saida: m.saida || dSaida || fSaida,
                          dataSugerida: m.data || activeViagem?.dataInicio || '',
                          dias: m.dias || dDias || 7,
                          adultos: m.adultos || fAdultos || 2,
                          alvoPassagens: m.alvo,
                          alvoHoteis: m.alvo,
                          existingMonitor: m,
                        })}
                      </div>
                      <button
                        className="x-btn"
                        aria-label="Apagar monitor"
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
                            aria-label={`Remover ${em}`}
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
                  onChange={(e) => setITipo(e.target.value as ItemTipo)}
                >
                  <option value="passagem">Passagem</option>
                  <option value="hotel">Hotel / resort</option>
                  <option value="seguro">Seguro viagem</option>
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
                        {i.valor ? <span className="mut">{fmtMoney(i.valor)}</span> : null}
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
                  <b>{fmtMoney(items.reduce((s, i) => s + (Number(i.valor) || 0), 0))}</b>
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
                        {i.valor ? <span className="mut"> · {fmtMoney(i.valor)}</span> : null}
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
                            style={{ margin: '0 6px 0 0', padding: '3px 10px', fontSize: '0.875rem' }}
                            onClick={() => handleVote(i)}
                            aria-label={`Curtir item ${i.titulo}, ${v.length} votos`}
                          >
                            👍 {v.length}
                          </button>
                          <button
                            className="btn sec"
                            style={{ margin: 0, padding: '3px 10px', fontSize: '0.875rem' }}
                            onClick={() =>
                              setOpenComments((prev) => ({ ...prev, [i.id]: !prev[i.id] }))
                            }
                            aria-label={`Comentários de ${i.titulo}, ${c.length} comentários`}
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
                        aria-label={`Apagar ${i.titulo}`}
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
                  placeholder={activeViagem?.destino || 'Ex.: Lisboa'}
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
                <input
                  value={kDest}
                  onChange={(e) => setKDest(e.target.value)}
                  placeholder={activeViagem?.destino || 'Seu destino'}
                />
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
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button className="btn" disabled={kLoading} onClick={handleGerarChecklist}>
                Gerar checklist
              </button>
              {/* #4 CÂMBIO E SEGURO: Seguro viagem como item sugerido no checklist */}
              <button
                className="btn sec"
                style={{ marginTop: 12, padding: '10px 14px' }}
                onClick={() => {
                  addCheckItem(
                    'Documentos',
                    'Seguro viagem (conferir cobertura médica ou emissão pelo cartão)'
                  );
                  toast('Seguro viagem adicionado ao checklist!');
                }}
              >
                + Incluir Seguro viagem
              </button>
            </div>
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
                                  fontSize: '0.95rem',
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
                                aria-label={`Apagar ${i.texto}`}
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

      {/* ORÇAMENTO (#4 CÂMBIO E SEGURO incluído) */}
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

            {/* #4 CÂMBIO E SEGURO: Moeda estrangeira e cotação */}
            <details className="adv" open={Boolean(moedaAtiva)}>
              <summary>Câmbio para viagem internacional (opcional)</summary>
              <div className="grid-form" style={{ marginTop: 8 }}>
                <label className="field-label">
                  Moeda do destino (ex.: USD, EUR, GBP)
                  <input
                    value={activeViagem?.moeda || ''}
                    onChange={(e) => updateTripMeta({ moeda: e.target.value })}
                    placeholder="Ex.: EUR"
                  />
                </label>
                <label className="field-label">
                  Cotação (1 moeda = quantos R$)
                  <input
                    type="number"
                    step="0.01"
                    value={activeViagem?.cotacao || ''}
                    onChange={(e) => updateTripMeta({ cotacao: Number(e.target.value) || 0 })}
                    placeholder="Ex.: 6.10"
                  />
                </label>
              </div>
            </details>

            <div className="cost">
              <div>
                Total estimado<b>{fmtMoney(totOrc)}</b>
              </div>
              <div>
                Pagar antes (passagem + hotel + seguro)<b>{fmtMoney(antTotal)}</b>
              </div>
              <div>
                Guardar para gastar lá<b>{fmtMoney(destTotal)}</b>
              </div>
            </div>

            <p>
              Guardando por mês:{' '}
              <span className="big">{fmtMoney(totOrc / Math.max(1, meses))}</span>
            </p>

            {maxB > 0 && (
              <p>
                {totOrc <= maxB ? (
                  <>
                    Dentro do limite, sobram <b>{fmtMoney(maxB - totOrc)}</b>.
                  </>
                ) : (
                  <>
                    <b className="err">Acima do limite em {fmtMoney(totOrc - maxB)}.</b> Revise
                    passagens e hospedagem, que pesam mais.
                  </>
                )}
              </p>
            )}

            <p className="mut">
              Dica geral: passagem, hospedagem e seguro viagem costumam ser pagos antes, e
              passagens/hotéis sobem perto da data — então vale quitar essas partes primeiro e
              juntar o restante em paralelo. Confira se há cancelamento gratuito e compare pagar em
              dinheiro com usar milhas. Valores são estimativas gerais, sem preços em tempo real.
              Confirme nos sites antes de comprar.
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
                    Já pago<b>{fmtMoney(pagoSum)}</b>
                  </div>
                  <div>
                    Falta pagar<b>{fmtMoney(faltaPagar)}</b>
                  </div>
                </div>
                <p>
                  Para quitar o que falta em {meses} meses:{' '}
                  <b>{fmtMoney(faltaPagar / Math.max(1, meses))}</b> por mês.
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
                            {i.titulo} · {fmtMoney(i.valor)}
                          </span>
                        </label>
                        {atrasado && <div className="err">Prazo vencido</div>}
                      </div>
                      <input
                        type="date"
                        aria-label={`Prazo de pagamento para ${i.titulo}`}
                        style={{ width: 155, margin: 0 }}
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
                    Total gasto: <b>{fmtMoney(tot)}</b>
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
                      {fmtMoney(Math.abs(saldo[n]))}
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
                          <b>{g.desc}</b> · {fmtMoney(g.valor)}
                          <div className="mut">
                            Pago por {g.pagador} · dividido entre{' '}
                            {arr<string>(g.dividir).join(', ') || 'todos'}
                          </div>
                        </div>
                        <button
                          className="x-btn"
                          aria-label={`Apagar gasto ${g.desc}`}
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

      {/* #3 CONVERSA COM O AGENTE: Botão flutuante e janela de chat */}
      <button
        className="chat-fab"
        onClick={() => setChatOpen((v) => !v)}
        aria-label="Perguntar ao agente de viagem"
        aria-expanded={chatOpen}
      >
        {chatOpen ? '✕ Fechar chat' : '💬 Perguntar ao agente'}
      </button>

      {chatOpen && (
        <aside className="chat-panel" role="dialog" aria-label="Conversa com o agente de viagem">
          <div
            style={{
              padding: '12px 14px',
              borderBottom: '1px solid var(--line)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: 'var(--bg)',
            }}
          >
            <div>
              <b style={{ fontSize: '0.95rem' }}>💬 Agente de Viagem</b>
              <div className="mut" style={{ fontSize: '0.75rem' }}>
                Viagem: {activeViagem?.nome || 'Nossa Viagem'}
              </div>
            </div>
            <button
              className="x-btn"
              onClick={() => setChatOpen(false)}
              aria-label="Fechar conversa"
            >
              ×
            </button>
          </div>

          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            {chatMsgs.map((m, idx) => (
              <div
                key={idx}
                style={{
                  alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '90%',
                  background: m.role === 'user' ? 'var(--acc)' : 'var(--bg)',
                  color: m.role === 'user' ? '#fff' : 'var(--ink)',
                  padding: '8px 12px',
                  borderRadius: 12,
                  fontSize: '0.875rem',
                }}
              >
                <div>{m.texto}</div>
                {m.dicas && m.dicas.length > 0 && (
                  <ul style={{ marginTop: 6, paddingLeft: 18 }}>
                    {m.dicas.map((d, di) => (
                      <li key={di}>{d}</li>
                    ))}
                  </ul>
                )}
                {m.conferir && (
                  <div
                    style={{
                      marginTop: 6,
                      fontSize: '0.78rem',
                      opacity: 0.9,
                      borderTop: '1px solid var(--line)',
                      paddingTop: 4,
                    }}
                  >
                    <b>O que conferir:</b> {m.conferir}
                  </div>
                )}
              </div>
            ))}
            {chatLoading && <div className="mut">O agente está pensando…</div>}
          </div>

          <div
            style={{
              padding: 10,
              borderTop: '1px solid var(--line)',
              display: 'flex',
              gap: 6,
            }}
          >
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSendChat();
              }}
              placeholder="Pergunte sobre roteiro, custos…"
              aria-label="Digite sua pergunta para o agente"
              style={{ margin: 0, flex: 1 }}
            />
            <button
              className="btn"
              style={{ margin: 0, padding: '8px 14px' }}
              disabled={chatLoading}
              onClick={handleSendChat}
            >
              Enviar
            </button>
          </div>
        </aside>
      )}

      {toastMsg && (
        <div className="toast-box" role="status" aria-live="polite">
          {toastMsg}
        </div>
      )}
    </div>
  );
}
