# CycleCountAppStark - Verification & Security Notes

## Langkah Verifikasi Pasca-Migrasi

### 1. Verifikasi Objek Database

Jalankan query berikut di PostgreSQL client (psql, pgAdmin, atau SQL editor) untuk memastikan semua objek terbuat:

```sql
-- Cek semua tabel
SELECT schemaname, tablename, tableowner
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- Cek semua indeks
SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

-- Cek semua constraint
SELECT conname, conrelid::regclass, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid IN (
    SELECT oid FROM pg_class
    WHERE relname IN ('profiles', 'categories', 'locations', 'items', 'sessions', 'session_users', 'session_items', 'counts')
)
ORDER BY conrelid::regclass, conname;

-- Cek semua policies RLS
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

### 2. Verifikasi Otorisasi API (Hono + JWT)

Akses data sekarang di-enforce oleh server Hono (`server/src/authorize.js`), bukan RLS.

#### Test sebagai Admin (JWT role `admin`):
- `GET /rest/profiles` — semua profil
- `GET /rest/sessions` — semua sesi
- `POST /rest/categories` — berhasil
- `POST /rest/rpc/soft_delete_location` — berhasil

#### Test sebagai Counter (JWT role `user`):
- `GET /rest/profiles` — hanya profil sendiri
- `GET /rest/sessions` — hanya sesi yang di-assign via `session_users`
- `POST /rest/categories` — ditolak (403)
- `POST /rest/counts` pada sesi yang tidak di-assign — ditolak (403)

### 3. Test Realtime Subscription

```sql
-- Test realtime untuk counts:
SELECT * FROM counts WHERE session_id = 'test-session-id' LIMIT 1;

-- Di tab/window lain, insert count baru:
INSERT INTO counts (session_id, item_id, user_id, location_id, counted_qty)
VALUES ('test-session-id', 'item-id', auth.uid(), 'location-id', 5);

-- Kembali ke tab pertama, harus menerima update realtime
```

## Catatan Keamanan dan Stabilitas

### 1. Model Keamanan API Hono

**Prinsip otorisasi yang diterapkan di `server/src/authorize.js`:**
- **Admin Bypass**: Admin dapat mengakses semua data melalui API
- **User Ownership**: Data milik user yang membuat (`created_by`) atau assigned
- **Session-based Access**: Counter hanya bisa akses session yang di-assign
- **Public Read Data**: Items, locations, categories bisa dibaca authenticated users

**Dampak terhadap Query:**
- Query SELECT difilter oleh Hono sebelum masuk ke PostgreSQL
- INSERT/UPDATE/DELETE divalidasi oleh Hono sebelum query dieksekusi
- Tidak ada service-role Supabase; server memakai `DATABASE_URL` dan JWT role claims

### 2. Pencegahan SQL Injection

- Query server memakai parameterized queries melalui `pg`
- Dynamic identifiers divalidasi/di-quote di `server/src/queryBuilder.js` dan REST routes
- Foreign key constraints mencegah orphaned records

### 3. Performa dan Optimisasi

**Indeks Strategis:**
- Foreign key indexes untuk JOIN performance
- GIN indexes untuk array tags dan full-text search
- Partial index untuk active sessions (hanya pada sessions table)
- Composite indexes untuk common query patterns

**Query Patterns yang Dioptimasi:**
- Session listing dengan status filter
- Item search by SKU/name/tags
- Count aggregation per session
- Real-time subscriptions

### 4. Data Integrity

**Constraints yang Diterapkan:**
- CHECK constraints untuk positive quantities
- UNIQUE constraints untuk business keys (SKU, session-item pairs)
- Foreign key constraints dengan CASCADE/RESTRICT sesuai kebutuhan
- Enum types untuk controlled vocabularies

### 5. Audit dan Logging

**Yang Dicatat:**
- Semua counts dengan timestamp dan user_id
- Session assignments dengan assigned_at
- Created/updated timestamps pada semua entities

**Tidak Diperlukan:** Full audit logging karena data cycle count sudah historical

### 6. Rollback Strategy

**Urutan Rollback Aman:**
1. Drop policies (mencegah akses selama cleanup)
2. Drop triggers dan functions
3. Drop indexes
4. Drop tables (dalam urutan dependency terbalik)
5. Drop enums

**Peringatan:** Rollback akan menghapus semua data - backup diperlukan untuk production

### 7. Production Considerations

**Environment Variables:**
- Frontend: pastikan `VITE_API_URL` mengarah ke server Hono
- Server: pastikan `DATABASE_URL`, `JWT_SECRET`, `PORT`, dan `CORS_ORIGIN` sudah benar

**Monitoring:**
- Monitor RLS policy performance
- Watch untuk slow queries pada large datasets
- Monitor realtime connection limits

**Backup Strategy:**
- Regular backup sebelum migration
- Test rollback procedure di staging environment
- Document data migration scripts jika ada data existing

## Instruksi Eksekusi di PostgreSQL Client

### 1. Persiapan
- Backup database production (jika ada data existing)
- Pastikan environment variables sudah dikonfigurasi
- Test di staging environment terlebih dahulu

### 2. Eksekusi Migration UP
1. Buka PostgreSQL client (`psql`, pgAdmin, atau SQL editor provider database)
2. Jalankan seluruh isi `migration_up.sql`
3. Jalankan `realtime_notify_triggers.sql` jika realtime WebSocket dibutuhkan
4. Verifikasi dengan queries di bagian verifikasi

### 3. Testing
1. Test login sebagai admin user
2. Test login sebagai counter user
3. Test semua CRUD operations sesuai role
4. Test realtime updates

### 4. Rollback (jika diperlukan)
1. Copy paste seluruh isi `migration_down.sql`
2. Jalankan rollback sampai selesai
3. Restore dari backup jika diperlukan

### 5. Post-Migration
1. Update aplikasi dengan table references yang baru
2. Test end-to-end functionality
3. Monitor performance dan error logs
4. Update dokumentasi API jika diperlukan

## Troubleshooting

### Error Umum:
1. **Extension not found**: Pastikan pgcrypto dan uuid-ossp tersedia
2. **Policy conflicts**: Drop existing policies sebelum recreate
3. **Permission denied**: Pastikan menjalankan sebagai service role atau owner
4. **API returns 403**: Check JWT role, `server/src/authorize.js`, dan session assignment data
5. **Realtime tidak update**: Pastikan trigger NOTIFY terpasang dan table ada di curated list `server/src/realtime.js`

### Debug Queries:
```sql
-- Check profile exists
SELECT id, email, role, status FROM profiles WHERE email = 'user@example.com';

-- Test session assignment manually
SELECT s.*
FROM sessions s
JOIN session_users su ON su.session_id = s.id
WHERE su.user_id = 'user-uuid-here'
LIMIT 1;
