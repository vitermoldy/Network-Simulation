# Simulasi Jaringan

Simulator jaringan 3D di browser untuk belajar bagaimana satu permintaan web sampai ke server dan
kembali. Alurnya mengikuti input, proses, output: alamat diketik di laptop (input), paket diteruskan
switch, router, dan server DNS (proses), lalu server web menjawab dan halamannya tampil di layar
(output). Semua perangkat ada di meja 3D yang bisa diputar, lengkap dengan port, kabel, lampu, dan
tombol power yang benar-benar bisa dipakai.

Perangkatnya mengikuti bentuk yang biasa ditemui di lab Cisco dan Packet Tracer: switch 24 port
FastEthernet dengan 2 uplink Gigabit, router dengan port GigabitEthernet dan port console, PC tower,
laptop, dan server. Nama port dan perintahnya juga sama (Fa0/1, G0/0, `show ip route`, `no shutdown`).

## Yang bisa dilakukan

- **Ikuti satu permintaan web.** ARP mencari MAC gateway, DNS menerjemahkan nama, TCP berjabat tangan
  tiga langkah, HTTP meminta halaman, server mengirimnya dalam tiga segmen, lalu sambungan ditutup.
  Setiap keputusan perangkat dijelaskan di panel Alur.
- **Buka header setiap paket** lapis demi lapis (aplikasi, transport, IP, Ethernet, kabel). Saat paket
  ada di dalam switch atau router, terlihat sampai lapisan mana perangkat itu membacanya dan field
  mana yang berubah (MAC baru, TTL turun).
- **Ubah jaringannya.** Tambah PC, laptop, switch, router, atau server dari palet; seret untuk
  memindahkan; klik port kosong lalu port lain untuk memasang kabel; klik kabel untuk mencabutnya;
  tekan tombol power untuk mematikan perangkat.
- **Jendela perangkat seperti di Packet Tracer.** Klik perangkat untuk membukanya:
  - Fisik: perangkat itu saja dalam 3D, bisa diputar dan diperbesar.
  - Config: nama, IP per port, port aktif atau shutdown, gateway, DNS, layanan server, catatan DNS.
  - Desktop (PC, laptop): IP Configuration, Command Prompt (`ipconfig`, `ping`, `arp -a`, `nslookup`),
    Web Browser.
  - CLI (router, switch): `enable`, `configure terminal`, `interface`, `ip address`, `shutdown`,
    `no shutdown`, `hostname`, `show ip interface brief`, `show ip route`, `show mac address-table`,
    `show arp`, `show running-config`, `ping`. Singkatan seperti `conf t` dan `int g0/1` bisa dipakai.
- **Lihat jaringan memperbaiki diri.** Skenario "router mati" mematikan router di tengah jalur saat data
  dikirim: paket hilang, router menghitung ulang rute (link-state, seperti OSPF), dan TCP mengirim ulang
  lewat jalur lain. Skenario "paket hilang" merusak satu segmen di kabel sehingga terlihat ACK duplikat
  dan kirim ulang.
- **Riwayat dan rancangan di MySQL.** Setiap percobaan (berhasil atau gagal) tercatat, dan susunan
  jaringan bisa disimpan dengan nama lalu dimuat lagi.

## Menjalankan

Butuh Node.js 22 atau lebih baru.

```bash
npm install
npm run dev
```

Buka http://localhost:5181. Simulasinya berjalan penuh di browser; server MySQL hanya untuk riwayat
dan rancangan tersimpan.

### Server MySQL (riwayat dan rancangan)

1. Salin `.env.example` menjadi `.env`, lalu isi `DB_USER` dan `DB_PASSWORD` MySQL kamu.
2. Jalankan server di terminal kedua:

   ```bash
   npm run server
   ```

   Server membuat database `network_simulation` dan tabelnya sendiri saat pertama kali tersambung.
   Selama `npm run dev` jalan, alamat `/api` diteruskan ke server ini (port 8797).

Kalau server mati, simulator tetap bisa dipakai. Percobaan yang selesai disimpan dulu di browser dan
dikirim begitu server tersambung lagi.

Untuk versi jadi: `npm run build`, lalu `npm start` menyajikan folder `dist` sekaligus API-nya di
http://localhost:8797.

### Perintah lain

```bash
npm test          # tes mesin simulasi (routing, ARP, DNS, TCP, ping, shutdown, simpan dan muat)
npm run typecheck
```

## Struktur

```
src/engine/   mesin simulasi: alamat IP, topologi, routing link-state, paket, dan simulator berbasis event
src/scene/    meja 3D (three.js): model perangkat, kabel, paket, dan tampilan dekat satu perangkat
src/ui/       panel, jendela perangkat, Command Prompt, dan CLI gaya IOS
src/data/     pemanggil API MySQL dan antrean riwayat
