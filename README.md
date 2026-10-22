# KharismaHub  -  Sistem Manajemen SDM

KharismaHub adalah aplikasi HR berbasis web untuk mengelola data karyawan, kalender, kehadiran, KPI, cuti, dan penggajian. Aplikasi memakai Supabase Auth untuk sesi login serta Supabase Postgres dengan Row Level Security (RLS) untuk membatasi akses data.

## Menjalankan Secara Lokal

```bash
npm start
# Buka http://localhost:3000
```

`server.js` menyediakan backend lokal/demo. Alur autentikasi Supabase lengkap (undangan, aktivasi, dan pengelolaan akun) berjalan pada fungsi serverless di folder `api/`; gunakan deployment Vercel untuk alur tersebut. Jangan mengekspos backend lokal ke internet.

## Setup Supabase

Jalankan SQL Editor Supabase dalam urutan berikut:

1. `supabase/schema.sql`
2. `supabase/auth-hardening.sql`
3. `supabase/attendance-optimization.sql`
4. `supabase/login-auth-v2.sql`

Migrasi terakhir memperluas peran menjadi `Admin`, `Supervisor` (label UI: Atasan), dan `Employee` (Karyawan); status akun menjadi `Pending`, `Active`, atau `Inactive`; menautkan profil ke data karyawan; serta memasang kebijakan RLS berbasis peran dan departemen. Penulisan presensi wajib melalui RPC transisi agar waktu, lokasi, dan persetujuan tidak dapat dipalsukan lewat REST langsung.

Di Supabase Authentication:

- Nonaktifkan pendaftaran publik (*public sign-up*). Akun karyawan dibuat melalui undangan admin.
- Tambahkan URL produksi `https://kharismahub.vercel.app/**` dan URL lokal `http://localhost:3000/**` ke daftar Redirect URLs.
- Siapkan SMTP agar undangan dan tautan pemulihan kata sandi dapat terkirim.
- Akun undangan berstatus `Pending` sampai pengguna membuka undangan, membuat kata sandi, lalu profil lolos validasi tautan karyawan/departemen.

Buat pengguna admin pertama melalui Supabase Dashboard  >  Authentication  >  Users. Setelah profil terbentuk, aktifkan dan promosikan akun itu dari SQL Editor:

```sql
update public.user_profiles
set role = 'Admin', status = 'Active', department = 'Human Resources', title = 'Administrator SDM'
where lower(email) = lower('email-admin-anda@example.com');
```

Akun admin pertama harus memiliki kata sandi yang ditetapkan melalui Supabase Dashboard atau tautan pemulihan kata sandi. Undangan akun berikutnya tersedia pada menu Manajemen Pengguna.

## Environment Vercel

Pada Vercel  >  Project Settings  >  Environment Variables, isi untuk Production, Preview, dan Development sesuai kebutuhan:

- `SUPABASE_URL`  -  URL proyek Supabase.
- `SUPABASE_ANON_KEY`  -  anon/public key; endpoint `/api/config` mengirim key ini ke browser.
- `SUPABASE_SERVICE_ROLE_KEY`  -  service-role key, hanya untuk fungsi server. Tandai sebagai rahasia dan jangan gunakan nama variabel `NEXT_PUBLIC_*`.

`/api/config` hanya mengirim URL, anon key, dan status konfigurasi. Service-role key tidak pernah dikirim ke browser. Jika variabel server belum lengkap, aplikasi sengaja tetap terkunci pada halaman login dan menampilkan konfigurasi yang perlu dilengkapi; aplikasi tidak membuka data demo sebagai pengganti sesi produksi.

## Peran dan Akses

- **Admin:** mengelola seluruh data dan akun.
- **Atasan / Supervisor:** mengakses karyawan dan proses persetujuan di departemennya.
- **Karyawan / Employee:** mengakses profil dan aktivitas miliknya sendiri.

Peran, status, dan tautan `employee_id` hanya dapat diubah melalui tindakan admin. Setiap data karyawan harus memiliki email unik agar undangan Employee dapat ditautkan dengan benar. Jangan menghapus tabel atau menonaktifkan RLS setelah migrasi.

Setelah migrasi absensi, admin mengatur koordinat dan radius kantor melalui menu Kehadiran. Atasan dapat menetapkan shift bagi karyawan di departemennya. Presensi memerlukan izin GPS dan browser HTTPS (atau localhost).
\n