// Small WebSocket wrapper with automatic reconnect (exponential backoff).
export class Net {
  constructor(onMessage, onStatus = () => {}) {
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.onOpen = () => {};
    this.ws = null;
    this.retry = 0;
    this.closed = false;
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => { this.retry = 0; this.onStatus('open'); this.onOpen(); };
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      this.onMessage(m);
    };
    ws.onclose = () => {
      this.onStatus('closed');
      if (this.closed) return;
      const delay = Math.min(1000 * 2 ** this.retry++, 8000);
      setTimeout(() => this.connect(), delay);
    };
    ws.onerror = () => ws.close();
  }

  send(msg) {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  close() {
    this.closed = true;
    if (this.ws) this.ws.close();
  }
}
