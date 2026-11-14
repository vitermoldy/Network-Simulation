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
