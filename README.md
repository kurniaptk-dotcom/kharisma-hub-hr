# Kharisma Hub — Sistem Manajemen SDM & HR Enterprise

Kharisma Hub adalah aplikasi manajemen Sumber Daya Manusia (SDM) komprehensif berbasis web dengan desain antarmuka modern, bersih, dan berstandar SaaS enterprise.

## Fitur Utama

- **Dasbor Eksekutif:** Metrik karyawan, grafik kehadiran, tinjauan kepuasan kerja, status kepegawaian, daftar tugas, dan aktivitas terbaru.
- **Direktori Karyawan:** Manajemen data karyawan dengan mode tampilan tabel dan grid, form tambah & edit karyawan, serta profil detail.
- **Kalender Kerja & Agenda:** Penjadwalan agenda rekrutmen, orientasi, pelatihan, dan evaluasi dengan sistem filter kategori.
- **Presensi & Kehadiran:** Pelacakan jam masuk/pulang (Clock In/Out), status keterlambatan, cuti, absensi, serta rekapitulasi kehadiran bulanan.
- **KPI & Target:** Indikator kinerja utama, capaian departemen, evaluasi target (*Exceeded*, *On Track*, *At Risk*), dan manajemen hak akses admin/supervisor.
- **Manajemen Penggajian (Payroll):** Rekapitulasi gaji pokok, tunjangan, lembur, potongan, dan cetak slip gaji resmi (*Payslip*).
- **Pengajuan Cuti (Leave Management):** Pengajuan cuti terstruktur beserta alur persetujuan (*Approved / Pending / Rejected*).
- **Kotak Masuk (Inbox):** Manajemen komunikasi internal dengan fitur folder, label, pencarian, dan composer pesan.
- **Koneksi Supabase Cloud:** Terintegrasi dengan Supabase Auth dan database untuk data SDM.

## Integrasi Supabase

- **Project URL:** `https://wirgqezinegebauddmgy.supabase.co`
- Masukkan *Supabase Anon Key* melalui menu **Pengaturan** di dalam aplikasi untuk mengaktifkan sinkronisasi database.

## Menjalankan Secara Lokal

```bash
# Menjalankan server lokal
npm start
# Buka http://localhost:3000 di browser
```

`server.js` adalah backend demo berbasis berkas lokal dan hanya bind ke `127.0.0.1`. Endpoint `/api/*` menolak akses dari origin lain. Jangan mengekspos server demo ini ke internet; deployment cloud harus memakai fungsi serverless di folder `api/` dengan environment Supabase yang sudah dikonfigurasi.

## Lisensi

Hak Cipta © 2026 PT Kharisma Group Indonesia. All rights reserved.

# Penyiapan Login Supabase

Login memakai proyek Supabase yang sudah dikonfigurasi di `supabaseClient.js`.

1. Jalankan `supabase/schema.sql`, lalu `supabase/auth-hardening.sql`, kemudian `supabase/attendance-optimization.sql` di SQL Editor proyek tersebut. Migration terakhir menambahkan shift, geofence, sesi istirahat, koreksi, dan persetujuan lembur.
2. Salin **anon/public key** Supabase ke Pengaturan aplikasi. Key ini boleh digunakan di browser; jangan masukkan service-role key di aplikasi.
3. Buat pengguna pertama melalui Supabase Dashboard → Authentication → Users. Setelah akun dibuat, promosikan sebagai administrator di SQL Editor:

   ```sql
   update public.user_profiles
   set role = 'Admin', department = 'Human Resources', title = 'Administrator SDM'
   where email = 'email-admin-anda@example.com';
   ```

4. Atur environment server `SUPABASE_ANON_KEY` dan `SUPABASE_SERVICE_ROLE_KEY`. Service-role key hanya dipakai API server untuk memvalidasi role admin dan mengundang atau mengelola akun; jangan pernah dipasang sebagai key browser.
5. Tambahkan origin aplikasi (lokal dan produksi) ke Authentication → URL Configuration → Redirect URLs. Atur SMTP email untuk undangan dan reset kata sandi sebelum dipakai pengguna.
6. Nonaktifkan public sign-up di Authentication → Settings agar akun hanya dibuat melalui undangan administrator. Login dengan administrator pertama. Undangan pengguna berikutnya tersedia di KPI → Manajemen Pengguna. Pengguna baru menerima tautan untuk mengatur kata sandi sendiri.

Setelah migration absensi dijalankan, buka menu **Kehadiran** sebagai admin untuk mengatur koordinat dan radius kantor, membuat shift, lalu menetapkan shift kepada karyawan. Akun karyawan harus ditautkan ke `user_profiles.employee_id`; supervisor dapat menetapkan shift kepada karyawan dalam departemennya. Izin GPS diperlukan, dan browser harus berjalan pada HTTPS atau `localhost`.

Jika anon key belum dikonfigurasi, aplikasi tetap terbuka dalam **mode demo lokal** dan tidak meminta login cloud. Mode ini hanya memakai simulasi akun lokal. Login Supabase mewajibkan sesi aktif dan profil dengan status `Active`.

  Data karyawan dan KPI disimpan ke cloud saat administrator mengubahnya; data presensi disimpan saat pengguna mencatat masuk atau pulang. Supervisor hanya dapat menyimpan KPI divisinya dan presensinya sendiri. Sinkronisasi massal dari Pengaturan hanya memproses data karyawan, KPI sesuai divisi/role, dan presensi pengguna yang sedang login. Login tidak mengirim data. Cuti dan kalender tidak termasuk sinkronisasi cloud.
