/**
 * Health check HTTP server for orchestrator monitoring.
 *
 * Exposes three JSON endpoints over Node's built-in `http` module (no
 * framework dependency needed for three small routes):
 *
 *   GET /health/live     - liveness probe. Always 200 while the process is
 *                           responding to requests. Use this for
 *                           container/orchestrator restart decisions.
 *
 *   GET /health/ready     - readiness probe. 200 if the bot can currently
 *                           reach the configured Stellar RPC endpoint,
 *                           503 otherwise. Use this to gate traffic /
 *                           mark the pod "not ready".
 *
 *   GET /health/metrics    - basic operational metrics as JSON: last
 *                           settlement time, pending pool count, error
 *                           count, and poll-loop status.
 *
 * The port is configurable via HEALTH_CHECK_PORT (default 3000). The whole
 * server can be disabled via HEALTH_CHECK_ENABLED=false.
 */

import http from "node:http";
import type { Poller } from "./poller.js";
import { logger } from "./logger.js";

function sendJson(res: http.ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

export class HealthServer {
  private readonly poller: Poller;
  private readonly port: number;
  private server: http.Server | null = null;
  private _boundPort: number | null = null;

  constructor(poller: Poller, port: number) {
    this.poller = poller;
    this.port = port;
  }

  /** The port actually bound after start() resolves (useful when port 0 was requested). */
  get boundPort(): number | null {
    return this._boundPort;
  }

  /**
   * Starts listening on the configured port. Resolves once the server is
   * bound, or rejects if binding fails (e.g. port already in use).
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        void this.handleRequest(req, res);
      });

      this.server.once("error", (err) => {
        logger.error("Health check server failed to start", {
          port: this.port,
          error: String(err),
        });
        reject(err);
      });

      this.server.listen(this.port, () => {
        const address = this.server?.address();
        this._boundPort = typeof address === "object" && address ? address.port : this.port;
        logger.info("Health check server listening", { port: this._boundPort });
        resolve();
      });
    });
  }

  /**
   * Stops the server, allowing in-flight requests to finish. Resolves once
   * fully closed.
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => {
        logger.info("Health check server stopped");
        resolve();
      });
    });
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const url = new URL(req.url ?? "/", `http://localhost:${this.port}`);

    try {
      switch (url.pathname) {
        case "/health/live":
          sendJson(res, 200, { status: "ok" });
          return;

        case "/health/ready": {
          const health = await this.poller.checkReadiness();
          if (health.healthy) {
            sendJson(res, 200, {
              status: "ok",
              rpc: { connected: true, latestLedger: health.latestLedger },
            });
          } else {
            sendJson(res, 503, {
              status: "unavailable",
              rpc: { connected: false, error: health.error },
            });
          }
          return;
        }

        case "/health/metrics":
          sendJson(res, 200, this.poller.getMetrics());
          return;

        default:
          sendJson(res, 404, { status: "not_found" });
          return;
      }
    } catch (err) {
      logger.error("Health check request failed", {
        path: url.pathname,
        error: String(err),
      });
      sendJson(res, 500, { status: "error", error: String(err) });
    }
  }
}
