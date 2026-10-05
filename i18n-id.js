(() => {
  const translations = {
    'Dashboard': 'Dasbor', 'Inbox': 'Kotak Masuk', 'Calendar': 'Kalender', 'Employees': 'Karyawan',
    'Attendance': 'Kehadiran', 'Performance': 'Kinerja', 'KPI & Targets': 'KPI & Target', 'Payroll': 'Penggajian', 'Leave Management': 'Manajemen Cuti', 'Recruitment': 'Rekrutmen',
    'Employee Details': 'Detail Karyawan', 'Add New Employee': 'Tambah Karyawan', 'Employee List': 'Daftar Karyawan',
    'Employee Attendance': 'Kehadiran Karyawan', 'Attendance Report': 'Laporan Kehadiran', 'Team Performance': 'Kinerja Tim',
    'Performance by Category': 'Kinerja berdasarkan Kategori', 'Average Performance': 'Rata-rata Kinerja', 'Employee Performance': 'Kinerja Karyawan',
    'Top Performers': 'Karyawan Berkinerja Terbaik', 'Time Management Alerts': 'Peringatan Manajemen Waktu', 'Payroll List': 'Daftar Penggajian',
    'Payroll Overview': 'Ringkasan Penggajian', 'Payroll Breakdown': 'Rincian Penggajian', 'Leave Overview': 'Ringkasan Cuti',
    'Leave Activity': 'Aktivitas Cuti', 'Leave Types': 'Jenis Cuti', 'Current Vacancies': 'Lowongan Saat Ini',
    'Application by Department': 'Lamaran berdasarkan Departemen', 'Applicant Resources': 'Sumber Pelamar', 'Schedules': 'Jadwal',
    'Details Schedule': 'Detail Jadwal', 'Personal Info': 'Informasi Pribadi', 'Hours Logged': 'Jam Kerja Tercatat',
    'Documents': 'Dokumen', 'Internal Notes': 'Catatan Internal', 'Payroll Summary': 'Ringkasan Penggajian',
    'Total Employees': 'Total Karyawan', 'New Employees (This Month)': 'Karyawan Baru (Bulan Ini)', 'Turnover Rate': 'Tingkat Pergantian Karyawan',
    'Resigned Employees (This Month)': 'Karyawan Mengundurkan Diri (Bulan Ini)', 'Total All Schedules': 'Total Semua Jadwal',
    'Talent Acquisition': 'Akuisisi Talenta', 'Employee Development': 'Pengembangan Karyawan', 'Workplace Engagement': 'Keterlibatan Karyawan',
    'Job Applicants': 'Pelamar Kerja', 'Leave Requests': 'Permintaan Cuti', 'Employment Status': 'Status Kepegawaian',
    'Employee Satisfaction': 'Kepuasan Karyawan', 'Tasks': 'Tugas', 'Recent Activities': 'Aktivitas Terkini',
    'New Message': 'Pesan Baru', 'New message': 'Pesan baru', 'New Agenda': 'Agenda Baru', 'New Employee': 'Karyawan Baru', 'Add employee': 'Tambah karyawan',
    'Add Applicant': 'Tambah Pelamar', 'Add candidate': 'Tambah kandidat', 'Create item': 'Buat item', 'Create review cycle': 'Buat periode penilaian',
    'Full name': 'Nama lengkap', 'Work email': 'Email kantor', 'Department': 'Departemen', 'Job title': 'Jabatan', 'Event title': 'Judul acara',
    'Position': 'Posisi', 'Candidate name': 'Nama kandidat', 'Email': 'Email', 'Start date': 'Tanggal mulai', 'End date': 'Tanggal selesai',
    'Date': 'Tanggal', 'Time': 'Waktu', 'Location': 'Lokasi', 'Note': 'Catatan', 'Review cycle name': 'Nama periode penilaian',
    'Review type': 'Jenis penilaian', 'Leave type': 'Jenis cuti', 'Optional note for your manager': 'Catatan opsional untuk manajer',
    'Search anything...': 'Cari apa saja...', 'Search anything': 'Cari apa saja', 'Search employee': 'Cari karyawan', 'Search employee, ID, etc': 'Cari karyawan, ID, dan lainnya',
    'Search applicant': 'Cari pelamar', 'Search email': 'Cari email', 'Filter': 'Saring', 'Sort by:': 'Urutkan:', 'Sort by': 'Urutkan',
    'Name': 'Nama', 'NAME': 'NAMA', 'Employee ID': 'ID Karyawan', 'Job Title': 'Jabatan', 'Applied Date': 'Tanggal Melamar',
    'Application Received': 'Lamaran Diterima', 'Status (Stage)': 'Status (Tahap)', 'Work Model': 'Model Kerja', 'Join Date': 'Tanggal Bergabung',
    'Employment Type': 'Jenis Kepegawaian', 'Check In - Out': 'Jam Masuk - Pulang', 'Check In': 'Jam Masuk', 'Check Out': 'Jam Pulang',
    'Duration': 'Durasi', 'Overtime': 'Lembur', 'Salary': 'Gaji', 'Allowances': 'Tunjangan', 'Incentives': 'Insentif',
    'Deductions': 'Potongan', 'Total': 'Total', 'Payslip': 'Slip Gaji', 'Description': 'Deskripsi', 'Amount': 'Jumlah',
    'Show': 'Tampilkan', 'of': 'dari', 'results': 'data', 'All': 'Semua', 'All Department': 'Semua Departemen', 'All Position': 'Semua Posisi',
    'All statuses': 'Semua status', 'All employees': 'Semua karyawan', 'All vacancies': 'Semua lowongan', 'This Month': 'Bulan Ini',
    'Last Month': 'Bulan Lalu', 'last month': 'bulan lalu', 'Last 6 Months': '6 Bulan Terakhir', 'Last 3 Months': '3 Bulan Terakhir', 'Last Year': 'Tahun Lalu',
    'This Week': 'Minggu Ini', 'Today': 'Hari Ini', 'Yesterday': 'Kemarin', 'Just now': 'Baru saja', 'June': 'Juni', 'Jun': 'Jun', 'Month': 'Bulan', 'Week': 'Minggu',
    'Mon': 'Sen', 'Tue': 'Sel', 'Wed': 'Rab', 'Thu': 'Kam', 'Fri': 'Jum', 'Sat': 'Sab', 'Sun': 'Min',
    'Present': 'Hadir', 'On-Time': 'Tepat Waktu', 'Late': 'Terlambat', 'On Leave': 'Cuti', 'Absent': 'Tidak Hadir',
    'Active': 'Aktif', 'Approved': 'Disetujui', 'Pending': 'Menunggu', 'Pending Review': 'Menunggu Tinjauan', 'Rejected': 'Ditolak',
    'Declined': 'Ditolak', 'Paid': 'Dibayar', 'Applied': 'Melamar', 'All statuses': 'Semua status', 'Interview Scheduled': 'Wawancara Terjadwal',
    'Final Interview': 'Wawancara Akhir', 'Test Completed': 'Tes Selesai', 'Application Received': 'Lamaran Diterima',
    'Full-Time': 'Penuh Waktu', 'Part-Time': 'Paruh Waktu', 'Internship': 'Magang', 'Freelance': 'Lepas',
    'Remote': 'Jarak Jauh', 'On-Site': 'Di Kantor', 'Hybrid': 'Hibrida', 'Annual Leave': 'Cuti Tahunan', 'Annual leave': 'Cuti tahunan',
    'Sick Leave': 'Cuti Sakit', 'Casual Leave': 'Cuti Pribadi', 'Other Leaves': 'Cuti Lainnya', 'Personal': 'Pribadi',
    'Days': 'Hari', 'Hours': 'Jam', 'Employees': 'Karyawan', 'Employee': 'Karyawan', 'Days Off': 'Hari Libur',
    'Total Salary': 'Total Gaji', 'Total Allowances': 'Total Tunjangan', 'Total Overtime': 'Total Lembur', 'Total Incentives': 'Total Insentif',
    'Total Applicants': 'Total Pelamar', 'Total Monthly Value': 'Total Nilai Bulanan', 'Total Pay This Month': 'Total Gaji Bulan Ini',
    'Base Salary': 'Gaji Pokok', 'Benefits': 'Tunjangan Tambahan', 'Transportation': 'Transportasi', 'Meal': 'Uang Makan',
    'Health Insurance': 'Asuransi Kesehatan', 'Life Insurance': 'Asuransi Jiwa', 'Company Device': 'Perangkat Perusahaan',
    'Training Program': 'Program Pelatihan', 'Fitness Membership': 'Keanggotaan Kebugaran',
    'Gender': 'Jenis Kelamin', 'Date of Birth': 'Tanggal Lahir', 'Email Address': 'Alamat Email', 'Phone': 'Telepon', 'Address': 'Alamat',
    'Social Media': 'Media Sosial', 'Not provided': 'Belum diisi', 'Female': 'Perempuan', 'Male': 'Laki-laki',
    'Privacy Policy': 'Kebijakan Privasi', 'Term and conditions': 'Syarat dan Ketentuan', 'Contact': 'Kontak', 'Copyright': 'Hak Cipta',
    'TEAM DIRECTORY': 'DIREKTORI TIM', 'TEAMHUB WORKSPACE': 'RUANG KERJA KHARISMA HUB', 'KHARISMA HUB WORKSPACE': 'RUANG KERJA KHARISMA HUB', 'Cancel': 'Batal', 'Save': 'Simpan', 'Add employee': 'Tambah karyawan',
    'Save changes': 'Simpan perubahan', 'Submit request': 'Kirim permintaan', 'Send Message': 'Kirim Pesan', 'Save draft': 'Simpan draf',
    'Download': 'Unduh', 'Export report': 'Ekspor laporan', 'Export': 'Ekspor', 'Edit': 'Ubah', 'Delete': 'Hapus', 'Apply': 'Terapkan', 'Reset': 'Atur Ulang',
    'New calendar event': 'Acara kalender baru', 'Request time off': 'Ajukan cuti', 'Create item': 'Buat item',
    'e.g. Taylor Johnson': 'mis. Taylor Johnson', 'name@kharismahub.com': 'nama@kharismahub.com', 'nama@kharismahub.com': 'nama@kharismahub.com', 'e.g. Product Designer': 'mis. Desainer Produk',
    'e.g. Team planning': 'mis. Rapat tim', 'Meeting room or video link': 'Ruang rapat atau tautan video', 'Full name': 'Nama lengkap',
    'Open role': 'Posisi yang tersedia', 'e.g. Q3 2035 review': 'mis. Penilaian Triwulan 3 2035', 'Performance review': 'Penilaian kinerja',
    'Probation review': 'Penilaian masa percobaan', 'Peer feedback': 'Umpan balik rekan kerja', 'TEAMHUB WORKSPACE': 'RUANG KERJA KHARISMA HUB', 'KHARISMA HUB WORKSPACE': 'RUANG KERJA KHARISMA HUB',
    'Hello Davis!': 'Halo, Davis!', 'Good Morning': 'Selamat Pagi', "You're part of a": 'Anda adalah bagian dari', "You've submitted": 'Anda telah mengajukan',
    'growing team!': 'tim yang terus berkembang!', 'Your attendance this month is looking': 'Kehadiran Anda bulan ini terlihat', 'solid': 'baik',
    'Your team has': 'Tim Anda memiliki', 'new applicants': 'pelamar baru', 'compared to last month': 'dibandingkan bulan lalu',
    'Increased vs last week': 'Meningkat dibandingkan minggu lalu', 'Attendance Rate': 'Tingkat Kehadiran', 'Employees': 'Karyawan',
    'New Recruit Introduction': 'Pengenalan Rekrut Baru', 'Personal Growth Session — Leadership Track': 'Sesi Pengembangan Diri — Jalur Kepemimpinan',
    'Interview — Product Designer Candidate': 'Wawancara — Kandidat Desainer Produk', 'Mid-Year Performance Review — Design Dept': 'Penilaian Kinerja Tengah Tahun — Departemen Desain',
    'Quarterly Policy Review Meeting': 'Rapat Tinjauan Kebijakan Triwulanan', 'Remote Work Compliance Briefing': 'Pengarahan Kepatuhan Kerja Jarak Jauh',
    'Complete pre-session survey for Leadership Track': 'Lengkapi survei sebelum sesi Jalur Kepemimpinan',
    'Join Remote Work Compliance Briefing': 'Ikuti pengarahan kepatuhan kerja jarak jauh', 'Prepare Q3 recruitment planning materials': 'Siapkan materi perencanaan rekrutmen Triwulan 3',
    'Compensation & Benefits': 'Kompensasi & Tunjangan', 'Work Culture': 'Budaya Kerja', 'Work-Life Balance': 'Keseimbangan Kerja dan Kehidupan',
    'Career Growth Opportunities': 'Peluang Pengembangan Karier', 'Leave Request Approval': 'Persetujuan Permintaan Cuti',
    'Updated Contact Info': 'Pembaruan Informasi Kontak', 'Medical Leave Submission': 'Pengajuan Cuti Sakit',
    'Performance Review Reminder': 'Pengingat Penilaian Kinerja', 'Attendance Clarification': 'Klarifikasi Kehadiran',
    'Password Expiry Alert': 'Peringatan Kata Sandi Kedaluwarsa', 'Leave Policy Update': 'Pembaruan Kebijakan Cuti',
    'Hi there,': 'Halo,', 'Thanks so much!': 'Terima kasih!', 'Please let me know if you need anything else from my side.': 'Beri tahu saya jika ada hal lain yang diperlukan.',
    'The request is still marked as pending, and I wanted to confirm if any additional documents are needed.': 'Permintaan ini masih berstatus menunggu. Saya ingin memastikan apakah ada dokumen tambahan yang diperlukan.',
    'No message selected.': 'Tidak ada pesan yang dipilih.', 'Showing attendance for': 'Menampilkan kehadiran untuk',
    'Calendar updated for': 'Kalender diperbarui untuk', 'Calendar view changed': 'Tampilan kalender diubah',
    'Careers page preview is ready to connect': 'Pratinjau halaman karier siap dihubungkan', 'Candidate profile opened': 'Profil kandidat dibuka',
    'Record details opened': 'Detail data dibuka', 'Clocked in': 'Berhasil presensi masuk', 'Clocked out': 'Berhasil presensi pulang',
    'Task completed:': 'Tugas selesai:', 'Task reopened:': 'Tugas dibuka kembali:',
    'Pay run checklist opened. Payroll actions are demo only.': 'Daftar periksa penggajian dibuka. Tindakan penggajian hanya simulasi.',
    'Attendance table is not available to export': 'Tabel kehadiran tidak tersedia untuk diekspor', 'Payroll report export is available in this demo workspace.': 'Ekspor laporan penggajian tersedia di ruang kerja demo ini.',
    'You’re all caught up on notifications.': 'Tidak ada notifikasi baru.', 'Signed in as Davis Levin.': 'Masuk sebagai Davis Levin.',
    'More options are ready to customize.': 'Opsi lainnya siap disesuaikan.', 'Your team updates and messages in one place.': 'Pembaruan dan pesan tim Anda dalam satu tempat.',
    'Plan interviews, reviews and team events.': 'Atur wawancara, penilaian, dan acara tim.', 'Manage your people, roles and team details.': 'Kelola karyawan, jabatan, dan informasi tim.',
    'Review check-ins, hours and attendance records.': 'Tinjau presensi, jam kerja, dan catatan kehadiran.', 'Track goals, reviews and team progress.': 'Pantau sasaran, penilaian, dan kemajuan tim.',
    'Manage payroll cycles and compensation records.': 'Kelola siklus penggajian dan catatan kompensasi.', 'Review time off requests and team availability.': 'Tinjau permintaan cuti dan ketersediaan tim.',
    'Track applicants through your hiring pipeline.': 'Pantau pelamar dalam proses rekrutmen.', 'View employee profile, leave and payroll information.': 'Lihat profil karyawan, cuti, dan informasi penggajian.',
    'Browse employees in a visual directory.': 'Jelajahi karyawan melalui direktori visual.', 'Create a profile for a new team member.': 'Buat profil anggota tim baru.',
    'Total All Schedules': 'Total Semua Jadwal', 'Last 6 Months': '6 Bulan Terakhir', 'Last 3 Months': '3 Bulan Terakhir',
    'This Year': 'Tahun Ini', 'Departments': 'Departemen', 'Status': 'Status', 'Interview': 'Wawancara', 'Admin Notes': 'Catatan Admin',
    'Starred': 'Berbintang', 'Sent': 'Terkirim', 'Drafts': 'Draf', 'Trash': 'Sampah', 'Reply': 'Balas', 'Forward': 'Teruskan',
    'To:': 'Kepada:', 'Type something...': 'Tulis pesan...', 'from': 'dari', 'for': 'untuk', 'the': 'tersebut',
    'Interview Schedules': 'Jadwal Wawancara', 'Leave Schedules': 'Jadwal Cuti', 'Teamwork': 'Kerja Tim', 'Work Quality': 'Kualitas Kerja',
    'Problem-Solving': 'Pemecahan Masalah', 'Time Management': 'Manajemen Waktu', 'Other Leave': 'Cuti Lainnya', 'Public Holiday': 'Hari Libur Nasional',
    'Job Portal': 'Portal Kerja', 'Company Website': 'Situs Perusahaan', 'Employee Referral': 'Referensi Karyawan', 'Applicants': 'Pelamar', 'applicants': 'pelamar',
    'Marketing': 'Pemasaran', 'Executive Marketing': 'Eksekutif Pemasaran', 'UI Designer': 'Desainer UI', 'Product Designer': 'Desainer Produk', 'Data Analyst': 'Analis Data',
    'Product Design': 'Desain Produk', 'Lab Analyst': 'Analis Laboratorium', 'R&D': 'Riset dan Pengembangan', 'Site Supervisor': 'Pengawas Lapangan',
    'Operations': 'Operasional', 'Human Resources': 'Sumber Daya Manusia', 'Customer Service': 'Layanan Pelanggan', 'Compliance Specialist': 'Spesialis Kepatuhan',
    'Graphic Designer': 'Desainer Grafis', 'Training Coordinator': 'Koordinator Pelatihan', 'Customer Experience Lead': 'Ketua Pengalaman Pelanggan',
    'Customer Support Intern': 'Staf Magang Dukungan Pelanggan', 'Recruitment Assistant': 'Asisten Rekrutmen', 'UX Researcher': 'Peneliti UX',
    'Finance': 'Keuangan', 'Engineering': 'Teknik', 'Product': 'Produk', 'People & Culture': 'SDM & Budaya',
    'Interview — Product Designer': 'Wawancara — Desainer Produk', 'First Interview': 'Wawancara Pertama', 'HR Interview': 'Wawancara SDM',
    'Application by Department': 'Lamaran berdasarkan Departemen', 'Candidate': 'Kandidat', 'Candidates': 'Kandidat', 'Status': 'Status',
    'From last month': 'Dari bulan lalu', 'from last month': 'dari bulan lalu', 'of Total leave': 'dari total cuti', 'Total leave': 'Total cuti', 'Leave': 'Cuti',
    'Medical Leave': 'Cuti Sakit', 'Annual Leaves': 'Cuti Tahunan', 'Casual Leaves': 'Cuti Pribadi', 'Sick Leaves': 'Cuti Sakit',
    'Other Leaves': 'Cuti Lainnya', 'All Leaves': 'Semua Cuti', 'Employee Leaves': 'Cuti Karyawan',
    'Interview — Product Designer Candidate': 'Wawancara — Kandidat Desainer Produk', 'Mid-Year Performance Review — Design Dept': 'Penilaian Kinerja Tengah Tahun — Departemen Desain',
    'Performance Review Check-in — Marketing Team': 'Tinjauan Kinerja — Tim Pemasaran', 'Online Test Review': 'Tinjauan Tes Daring',
    'Leave Request Approval': 'Persetujuan Permintaan Cuti', 'Updated Contact Info': 'Pembaruan Informasi Kontak',
    "I've attached my doctor's note for the requested medical leave from June 20 to June 21.": 'Saya melampirkan surat dokter untuk pengajuan cuti sakit pada 20–21 Juni.',
    'Please review the newly updated 2035 leave policy document. It includes important updates on...': 'Silakan tinjau dokumen kebijakan cuti 2035 yang telah diperbarui. Dokumen ini memuat perubahan penting mengenai cuti.',
    'Just a quick heads-up that I\'ve updated my emergency contact details on my profile.': 'Saya ingin memberi tahu bahwa informasi kontak darurat di profil saya sudah diperbarui.',
    'Hi, I\'d like to follow up on my annual leave request for next month, from July 15 to July 19.': 'Halo, saya ingin menindaklanjuti permintaan cuti tahunan untuk bulan depan, tanggal 15 sampai 19 Juli.',
    'I\'d like to follow up on my annual leave request for the dates 15–19 July.': 'Saya ingin menindaklanjuti permintaan cuti tahunan untuk tanggal 15–19 Juli.',
    'A reminder to complete your self-assessment form as part of the performance review cycle.': 'Pengingat untuk mengisi formulir evaluasi mandiri dalam periode penilaian kinerja.',
    'Just wanted to clarify my absence earlier today. I experienced a personal emergency and...': 'Saya ingin menjelaskan ketidakhadiran saya hari ini. Saya mengalami keadaan darurat pribadi dan...',
    'I wanted to clarify my absence earlier today. I experienced a personal emergency and could not check in on time.': 'Saya ingin menjelaskan ketidakhadiran saya hari ini. Saya mengalami keadaan darurat pribadi sehingga tidak dapat melakukan presensi tepat waktu.',
    'Your current password will expire in 5 days. To maintain account security, please reset it via...': 'Kata sandi Anda akan kedaluwarsa dalam 5 hari. Demi keamanan akun, silakan atur ulang melalui...',
    'The document is available in the team workspace.': 'Dokumen tersedia di ruang kerja tim.',
    'HR Department': 'Departemen SDM', 'System Notification': 'Notifikasi Sistem', 'Leave Requests': 'Permintaan Cuti',
    'The request is still marked as pending, and I wanted to confirm if any additional documents are needed.': 'Permintaan ini masih menunggu. Saya ingin memastikan apakah ada dokumen tambahan yang diperlukan.',
    'this month': 'bulan ini', '2 leave requests': '2 permintaan cuti', 'approved 2 pending leave requests': 'menyetujui 2 permintaan cuti yang menunggu',
    'marked absent automatically due to no check-in': 'otomatis ditandai tidak hadir karena tidak melakukan presensi',
    'Low on-time rate for deliverables this month.': 'Tingkat ketepatan waktu penyelesaian tugas bulan ini rendah.',
    'of total leave': 'dari total cuti', '3 employees': '3 karyawan', '2 employees': '2 karyawan', '0 employees': '0 karyawan',
    'vs last month': 'dibandingkan bulan lalu', 'JOB TITLE': 'JABATAN', 'DATE': 'TANGGAL', 'STATUS': 'STATUS',
    'User': 'Pengguna', 'Mia Torres approved 2 pending leave requests': 'Mia Torres menyetujui 2 permintaan cuti yang menunggu',
    'Ethan Ray updated his emergency contact details': 'Ethan Ray memperbarui informasi kontak daruratnya',
    'June Team Update': 'Pembaruan Tim Bulan Juni', 'Sharing the latest people updates for June.': 'Berikut pembaruan terbaru untuk tim pada bulan Juni.',
    'Sharing the latest people updates for June. Please take a look at the calendar for upcoming events.': 'Berikut pembaruan terbaru untuk tim pada bulan Juni. Silakan lihat kalender untuk mengetahui agenda mendatang.',
    'Welcome aboard!': 'Selamat bergabung!', 'We are excited to have you join the Kharisma Hub team.': 'Kami senang Anda bergabung dengan tim Kharisma Hub.',
    'Welcome aboard! We are excited to have you join the Kharisma Hub team.': 'Selamat bergabung! Kami senang Anda menjadi bagian dari tim Kharisma Hub.',
    'Personal leave': 'Cuti pribadi', 'HR Administrator': 'Administrator SDM',
    'Jacob Yuen marked absent automatically due to no check-in': 'Jacob Yuen otomatis ditandai tidak hadir karena tidak melakukan presensi',
    'Level Up Your HR System': 'Tingkatkan Sistem SDM Anda', 'TeamHub Pro gives you full control with advanced modules and extended layouts.': 'TeamHub Pro memberi Anda kendali penuh melalui modul lanjutan dan tata letak yang lebih lengkap.',
    'Get Kharisma Pro': 'Dapatkan Kharisma Pro', 'Dapatkan Kharisma Pro': 'Dapatkan Kharisma Pro', 'That\'s an increase of 6% from last month': 'Ini meningkat 6% dibandingkan bulan lalu.',
    "That's an ": 'Ini ', 'increase of 6%': 'meningkat 6%', ' from last month': ' dibandingkan bulan lalu',
    ' approved 2 pending leave requests': ' menyetujui 2 permintaan cuti yang menunggu',
    ' updated his emergency contact details': ' memperbarui informasi kontak daruratnya',
    ' marked absent automatically due to no check-in': ' otomatis ditandai tidak hadir karena tidak melakukan presensi',
    'Satisfaction': 'Kepuasan', '78% Satisfaction': 'Kepuasan 78%', '74% Satisfaction': 'Kepuasan 74%', '71% Satisfaction': 'Kepuasan 71%', '68% Satisfaction': 'Kepuasan 68%',
    'Check In': 'Presensi Masuk', 'Check Out': 'Presensi Pulang', 'CHECK IN': 'PRESENSI MASUK', 'CHECK OUT': 'PRESENSI PULANG',
    'Late Arrival': 'Keterlambatan', '1 Late Arrival': '1 keterlambatan', 'Meeting Room': 'Ruang Rapat', 'Conference Room': 'Ruang Konferensi',
    'Notion Review Sheet': 'Lembar Tinjauan Notion', 'HR Officer': 'Staf SDM', 'HR Assistant': 'Asisten SDM',
    'Total Score': 'Skor Total', 'Total Performance': 'Kinerja Total', 'Growth': 'Pertumbuhan', 'Sans Serif': 'Tanpa Kait',
    'New Pay Run': 'Proses Gaji Baru', 'Prepare a payroll run': 'Siapkan Proses Penggajian', 'Pay period': 'Periode Gaji', 'Payment date': 'Tanggal Pembayaran',
    'Onboarding Session': 'Sesi Orientasi', 'Training Programs': 'Program Pelatihan', 'Coaching Sessions': 'Sesi Pendampingan', 'Company Events': 'Acara Perusahaan', 'Policies Deadlines': 'Tenggat Kebijakan',
    'Onboarding Session — New Hires Batch 3': 'Sesi Orientasi — Karyawan Baru Gelombang 3', 'Quarterly Policy Review': 'Tinjauan Kebijakan Triwulanan', 'Team Communication Workshop': 'Lokakarya Komunikasi Tim',
    'Upskilling Program: Advanced Excel': 'Program Peningkatan Keterampilan: Excel Tingkat Lanjut', 'Internal Team-Building Event': 'Acara Kebersamaan Internal Tim',
    'I confirm the payroll data is ready for review.': 'Saya memastikan data penggajian siap ditinjau.', 'Designer': 'Desainer', 'Manager': 'Manajer',
    'Cc': 'Tembusan', 'Bcc': 'Tembusan Tersembunyi', 'from last month': 'dari bulan lalu',
    'Tahun Ini': 'Tahun Ini', '3 Days Off, 1 Late Arrival': '3 Hari Libur, 1 Keterlambatan',
    'Promoted from HR Assistant to HR Officer due to consistent performance and leadership in onboarding initiatives.': 'Dipromosikan dari Asisten SDM menjadi Staf SDM berkat kinerja konsisten dan kepemimpinannya dalam program orientasi.',
    'Recognized by the Head of HR for successfully leading the Q2 training rollout with a 98% participation rate.': 'Mendapat apresiasi dari Kepala SDM karena berhasil memimpin pelaksanaan pelatihan Triwulan 2 dengan tingkat partisipasi 98%.',
    'Olivia Mason is building a strong record in Marketing through consistent performance and team support.': 'Olivia Mason membangun rekam kinerja yang baik di bidang pemasaran melalui kinerja konsisten dan dukungan kepada tim.',
    'Olivia Mason is recognized for contributing to team goals and sharing expertise with colleagues.': 'Olivia Mason diapresiasi atas kontribusinya pada sasaran tim dan kesediaannya berbagi keahlian dengan rekan kerja.',
  };

  const entries = Object.entries(translations).sort(([a], [b]) => b.length - a.length);
  const escapePattern = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function translate(value) {
    let result = value;
    for (const [source, target] of entries) {
      const expression = new RegExp(`(^|[^\\p{L}\\p{N}])${escapePattern(source)}(?=$|[^\\p{L}\\p{N}])`, 'gu');
      result = result.replace(expression, (match, prefix) => `${prefix}${target}`);
    }
    return result;
  }
  function toEnglish(value) {
    let result = value;
    for (const [source, target] of entries) {
      const expression = new RegExp(`(^|[^\\p{L}\\p{N}])${escapePattern(target)}(?=$|[^\\p{L}\\p{N}])`, 'giu');
      result = result.replace(expression, (match, prefix) => `${prefix}${source}`);
    }
    return result;
  }
  window.teamHubTranslate = translate;
  window.kharismaHubTranslate = translate;
  window.kharismaHubToEnglish = toEnglish;
  window.teamHubToEnglish = toEnglish;

  function translateNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const updated = translate(node.nodeValue);
      if (updated !== node.nodeValue) node.nodeValue = updated;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE || ['SCRIPT', 'STYLE', 'TEXTAREA'].includes(node.tagName)) return;
    if (node.tagName === 'OPTION' && !node.hasAttribute('value')) node.value = node.textContent.trim();
    for (const child of node.childNodes) translateNode(child);
    for (const attribute of ['placeholder', 'aria-label', 'title', 'alt']) {
      if (node.hasAttribute(attribute)) {
        const updated = translate(node.getAttribute(attribute));
        if (updated !== node.getAttribute(attribute)) node.setAttribute(attribute, updated);
      }
    }
  }

  document.documentElement.lang = 'id';
  const pageTitle = document.querySelector('title');
  if (pageTitle) pageTitle.textContent = 'Kharisma Hub — Manajemen SDM';
  translateNode(document.body);
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'childList') record.addedNodes.forEach(translateNode);
      else if (record.type === 'characterData') translateNode(record.target);
      else if (record.type === 'attributes') translateNode(record.target);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['placeholder', 'aria-label', 'title', 'alt'] });
})();
