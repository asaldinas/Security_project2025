(async () => {
  const status = document.getElementById('status');
  const btn = document.getElementById('googleBtn');

  // If already authenticated, jump straight to notes
  try {
    const me = await fetch('/me', { credentials: 'include' });
    if (me.ok) {
      window.location.href = '/notes.html';
      return;
    }
  } catch (_) {}

  btn.addEventListener('click', () => {
    // Starts OIDC PKCE flow handled by the server
    window.location.href = '/login';
  });

  status.textContent = 'Not signed in.';
})();
