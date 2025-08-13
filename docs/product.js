(function() {
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

