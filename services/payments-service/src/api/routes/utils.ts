import type { NextFunction, Request, Response } from "express";

export function asyncHandler(
  fn: (req: Request, res: Response) => Promise<void>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

export function hasWildcardScope(req: Request): boolean {
  return req.auth?.scopes.includes("*") === true;
}
