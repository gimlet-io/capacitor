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

    function scrollToSection(sectionId) {
      if (!sectionId || !content) return;
      const el = content.querySelector('#' + sectionId);
      if (!el) return;
      el.scrollIntoView({ block: 'start' });
    }

    function enhanceHeadings(currentId) {
      if (!content || !currentId) return;
      const headings = content.querySelectorAll('h2[id], h3[id]');
      headings.forEach(function(h) {
        const id = h.getAttribute('id');
        if (!id) return;
        // Avoid wrapping multiple times
        if (h.querySelector('a.doc-heading-link')) return;
        const innerHtml = h.innerHTML;
        const link = document.createElement('a');
        link.className = 'doc-heading-link';
        link.setAttribute('href', '#' + currentId + ':' + id);
        link.innerHTML = innerHtml;
        h.innerHTML = '';
        h.appendChild(link);
      });
    }

    async function loadDoc(id, sectionId) {
      try {
        setActive(id);
        content.innerHTML = '<p class="dim">Loading…</p>';
        const url = resolveDocUrl(id);
        const res = await fetch(url, { cache: 'no-cache' });
        if (!res.ok) throw new Error('Failed to load ' + id);
        const md = await res.text();
        content.innerHTML = renderMarkdown(md);
        renderPrevNextNav(id);
        enhanceHeadings(id);
        // Scroll top of content after load
        content.scrollTop = 0;
        if (sectionId) {
          // Let the DOM paint before scrolling to the target section
          setTimeout(function() { scrollToSection(sectionId); }, 0);
        }
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
        // Media (images and videos) first so they are not picked up by link regex
        const withMedia = safe.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function(_m, alt, url) {
          const rawUrl = String(url);
          const urlEsc = rawUrl.replace(/"/g, '&quot;');
          const ext = (rawUrl.split('?')[0].split('#')[0].split('.').pop() || '').toLowerCase();
          if (/(mp4|webm|ogg|mov)/.test(ext)) {
            const type = ext === 'mp4' ? 'video/mp4'
              : ext === 'webm' ? 'video/webm'
              : ext === 'ogg' ? 'video/ogg'
              : 'video/quicktime';
            const altRaw = String(alt);
            const parts = altRaw.split('|').map(p => String(p).trim());
            const label = (parts[0] || '').replace(/"/g, '&quot;');
            const opts = {};
            for (let i = 1; i < parts.length; i++) {
              const p = parts[i];
              if (!p) continue;
              const eq = p.indexOf('=');
              if (eq === -1) {
                opts[p.toLowerCase()] = true;
              } else {
                const k = p.slice(0, eq).trim().toLowerCase();
                const v = p.slice(eq + 1).trim();
                opts[k] = v;
              }
            }
            let attrs = ' controls';
            if (opts['controls'] === 'false' || opts['controls'] === false) {
              attrs = attrs.replace(' controls', '');
            }
            if (opts['autoplay']) {
              attrs += ' autoplay muted';
            }
            if (opts['muted']) {
              if (attrs.indexOf(' muted') === -1) attrs += ' muted';
            }
            if (opts['loop']) {
              attrs += ' loop';
            }
            let styleAttr = '';
            if (opts['width']) {
              const wRaw = String(opts['width']);
              const wCss = /^\d+$/.test(wRaw) ? (wRaw + 'px') : wRaw;
              const wEsc = wCss.replace(/"/g, '&quot;');
              styleAttr = ' style="width: ' + wEsc + ';"';
            }
            return '<video' + attrs + ' preload="metadata" playsinline aria-label="' + label + '"' + styleAttr + '><source src="' + urlEsc + '" type="' + type + '"></video>';
          }
          const altEsc = String(alt).replace(/"/g, '&quot;');
          return '<img src="' + urlEsc + '" alt="' + altEsc + '" />';
        });
        const withLinks = withMedia.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, url) => {
          const urlEsc = String(url).replace(/"/g, '&quot;');
          return '<a class="dim" href="' + urlEsc + '" target="_blank" rel="noopener noreferrer">' + text + '</a>';
        });
        // Basic emphasis: *text* → <em>text</em>
        const withEmphasis = withLinks.replace(/\*([^*]+)\*/g, (_m, em) => {
          return '<em>' + em + '</em>';
        });
        const withCode = withEmphasis.replace(/`([^`]+)`/g, (_m, code) => {
          // Inline code: use break-all so the code wraps mid-word rather than
          // being pushed to a new line as a whole unit.
          return '<code style="word-break: break-all;">' + code + '</code>';
        });
        return withCode;
      };

      // Very small YAML-table helper: parses a list of maps and renders as an HTML table.
      function renderYamlTableBlock(lines) {
        const rows = [];
        let current = {};
        function pushCurrent() {
          if (Object.keys(current).length > 0) {
            rows.push(current);
          }
          current = {};
        }
        for (let i = 0; i < lines.length; i++) {
          const raw = lines[i];
          const trimmed = raw.trim();
          if (!trimmed) continue;
          if (trimmed[0] === '#') continue;
          if (trimmed.startsWith('- ')) {
            // Start a new row
            pushCurrent();
            const afterDash = trimmed.slice(2).trim();
            if (afterDash) {
              const idx = afterDash.indexOf(':');
              if (idx !== -1) {
                const key = afterDash.slice(0, idx).trim();
                const value = afterDash.slice(idx + 1).trim();
                if (key) current[key] = value;
              }
            }
            continue;
          }
          if (trimmed.indexOf(':') !== -1) {
            const idx = trimmed.indexOf(':');
            const key = trimmed.slice(0, idx).trim();
            const value = trimmed.slice(idx + 1).trim();
            if (key) current[key] = value;
          }
        }
        pushCurrent();
        if (!rows.length) {
          // Fallback: nothing parsed, render as plain code block
          return null;
        }
        const headerKeys = [];
        const seen = {};
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          for (const k in row) {
            if (!Object.prototype.hasOwnProperty.call(row, k)) continue;
            if (!seen[k]) {
              seen[k] = true;
              headerKeys.push(k);
            }
          }
        }
        if (!headerKeys.length) return null;
        let html = '<table class="yaml-table"><thead><tr>';
        for (let i = 0; i < headerKeys.length; i++) {
          html += '<th>' + esc(headerKeys[i]) + '</th>';
        }
        html += '</tr></thead><tbody>';
        for (let r = 0; r < rows.length; r++) {
          const row = rows[r];
          html += '<tr>';
          for (let i = 0; i < headerKeys.length; i++) {
            const key = headerKeys[i];
            const val = row[key] != null ? String(row[key]) : '';
            html += '<td>' + esc(val) + '</td>';
          }
          html += '</tr>';
        }
        html += '</tbody></table>';
        return html;
      }

      const usedHeadingIds = {};
      function slugifyHeading(text) {
        const base = String(text || '')
          .toLowerCase()
          .replace(/[`*_~]/g, '')
          .replace(/[^a-z0-9\s-]/g, '')
          .trim()
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-');
        return base || 'section';
      }
      function getUniqueHeadingId(base) {
        let id = base;
        let counter = 2;
        while (usedHeadingIds[id]) {
          id = base + '-' + counter++;
        }
        usedHeadingIds[id] = true;
        return id;
      }

      const lines = md.split(/\r?\n/);
      let html = '';
      let listOpen = false;

      function closeListIfOpen() {
        if (listOpen) {
          html += '</ul>';
          listOpen = false;
        }
      }

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Fenced code blocks (including yaml-table)
        if (line.startsWith('```')) {
          const info = line.slice(3).trim().toLowerCase();
          const isYamlTable = info === 'yaml-table' || info === 'yaml table';
          const blockLines = [];
          i++;
          while (i < lines.length && !lines[i].startsWith('```')) {
            blockLines.push(lines[i]);
            i++;
          }
          // closing fence (```...) is consumed by while; outer for will increment i again
          if (isYamlTable) {
            closeListIfOpen();
            const tableHtml = renderYamlTableBlock(blockLines);
            if (tableHtml != null) {
              html += tableHtml;
            } else {
              // Fallback: render as plain code if parsing failed
              html += '<pre class="code-fence"><code class="mono">';
              for (let j = 0; j < blockLines.length; j++) {
                html += esc(blockLines[j]) + '\n';
              }
              html += '</code></pre>';
            }
          } else {
            closeListIfOpen();
            html += '<pre class="code-fence"><code class="mono">';
            for (let j = 0; j < blockLines.length; j++) {
              html += esc(blockLines[j]) + '\n';
            }
            html += '</code></pre>';
          }
          continue;
        }

        const h = line.match(/^(#{1,3})\s+(.*)$/);
        if (h) {
          closeListIfOpen();
          const level = h[1].length;
          const rawText = h[2] || '';
          const tag = 'h' + level;
          const innerHtml = formatInline(rawText);
          if (level === 2 || level === 3) {
            const slugBase = slugifyHeading(rawText);
            const id = getUniqueHeadingId(slugBase);
            html += '<' + tag + ' id="' + id + '">' + innerHtml + '</' + tag + '>';
          } else {
            html += '<' + tag + '>' + innerHtml + '</' + tag + '>';
          }
          continue;
        }

        const li = line.match(/^[-*]\s+(.*)$/);
        if (li) {
          if (!listOpen) {
            html += '<ul>';
            listOpen = true;
          }
          html += '<li>' + formatInline(li[1]) + '</li>';
          continue;
        }

        if (line.trim() === '') {
          closeListIfOpen();
          continue;
        }

        html += '<p>' + formatInline(line) + '</p>';
      }

      if (listOpen) html += '</ul>';
      return html;
    }

    function route() {
      const fallbackDocId = docsOrder.length > 0 ? docsOrder[0] : 'quickstart';
      const raw = window.location.hash ? window.location.hash.slice(1) : fallbackDocId;
      const parts = raw.split(':');
      const docId = parts[0] || fallbackDocId;
      const sectionId = parts.length > 1 ? parts[1] : null;
      loadDoc(docId, sectionId);
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

