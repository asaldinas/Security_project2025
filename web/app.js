    let csrfToken = null;
    async function fetchJSON(url, opts = {}) {
      const res = await fetch(url, { credentials: 'same-origin', ...opts });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    }
    async function init() {
      try {
        const me = await fetchJSON('/me');
        document.getElementById('nav').innerHTML =
          `<span class="muted">Signed in as ${me.email}</span> <a href="/logout"><button>Logout</button></a>`;
        document.getElementById('auth').style.display = 'none';
        document.getElementById('notes').style.display = 'block';
        await refreshCsrf();
        await loadNotes();
      } catch {
        document.getElementById('auth').innerHTML =
          `<p>Sign in with your university Google account to manage notes securely.</p>
           <a href="/login"><button>Login with Google</button></a>`;
      }
    }
    async function refreshCsrf() {
      const data = await fetchJSON('/csrf', { headers: { 'Cache-Control': 'no-store' }});
      csrfToken = data.token;
    }
    async function loadNotes() {
      const notes = await fetchJSON('/api/notes');
      const list = document.getElementById('list');
      list.innerHTML = '';
      notes.forEach(n => {
        const el = document.createElement('div');
        el.className = 'note';
        el.innerHTML = `
          <strong>${n.title}</strong>
          <div class="muted">${new Date(n.updated_at).toLocaleString()}</div>
          <p>${n.body.replace(/</g,'&lt;')}</p>
          <div class="row">
            <button data-id="${n.id}" class="edit">Edit</button>
            <button data-id="${n.id}" class="delete danger">Delete</button>
          </div>`;
        list.appendChild(el);
      });
    }
    document.addEventListener('click', async (e) => {
      if (e.target.id === 'create') {
        const title = document.getElementById('title').value.trim();
        const body = document.getElementById('body').value.trim();
        await fetch('/api/notes', {
          method:'POST',
          credentials:'same-origin',
          headers:{ 'Content-Type':'application/json', 'x-csrf-token': csrfToken },
          body: JSON.stringify({ title, body })
        });
        document.getElementById('title').value='';
        document.getElementById('body').value='';
        await refreshCsrf();
        await loadNotes();
      }
      if (e.target.classList.contains('delete')) {
        const id = e.target.dataset.id;
        await fetch(`/api/notes/${id}`, { method:'DELETE', credentials:'same-origin', headers:{ 'x-csrf-token': csrfToken } });
        await refreshCsrf();
        await loadNotes();
      }
      if (e.target.classList.contains('edit')) {
        const id = e.target.dataset.id;
        const title = prompt('New title:');
        if (title === null) return;
        const body = prompt('New body:');
        if (body === null) return;
        await fetch(`/api/notes/${id}`, {
          method:'PUT',
          credentials:'same-origin',
          headers:{ 'Content-Type':'application/json', 'x-csrf-token': csrfToken },
          body: JSON.stringify({ title, body })
        });
        await refreshCsrf();
        await loadNotes();
      }
    });
    init();