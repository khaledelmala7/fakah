const localtunnel = require('localtunnel');

async function startTunnel() {
  try {
    const tunnel = await localtunnel({ port: 3000, subdomain: 'fakah-pay-demo' });
    console.log(`[TUNNEL_READY] Public URL: ${tunnel.url}`);

    tunnel.on('close', () => {
      console.log('[TUNNEL] Closed. Reconnecting in 2s...');
      setTimeout(startTunnel, 2000);
    });

    tunnel.on('error', (err) => {
      console.error('[TUNNEL] Error:', err.message);
      setTimeout(startTunnel, 2000);
    });
  } catch (err) {
    console.error('[TUNNEL] Setup error:', err.message);
    setTimeout(startTunnel, 3000);
  }
}

startTunnel();
