/**
 * HCT Library AI Agent — Cloudflare Worker API Backend
 * ======================================================
 * Deploy this to Cloudflare Workers. Set the following secrets:
 *   wrangler secret put ANTHROPIC_API_KEY
 *   wrangler secret put PINECONE_API_KEY
 *   wrangler secret put PINECONE_INDEX_HOST   (your Pinecone index host URL)
 *   wrangler secret put SUPABASE_URL          (for analytics logging)
 *   wrangler secret put SUPABASE_ANON_KEY     (for analytics logging)
 *
 * Deploy: wrangler deploy
 * Test:   curl -X POST https://hct-library-api.mmyousef.workers.dev/chat \
 *           -H "Content-Type: application/json" \
 *           -d '{"query":"What are library hours?","session_id":"test123"}'
 */

// ── CORS HEADERS ──────────────────────────────────────────────────────────────
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',           // Lock down to your domain in production:
  // 'Access-Control-Allow-Origin': 'https://library.hct.ac.ae',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

// ── SYSTEM PROMPT ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are the HCT Library AI Reference Assistant, an intelligent assistant for the Higher Colleges of Technology (HCT) Library.

Your purpose: Help HCT students, faculty, and staff with library-related enquiries including:
- Finding and accessing library databases and electronic resources
- Citation and referencing guidance (APA 7th edition)
- Research strategy and information literacy
- Library policies, borrowing, and services
- Study spaces, equipment, and facilities
- Thesis and dissertation research support
- Events and workshops

Guidelines:
1. Be helpful, accurate, and concise.
2. ALWAYS base your answers on the provided context documents. If the context does not contain the answer, say so clearly and direct the user to the Reference Desk.
3. Do NOT fabricate information. If unsure, acknowledge uncertainty.
4. Maintain a professional, friendly, and inclusive tone appropriate for an academic library.
5. When relevant, recommend specific databases or resources by name.
6. Keep responses under 300 words unless the question genuinely requires more detail.
7. Format responses clearly using line breaks and bullet points where helpful.
8. Never discuss topics outside library services — politely decline and redirect.

Institution: Higher Colleges of Technology, UAE
Library contact: library@hct.ac.ae
Library website: https://library.hct.ac.ae
Operating hours: Sunday–Thursday 8:00 AM – 9:00 PM`;

// ── CONTENT MODERATION ────────────────────────────────────────────────────────
const MODERATION_PATTERNS = [
  {
    pattern: /\b(porn|xxx|adult\s?content|explicit\s?material|sexual\s?content)\b/i,
    template: 'general'
  },
  {
    pattern: /\b(how\s?to\s?kill|suicide\s?method|self[\s-]harm\s?way|harm\s?myself)\b/i,
    template: 'sensitive'
  },
  {
    pattern: /\b(write\s+my\s+(essay|assignment|report|thesis)|do\s+my\s+homework|complete\s+my\s+assignment)\b/i,
    template: 'academic'
  },
  {
    pattern: /\b(how\s?to\s?hack|pirate\s?software|crack\s?license|illegal)\b/i,
    template: 'general'
  },
];

const REFUSAL_TEMPLATES = {
  general: "Thank you for your message.\n\nYour query falls outside the scope of services provided by the HCT Library AI Agent. This assistant is designed to support academic research, library resource discovery, and institutional information.\n\nFor assistance:\n• Reference Desk: library@hct.ac.ae\n• Library website: https://library.hct.ac.ae\n• Operating hours: Sunday–Thursday 8:00 AM – 9:00 PM",
  sensitive: "Thank you for your message.\n\nThe HCT Library AI Agent is unable to respond to this type of query. If you are experiencing personal difficulties, HCT provides confidential support through Student Affairs and Counselling Services.\n\nFor academic assistance: library@hct.ac.ae\nHCT Student Services: studentservices@hct.ac.ae",
  academic: "Thank you for your message.\n\nThe HCT Library AI Agent is not able to write, complete, or assist with academic work intended for submission as your own work.\n\nI can help you:\n• Find academic sources and databases\n• Understand APA 7th edition citation\n• Access writing guides and academic integrity resources\n\nPlease ask a new question about library resources.",
};

function checkModeration(text) {
  for (const { pattern, template } of MODERATION_PATTERNS) {
    if (pattern.test(text)) {
      return { blocked: true, template, response: REFUSAL_TEMPLATES[template] };
    }
  }
  return { blocked: false };
}

// ── EMBEDDING (Anthropic) ──────────────────────────────────────────────────────
async function getEmbedding(text, apiKey) {
  // Using OpenAI-compatible embedding (replace with Anthropic embeddings when available)
  // For now using a simple hash-based mock — replace with real embedding API call
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text,
    }),
  });
  const data = await response.json();
  return data.data[0].embedding;
}

// ── VECTOR SEARCH (Pinecone) ───────────────────────────────────────────────────
async function retrieveChunks(queryEmbedding, pineconeHost, pineconeKey, topK = 5) {
  const response = await fetch(`${pineconeHost}/query`, {
    method: 'POST',
    headers: {
      'Api-Key': pineconeKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      vector: queryEmbedding,
      topK,
      includeMetadata: true,
    }),
  });
  const data = await response.json();
  return (data.matches || []).map(m => ({
    text: m.metadata?.text || '',
    source: m.metadata?.source || 'Library Document',
    score: m.score,
  }));
}

// ── LLM CALL (Claude) ──────────────────────────────────────────────────────────
async function callClaude(query, chunks, apiKey) {
  const contextText = chunks.length > 0
    ? chunks.map((c, i) => `[Source ${i+1}: ${c.source}]\n${c.text}`).join('\n\n---\n\n')
    : 'No specific documents retrieved. Please use your general knowledge of library services.';

  const userMessage = `Context from HCT Library documents:\n\n${contextText}\n\n---\n\nUser question: ${query}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.content[0].text;
}

