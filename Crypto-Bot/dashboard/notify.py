"""Meldingen naar je telefoon via Telegram. Gratis, geen extra software nodig.

Instellen: open Telegram, zoek @BotFather, stuur /newbot en volg de stappen: je krijgt een token.
Stuur daarna een bericht naar je nieuwe bot en vul token in het dashboard in; de bot zoekt je chat-id zelf op.
"""
import json, queue, threading, time, urllib.request, urllib.parse


class Notifier:
    def __init__(self, log=print):
        self.q = queue.Queue(maxsize=200); self.log = log
        self.token = ''; self.chat = ''; self.enabled = False
        self.last_sent = {}; self.ok = None; self.last_error = None
        threading.Thread(target=self._loop, daemon=True).start()

    def configure(self, token, chat):
        self.token = (token or '').strip(); self.chat = str(chat or '').strip()
        self.enabled = bool(self.token)

    def _api(self, method, params=None, timeout=15):
        url = f'https://api.telegram.org/bot{self.token}/{method}'
        data = urllib.parse.urlencode(params or {}).encode()
        with urllib.request.urlopen(urllib.request.Request(url, data=data), timeout=timeout) as r:
            return json.loads(r.read().decode())

    def find_chat(self):
        """Zoek de chat-id van het laatste bericht dat iemand naar de bot stuurde."""
        res = self._api('getUpdates')
        for u in reversed(res.get('result', [])):
            msg = u.get('message') or u.get('channel_post') or {}
            if msg.get('chat', {}).get('id'): return str(msg['chat']['id'])
        return ''

    def send(self, kind, text, every=0):
        """every: minimaal aantal seconden tussen meldingen van hetzelfde soort (tegen spam)."""
        if not self.enabled: return
        now = time.time()
        if every and now - self.last_sent.get(kind, 0) < every: return
        self.last_sent[kind] = now
        try: self.q.put_nowait(text)
        except queue.Full: pass

    def send_now(self, text):
        if not self.chat: self.chat = self.find_chat()
        if not self.chat: raise RuntimeError('Geen chat gevonden. Stuur eerst een bericht naar je bot in Telegram.')
        self._api('sendMessage', dict(chat_id=self.chat, text=text, disable_web_page_preview='true'))
        return self.chat

    def _loop(self):
        while True:
            text = self.q.get()
            for attempt in range(3):
                try:
                    self.send_now('Crypto-bot: ' + text); self.ok = True; self.last_error = None; break
                except Exception as e:
                    self.ok = False; self.last_error = f'{type(e).__name__}: {e}'
                    time.sleep(5 * (attempt + 1))
