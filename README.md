# Rice Receiving replacement — Version 2
Independent receiving appointment system matching the current Rice driver/admin workflow.

## V2 additions
- Five-step driver flow with visible step names: Your info → Pick a date → Truck type → Pick a time → Confirm.
- Local-date-safe weekday scheduling (avoids UTC date drift).
- Advance-booking and weekend validation enforced on the server, not only in the browser.
- Server-side validation now applies to admin edits too.
- 30-minute slot collision protection.
- Admin Today / Week / Month / 60 Days counts and views.
- Edit/remove flow with removal confirmation.
- Appointment audit log for create/update/remove actions.
- Production session cookies become secure automatically under NODE_ENV=production.
- Mobile-friendly booking and admin UI.

## Run locally
1. Install Node.js 20+.
2. `npm install`
3. Set `ADMIN_PASSWORD` and `SESSION_SECRET`.
4. `npm start`
5. Driver site: http://localhost:3000/
6. Admin: http://localhost:3000/admin

## Production cutover checklist
- Confirm exact Rice receiving hours, holidays/blackout dates, truck-specific slot lengths/capacity, and exact production wording.
- Replace SQLite with managed Postgres if deploying across multiple server instances.
- Prefer named administrator accounts + MFA for the production admin portal.
- Export/migrate all future appointments from the existing system immediately before cutover.
- Keep the old site live until the replacement passes side-by-side acceptance testing.
- Rotate domain/DNS, hosting, database, email/SMS/API, recovery and old developer credentials during cutover.
