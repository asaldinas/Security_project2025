let CSRF = null;

async function ensureAuth() {
  const res = await fetch('/me', { credentials: 'include' });
  if (!res.ok) {
    window.location.href = '/'; // back to login
    return null;
  }
  const me = await res.json();
  document.getElementById('who').textContent = me.name || me.email || 'Signed in';
  return me;
}

async function refreshCsrf() {
  const res = await fetch('/csrf', { credentials: 'include' });
  if (!res.ok) throw new Error('Invalid CSRF token');
  const { token } = await res.json();
  CSRF = token;
}

async function listNotes() {
  const res = await fetch('/api/notes', { credentials: 'include' });
  const notes = res.ok ? await res.json() : [];
  const list = document.getElementById('list');
  list.innerHTML = '';
  if (!notes.length) {
    list.innerHTML = '<p class="muted">No notes yet.</p>';
    return;
  }
  for (const n of notes) {
    const el = document.createElement('div');
    el.className = 'note';
    el.innerHTML = `
      <div class="title">${escapeHtml(n.title)}</div>
      <p>${escapeHtml(n.body)}</p>
      <div class="row">
        <button data-edit="${n.id}">Edit</button>
        <button data-del="${n.id}" class="danger">Delete</button>
      </div>
    `;
    list.appendChild(el);
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;');
}

async function createNote() {
  const title = document.getElementById('title').value.trim();
  const body = document.getElementById('body').value.trim();
  const msg = document.getElementById('msg');
  if (!title || !body) { msg.textContent = 'Title and body are required.'; return; }

  await refreshCsrf();
  const res = await fetch('/api/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-csrf-token': CSRF },
    credentials: 'include',
    body: JSON.stringify({ title, body })
  });

  if (res.ok) {
    document.getElementById('title').value = '';
    document.getElementById('body').value = '';
    msg.textContent = 'Note added.';
    await listNotes();
  } else {
    const e = await res.json().catch(()=>({error:'Failed'}));
    msg.textContent = e.error || 'Error creating note.';
  }
}

async function updateNote(id, title, body) {
  await refreshCsrf();
  const res = await fetch(`/api/notes/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-csrf-token': CSRF },
    credentials: 'include',
    body: JSON.stringify({ title, body })
  });
  return res.ok;
}

async function deleteNote(id) {
  await refreshCsrf();
  const res = await fetch(`/api/notes/${id}`, {
    method: 'DELETE',
    headers: { 'x-csrf-token': CSRF },
    credentials: 'include'
  });
  return res.ok;
}

function attachListHandlers() {
  document.getElementById('list').addEventListener('click', async (e) => {
    const editId = e.target.getAttribute('data-edit');
    const delId  = e.target.getAttribute('data-del');

    if (editId) {
      // inline edit UI
      const card = e.target.closest('.note');
      const currentTitle = card.querySelector('.title').textContent;
      const currentBody  = card.querySelector('p').textContent;

      card.innerHTML = `
        <div class="row"><input id="etitle" value="${currentTitle}" maxlength="120"/></div>
        <div class="row"><textarea id="ebody" rows="4" maxlength="5000">${currentBody}</textarea></div>
        <div class="row">
          <button data-save="${editId}">Save</button>
          <button data-cancel>Cancel</button>
        </div>
      `;
    }

    if (delId) {
      if (confirm('Delete this note?')) {
        const ok = await deleteNote(delId);
        if (ok) await listNotes();
        else alert('Delete failed.');
      }
    }

    const saveId = e.target.getAttribute('data-save');
    if (saveId) {
      const card = e.target.closest('.note');
      const t = card.querySelector('#etitle').value.trim();
      const b = card.querySelector('#ebody').value.trim();
      if (!t || !b) { alert('Title and body required.'); return; }
      const ok = await updateNote(saveId, t, b);
      if (ok) await listNotes();
      else alert('Update failed.');
    }

    if (e.target.hasAttribute('data-cancel')) {
      await listNotes();
    }
  });
}

(async function init() {
  const me = await ensureAuth();
  if (!me) return;
  document.getElementById('create').addEventListener('click', createNote);
  attachListHandlers();
  await listNotes();
})();
