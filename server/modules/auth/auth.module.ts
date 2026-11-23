import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import os from 'node:os';

import { getConnection, userDb } from '@/modules/database/index.js';
import { SERVER_BIND_HOST } from '@/shared/utils.js';

import { isLoopbackHost } from '../../../shared/networkHosts.js';

import { authenticateToken, generateToken } from './auth.middleware.js';
import { createAuthRouter } from './auth.routes.js';
import { createAuthService, type AutoSignInSetting } from './auth.service.js';

type BcryptAdapter = {
  hash(password: string, saltRounds: number): Promise<string>;
  compare(password: string, passwordHash: string): Promise<boolean>;
};

// bcrypt does not ship TypeScript declarations in this project, so the
// composition root narrows its CommonJS runtime surface before injecting it.
const require = createRequire(import.meta.url);
const bcrypt = require('bcrypt') as BcryptAdapter;
const databaseConnection = getConnection();

const LOCAL_ACCOUNT_FALLBACK_USERNAME = 'local';

function readLocalUsername(): string {
  try {
    return os.userInfo().username || LOCAL_ACCOUNT_FALLBACK_USERNAME;
  } catch {
    return LOCAL_ACCOUNT_FALLBACK_USERNAME;
  }
}

// Automatic sign-in trusts requests that reach a loopback address, so it is
// refused unless the server listens on this computer only.
function readAutoSignInSetting(): AutoSignInSetting {
  if (process.env.LOCAL_AUTO_SIGN_IN !== 'true') {
    return { enabled: false };
  }
  if (!isLoopbackHost(SERVER_BIND_HOST)) {
    console.warn('[WARN] LOCAL_AUTO_SIGN_IN is ignored: HOST must be 127.0.0.1, ::1 or localhost.');
    return { enabled: false };
  }
  return {
    enabled: true,
    defaultUsername: readLocalUsername(),
    createUnusablePassword: () => randomBytes(32).toString('base64url'),
  };
}

const authService = createAuthService({
  users: {
    hasUsers: () => userDb.hasUsers(),
    createUser: (username, passwordHash) => userDb.createUser(username, passwordHash),
    getUserByUsername: (username) => userDb.getUserByUsername(username),
    getFirstUser: () => userDb.getFirstUser(),
    updateLastLogin: (userId) => userDb.updateLastLogin(userId),
  },
  autoSignIn: readAutoSignInSetting(),
  transaction: {
    begin: () => databaseConnection.prepare('BEGIN').run(),
    commit: () => databaseConnection.prepare('COMMIT').run(),
    rollback: () => databaseConnection.prepare('ROLLBACK').run(),
  },
  hashPassword: (password) => bcrypt.hash(password, 12),
  comparePassword: (password, passwordHash) => bcrypt.compare(password, passwordHash),
  generateToken,
});

/** Auth router assembled for the server entrypoint. */
export const authRoutes = createAuthRouter(authService, authenticateToken);
