import { Request, Response, NextFunction } from "express";

export const notFoundMiddleware = (
  req: Request,
  res: Response,
  _next: NextFunction,
) => {
  res.status(404).json({
    message: `Route ${req.originalUrl} not found`,
  });
};
