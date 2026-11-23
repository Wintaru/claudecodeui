import assert from 'node:assert/strict';

import { act, cleanup, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { AuthProvider, useAuth } from '@/modules/auth/context/AuthContext';
import '@/modules/i18n';
import { AUTH_SESSION_EXPIRED_EVENT } from '@/shared/authToken';

/**
 * With LOCAL_AUTO_SIGN_IN on, the server signs in pages that this computer
 * serves. The app must ask it for a token instead of showing the sign-in form,
 * and an expired token must be replaced without showing that form.
 */

const makeToken = (label: string) => {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = { userId: 1, username: 'josh', iat: issuedAt, exp: issuedAt + 7 * 86400 };
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.${label}`;
};

let requestedPaths: string[] = [];
let isAutoSignInOn = true;
let isLocalSessionAvailable = true;
let localSessionToken = makeToken('first');

const stubServer = () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    requestedPaths.push(url);
    const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

    if (url === '/api/auth/status') {
      return respond(200, { needsSetup: false, autoSignIn: isAutoSignInOn });
    }
    if (url === '/api/auth/local-session') {
      return isLocalSessionAvailable
        ? respond(200, { success: true, token: localSessionToken, user: { id: 1, username: 'josh' } })
        : respond(403, { error: { code: 'AUTH_NOT_LOCAL_PAGE', message: 'refused' } });
    }
    if (url === '/api/user/onboarding-status') {
      return respond(200, { hasCompletedOnboarding: true });
    }
    return respond(200, {});
  }));
};

let workspaceMounts = 0;
let seenToken: string | null = null;

function Workspace() {
  useEffect(() => {
    workspaceMounts += 1;
  }, []);
  return <div>workspace</div>;
}

function Gate() {
  const { isLoading, user, token } = useAuth();
  useEffect(() => {
    seenToken = token;
  }, [token]);
  if (isLoading) {
    return <div>loading</div>;
  }
  return user ? <Workspace /> : <div>login</div>;
}

const renderApp = () => render(
  <AuthProvider>
    <Gate />
  </AuthProvider>,
);

beforeEach(() => {
  localStorage.clear();
  requestedPaths = [];
  isAutoSignInOn = true;
  isLocalSessionAvailable = true;
  localSessionToken = makeToken('first');
  workspaceMounts = 0;
  seenToken = null;
  stubServer();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('with automatic sign-in on, the workspace opens without the sign-in form', async () => {
  renderApp();

  await screen.findByText('workspace');
  assert.ok(requestedPaths.includes('/api/auth/local-session'));
  assert.equal(localStorage.getItem('auth-token'), localSessionToken);
  assert.equal(seenToken, localSessionToken);
});

test('with automatic sign-in off, the sign-in form shows and no local session is asked for', async () => {
  isAutoSignInOn = false;

  renderApp();

  await screen.findByText('login');
  assert.equal(requestedPaths.includes('/api/auth/local-session'), false);
});

test('an expired session is replaced without unmounting the workspace', async () => {
  renderApp();
  await screen.findByText('workspace');

  localSessionToken = makeToken('second');
  await act(async () => {
    window.dispatchEvent(new Event(AUTH_SESSION_EXPIRED_EVENT));
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  assert.equal(seenToken, localSessionToken);
  assert.equal(workspaceMounts, 1);
  assert.ok(screen.getByText('workspace'));
});

test('requests that expire together share one new local session', async () => {
  renderApp();
  await screen.findByText('workspace');
  const localSessionCalls = () => requestedPaths.filter((path) => path === '/api/auth/local-session').length;
  const callsAfterStart = localSessionCalls();

  await act(async () => {
    window.dispatchEvent(new Event(AUTH_SESSION_EXPIRED_EVENT));
    window.dispatchEvent(new Event(AUTH_SESSION_EXPIRED_EVENT));
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  assert.equal(localSessionCalls() - callsAfterStart, 1);
  assert.equal(requestedPaths.filter((path) => path === '/api/user/onboarding-status').length, 1);
});

test('when the server refuses automatic sign-in, the sign-in form shows', async () => {
  isLocalSessionAvailable = false;

  renderApp();

  await screen.findByText('login');
});
