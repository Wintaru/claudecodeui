import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express, { type ErrorRequestHandler, type RequestHandler } from 'express';

import { AppError } from '@/shared/utils.js';

import { createAuthRouter } from '../auth.routes.js';
import type { createAuthService } from '../auth.service.js';

type AuthService = ReturnType<typeof createAuthService>;

const rejectUnexpectedToken: RequestHandler = () => {
  throw new Error('Unexpected authenticated route');
};

const sendAppError: ErrorRequestHandler = (error, _request, response, _next) => {
  const statusCode = error instanceof AppError ? error.statusCode : 500;
  response.status(statusCode).json({ code: error instanceof AppError ? error.code : 'UNEXPECTED' });
};

function createFakeService(startLocalSession: AuthService['startLocalSession']): AuthService {
  const unexpected = (): never => {
    throw new Error('Unexpected Auth service call');
  };
  return {
    getStatus: unexpected,
    startLocalSession,
    register: unexpected,
    login: unexpected,
    getCurrentUser: unexpected,
    refreshSession: unexpected,
    logout: unexpected,
  };
}

type PostResult = { statusCode: number; body: unknown };

// node:http instead of fetch, because fetch does not let a test set Host.
function postLocalSession(port: number, headers: http.OutgoingHttpHeaders): Promise<PostResult> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: '127.0.0.1', port, method: 'POST', path: '/api/auth/local-session', headers },
      (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          text += chunk;
        });
        response.on('end', () => {
          const body: unknown = JSON.parse(text);
          resolve({ statusCode: response.statusCode ?? 0, body });
        });
      },
    );
    request.on('error', reject);
    request.end();
  });
}

async function withAuthServer(service: AuthService, run: (port: number) => Promise<void>): Promise<void> {
  const app = express();
  app.use('/api/auth', createAuthRouter(service, rejectUnexpectedToken));
  app.use(sendAppError);

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    await run((server.address() as AddressInfo).port);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

const signedInSession = async () => ({
  success: true,
  user: { id: 1, username: 'josh' },
  token: 'local-token',
});

test('local-session gives the CloudCLI page a token', async () => {
  await withAuthServer(createFakeService(signedInSession), async (port) => {
    const result = await postLocalSession(port, {
      host: `127.0.0.1:${port}`,
      origin: `http://127.0.0.1:${port}`,
    });

    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body, await signedInSession());
  });
});

test('local-session refuses a foreign page without asking the service', async () => {
  let serviceCalled = false;
  const service = createFakeService(async () => {
    serviceCalled = true;
    return signedInSession();
  });

  await withAuthServer(service, async (port) => {
    const foreignOrigin = await postLocalSession(port, {
      host: `127.0.0.1:${port}`,
      origin: 'https://example.com',
    });
    const rebound = await postLocalSession(port, {
      host: `rebind.example.com:${port}`,
      origin: `http://rebind.example.com:${port}`,
    });

    assert.deepEqual(foreignOrigin, { statusCode: 403, body: { code: 'AUTH_NOT_LOCAL_PAGE' } });
    assert.deepEqual(rebound, { statusCode: 403, body: { code: 'AUTH_NOT_LOCAL_PAGE' } });
    assert.equal(serviceCalled, false);
  });
});
