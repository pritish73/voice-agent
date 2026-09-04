import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

export const runtime = 'nodejs';

export async function POST() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY is not configured.' }, { status: 500 });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const token = await ai.authTokens.create({
      config: {
        uses: 1,
        newSessionExpireTime: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      },
    });

    return NextResponse.json({ token: token.name });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not create Gemini realtime token.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
