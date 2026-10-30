import express from 'express';

import type { OpenInEditorInput } from '@/modules/session-context/session-context-open.service.js';
import type { ReadSessionContextInput, SessionContext } from '@/modules/session-context/session-context.service.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

export type SessionContextRouteServices = {
  resolveProjectPath: (projectId: string) => string;
  read: (input: ReadSessionContextInput) => Promise<SessionContext>;
  openInEditor: (input: OpenInEditorInput) => Promise<void>;
};

function readRequiredProjectId(value: unknown): string {
  const projectId = readOptionalString(value);
  if (!projectId) {
    throw new AppError('project is required', { code: 'PROJECT_ID_REQUIRED', statusCode: 400 });
  }
  return projectId;
}

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
      const folderPath = services.resolveProjectPath(readRequiredProjectId(req.query.project));
      const result = await services.read({ folderPath, sessionId: readOptionalString(req.query.session) });
      res.json(createApiSuccessResponse(result));
    }),
  );

  router.post(
    '/open',
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const folderPath = services.resolveProjectPath(readRequiredProjectId(body.project));
      const targetPath = readOptionalString(body.path);
      if (!targetPath) {
        throw new AppError('path is required', { code: 'INVALID_REQUEST_BODY', statusCode: 400 });
      }
      await services.openInEditor({ folderPath, targetPath });
      res.json(createApiSuccessResponse({ opened: true }));
    }),
  );

  return router;
}
