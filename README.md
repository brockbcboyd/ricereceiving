# Rice Receiving V3
Independent replacement receiving appointment system.

## V3 fixes
- Removed native SQLite/better-sqlite3 dependency that crashed in GitHub Codespaces.
- Uses a simple JSON data store for private test/development runs.
- Admin login is password-only, matching the existing public admin workflow more closely.
- `ADMIN_PASSWORD` is read directly at login; changing it no longer requires recreating an admin record.
- Appointment create/edit/remove audit history is stored in `rice-data.json`.
- Server-side validation and slot collision protection apply to both driver bookings and admin edits.
- Local-date-safe scheduling for America/Chicago.
- Fixed five-step progress labels and mobile presentation.

## Codespaces
```bash
export ADMIN_PASSWORD='your-test-password'
export SESSION_SECRET=$(openssl rand -hex 32)
npm install
npm start
```
Open port 3000. Driver: `/` and Admin: `/admin`.

## Production note
The JSON store is intentionally dependency-free for reliable testing. Before production cutover, replace it with managed PostgreSQL so data survives horizontal scaling and managed-host redeployments.
