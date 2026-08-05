/**
 * Tiny HTTP client built on Node's built-in http(s) modules — no external deps.
 *
 * Copied from services/_connector-template/src/http.ts
 */

import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import { logger } from './logger';

export interface HttpRequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  timeoutMs: number;
  json?: boolean;
}

export interface HttpResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  text: string;
  data?: unknown;
}

export class HttpError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string, message?: string) {
    super(message || `HTTP ${status}: ${body.slice(0, 200)}`);
    this.status = status;
    this.body = body;
  }
}

export async function request(opts: HttpRequestOptions): Promise<HttpResponse> {
  const url = new URL(opts.url);
  const lib = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        method: opts.method,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        headers: opts.headers || {},
        timeout: opts.timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const out: HttpResponse = {
            status: res.statusCode || 0,
            headers: res.headers,
            text,
          };
          if (opts.json) {
            try {
              out.data = text ? JSON.parse(text) : undefined;
            } catch {
              // leave data undefined
            }
          }
          if (out.status >= 400) {
            reject(new HttpError(out.status, text));
          } else {
            resolve(out);
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error(`Request timed out after ${opts.timeoutMs}ms`));
    });
    req.on('error', (err) => reject(err));

    if (opts.body != null) {
      req.write(opts.body);
    }
    req.end();
  });
}

export async function getJson(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<unknown> {
  logger.debug('HTTP GET', { url });
  const res = await request({ method: 'GET', url, headers, timeoutMs, json: true });
  return res.data;
}

export async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<unknown> {
  const payload = JSON.stringify(body);
  logger.debug('HTTP POST', { url, bytes: payload.length });
  const res = await request({
    method: 'POST',
    url,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: payload,
    timeoutMs,
    json: true,
  });
  return res.data;
}

export async function postRaw(
  url: string,
  body: string | Buffer,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<unknown> {
  logger.debug('HTTP POST raw', { url, bytes: body.length });
  const res = await request({
    method: 'POST',
    url,
    headers,
    body,
    timeoutMs,
    json: true,
  });
  return res.data;
}
