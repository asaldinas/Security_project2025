// db.js
const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, 'campushub.sqlite'));

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    sub TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    name TEXT,
    picture TEXT
  );

  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    owner_sub TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (owner_sub) REFERENCES users(sub) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS notes_owner_idx ON notes(owner_sub);
`);

module.exports = {
  upsertUser(user) {
    const stmt = db.prepare(`
      INSERT INTO users (sub, email, name, picture)
      VALUES (@sub, @email, @name, @picture)
      ON CONFLICT(sub) DO UPDATE SET email=excluded.email, name=excluded.name, picture=excluded.picture
    `);
    stmt.run(user);
  },
  listNotes(ownerSub) {
    return db.prepare(`SELECT id, title, body, created_at, updated_at FROM notes WHERE owner_sub = ? ORDER BY updated_at DESC`).all(ownerSub);
  },
  createNote(ownerSub, note) {
    const stmt = db.prepare(`INSERT INTO notes (id, owner_sub, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`);
    const now = Date.now();
    stmt.run(note.id, ownerSub, note.title, note.body, now, now);
  },
  updateNote(ownerSub, id, patch) {
    const now = Date.now();
    const res = db.prepare(
      `UPDATE notes SET title = ?, body = ?, updated_at = ? WHERE id = ? AND owner_sub = ?`
    ).run(patch.title, patch.body, now, id, ownerSub);
    return res.changes > 0;
  },
  deleteNote(ownerSub, id) {
    const res = db.prepare(`DELETE FROM notes WHERE id = ? AND owner_sub = ?`).run(id, ownerSub);
    return res.changes > 0;
  }
};
