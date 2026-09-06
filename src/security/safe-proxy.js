import { createServer, request as httpRequest } from 'node:http';
import { connect as connectSocket } from 'node:net';
import {
  UnsafeNetworkTargetError,
  resolvePublicTarget,
} from './url-safety.js';

const PROXY_TIMEOUT_MS = 30_000;

function responseStatus(error) {
  return error instanceof UnsafeNetworkTargetError ? 403 : 502;
}

function endHttp(response, error) {
  const status = responseStatus(error);
  response.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'close',
  });
  response.end(status === 403 ? 'Blocked by network safety policy' : 'Upstream connection failed');
}

function endTunnel(socket, error) {
  const status = responseStatus(error);
  const label = status === 403 ? 'Forbidden' : 'Bad Gateway';
  socket.end(`HTTP/1.1 ${status} ${label}\r\nConnection: close\r\n\r\n`);
}

function forwardHeaders(headers, host) {
  const forwarded = { ...headers, host };
  delete forwarded['proxy-authorization'];
  delete forwarded['proxy-connection'];
  return forwarded;
}

export async function startSafeBrowsingProxy({ lookup } = {}) {
  const sockets = new Set();
  const resolutionOptions = lookup ? { lookup } : undefined;

  const server = createServer(async (request, response) => {
    try {
      const target = await resolvePublicTarget(request.url, resolutionOptions);
      const parsed = new URL(target.url);
      if (parsed.protocol !== 'http:') {
        throw new UnsafeNetworkTargetError('HTTPS requests must use a CONNECT tunnel');
      }

      const upstream = httpRequest({
        hostname: target.address,
        family: target.family,
        port: 80,
        method: request.method,
        path: `${parsed.pathname}${parsed.search}`,
        headers: forwardHeaders(request.headers, parsed.host),
      }, (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
        upstreamResponse.pipe(response);
      });
      upstream.setTimeout(PROXY_TIMEOUT_MS, () => upstream.destroy(new Error('Upstream timeout')));
      upstream.on('error', (error) => {
        if (!response.headersSent) endHttp(response, error);
        else response.destroy(error);
      });
      request.pipe(upstream);
    } catch (error) {
      endHttp(response, error);
    }
  });

  server.on('connect', async (request, clientSocket, head) => {
    try {
      const target = await resolvePublicTarget(`https://${request.url}`, resolutionOptions);
      const upstreamSocket = connectSocket({
        host: target.address,
        family: target.family,
        port: 443,
      });
      upstreamSocket.setTimeout(PROXY_TIMEOUT_MS, () => upstreamSocket.destroy(new Error('Upstream timeout')));
      upstreamSocket.once('connect', () => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstreamSocket.write(head);
        upstreamSocket.pipe(clientSocket);
        clientSocket.pipe(upstreamSocket);
      });
      upstreamSocket.once('error', (error) => endTunnel(clientSocket, error));
    } catch (error) {
      endTunnel(clientSocket, error);
    }
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'));

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  const host = typeof address === 'object' && address ? address.address : '127.0.0.1';
  const port = typeof address === 'object' && address ? address.port : 0;

  return {
    host,
    port,
    url: `http://${host}:${port}`,
    async close() {
      for (const socket of sockets) socket.destroy();
      if (!server.listening) return;
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
