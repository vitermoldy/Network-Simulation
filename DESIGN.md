# DESIGN.md: Simulasi Jaringan

## Arah

Simulator jaringan 3D untuk belajar alur input, proses, output dari satu permintaan web. Arah
datang dari pemilik proyek dalam tiga langkah:

1. "Visualisasi barangnya jelas, lubang-lubang untuk kabel, tombol on/off jelas, alurnya jelas, 3D,
   bisa diputar."
2. Palet A dari dealer taste-skill (meja lab abu terang, aksen kobalt), dipilih pemilik pada 14 November
   2026 dari tiga palet yang ditawarkan.
3. "Lihat Cisco": perangkat bergaya Cisco dan Packet Tracer, perangkat bisa ditambah dan dikurangi,
   dan klik perangkat membuka tampilan dekatnya (dengan tangkapan layar Packet Tracer sebagai acuan:
   tab Physical, Config, Desktop, CLI).

Design read: alat belajar jaringan (software) untuk mahasiswa praktikum, dengan bahasa meja lab dan
perangkat Cisco, dial **ENERGY 2 / RHYTHM 2 / MOTION 2**.

- ENERGY 2: meja 3D adalah pusat perhatian; panel di sekitarnya tenang supaya penjelasan mudah dibaca.
- RHYTHM 2: tata letak tetap (meja, bilah kendali, panel) dengan satu jendela perangkat yang mengambang.
- MOTION 2: gerak hanya untuk makna: paket berjalan di kabel, lampu port berkedip saat data lewat,
  kamera berpindah saat perangkat difokuskan. Tidak ada animasi hiasan.

## Deal taste-skill 2.5.1

| Item | Hasil | Alasan |
| --- | --- | --- |
| Kind | software (developer tool) | Produknya alat kerja; tampilannya adalah alat itu sendiri. |
| Palet | cool-grey-cobalt: bg `#eef0f3`, surface `#e2e5ea`, ink `#0b0c0e`, muted `#4f5662`, aksen `#1f2de6` | Meja abu terang membuat perangkat gelap gaya Cisco dan lubang port hitam paling kontras; kobalt hanya untuk paket yang bergerak dan status aktif. Dipilih pemilik. |
| Huruf | Host Grotesk (teks dan judul) + JetBrains Mono (alamat IP, MAC, CLI) | Pasangan pertama dari dealer. Digit mono membuat alamat dan tabel rata; terminal terasa seperti terminal. |
| Radius | soft (6, 8, 14 px) | Dealer untuk software; tidak ada bentuk pil kecuali sakelar. |

Tema gelap ada sebagai pilihan (tombol di kanan atas): latar `#0b0c0e`, aksen `#5b8cff` (6,4:1 di latar).
Terminal tetap gelap di kedua tema, seperti terminal sungguhan.

## Perangkat (gaya Cisco, tanpa logo)

| Perangkat | Bentuk | Catatan |
| --- | --- | --- |
| Switch | Panel sistem abu kebiruan, 24 port Fa dalam tiga blok berisi delapan (dua baris), dua uplink Gi0/1 dan Gi0/2, LED SYST, STAT, DUPLX, SPEED, tombol MODE | Satu LED per port seperti switch Cisco: hijau saat link, kuning saat ada data. |
| Router | Bezel hitam, ventilasi, dua plat slot modul kosong, G0/0 sampai G0/3, port console biru | LED PWR, SYS, ACT. Router baru mulai dengan semua port shutdown, seperti di Packet Tracer. |
| PC | Tower abu muda dan monitor | Layar monitor menampilkan browser kalau PC ini pengirimnya. |
| Laptop | Lid terbuka dengan layar hidup, port di sisi kanan, tombol power di atas keyboard | |
| Server | Tower dengan drive bay; layanan (DNS, HTTP) dan IP tercetak di depan | |

Tidak ada logo atau nama Cisco di model, karena itu merek dagang pihak lain. Bentuk, nama port, dan
perintah CLI mengikuti kebiasaan Cisco supaya terasa akrab bagi mahasiswa yang memakai Packet Tracer.

Keputusan yang sengaja menyimpang dari perangkat asli: tombol power switch dan router ada di depan
(aslinya di belakang atau tidak ada pada switch), karena pemilik meminta tombol on/off yang jelas.

## Keputusan dan alasan (R-31)

| Keputusan | Alasan |
| --- | --- |
| Mesin simulasi berbasis event, sendiri, di TypeScript | Setiap keputusan perangkat (switch membaca MAC, router mencocokkan rute, TCP mengirim ulang) harus bisa diceritakan dan bereaksi saat kabel dicabut di tengah jalan. |
