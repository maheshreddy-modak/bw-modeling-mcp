#!/usr/bin/env node
/**
 * HTTP entry point — self-hosted (Docker, a VM), no SAP BTP.
 *
 * Streamable HTTP on `/mcp` against the single BW system configured the same way as stdio
 * (BW_URL, BW_USER / BW_PASSWORD or BW_COOKIE_FILE, BW_CLIENT). Every caller shares that
 * one BW identity.
 *
 * Callers authenticate with a static bearer token (BW_MCP_HTTP_TOKEN). It is mandatory:
 * an open MCP server in front of BW hands anyone who reaches the port that user's access.
 * BW_MCP_HTTP_SCOPES (e.g. `read`) narrows the tools offered, using the same scopes as the
 * BTP transport; unset, every tool is offered, as on stdio.
 *
 * For multi-user hosting with per-user identity, use http.ts on BTP Cloud Foundry.
 */
import { timingSafeEqual } from 'node:crypto';
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { createServer } from './index.js';
import { createClientFromEnv } from './bw-client.js';
import { ensurePlatform } from './platform.js';
import { SCOPES, type Scope } from './scopes.js';

function tokenMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 8080);
  const host = process.env.HOST ?? '0.0.0.0';

  const token = process.env.BW_MCP_HTTP_TOKEN;
  if (!token || token.length < 16) {
    throw new Error('BW_MCP_HTTP_TOKEN is required (at least 16 characters) — callers send it as "Authorization: Bearer <token>".');
  }

  const scopes = (process.env.BW_MCP_HTTP_SCOPES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const unknown = scopes.filter((s) => !SCOPES.includes(s as Scope));
  if (unknown.length) {
    throw new Error(`BW_MCP_HTTP_SCOPES has unknown scope(s): ${unknown.join(', ')}. Allowed: ${SCOPES.join(', ')}.`);
  }
  // No authInfo means "no scope filter", exactly as on stdio.
  const authInfo: AuthInfo | undefined = scopes.length ? { token: 'local', clientId: 'local', scopes } : undefined;

  // Fail at startup, not on the first request, when the credentials are missing.
  const client = createClientFromEnv();
  try {
    const profile = await ensurePlatform(client);
    process.stderr.write(`[bw-modeling-mcp] Platform: ${profile.detail}\n`);
  } catch (err) {
    process.stderr.write(`[bw-modeling-mcp] Warning: platform detection skipped (${err})\n`);
  }

  const app = express();
  app.use(express.json({ limit: '4mb' }));

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', transport: 'http-streamable', mode: 'self-hosted' });
  });

  app.all('/mcp', async (req, res) => {
    const header = req.headers.authorization ?? '';
    const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    if (!tokenMatches(presented, token)) {
      res.status(401).set('WWW-Authenticate', 'Bearer').json({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Missing or invalid bearer token.' },
        id: null,
      });
      return;
    }

    // Stateless, as in http.ts: the SDK binds a Server to one transport for its lifetime.
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    if (authInfo) (req as unknown as { auth?: AuthInfo }).auth = authInfo;
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.listen(port, host, () => {
    process.stderr.write(
      `bw-modeling-mcp listening on ${host}:${port}/mcp — ${process.env.BW_URL}` +
        `${scopes.length ? ` (scopes: ${scopes.join(', ')})` : ' (all tools)'}\n`,
    );
  });
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err}\n`);
  process.exit(1);
});
