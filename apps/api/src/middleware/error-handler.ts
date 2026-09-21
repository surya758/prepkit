import type { ErrorRequestHandler, RequestHandler } from "express";
import { notFound, toHttpError } from "../errors";

/** Mounted after every route: whatever was not matched is a 404 in the same envelope as any other error. */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(notFound("ROUTE_NOT_FOUND", `No route for ${req.method} ${req.path}`));
};

export function createErrorHandler(log: (message: string, error: unknown) => void = console.error): ErrorRequestHandler {
  // Express recognises error middleware by its four parameters, so `_next` has to stay.
  return (error, req, res, _next) => {
    const { status, body, unexpected } = toHttpError(error);
    if (unexpected) log(`[api] unexpected error on ${req.method} ${req.path}`, error);

    // If the response has already started, the only safe thing left is to end the connection.
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.status(status).json(body);
  };
}
