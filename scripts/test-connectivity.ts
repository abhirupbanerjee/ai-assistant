#!/usr/bin/env npx tsx

/**
 * API Connectivity Test Script
 * Tests connections to OpenAI, Azure AD, and Google OAuth endpoints
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env.local manually
function loadEnv() {
  try {
    const envPath = resolve(process.cwd(), '.env.local');
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          process.env[key.trim()] = valueParts.join('=').trim();
        }
      }
    }
  } catch {
    console.log('Note: Could not load .env.local');
  }
}

loadEnv();

interface TestResult {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  message: string;
}

const results: TestResult[] = [];

async function testOpenAI(): Promise<TestResult> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return { name: 'OpenAI API', status: 'skip', message: 'OPENAI_API_KEY not configured' };
  }

  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (response.ok) {
      const data = await response.json();
      const modelCount = data.data?.length || 0;
      return { name: 'OpenAI API', status: 'pass', message: `Connected successfully. ${modelCount} models available.` };
    } else {
      const error = await response.json();
      return { name: 'OpenAI API', status: 'fail', message: `HTTP ${response.status}: ${error.error?.message || 'Unknown error'}` };
    }
  } catch (error) {
    return { name: 'OpenAI API', status: 'fail', message: `Connection error: ${error instanceof Error ? error.message : 'Unknown error'}` };
  }
}

async function testAzureAD(): Promise<TestResult> {
  const clientId = process.env.AZURE_AD_CLIENT_ID;
  const tenantId = process.env.AZURE_AD_TENANT_ID || 'common';

  if (!clientId) {
    return { name: 'Azure AD', status: 'skip', message: 'AZURE_AD_CLIENT_ID not configured' };
  }

  try {
    // Test the OpenID configuration endpoint
    const response = await fetch(
      `https://login.microsoftonline.com/${tenantId}/v2.0/.well-known/openid-configuration`
    );

    if (response.ok) {
      const config = await response.json();
      return {
        name: 'Azure AD',
        status: 'pass',
        message: `OpenID endpoint reachable. Issuer: ${config.issuer}`
      };
    } else {
      return { name: 'Azure AD', status: 'fail', message: `HTTP ${response.status}: Could not reach OpenID configuration` };
    }
  } catch (error) {
    return { name: 'Azure AD', status: 'fail', message: `Connection error: ${error instanceof Error ? error.message : 'Unknown error'}` };
  }
}

async function testGoogleOAuth(): Promise<TestResult> {
  const clientId = process.env.GOOGLE_CLIENT_ID;

  if (!clientId) {
    return { name: 'Google OAuth', status: 'skip', message: 'GOOGLE_CLIENT_ID not configured' };
  }

  try {
    // Test the OpenID configuration endpoint
    const response = await fetch('https://accounts.google.com/.well-known/openid-configuration');

    if (response.ok) {
      const config = await response.json();
      return {
        name: 'Google OAuth',
        status: 'pass',
        message: `OpenID endpoint reachable. Issuer: ${config.issuer}`
      };
    } else {
      return { name: 'Google OAuth', status: 'fail', message: `HTTP ${response.status}: Could not reach OpenID configuration` };
    }
  } catch (error) {
    return { name: 'Google OAuth', status: 'fail', message: `Connection error: ${error instanceof Error ? error.message : 'Unknown error'}` };
  }
}

async function testChromaDB(): Promise<TestResult> {
  const host = process.env.CHROMA_HOST || 'localhost';
  const port = process.env.CHROMA_PORT || '8000';

  try {
    const response = await fetch(`http://${host}:${port}/api/v1/heartbeat`);

    if (response.ok) {
      const data = await response.json();
      return {
        name: 'ChromaDB',
        status: 'pass',
        message: `Connected. Heartbeat: ${JSON.stringify(data)}`
      };
    } else {
      return { name: 'ChromaDB', status: 'fail', message: `HTTP ${response.status}` };
    }
  } catch (error) {
    return { name: 'ChromaDB', status: 'fail', message: `Connection error: ${error instanceof Error ? error.message : 'Unknown error'}` };
  }
}

async function testRedis(): Promise<TestResult> {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

  try {
    // Simple TCP connection test
    const url = new URL(redisUrl);
    const host = url.hostname;
    const port = parseInt(url.port) || 6379;

    const net = await import('net');

    return new Promise((resolve) => {
      const socket = net.createConnection({ host, port }, () => {
        socket.write('PING\r\n');
      });

      socket.on('data', (data) => {
        const response = data.toString().trim();
        socket.end();
        if (response.includes('PONG')) {
          resolve({ name: 'Redis', status: 'pass', message: `Connected to ${host}:${port}. PING -> PONG` });
        } else {
          resolve({ name: 'Redis', status: 'pass', message: `Connected to ${host}:${port}. Response: ${response}` });
        }
      });

      socket.on('error', (error) => {
        resolve({ name: 'Redis', status: 'fail', message: `Connection error: ${error.message}` });
      });

      socket.setTimeout(5000, () => {
        socket.destroy();
        resolve({ name: 'Redis', status: 'fail', message: 'Connection timeout' });
      });
    });
  } catch (error) {
    return { name: 'Redis', status: 'fail', message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` };
  }
}

async function main() {
  console.log('\n========================================');
  console.log('  AI Assistant - API Connectivity Tests');
  console.log('========================================\n');

  // Configuration Summary
  console.log('Configuration Summary:');
  console.log('─────────────────────────────────────────');
  console.log(`  OpenAI API Key:    ${process.env.OPENAI_API_KEY ? '✓ Configured' : '✗ Not set'}`);
  console.log(`  Azure AD Client:   ${process.env.AZURE_AD_CLIENT_ID ? '✓ Configured' : '✗ Not set'}`);
  console.log(`  Azure AD Tenant:   ${process.env.AZURE_AD_TENANT_ID || 'common'}`);
  console.log(`  Google Client ID:  ${process.env.GOOGLE_CLIENT_ID ? '✓ Configured' : '✗ Not set'}`);
  console.log(`  ChromaDB:          ${process.env.CHROMA_HOST || 'localhost'}:${process.env.CHROMA_PORT || '8000'}`);
  console.log(`  Redis:             ${process.env.REDIS_URL || 'redis://localhost:6379'}`);
  console.log(`  Auth Disabled:     ${process.env.AUTH_DISABLED === 'true' ? 'Yes' : 'No'}`);
  console.log(`  Access Mode:       ${process.env.ACCESS_MODE || 'allowlist'}`);
  console.log('');

  // Run tests
  console.log('Running Connectivity Tests:');
  console.log('─────────────────────────────────────────');

  const tests = [
    testOpenAI(),
    testAzureAD(),
    testGoogleOAuth(),
    testChromaDB(),
    testRedis(),
  ];

  const results = await Promise.all(tests);

  for (const result of results) {
    const icon = result.status === 'pass' ? '✓' : result.status === 'fail' ? '✗' : '○';
    const color = result.status === 'pass' ? '\x1b[32m' : result.status === 'fail' ? '\x1b[31m' : '\x1b[33m';
    console.log(`  ${color}${icon}\x1b[0m ${result.name}`);
    console.log(`    ${result.message}`);
  }

  console.log('');

  // Summary
  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const skipped = results.filter(r => r.status === 'skip').length;

  console.log('Summary:');
  console.log('─────────────────────────────────────────');
  console.log(`  \x1b[32m${passed} passed\x1b[0m, \x1b[31m${failed} failed\x1b[0m, \x1b[33m${skipped} skipped\x1b[0m`);
  console.log('');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(console.error);
