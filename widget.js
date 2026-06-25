/**
 * HCT Library AI Agent — Embeddable Widget
 * =========================================
 * Usage: Add this single line before </body> on your library website:
 *
 *   <script src="https://mmyousef.github.io/hct-library-agent/widget.js"
 *     data-position="bottom-right"
 *     data-theme="hct"
 *     data-lang="en"
 *     async></script>
 *
 * Attributes:
 *   data-position   : "bottom-right" (default) | "bottom-left"
 *   data-theme      : "hct" (default) | "light" | "dark"
 *   data-lang       : "en" (default) | "ar"
 *   data-greeting   : Custom greeting message
 *   data-api-url    : Override the Cloudflare Worker URL
 */

(function () {
  'use strict';

  // ── Config from script tag attributes ──────────────────────────
  const script = document.currentScript ||
    document.querySelector('script[src*="widget.js"]');
  const attr = (name, def) => (script && script.getAttribute(name)) || def;

  const WIDGET_CONFIG = {
    position:  attr('data-position', 'bottom-right'),
    theme:     attr('data-theme', 'hct'),
    lang:      attr('data-lang', 'en'),
    greeting:  attr('data-greeting', "Hello! I'm the HCT Library AI Assistant. How can I help with your research today? 📚"),
    apiUrl:    attr('data-api-url', ''),
    baseUrl:   'https://mmyousef.github.io/hct-library-agent',
  };

  const DEMO_MODE = !WIDGET_CONFIG.apiUrl;
  const isRTL = WIDGET_CONFIG.lang === 'ar';

  // ── Styles ──────────────────────────────────────────────────────
  const CSS = `
  #hct-widget-btn {
    position: fixed;
    ${WIDGET_CONFIG.position === 'bottom-left' ? 'left: 22px' : 'right: 22px'};
    bottom: 22px;
    width: 62px; height: 62px;
    border-radius: 18px;
    background: linear-gradient(145deg, #002E5D 0%, #0065BD 100%);
    border: none; cursor: pointer;
    box-shadow: 0 6px 28px rgba(0,46,93,0.55), 0 0 0 3px rgba(200,168,75,0.25);
    display: flex; align-items: center; justify-content: center;
    z-index: 999998;
    transition: transform 0.2s, box-shadow 0.2s;
    padding: 0;
  }
  #hct-widget-btn:hover {
    transform: scale(1.08) translateY(-2px);
    box-shadow: 0 10px 36px rgba(0,46,93,0.65), 0 0 0 3px rgba(200,168,75,0.45);
  }
  #hct-widget-btn .hct-btn-logo { width: 36px; height: 36px; display: block; }
  #hct-widget-btn .hct-notif {
    position: absolute; top: -4px; right: -4px;
    width: 16px; height: 16px;
    background: #e74c3c; border-radius: 50%;
    border: 2px solid #fff;
    animation: hct-pulse 2s infinite;
  }
  @keyframes hct-pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }

  #hct-panel {
    position: fixed;
    ${WIDGET_CONFIG.position === 'bottom-left' ? 'left: 16px' : 'right: 16px'};
    bottom: 92px;
    width: 440px; height: 680px;
    max-height: calc(100vh - 110px);
    background: #0d1f35;
    border-radius: 18px;
    box-shadow: 0 12px 48px rgba(0,0,0,0.45);
    display: flex; flex-direction: column;
    z-index: 999999;
    overflow: hidden;
    transform: scale(0.85) translateY(20px);
    opacity: 0;
    pointer-events: none;
    transition: transform 0.22s cubic-bezier(0.34,1.56,0.64,1), opacity 0.18s;
    font-family: 'Segoe UI', Arial, sans-serif;
    direction: ${isRTL ? 'rtl' : 'ltr'};
  }
  #hct-panel.open {
    transform: scale(1) translateY(0);
    opacity: 1;
    pointer-events: all;
  }
  @media (max-width: 440px) {
    #hct-panel { width: calc(100vw - 16px); right: 8px; left: 8px; bottom: 82px; }
  }

  .hct-header {
    background: linear-gradient(135deg, #001E3F 0%, #003670 60%, #004A8F 100%);
    padding: 14px 16px; display: flex; align-items: center;
    gap: 10px; flex-shrink: 0;
    border-bottom: 2px solid rgba(200,168,75,0.35);
  }
  .hct-header-icon {
    width: 40px; height: 40px;
    background: rgba(200,168,75,0.12);
    border: 1px solid rgba(200,168,75,0.30);
    border-radius: 11px; display: flex; align-items: center;
    justify-content: center; flex-shrink: 0;
  }
  .hct-header-icon svg { width: 24px; height: 24px; }
  .hct-header-text { flex: 1; }
  .hct-header-title { font-size: 14px; font-weight: 700; color: #fff; }
  .hct-header-sub { font-size: 10.5px; color: rgba(255,255,255,0.75); }
  .hct-close-btn {
    width: 28px; height: 28px; border-radius: 8px;
    background: rgba(255,255,255,0.15); border: none;
    color: #fff; font-size: 14px; cursor: pointer; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    transition: background 0.15s;
  }
  .hct-close-btn:hover { background: rgba(255,255,255,0.25); }

  .hct-messages {
    flex: 1; overflow-y: auto; padding: 14px 12px; display: flex;
    flex-direction: column; gap: 12px;
  }
  .hct-messages::-webkit-scrollbar { width: 4px; }
  .hct-messages::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }

  .hct-msg { display: flex; gap: 7px; max-width: 90%; animation: hct-fadein 0.2s ease; }
  @keyframes hct-fadein { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
  .hct-msg.user { align-self: flex-end; flex-direction: row-reverse; }
  .hct-msg.bot  { align-self: flex-start; }

  .hct-avatar {
    width: 28px; height: 28px; border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    font-size: 13px; flex-shrink: 0;
  }
  .hct-msg.bot  .hct-avatar { background: linear-gradient(135deg,#002E5D,#0065BD); display:flex;align-items:center;justify-content:center; }
  .hct-msg.bot  .hct-avatar svg { width:16px;height:16px; }
  .hct-msg.user .hct-avatar { background: rgba(200,168,75,0.18); font-size:13px; }

  .hct-bubble {
    padding: 9px 12px; border-radius: 11px; font-size: 12.5px;
    line-height: 1.55; white-space: pre-wrap; word-break: break-word;
  }
  .hct-msg.bot  .hct-bubble { background: #132840; color: #cce4f5; border: 1px solid rgba(255,255,255,0.06); border-top-left-radius: 3px; }
  .hct-msg.user .hct-bubble { background: #1a6fb0; color: #fff; border-top-right-radius: 3px; }

  .hct-typing { display: flex; align-items: center; gap: 4px; padding: 9px 12px; }
  .hct-typing span { width: 6px; height: 6px; background: #2a9d8f; border-radius: 50%; animation: hct-bounce 1.2s infinite; }
  .hct-typing span:nth-child(2) { animation-delay: 0.2s; }
  .hct-typing span:nth-child(3) { animation-delay: 0.4s; }
  @keyframes hct-bounce { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-6px)} }

  .hct-sources { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
  .hct-src-tag { font-size: 9.5px; padding: 2px 7px; border-radius: 20px; background: rgba(42,157,143,0.12); color: #2a9d8f; border: 1px solid rgba(42,157,143,0.2); }

  .hct-input-area {
    padding: 10px 12px; border-top: 1px solid rgba(255,255,255,0.07);
    background: #132840; flex-shrink: 0;
  }
  .hct-input-row { display: flex; gap: 8px; align-items: flex-end; }
  .hct-input-wrap {
    flex: 1; background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.1); border-radius: 10px;
    padding: 8px 11px; transition: border-color 0.2s;
  }
  .hct-input-wrap:focus-within { border-color: #2a9d8f; }
  .hct-textarea {
    width: 100%; background: transparent; border: none; outline: none;
    color: #fff; font-size: 12.5px; resize: none; min-height: 20px;
    max-height: 80px; line-height: 1.45; font-family: inherit;
  }
  .hct-textarea::placeholder { color: #6b8096; }
  .hct-send {
    width: 36px; height: 36px; border-radius: 9px; border: none;
    background: #1a6fb0; color: #fff; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0; transition: background 0.15s;
    font-size: 15px;
  }
  .hct-send:hover { background: #135a96; }
  .hct-send:disabled { background: rgba(255,255,255,0.08); cursor: not-allowed; }
  .hct-footer-link {
    display: block; text-align: center; font-size: 9.5px; color: #4a607a;
    margin-top: 6px; text-decoration: none;
  }
  .hct-footer-link:hover { color: #2a9d8f; }
  `;

  // ── Inject styles ────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  // ── Build DOM ────────────────────────────────────────────────
  const btn = document.createElement('button');
  btn.id = 'hct-widget-btn';
  btn.title = 'HCT Library AI Assistant';
  // Floating button logo: open book with AI spark
  btn.innerHTML = `
    <svg class="hct-btn-logo" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
      <!-- Book left page -->
      <path d="M18 28V10C18 10 13 8 7 9.5V27.5C13 26 18 28 18 28Z" fill="#C8A84B" opacity="0.90"/>
      <!-- Book right page -->
      <path d="M18 28V10C18 10 23 8 29 9.5V27.5C23 26 18 28 18 28Z" fill="#E2C06A" opacity="0.75"/>
      <!-- Spine line -->
      <rect x="17" y="9.5" width="2" height="19" rx="1" fill="#C8A84B"/>
      <!-- AI sparkle top-right -->
      <circle cx="27" cy="9" r="4.5" fill="#002E5D"/>
      <path d="M27 6.5V11.5M24.5 9H29.5" stroke="#C8A84B" stroke-width="1.5" stroke-linecap="round"/>
      <circle cx="27" cy="9" r="1.2" fill="#C8A84B"/>
    </svg>
    <span class="hct-notif"></span>`;


  const panel = document.createElement('div');
  panel.id = 'hct-panel';
  panel.innerHTML = `
    <div class="hct-header">
      <div class="hct-header-icon">
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <!-- Book left page -->
          <path d="M12 19.5V7C12 7 8.5 5.5 4 6.5V18.5C8.5 17.5 12 19.5 12 19.5Z" fill="#C8A84B" opacity="0.95"/>
          <!-- Book right page -->
          <path d="M12 19.5V7C12 7 15.5 5.5 20 6.5V18.5C15.5 17.5 12 19.5 12 19.5Z" fill="#E2C06A" opacity="0.75"/>
          <!-- Spine -->
          <rect x="11.25" y="6.5" width="1.5" height="13.5" rx="0.75" fill="#C8A84B"/>
          <!-- AI spark circle -->
          <circle cx="19" cy="5.5" r="3.5" fill="#001E3F" stroke="#C8A84B" stroke-width="0.75"/>
          <path d="M19 3.8V7.2M17.3 5.5H20.7" stroke="#C8A84B" stroke-width="1.1" stroke-linecap="round"/>
        </svg>
      </div>
      <div class="hct-header-text">
        <div class="hct-header-title">HCT Library Assistant</div>
        <div class="hct-header-sub">AI · Available 24/7</div>
      </div>
      <button class="hct-close-btn" id="hct-close">✕</button>
    </div>
    <div class="hct-messages" id="hct-msgs"></div>
    <div class="hct-input-area">
      <div class="hct-input-row">
        <div class="hct-input-wrap">
          <textarea class="hct-textarea" id="hct-input" placeholder="Ask about library resources, citations, policies..." rows="1" maxlength="500"></textarea>
        </div>
        <button class="hct-send" id="hct-send">➤</button>
      </div>
      <a class="hct-footer-link" href="https://library.hct.ac.ae" target="_blank">🌐 Visit HCT Library Website</a>
    </div>`;

  document.body.appendChild(btn);
  document.body.appendChild(panel);

  // ── Load KB ──────────────────────────────────────────────────
  let KB = [];
  fetch(WIDGET_CONFIG.baseUrl + '/knowledge_base/faq_sample.json')
    .then(r => r.json())
    .then(d => { KB = d.entries || []; })
    .catch(() => {});

  // ── Demo search ──────────────────────────────────────────────
  function search(q) {
    const words = q.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const scored = KB.map(e => {
      let s = 0;
      const txt = (e.q + ' ' + e.a + ' ' + (e.tags || []).join(' ')).toLowerCase();
      words.forEach(w => { if (txt.includes(w)) s += 2; if (e.q.toLowerCase().includes(w)) s += 3; });
      return { e, s };
    });
    return scored.filter(x => x.s > 0).sort((a,b) => b.s - a.s).slice(0, 2);
  }

  function respond(q) {
    const blocked = checkMod(q);
    if (blocked) return { text: blocked, sources: [] };
    const results = search(q);
    if (!results.length) return {
      text: "I don't have specific information on that. Please contact the library:\n• Email: lrstech@hct.ac.ae\n• Website: https://hct.ac.ae/en/libraries/\n• Open Mon–Thu 8.00 AM – 4.00 PM",
      sources: []
    };
    return { text: results[0].e.a, sources: [...new Set(results.map(r => r.e.source).filter(Boolean))] };
  }

  const BLOCKED = [
    { r: /\b(porn|xxx|adult content|explicit material)\b/i, t: "Thank you for your message. Your query falls outside the scope of the HCT Library AI Assistant. For library assistance: library@hct.ac.ae" },
    { r: /\b(write my (essay|assignment|report|thesis)|do my homework)\b/i, t: "The HCT Library Assistant cannot write academic work for submission. I can help you find sources, learn citation formats, and access research databases." },
  ];
  function checkMod(q) {
    for (const p of BLOCKED) if (p.r.test(q)) return p.t;
    return null;
  }

  // ── UI helpers ───────────────────────────────────────────────
  let thinking = false;

  function addMsg(role, text, sources = []) {
    const msgs = document.getElementById('hct-msgs');
    const d = document.createElement('div');
    d.className = `hct-msg ${role}`;
    const srcHTML = sources.length ? `<div class="hct-sources">${sources.map(s=>`<span class="hct-src-tag">📄 ${s}</span>`).join('')}</div>` : '';
    const botIcon = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 18V7C12 7 8.5 5.5 4 6.5V17.5C8.5 16.5 12 18 12 18Z" fill="#C8A84B" opacity="0.9"/><path d="M12 18V7C12 7 15.5 5.5 20 6.5V17.5C15.5 16.5 12 18 12 18Z" fill="#E2C06A" opacity="0.7"/><rect x="11.25" y="6.5" width="1.5" height="12" rx="0.75" fill="#C8A84B"/></svg>`;
    d.innerHTML = `<div class="hct-avatar">${role==='bot' ? botIcon : '👤'}</div><div><div class="hct-bubble">${text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/\n/g,'<br>')}</div>${srcHTML}</div>`;
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function showTyping() {
    const msgs = document.getElementById('hct-msgs');
    const d = document.createElement('div');
    d.className = 'hct-msg bot'; d.id = 'hct-typing';
    d.innerHTML = `<div class="hct-avatar"><svg viewBox="0 0 24 24" fill="none"><path d="M12 18V7C12 7 8.5 5.5 4 6.5V17.5C8.5 16.5 12 18 12 18Z" fill="#C8A84B" opacity="0.9"/><path d="M12 18V7C12 7 15.5 5.5 20 6.5V17.5C15.5 16.5 12 18 12 18Z" fill="#E2C06A" opacity="0.7"/><rect x="11.25" y="6.5" width="1.5" height="12" rx="0.75" fill="#C8A84B"/></svg></div><div class="hct-bubble hct-typing"><span></span><span></span><span></span></div>`;
    msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight;
  }

  function removeTyping() { const e = document.getElementById('hct-typing'); if(e) e.remove(); }

  // ── Send ─────────────────────────────────────────────────────
  async function send() {
    if (thinking) return;
    const inp = document.getElementById('hct-input');
    const q = inp.value.trim();
    if (!q) return;
    inp.value = '';
    inp.style.height = 'auto';
    addMsg('user', q);
    thinking = true;
    document.getElementById('hct-send').disabled = true;
    showTyping();

    await new Promise(r => setTimeout(r, 500 + Math.random() * 500));

    let text, sources = [];
    if (!DEMO_MODE && WIDGET_CONFIG.apiUrl) {
      try {
        const res = await fetch(WIDGET_CONFIG.apiUrl, {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ query: q, session_id: getSessId() })
        });
        const data = await res.json();
        text = data.response || 'Sorry, try again.';
        sources = data.sources || [];
      } catch(e) { text = 'Connection error. Please try again or contact library@hct.ac.ae'; }
    } else {
      const r = respond(q); text = r.text; sources = r.sources;
    }

    removeTyping();
    addMsg('bot', text, sources);
    thinking = false;
    document.getElementById('hct-send').disabled = false;
  }

  function getSessId() {
    let id = sessionStorage.getItem('hct_w_sess');
    if (!id) { id = 'w_' + Math.random().toString(36).slice(2,10); sessionStorage.setItem('hct_w_sess', id); }
    return id;
  }

  // ── Toggle ───────────────────────────────────────────────────
  let isOpen = false;
  function open() {
    panel.classList.add('open');
    btn.querySelector('.hct-notif').style.display = 'none';
    isOpen = true;
    if (!document.getElementById('hct-msgs').children.length) {
      addMsg('bot', WIDGET_CONFIG.greeting);
    }
    setTimeout(() => document.getElementById('hct-input').focus(), 250);
  }
  function close() { panel.classList.remove('open'); isOpen = false; }

  btn.addEventListener('click', () => isOpen ? close() : open());
  document.getElementById('hct-close').addEventListener('click', close);

  const sendBtn = document.getElementById('hct-send');
  sendBtn.addEventListener('click', send);

  const inp = document.getElementById('hct-input');
  inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  inp.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 80) + 'px';
  });

  // Close on outside click
  document.addEventListener('click', e => {
    if (isOpen && !panel.contains(e.target) && !btn.contains(e.target)) close();
  });

})();
