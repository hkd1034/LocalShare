PROJE ÖZETİ Raporu: LocalShare 🚀
1. Proje Nedir?
LocalShare, cihazlar arası (örneğin bilgisayar ve telefon) hiçbir aracı sunucuya dosya yüklemeden, tamamen eşler arası (Peer-to-Peer / P2P) doğrudan veri aktarımı yapan modern bir web uygulamasıdır. Uçtan uca şifreli (E2EE) sohbet, sürükle-bırak dosya aktarımı, medya önizlemesi ve çoklu indirme gibi özelliklere sahiptir.

2. Kullanılan Temel Teknolojiler
Arayüz (Frontend): React.js

Gerçek Zamanlı Veri Aktarımı: WebRTC (DataChannels)

Sinyalleşme (Çöpçatan) Sunucusu: SignalR

Güvenlik: Custom Symmetric Cipher (XOR + Base64 E2EE)

3. Geliştirme Sürecinde Karşılaşılan Zorluklar ve Ürettiğimiz Çözümler
Zorluk 1: Sayfa Yenilemede (F5) Veri ve Bağlantı Kaybı

Sorun: Uygulama her açıldığında yeni bir QR kod ve Oda numarası üretiyordu. Telefon ekranı kapanıp açıldığında veya F5 atıldığında oda kopuyor, eski veriler siliniyordu.

Çözüm: URL State & Session Recovery (Oturum Kurtarma) mekanizması kurduk. Oda kodu üretildiği an history.replaceState ile tarayıcı URL'sine sabitlendi (?room=...). Dosya ve sohbet geçmişi ise tarayıcının geçici belleğine (sessionStorage) yazıldı. Sayfa yenilense bile sistem URL'deki odayı okuyup tüm geçmişi bellekten saniyesinde geri yükledi.

Zorluk 2: Telefondan Mesaj Gitmemesi (HTTP Güvenlik Kısıtlaması)

Sorun: Güvenli sohbet için modern Web Crypto API (AES-256) kullanıyorduk. Ancak telefonlar yerel ağda HTTP (örn: 172.20...) üzerinden bağlandığı için tarayıcılar güvenlik gereği bu şifreleme motorunu blokladı.

Çözüm: İşletim sistemi/tarayıcı kısıtlamalarını aşmak için saf JavaScript ile kendi şifreleme algoritmamızı yazdık. Oda Kodunu (Room ID) "gizli anahtar" olarak kullanan, veriyi bit düzeyinde karıştıran (Custom XOR Cipher) ve Base64'e çeviren yedek bir uçtan uca şifreleme mimarisi kurduk.

Zorluk 3: Hayalet Odalar (Bağlantı Kopma Senkronizasyonu)

Sorun: Cihazlardan biri "Odadan Ayrıl" butonuna basıp çıkış yaptığında, diğer cihazın bundan haberi olmuyor ve sonsuza kadar "Bağlantı Kuruldu" ekranında boş boş bekliyordu.

Çözüm: Çıkış butonuna basıldığı an, bağlantı koparılmadan milisaniyeler önce karşı cihaza WebRTC üzerinden gizli bir {"type": "disconnect"} sinyali fırlatıldı. Karşı cihaz bu sinyali yakaladığı an anında kendini sıfırlayıp QR kod bekleme ekranına dönmesi sağlandı.

Zorluk 4: Videoların Önizlenmemesi (Kör İndirme)

Sorun: Gönderilen resim ve videoların karşı tarafta sadece bir dosya adı ve ikonu olarak görünmesi kullanıcı deneyimini düşürüyordu.

Çözüm: Dosya uzantılarını (.mp4, .mov, .jpg vb.) tespit eden bir analizör yazıldı. Videolar için HTML5 video etiketine #t=0.1 parametresi eklenerek, videonun 0.1'inci saniyesindeki görüntüsünün otomatik olarak küçük bir kapak fotoğrafına (thumbnail) dönüşmesi başarıldı.

4. Projenin Sağladığı Kazanımlar
Bu proje; sadece React ile arayüz çizmeyi değil, cihazların birbiriyle ağ üzerinden nasıl doğrudan konuşturulacağını (WebRTC), tarayıcı sınırlarının ve kısıtlamalarının nasıl aşılacağını (Custom JS Crypto & sessionStorage) ve Yarış Durumu (Race Condition) gibi kritik senkronizasyon hatalarının nasıl yönetileceğini kanıtlayan, tam teşekküllü bir mühendislik çalışması olmuştur.