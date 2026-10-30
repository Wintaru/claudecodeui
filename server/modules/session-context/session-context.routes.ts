import express from 'express';

import type { ReadSessionContextInput, SessionContext } from '@/modules/session-context/session-context.service.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

export type SessionContextRouteServices = {
  resolveProjectPath: (projectId: string) => string;
  read: (input: ReadSessionContextInput) => Promise<SessionContext>;
};

function readOptionalString(value: unknown): string | null {
  const parsed = typeof value === 'string' ? value.trim() : '';
  return parsed || null;
}

/** Builds the router for the sidebar's context panel, mounted at `/api/session-context`. */
export function createSessionContextRouter(services: SessionContextRouteServices): express.Router {
  const router = express.Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const projectId = readOptionalString(req.query.project);
      if (!projectId) {
        throw new AppError('project is required', { code: 'PROJECT_ID_REQUIRED', statusCode: 400 });
      }
      const folderPath = services.resolveProjectPath(projectId);
      const result = await services.read({ folderPath, sessionId: readOptionalString(req.query.session) });
      res.json(createApiSuccessResponse(result));
    }),
  );

  return router;
}
