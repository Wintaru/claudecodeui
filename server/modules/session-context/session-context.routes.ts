import express from 'express';

import type { OpenInEditorInput } from '@/modules/session-context/session-context-open.service.js';
import type { PullRequestReview, ReadPullRequestReviewInput } from '@/modules/session-context/session-context-review.service.js';
import type { ReadSessionContextInput, SessionContext } from '@/modules/session-context/session-context.service.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

export type SessionContextRouteServices = {
  resolveProjectPath: (projectId: string) => string;
  read: (input: ReadSessionContextInput) => Promise<SessionContext>;
  openInEditor: (input: OpenInEditorInput) => Promise<void>;
  readReview: (input: ReadPullRequestReviewInput) => Promise<PullRequestReview>;
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

function readPullRequestNumber(value: unknown): number {
  const text = readOptionalString(value) ?? '';
  if (!/^[1-9]\d{0,8}$/.test(text)) {
    throw new AppError('pr must be a pull request number', { code: 'INVALID_PULL_REQUEST_NUMBER', statusCode: 400 });
  }
  return Number(text);
}

/** Builds the router for the chat panes' context panels, mounted at `/api/session-context`. */
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

  router.get(
    '/review',
    asyncHandler(async (req, res) => {
      const folderPath = services.resolveProjectPath(readRequiredProjectId(req.query.project));
      const result = await services.readReview({ folderPath, pullRequestNumber: readPullRequestNumber(req.query.pr) });
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
