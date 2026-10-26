import { GoogleGenAI, ThinkingLevel } from '@google/genai';

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
