/* Build Agentflows embed v1. Public loader: never put integration secrets here. */
(function () {
  "use strict";
  if (window.Agentflows) return;
  var active = null;
  var standard = {
    "page.getContext": "Conhecer a página aberta",
    "page.inspect": "Consultar elementos visíveis da página",
    "page.selectElement": "Pedir que a pessoa indique um elemento",
    "page.highlight": "Destacar um elemento",
    "page.scroll": "Rolar a página até uma posição ou elemento",
    "page.click": "Solicitar um clique, com confirmação da pessoa",
    "page.navigate": "Solicitar navegação na mesma aplicação, com confirmação",
    "page.requestScreenshot": "Pedir uma captura da tela, com autorização da pessoa"
  };
  var schema = { type: "object", properties: { selector: { type: "string" }, url: { type: "string" }, top: { type: "number" } }, additionalProperties: false };
  function mount(options) {
    if (active) throw new Error("O chat já está instalado nesta página.");
    if (!options || typeof options.getToken !== "function" || !options.flowId) throw new Error("Informe flowId e getToken.");
    var base = new URL(options.url).origin;
    var key = "agentflows:" + base + ":" + options.flowId;
    function read(name) { try { return sessionStorage.getItem(key + name); } catch { return null; } }
    function save(name, value) { try { sessionStorage.setItem(key + name, value); } catch { /* Storage may be disabled. The chat still works until reload. */ } }
    var tabId = read(":tab") || crypto.randomUUID(); save(":tab", tabId);
    var sessionId = read(":session") || "", opened = read(":open") === "true";
    // Browsers copy sessionStorage when duplicating a tab. Negotiate a fresh identity there.
    var instance = crypto.randomUUID();
    var channel = typeof BroadcastChannel === "function" ? new BroadcastChannel(key + ":tabs") : null;
    if (channel) {
      channel.onmessage = function (event) {
        var m = event.data;
        if (!m || m.tabId !== tabId || m.instance === instance) return;
        if (m.type === "probe") channel.postMessage({ type: "occupied", tabId: tabId, instance: instance, forInstance: m.instance });
        else if (m.type === "occupied" && m.forInstance === instance) {
          tabId = crypto.randomUUID(); sessionId = ""; save(":tab", tabId); save(":session", ""); save(":draft", "");
          post("resetConnection"); void connect();
        }
      };
      channel.postMessage({ type: "probe", tabId: tabId, instance: instance });
    }
    var custom = options.actions || {};
    var capabilities = Object.keys(standard).filter(function (name) { return name !== "page.requestScreenshot" || !!navigator.mediaDevices?.getDisplayMedia; }).map(function (name) { return { name: name, description: standard[name], schema: schema }; });
    Object.keys(custom).forEach(function (name) {
      if (!/^app\.[a-zA-Z][a-zA-Z0-9]{0,48}$/.test(name) || typeof custom[name].handle !== "function") throw new Error("Ação customizada inválida: " + name);
      capabilities.push({ name: name, description: custom[name].description, schema: custom[name].schema });
    });
    var host = document.createElement("div"); host.setAttribute("data-agentflows-widget", "");
    var shadow = host.attachShadow({ mode: "open" });
    var style = document.createElement("style");
    style.textContent = ':host{all:initial;position:fixed;right:20px;bottom:20px;z-index:2147483000;font-family:system-ui,sans-serif}button{font:inherit;cursor:pointer}button:focus-visible{outline:3px solid #a5b4fc;outline-offset:3px}.launcher{display:grid;place-items:center;width:56px;height:56px;margin-left:auto;border:0;border-radius:50%;background:#635bff;color:white;padding:0;box-shadow:0 8px 28px #25245430;font-weight:600}.frame{display:block;width:min(400px,calc(100vw - 32px));height:min(650px,calc(100dvh - 110px));border:1px solid #e8e8f0;border-radius:20px;background:white;box-shadow:0 16px 60px #22223b30;margin-bottom:12px}.frame[hidden]{display:none}.notice{position:fixed;bottom:90px;left:16px;width:min(340px,calc(100vw - 64px));background:white;color:#252438;padding:20px;border:1px solid #ddd;border-radius:14px;box-shadow:0 8px 35px #0002;line-height:1.5}.notice button{padding:9px 14px;border:1px solid #ddd;border-radius:9px;margin:12px 8px 0 0;background:white}.notice button:first-of-type{background:#635bff;color:white;border-color:#635bff}@media(max-width:480px){:host{right:12px;bottom:12px}}';
    var frame = document.createElement("iframe"); frame.className = "frame"; frame.title = "Conversa com o assistente"; frame.hidden = !opened;
    frame.src = base + "/embed/" + encodeURIComponent(options.flowId) + "?parent=" + encodeURIComponent(location.origin);
    frame.setAttribute("referrerpolicy", "no-referrer");
    var launcher = document.createElement("button"); launcher.type = "button"; launcher.className = "launcher";
    function toggle(value) { opened = value; frame.hidden = !opened; launcher.innerHTML = opened ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg>' : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2 1.5-6A8.5 8.5 0 1 1 21 11.5Z"/></svg>'; launcher.setAttribute("aria-label", opened ? "Fechar conversa" : "Abrir conversa"); launcher.title = opened ? "Fechar conversa" : "Abrir conversa"; launcher.setAttribute("aria-expanded", String(opened)); save(":open", String(opened)); }
    launcher.onclick = function () { toggle(!opened); }; toggle(opened);
    shadow.append(style, frame, launcher); document.body.append(host);
    var controllers = new Map(), completed = new Set(), refreshing = false, disposed = false;
    function post(type, data) { frame.contentWindow?.postMessage(Object.assign({ channel: "agentflows", version: 1, type: type }, data || {}), base); }
    async function connect() {
      if (refreshing || disposed) return; refreshing = true;
      try {
        var credentials = await options.getToken();
        post("init", { token: typeof credentials === "string" ? credentials : credentials.token, sessionId: sessionId, tabId: tabId, capabilities: capabilities });
      } catch { post("connectionError", {}); }
      finally { refreshing = false; }
    }
    function element(selector) {
      if (typeof selector !== "string" || !selector || selector.length > 500) throw new Error("Indique um elemento válido.");
      var elements = document.querySelectorAll(selector);
      if (elements.length !== 1 || !(elements[0] instanceof HTMLElement) || elements[0].closest("[data-agentflows-private],[data-agentflows-widget]")) throw new Error("Elemento indisponível ou ambíguo. Peça à pessoa para selecioná-lo.");
      return elements[0];
    }
    function describe(el) {
      if (!(el instanceof HTMLElement) || el.closest("[data-agentflows-private],[data-agentflows-widget]") || el.matches('input[type="password"],input[type="hidden"]')) return null;
      var selector = el.id ? "#" + CSS.escape(el.id) : el.getAttribute("data-agentflows-id") ? '[data-agentflows-id="' + CSS.escape(el.getAttribute("data-agentflows-id")) + '"]' : null;
      if (!selector) { var tag = crypto.randomUUID(); el.setAttribute("data-agentflows-ref", tag); selector = '[data-agentflows-ref="' + tag + '"]'; }
      return { selector: selector, tag: el.tagName.toLowerCase(), role: el.getAttribute("role"), label: (el.getAttribute("aria-label") || el.getAttribute("title") || (el.matches("input,textarea,select,form") ? "" : el.innerText) || "").slice(0, 160) };
    }
    function context() { return { url: location.origin + location.pathname, title: document.title, viewport: { width: innerWidth, height: innerHeight }, version: options.appVersion || null }; }
    function ask(text, label, signal, action) {
      return new Promise(function (resolve, reject) {
        var panel = document.createElement("div"); panel.className = "notice"; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Solicitação do assistente");
        var message = document.createElement("div"); message.textContent = text;
        var yes = document.createElement("button"); yes.type = "button"; yes.textContent = label;
        var no = document.createElement("button"); no.type = "button"; no.textContent = "Agora não";
        function clean() { panel.remove(); signal.removeEventListener("abort", abort); }
        function abort() { clean(); reject(new Error("Solicitação encerrada.")); }
        no.onclick = function () { clean(); reject(new Error("A pessoa recusou a ação.")); };
        // action runs directly in the real click handler, preserving browser user activation.
        yes.onclick = function () { yes.disabled = true; try { var p = action(); clean(); Promise.resolve(p).then(resolve, reject); } catch (e) { clean(); reject(e); } };
        signal.addEventListener("abort", abort, { once: true });
        panel.append(message, yes, no); shadow.append(panel); yes.focus();
      });
    }
    async function screenshot(signal) {
      return ask("Compartilhe apenas a aba ou janela relacionada ao problema. Confira se não há dados privados na tela.", "Compartilhar tela", signal, async function () {
        var stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        try {
          if (signal.aborted) throw new Error("Solicitação encerrada.");
          var video = document.createElement("video"); video.srcObject = stream; video.muted = true; await video.play();
          var canvas = document.createElement("canvas"); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
          canvas.getContext("2d").drawImage(video, 0, 0);
          var blob = await new Promise(function (resolve) { canvas.toBlob(resolve, "image/png"); });
          if (!blob || signal.aborted) throw new Error("Captura indisponível.");
          return { blob: blob, name: "captura.png", context: context() };
        } finally { stream.getTracks().forEach(function (track) { track.stop(); }); }
      });
    }
    async function perform(command, signal) {
      var a = command.args || {};
      switch (command.name) {
        case "page.getContext": return context();
        case "page.inspect": return { context: context(), elements: Array.from(document.querySelectorAll("button,a,input,select,textarea,[role=button],[data-agentflows-id]")).filter(function (el) { return el.getClientRects().length > 0; }).slice(0, 60).map(describe).filter(Boolean) };
        case "page.highlight": {
          var el = element(a.selector), previous = el.style.outline; el.style.outline = "3px solid #635bff";
          setTimeout(function () { el.style.outline = previous; }, 2500); return { highlighted: true };
        }
        case "page.scroll":
          if (a.selector) element(a.selector).scrollIntoView({ behavior: "instant", block: "center" });
          else { if (!Number.isFinite(a.top)) throw new Error("Posição inválida."); window.scrollTo({ top: a.top, behavior: "instant" }); }
          return { top: scrollY, left: scrollX };
        case "page.click": return ask("O assistente quer clicar em “" + (describe(element(a.selector))?.label || "elemento selecionado") + "”. Essa ação pode alterar dados.", "Permitir clique", signal, function () { element(a.selector).click(); return { dispatched: true, effectConfirmed: false }; });
        case "page.navigate": {
          if (typeof a.url !== "string" || !a.url.trim() || a.url.length > 2000) throw new Error("Indique uma rota válida.");
          var target = new URL(a.url, location.href);
          if (target.origin !== location.origin || target.username || target.password) throw new Error("Navegação permitida apenas nesta aplicação.");
          return ask("O assistente quer abrir " + target.pathname + ".", "Abrir página", signal, function () { return { navigationRequested: target.href, effectConfirmed: false }; });
        }
        case "page.requestScreenshot": return screenshot(signal);
        case "page.selectElement": return ask("Selecione na página o elemento relacionado ao pedido. A seleção não aciona o elemento.", "Selecionar elemento", signal, function () {
          return new Promise(function (resolve, reject) {
            function clean() { document.removeEventListener("click", pick, true); document.removeEventListener("keydown", escape, true); signal.removeEventListener("abort", abort); }
            function abort() { clean(); reject(new Error("Seleção encerrada.")); }
            function escape(e) { if (e.key === "Escape") abort(); }
            function pick(e) { if (e.composedPath().includes(host)) return; e.preventDefault(); e.stopImmediatePropagation(); var result = describe(e.target); clean(); if (result) resolve(result); else reject(new Error("Elemento privado ou indisponível.")); }
            document.addEventListener("click", pick, true); document.addEventListener("keydown", escape, true); signal.addEventListener("abort", abort, { once: true });
          });
        });
        default:
          if (!custom[command.name]) throw new Error("Esta ação não está disponível nesta página.");
          return ask("O assistente solicita: " + custom[command.name].description, "Permitir ação", signal, function () { return custom[command.name].handle(a, { signal: signal }); });
      }
    }
    async function receive(event) {
      if (event.origin !== base || event.source !== frame.contentWindow || !event.data || event.data.channel !== "agentflows" || event.data.version !== 1) return;
      var m = event.data;
      if (m.type === "ready" || m.type === "refreshToken") return connect();
      if (m.type === "session") { sessionId = m.sessionId; save(":session", sessionId); return; }
      if (m.type === "close") return toggle(false);
      if (m.type === "draft") { save(":draft", String(m.value || "").slice(0, 20000)); return; }
      if (m.type === "connected") { post("draft", { value: read(":draft") || "" }); post("event", { name: "page.contextChanged", data: context() }); return; }
      if (m.type === "cancelCommands") { controllers.forEach(function (c, id) { if (!m.ids.includes(id)) c.abort(); }); return; }
      if (m.type === "resultAccepted") { if (m.navigate) { var target = new URL(m.navigate); if (target.origin === location.origin) location.assign(target.href); } return; }
      if (m.type !== "command" || !m.command || typeof m.command.id !== "string") return;
      var c = m.command;
      if (c.sessionId !== sessionId || c.expiresAt <= Date.now() || completed.has(c.id) || controllers.has(c.id)) return;
      var controller = new AbortController(); controllers.set(c.id, controller);
      var timer = setTimeout(function () { controller.abort(); }, Math.max(1, c.expiresAt - Date.now()));
      try { var result = await perform(c, controller.signal); if (!controller.signal.aborted) post("result", { commandId: c.id, success: true, result: result }); }
      catch (e) { if (!controller.signal.aborted) post("result", { commandId: c.id, success: false, result: { error: e instanceof Error ? e.message : "Não foi possível executar a ação." } }); }
      finally { clearTimeout(timer); completed.add(c.id); controllers.delete(c.id); }
    }
    window.addEventListener("message", receive);
    var previousUrl = location.href;
    var heartbeat = setInterval(function () { post("heartbeat", {}); if (previousUrl !== location.href) { previousUrl = location.href; post("event", { name: "page.contextChanged", data: context() }); } }, 5000);
    active = {
      open: function () { toggle(true); },
      shareAttachment: function (file) { if (!(file instanceof Blob) || file.size > 10 * 1024 * 1024) throw new Error("Use um arquivo de até 10 MB."); post("attachment", { file: file, name: file.name || "captura.png" }); toggle(true); },
      emit: function (name, data) { if (!["page.contextChanged", "page.errorReported"].includes(name)) throw new Error("Evento não reconhecido."); post("event", { name: name, data: data }); },
      destroy: function () { disposed = true; controllers.forEach(function (c) { c.abort(); }); clearInterval(heartbeat); channel?.close(); window.removeEventListener("message", receive); host.remove(); active = null; }
    };
    return active;
  }
  window.Agentflows = { mount: mount, version: 1 };
})();