// ── ANALYTICS LOGGING (Supabase) ──────────────────────────────────────────────
async function logInteraction(payload, supabaseUrl, supabaseKey) {
  if (!supabaseUrl || !supabaseKey) return;
  try {
    await fetch(`${supabaseUrl}/rest/v1/conversations`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        session_id: payload.sessionId,
        query: payload.query,
        response: payload.response,
        sources: payload.sources,
        model_used: payload.model,
        latency_ms: payload.latency,
        blocked: payload.blocked,
        block_category: payload.blockCategory || null,
        created_at: new Date().toISOString(),
      }),
    });
  } catch (e) {
    console.error('Logging failed:', e.message);
  }
}

// ── RATE LIMITER (KV-based) ────────────────────────────────────────────────────
async function checkRateLimit(sessionId, kv) {
  if (!kv) return false; // Skip if KV not configured
  const key = `rl:${sessionId}`;
  const count = parseInt(await kv.get(key) || '0');
  if (count >= 20) return true; // 20 queries per hour limit
  await kv.put(key, String(count + 1), { expirationTtl: 3600 });
  return false;
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const start = Date.now();

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Health check endpoint
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', version: '1.0.0' }), {
        headers: CORS_HEADERS
      });
    }

    // Only handle POST to /chat
    if (request.method !== 'POST' || url.pathname !== '/chat') {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404, headers: CORS_HEADERS
      });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
        status: 400, headers: CORS_HEADERS
      });
    }

    const { query, session_id } = body;

    if (!query || typeof query !== 'string') {
      return new Response(JSON.stringify({ error: 'query is required' }), {
        status: 400, headers: CORS_HEADERS
      });
    }

    if (query.length > 500) {
      return new Response(JSON.stringify({ error: 'Query exceeds 500 character limit' }), {
        status: 400, headers: CORS_HEADERS
      });
    }

    const sessionId = session_id || 'anonymous';

    // Rate limiting
    const rateLimited = await checkRateLimit(sessionId, env.RATE_LIMIT_KV);
    if (rateLimited) {
      return new Response(JSON.stringify({
        error: 'Rate limit exceeded. Maximum 20 queries per hour per session.'
      }), { status: 429, headers: CORS_HEADERS });
    }

    // Layer 1: Content moderation
    const modResult = checkModeration(query);
    if (modResult.blocked) {
      await logInteraction({
        sessionId, query,
        response: modResult.response,
        sources: [],
        model: 'moderation-filter',
        latency: Date.now() - start,
        blocked: true,
        blockCategory: modResult.template,
      }, env.SUPABASE_URL, env.SUPABASE_ANON_KEY);

      return new Response(JSON.stringify({
        response: modResult.response,
        sources: [],
        blocked: true,
      }), { headers: CORS_HEADERS });
    }

    try {
      // Get query embedding
      const embedding = await getEmbedding(
        query,
        env.OPENAI_API_KEY || env.ANTHROPIC_API_KEY // Use whichever is configured
      );

      // Retrieve relevant chunks from Pinecone
      let chunks = [];
      if (env.PINECONE_INDEX_HOST && env.PINECONE_API_KEY) {
        chunks = await retrieveChunks(
          embedding,
          env.PINECONE_INDEX_HOST,
          env.PINECONE_API_KEY
        );
      }

      // Generate response with Claude
      const responseText = await callClaude(query, chunks, env.ANTHROPIC_API_KEY);

      const sources = [...new Set(chunks.map(c => c.source))];
      const latency = Date.now() - start;

      // Log interaction
      await logInteraction({
        sessionId, query,
        response: responseText,
        sources,
        model: 'claude-haiku-4-5-20251001',
        latency,
        blocked: false,
      }, env.SUPABASE_URL, env.SUPABASE_ANON_KEY);

      return new Response(JSON.stringify({
        response: responseText,
        sources,
        latency_ms: latency,
      }), { headers: CORS_HEADERS });

    } catch (error) {
      console.error('Worker error:', error);
      return new Response(JSON.stringify({
        response: 'I\'m experiencing technical difficulties. Please contact the library directly at library@hct.ac.ae or visit https://library.hct.ac.ae',
        sources: [],
        error: true,
      }), { headers: CORS_HEADERS });
    }
  }
};
