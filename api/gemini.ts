import crypto from 'node:crypto';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import firebaseConfig from '../firebase-applet-config.json';

interface ModelOption {
  model: string;
  thinkingConfig?: Record<string, unknown>;
}

const INTERNAL_MODELS: ModelOption[] = [
  { model: 'gemini-3.5-flash-lite', thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
  { model: 'gemini-3.5-flash', thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
  { model: 'gemini-3.6-flash', thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
  { model: 'gemini-3.8-flash', thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
];

const EXTERNAL_MODELS: ModelOption[] = [
  { model: 'gemini-2.5-flash-lite', thinkingConfig: { thinkingBudget: 0 } },
  { model: 'gemini-2.5-flash', thinkingConfig: { thinkingBudget: 0 } },
  { model: 'gemini-3.1-flash-lite-preview', thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
  { model: 'gemini-3-flash-preview', thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
  { model: 'gemini-flash-latest' },
  { model: 'gemini-3.5-flash-lite', thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
  { model: 'gemini-3.5-flash', thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
];

// Cache for Google's public X.509 certificates used to verify Firebase ID tokens
const GOOGLE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
let cachedCerts: Record<string, string> | null = null;
let cachedCertsExpiresAt = 0;

async function getGooglePublicCerts(): Promise<Record<string, string>> {
  const now = Date.now();
  if (cachedCerts && now < cachedCertsExpiresAt) {
    return cachedCerts;
  }
  const res = await fetch(GOOGLE_CERTS_URL);
  if (!res.ok) {
    throw new Error('Failed to fetch Firebase public certificates');
  }
  const certs = (await res.json()) as Record<string, string>;
  const cacheControl = res.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
  const ttlMs = maxAgeMatch ? Number(maxAgeMatch[1]) * 1000 : 3600 * 1000;
  cachedCerts = certs;
  cachedCertsExpiresAt = now + ttlMs;
  return certs;
}

function base64UrlToBuffer(b64u: string): Buffer {
  const b64 = b64u.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  return Buffer.from(b64 + pad, 'base64');
}

async function verifyFirebaseIdToken(idToken: string): Promise<{ uid: string; email?: string }> {
  const parts = idToken.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed JWT');
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  const header = JSON.parse(base64UrlToBuffer(headerB64).toString('utf8')) as {
    alg?: string;
    kid?: string;
  };
  const payload = JSON.parse(base64UrlToBuffer(payloadB64).toString('utf8')) as {
    iss?: string;
    aud?: string;
    exp?: number;
    iat?: number;
    sub?: string;
    email?: string;
  };

  if (header.alg !== 'RS256' || !header.kid) {
    throw new Error('Invalid token header');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp <= nowSec) {
    throw new Error('Token expired');
  }
  if (!payload.iat || payload.iat > nowSec + 300) {
    throw new Error('Invalid token issued-at time');
  }
  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new Error('Invalid token subject');
  }

  const expectedProjectId = process.env.FIREBASE_PROJECT_ID || firebaseConfig.projectId;
  if (expectedProjectId && payload.aud !== expectedProjectId) {
    throw new Error('Token audience mismatch');
  }
  if (payload.iss !== `https://securetoken.google.com/${payload.aud}`) {
    throw new Error('Token issuer mismatch');
  }

  const certs = await getGooglePublicCerts();
  const cert = certs[header.kid];
  if (!cert) {
    throw new Error('Unknown signing key ID');
  }

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();

  const signatureValid = verifier.verify(cert, base64UrlToBuffer(signatureB64));
  if (!signatureValid) {
    throw new Error('Invalid token signature');
  }

  return { uid: payload.sub, email: payload.email };
}

// Per-user rate limit: max 30 requests per hour
const RATE_LIMIT_MAX_PER_HOUR = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const userRequestTimestamps = new Map<string, number[]>();

function checkUserRateLimit(uid: string): boolean {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const history = (userRequestTimestamps.get(uid) || []).filter((ts) => ts > cutoff);
  if (history.length >= RATE_LIMIT_MAX_PER_HOUR) {
    userRequestTimestamps.set(uid, history);
    return false;
  }
  history.push(now);
  userRequestTimestamps.set(uid, history);
  return true;
}

function extractJson(raw: string) {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    }
    throw new Error('Invalid JSON response from model');
  }
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não permitido' });
    return;
  }

  // 1. Verify Firebase ID Token in Authorization header
  const authHeader = String(req.headers?.authorization || req.headers?.Authorization || '');
  if (!authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Não autorizado. Faça login com o Google.' });
    return;
  }

  const idToken = authHeader.slice('Bearer '.length).trim();
  if (!idToken) {
    res.status(401).json({ error: 'Token de autenticação ausente.' });
    return;
  }

  let verifiedUser: { uid: string; email?: string };
  try {
    verifiedUser = await verifyFirebaseIdToken(idToken);
  } catch (err) {
    console.warn('Invalid Firebase ID token:', err instanceof Error ? err.message : err);
    res.status(401).json({ error: 'Sessão inválida ou expirada. Faça login novamente.' });
    return;
  }

  // 2. Enforce simple per-user rate limit (30 requests / hour)
  if (!checkUserRateLimit(verifiedUser.uid)) {
    res.status(429).json({
      error: 'Limite de 30 solicitações por hora atingido. Tente novamente mais tarde.',
    });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const { prompt } = body;

    if (!prompt || typeof prompt !== 'string') {
      res.status(400).json({ error: 'Prompt inválido' });
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    if (!apiKey) {
      console.error('Missing GEMINI_API_KEY environment variable');
      res.status(500).json({
        error: 'Chave GEMINI_API_KEY não configurada nas variáveis de ambiente do servidor.',
      });
      return;
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const isExternalKey = apiKey.startsWith('AIza');
    const modelsToTry = isExternalKey ? EXTERNAL_MODELS : INTERNAL_MODELS;

    let lastError: unknown = null;

    for (const { model, thinkingConfig } of modelsToTry) {
      try {
        const config: Record<string, unknown> = {
          responseMimeType: 'application/json',
        };
        if (thinkingConfig) {
          config.thinkingConfig = thinkingConfig;
        }

        const response = await ai.models.generateContent({
          model,
          contents: prompt,
          config,
        });

        const text = response.text;
        if (!text) {
          throw new Error('Resposta vazia da IA');
        }

        const parsed = extractJson(text);
        res.status(200).json(parsed);
        return;
      } catch (err) {
        lastError = err;
        console.warn(
          `Model ${model} failed, trying next fallback...`,
          err instanceof Error ? err.message : err
        );
      }
    }

    console.error('All Gemini models failed:', lastError);
    res.status(500).json({
      error: 'Não consegui gerar agora. Tente de novo em instantes.',
    });
  } catch (error) {
    console.error('Gemini API Error:', error);
    res.status(500).json({
      error: 'Não consegui gerar agora. Tente de novo em instantes.',
    });
  }
}
