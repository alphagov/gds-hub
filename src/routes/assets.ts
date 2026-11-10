import path from "node:path";
import express, { Router, type RequestHandler } from "express";
import { GOVUK_FRONTEND_DIST, PUBLIC_DIR } from "../paths.js";
import { ASSET_PATHS } from "../site-map.js";

const GOVUK_DIR = path.join(GOVUK_FRONTEND_DIST, "govuk");

function sendFrom(root: string, file: string): RequestHandler {
  return (_req, res, next) => {
    res.sendFile(file, { root }, (err) => {
      if (err) next(err);
    });
  };
}

/**
 * Static files: GOV.UK Frontend's precompiled CSS and JS, its fonts, images and
 * manifest, and our own files in public/. Only these are served, not the rest
 * of the govuk-frontend package.
 */
export function assetsRouter(): Router {
  const router = Router();
  const options = { index: false, redirect: false } as const;

  router.get(ASSET_PATHS.stylesheet, sendFrom(GOVUK_DIR, "govuk-frontend.min.css"));
  router.get(ASSET_PATHS.frontendScript, sendFrom(GOVUK_DIR, "govuk-frontend.min.js"));
  router.use(ASSET_PATHS.assets, express.static(path.join(GOVUK_DIR, "assets"), options));
  router.use(express.static(PUBLIC_DIR, options));

  return router;
}
