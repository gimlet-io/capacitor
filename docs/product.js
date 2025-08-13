(function() {
  // Docs loader
  const content = document.getElementById('docsContent');
  const sidebar = document.getElementById('docsSidebar');
  if (content && sidebar) {
    const links = sidebar.querySelectorAll('a[data-doc-id]');
    const navAnchors = Array.from(links);
    const docsOrder = [];
    const docsTitleById = {};
    for (let i = 0; i < navAnchors.length; i++) {
      const a = navAnchors[i];
      const href = a.getAttribute('href') || '';
      if (!href.startsWith('#')) continue; // Skip external/home
      const id = a.getAttribute('data-doc-id');
      if (!id) continue;
      if (docsOrder.indexOf(id) !== -1) continue;
      docsOrder.push(id);
      docsTitleById[id] = (a.textContent || '').trim();
    }
    function findDocIndex(id) {
      let idx = docsOrder.indexOf(id);
      if (idx !== -1) return idx;
      const fallback = String(id).toLowerCase().replace(/\s+/g, '-');
      return docsOrder.indexOf(fallback);
    }
    function renderPrevNextNav(currentId) {
      const idx = findDocIndex(currentId);
      if (idx === -1) return;
      const prevId = idx > 0 ? docsOrder[idx - 1] : null;
      const nextId = idx < docsOrder.length - 1 ? docsOrder[idx + 1] : null;
      if (!prevId && !nextId) return;
      const nav = document.createElement('div');
      nav.className = 'doc-nav';
      const prevTitle = prevId ? (docsTitleById[prevId] || prevId) : '';
      const nextTitle = nextId ? (docsTitleById[nextId] || nextId) : '';
      const left = prevId ? '<a class="dim" href="#' + prevId + '">\u2190 ' + prevTitle + '</a>' : '';
      const right = nextId ? '<a class="dim" href="#' + nextId + '">' + nextTitle + ' \u2192</a>' : '';
      nav.innerHTML = '<div class="doc-nav-left">' + left + '</div><div class="doc-nav-right">' + right + '</div>';
      content.appendChild(nav);
    }
    function setActive(id) {
      links.forEach(a => a.classList.toggle('active', a.getAttribute('data-doc-id') === id));
    }
    function resolveDocUrl(id) {
      try {
        const pathname = window.location.pathname;
        const baseDir = pathname.endsWith('/')
          ? pathname
          : pathname.slice(0, pathname.lastIndexOf('/') + 1);
        return baseDir + 'markdown/' + id + '.md';
      } catch (_e) {
        return 'markdown/' + id + '.md';
      }
    }

    async function loadDoc(id) {
      try {
        setActive(id);
        content.innerHTML = '<p class="dim">Loading…</p>';
        const url = resolveDocUrl(id);
        const res = await fetch(url, { cache: 'no-cache' });
        if (!res.ok) throw new Error('Failed to load ' + id);
        const md = await res.text();
        content.innerHTML = renderMarkdown(md);
        renderPrevNextNav(id);
        // Scroll top of content after load
        content.scrollTop = 0;
      } catch (e) {
        const isFileProtocol = window.location.protocol === 'file:';
        const hint = isFileProtocol
          ? 'Open this page via a local HTTP server (e.g. `npx serve docs`) so markdown files can be fetched.'
          : 'Ensure the markdown files exist next to this page and your server serves .md files.';
        const msg = (e && e.message ? e.message : 'Failed to load') + '<br/><small class="dim">' + hint + '</small>';
        content.innerHTML = '<p class="dim">' + msg + '</p>';
      }
    }

    function renderMarkdown(md) {
      // Minimal Markdown renderer (headings, code, paragraphs, lists) with inline code and links
      const esc = s => s.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
      const formatInline = (s) => {
        const safe = esc(s);
        const withLinks = safe.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, url) => {
          const urlEsc = String(url).replace(/"/g, '&quot;');
          return '<a class="dim" href="' + urlEsc + '" target="_blank" rel="noopener noreferrer">' + text + '</a>';
        });
        const withCode = withLinks.replace(/`([^`]+)`/g, (_m, code) => '<code>' + code + '</code>');
        return withCode;
      };
      const lines = md.split(/\r?\n/);
      let html = '';
      let inCode = false;
      let listOpen = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith('```')) {
          if (!inCode) { html += '<pre class="code-fence"><code class="mono">'; inCode = true; }
          else { html += '</code></pre>'; inCode = false; }
          continue;
        }
        if (inCode) { html += esc(line) + '\n'; continue; }
        const h = line.match(/^(#{1,3})\s+(.*)$/);
        if (h) {
          if (listOpen) { html += '</ul>'; listOpen = false; }
          html += '<' + 'h' + h[1].length + '>' + formatInline(h[2]) + '</h' + h[1].length + '>';
          continue;
        }
        const li = line.match(/^[-*]\s+(.*)$/);
        if (li) {
          if (!listOpen) { html += '<ul>'; listOpen = true; }
          html += '<li>' + formatInline(li[1]) + '</li>';
          continue;
        }
        if (line.trim() === '') { if (listOpen) { html += '</ul>'; listOpen = false; } html += ''; continue; }
        html += '<p>' + formatInline(line) + '</p>';
      }
      if (listOpen) html += '</ul>';
      if (inCode) html += '</code></pre>';
      return html;
    }

    function route() {
      const id = (location.hash || '#quickstart').replace('#', '');
      loadDoc(id);
    }
    window.addEventListener('hashchange', route);
    route();
  }

  const button = document.getElementById('copyCmd');
  if (!button) return;
  const command = 'wget -qO- https://gimlet.io/install-capacitor | bash';
  const originalText = button.textContent;

  button.addEventListener('click', function() {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(command).then(showCopied, fallbackCopy);
    } else {
      fallbackCopy();
    }
  });

  function fallbackCopy() {
    try {
      const ta = document.createElement('textarea');
      ta.value = command;
      ta.setAttribute('readonly', '');
      ta.style.position = 'absolute';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showCopied();
    } catch (_e) {
      button.textContent = 'Copy failed';
      setTimeout(reset, 1200);
    }
  }

  function showCopied() {
    button.textContent = 'Copied!';
    button.disabled = true;
    setTimeout(reset, 1400);
  }

  function reset() {
    button.textContent = originalText;
    button.disabled = false;
  }
})();

