#!/usr/bin/env node
// LOCAL DEMO ONLY. Synthetic OpenAI-compatible upstream for demonstrating
// DevGateway gateway traffic end-to-end WITHOUT real provider keys or real
// model calls. It never reaches any external network. Do not use in production.
import { createServer } from 'node:http';

const PORT = Number.parseInt(process.env.MOCK_OPENAI_PORT ?? '8081', 10);
const HOST = process.env.MOCK_OPENAI_HOST ?? '0.0.0.0';
const MODEL = 'gpt-4o-mini';

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function jsonResponse(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

function chatCompletion(prompt) {
  const reply = `Mock gateway reply: received ${prompt.length} chars. This is a synthetic local response (no real model was called).`;
  const promptTokens = Math.max(1, Math.ceil(prompt.length / 4));
  const completionTokens = Math.max(1, Math.ceil(reply.length / 4));
  return {
    id: `chatcmpl-mock-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: MODEL,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: reply },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  // Tolerate both "/v1/..." and "/..." so the demo works regardless of whether
  // the gateway appends a version prefix to the configured base_url.
  const path = url.pathname.replace(/^\/v1(?=\/|$)/, '');

  if (req.method === 'GET' && (path === '/health' || path === '/health/')) {
    return jsonResponse(res, 200, { status: 'ok', mock: true });
  }

  if (req.method === 'GET' && path === '/models') {
    return jsonResponse(res, 200, {
      object: 'list',
      data: [{ id: MODEL, object: 'model', created: 0, owned_by: 'devgateway-local-mock' }],
    });
  }

  if (req.method === 'POST' && path === '/chat/completions') {
    const raw = await readBody(req);
    let parsed = {};
    try {
      parsed = raw.length > 0 ? JSON.parse(raw) : {};
    } catch {
      return jsonResponse(res, 400, { error: { message: 'invalid JSON body', type: 'invalid_request_error' } });
    }
    const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
    const prompt = messages.map((m) => (typeof m?.content === 'string' ? m.content : '')).join('\n');

    if (parsed.stream === true) {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      const id = `chatcmpl-mock-${Date.now()}`;
      const created = Math.floor(Date.now() / 1000);
      for (const piece of ['Mock ', 'streamed ', 'gateway ', 'reply.']) {
        res.write(
          `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: MODEL, choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] })}\n\n`,
        );
      }
      res.write(
        `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: MODEL, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`,
      );
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    return jsonResponse(res, 200, chatCompletion(prompt));
  }

  return jsonResponse(res, 404, { error: { message: `mock has no route for ${req.method} ${url.pathname}`, type: 'invalid_request_error' } });
});

server.listen(PORT, HOST, () => {
  console.log(`[mock-openai] synthetic upstream listening at http://${HOST}:${PORT} (model=${MODEL})`);
});
