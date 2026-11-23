import assert from 'node:assert/strict';
import test from 'node:test';

import { AppError } from '@/shared/utils.js';

import { createAuthService } from '../auth.service.js';

type AuthDependencies = Parameters<typeof createAuthService>[0];

function createDependencies(overrides: Partial<AuthDependencies> = {}): AuthDependencies {
  return {
    users: {
      hasUsers: () => false,
      createUser: (username, passwordHash) => ({ id: 1, username, password_hash: passwordHash }),
      getUserByUsername: () => undefined,
      getFirstUser: () => undefined,
      updateLastLogin: () => undefined,
    },
    autoSignIn: { enabled: false },
    transaction: {
      begin: () => undefined,
      commit: () => undefined,
      rollback: () => undefined,
    },
    hashPassword: async () => 'hashed-password',
    comparePassword: async () => false,
    generateToken: () => 'signed-token',
    ...overrides,
  };
}

test('register hashes credentials and commits through injected dependencies', async () => {
  const operations: string[] = [];
  const service = createAuthService(createDependencies({
    transaction: {
      begin: () => operations.push('begin'),
      commit: () => operations.push('commit'),
      rollback: () => operations.push('rollback'),
    },
    hashPassword: async (password) => {
      operations.push(`hash:${password}`);
      return 'hash';
    },
    users: {
      hasUsers: () => false,
      createUser: (username, passwordHash) => {
        operations.push(`create:${username}:${passwordHash}`);
        return { id: 1, username, password_hash: passwordHash };
      },
      getUserByUsername: () => undefined,
      getFirstUser: () => undefined,
      updateLastLogin: (userId) => operations.push(`login:${userId}`),
    },
  }));

  const result = await service.register('alice', 'secret12');

  assert.equal(result.token, 'signed-token');
  assert.deepEqual(operations, ['begin', 'hash:secret12', 'create:alice:hash', 'commit', 'login:1']);
});

test('login rejects an invalid password without issuing a token', async () => {
  let tokenIssued = false;
  const service = createAuthService(createDependencies({
    users: {
      hasUsers: () => true,
      createUser: () => { throw new Error('unused'); },
      getUserByUsername: () => ({ id: 1, username: 'alice', password_hash: 'hash' }),
      getFirstUser: () => ({ id: 1, username: 'alice' }),
      updateLastLogin: () => undefined,
    },
    comparePassword: async () => false,
    generateToken: () => {
      tokenIssued = true;
      return 'token';
    },
  }));

  await assert.rejects(
    service.login('alice', 'wrong-password'),
    (error: unknown) => error instanceof AppError && error.code === 'AUTH_INVALID_CREDENTIALS',
  );
  assert.equal(tokenIssued, false);
});

test('refreshSession issues a replacement token for the authenticated user', () => {
  let tokenUser: { id: number | bigint; username: string } | undefined;
  const service = createAuthService(createDependencies({
    generateToken: (user) => {
      tokenUser = user;
      return 'replacement-token';
    },
  }));

  const result = service.refreshSession({ id: 7, username: 'alice' });

  assert.deepEqual(result, { token: 'replacement-token' });
  assert.deepEqual(tokenUser, { id: 7, username: 'alice' });
});

const ENABLED_AUTO_SIGN_IN: AuthDependencies['autoSignIn'] = {
  enabled: true,
  defaultUsername: 'josh',
  createUnusablePassword: () => 'random-password',
};

test('status reports automatic sign-in and never asks for setup while it is on', () => {
  const service = createAuthService(createDependencies({ autoSignIn: ENABLED_AUTO_SIGN_IN }));

  assert.deepEqual(service.getStatus(), { needsSetup: false, isAuthenticated: false, autoSignIn: true });
});

test('startLocalSession is refused while automatic sign-in is off', async () => {
  const service = createAuthService(createDependencies());

  await assert.rejects(
    service.startLocalSession(),
    (error: unknown) => error instanceof AppError && error.code === 'AUTH_AUTO_SIGN_IN_DISABLED',
  );
});

test('startLocalSession signs in the existing account without creating one', async () => {
  const operations: string[] = [];
  const service = createAuthService(createDependencies({
    autoSignIn: ENABLED_AUTO_SIGN_IN,
    users: {
      hasUsers: () => true,
      createUser: () => { throw new Error('unused'); },
      getUserByUsername: () => undefined,
      getFirstUser: () => ({ id: 4, username: 'alice' }),
      updateLastLogin: (userId) => operations.push(`login:${userId}`),
    },
    generateToken: (user) => `token-for-${user.username}`,
  }));

  const result = await service.startLocalSession();

  assert.deepEqual(result, { success: true, user: { id: 4, username: 'alice' }, token: 'token-for-alice' });
  assert.deepEqual(operations, ['login:4']);
});

test('startLocalSession creates the local account with an unusable password when none exists', async () => {
  const operations: string[] = [];
  const service = createAuthService(createDependencies({
    autoSignIn: ENABLED_AUTO_SIGN_IN,
    users: {
      hasUsers: () => false,
      createUser: (username, passwordHash) => {
        operations.push(`create:${username}:${passwordHash}`);
        return { id: 1, username };
      },
      getUserByUsername: () => undefined,
      getFirstUser: () => undefined,
      updateLastLogin: (userId) => operations.push(`login:${userId}`),
    },
    hashPassword: async (password) => {
      operations.push(`hash:${password}`);
      return 'hash';
    },
  }));

  const result = await service.startLocalSession();

  assert.equal(result.user.username, 'josh');
  assert.deepEqual(operations, ['hash:random-password', 'create:josh:hash', 'login:1']);
});
