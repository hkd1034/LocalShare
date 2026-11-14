import { useEffect, useState, useRef } from 'react';
import { HubConnectionBuilder } from '@microsoft/signalr';
import { QRCodeCanvas } from 'qrcode.react'; // QR kod kütüphanemiz
import './App.css';

function App() {
  const [roomId, setRoomId] = useState('');
  const [connection, setConnection] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [peerConnected, setPeerConnected] = useState(false);
  const pcRef = useRef(null);
  const channelRef = useRef(null);
  const receivedBuffersRef = useRef([]); // Gelen parçaları toplayacağımız sepet
  const [downloadUrl, setDownloadUrl] = useState(null); // İndirme linkini tutacağımız state

  // WebRTC Köprüsünü Kuran Fonksiyon
const setupWebRTC = () => {
  // 1. Köprünün ayaklarını kur (Cihazların birbirini bulması için Google'ın ücretsiz STUN sunucusunu kullanıyoruz)
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });
  pcRef.current = pc;

  // 2. Dosya aktarımı için özel bir "Veri Kanalı" (DataChannel) aç
  const channel = pc.createDataChannel("fileTransfer");
  channelRef.current = channel;

  // Kanal açıldığında ve veri geldiğinde tetiklenecek olaylar
  channel.onopen = () => console.log("🚀 WebRTC Veri Kanalı Açıldı! Dosya akışına hazır.");
  
  // Karşı taraf bir veri kanalı açarsa onu da dinle
    pc.ondatachannel = (event) => {
      const receiveChannel = event.channel;
      receiveChannel.onopen = () => console.log("📥 Karşı cihazdan bağlantı kabul edildi.");
      
      receiveChannel.onmessage = (e) => {
        if (e.data === "EOF") {
          console.log("Bütün parçalar geldi, dosya birleştiriliyor...");
          const blob = new Blob(receivedBuffersRef.current);
          const url = URL.createObjectURL(blob);
          setDownloadUrl(url);
          receivedBuffersRef.current = []; 
        } else {
          receivedBuffersRef.current.push(e.data);
        }
      };
    };
  return pc;
};

// Seçilen dosyayı küçük lokmalar (chunk) halinde WebRTC'den fırlatan fonksiyon
  const handleFileSelect = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    console.log(`Seçilen dosya: ${file.name} (${file.size} byte)`);

    const reader = new FileReader();
    reader.onload = (e) => {
      const fileData = e.target.result;
      const channel = channelRef.current;
      
      if (channel && channel.readyState === "open") {
        const CHUNK_SIZE = 64 * 1024; // Telefonu boğmayan güvenli lokma
        let offset = 0;

        const sendNextChunk = () => {
          while (offset < fileData.byteLength) {
            // Boru 1 MB'ı geçerse sadece 5 milisaniye bekle ve ASLA KİLİTLENME
            if (channel.bufferedAmount > 1024 * 1024) {
              setTimeout(sendNextChunk, 5);
              return;
            }
            const chunk = fileData.slice(offset, offset + CHUNK_SIZE);
            channel.send(chunk);
            offset += CHUNK_SIZE; 
          }
          
          // Tüm parçalar bittiğinde onayı bas
          channel.send("EOF"); 
          console.log("Dosya aktarımı tamamlandı! 🚀");
        };

        // SADECE BİR KERE ÇAĞIRIYORUZ! Çakışma yok.
        sendNextChunk(); 

      } else {
        alert("Hata: WebRTC kanalı henüz hazır değil.");
      }
    };
    
    reader.readAsArrayBuffer(file);
  };

  // 1. Aşama: Cihaz ilk açıldığında odayı belirle ve SignalR bağlantısını kur
  useEffect(() => {
    // URL'deki "?room=123456" kısmını okuyan bölüm
    const params = new URLSearchParams(window.location.search);
    const urlRoom = params.get("room");

    // Eğer linkte oda varsa onu kullan (Telefon), yoksa yeni üret (Bilgisayar)
    const currentRoomId = urlRoom ? urlRoom : Math.floor(100000 + Math.random() * 900000).toString();
    setRoomId(currentRoomId);

    // Backend (C#) sunucumuza köprü atıyoruz (Tünel adresi aynı kalmalı)
    const newConnection = new HubConnectionBuilder()
      .withUrl("https://pvdl389s-7068.eun1.devtunnels.ms/shareHub")
      .withAutomaticReconnect()
      .build();

    setConnection(newConnection);
  }, []);

  // 2. Aşama: Bağlantı nesnesi oluştuğunda sunucuya bağlan ve odaya gir
  useEffect(() => {
    if (connection) {
      connection.start()
        .then(() => {
          setIsConnected(true);
          connection.invoke("JoinRoom", roomId).then(() => {
            const params = new URLSearchParams(window.location.search);
            if (params.get("room")) {
              setPeerConnected(true);
            }
          });
        })
        .catch(err => console.error("Bağlantı hatası: ", err));

      // 1. ADIM (BİLGİSAYAR): Telefon odaya girince WebRTC'yi kur ve "Teklif" gönder
      connection.on("UserJoined", async () => {
        setPeerConnected(true);
        const pc = setupWebRTC();

        // Ağ yolunu (ICE) buldukça karşıya (SignalR üzerinden) gönder
        pc.onicecandidate = (event) => {
          if (event.candidate) {
            connection.invoke("SendIceCandidate", roomId, JSON.stringify(event.candidate));
          }
        };

        // Teklifi oluştur ve yolla
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        connection.invoke("SendOffer", roomId, JSON.stringify(offer));
      });

      // 2. ADIM (TELEFON): Bilgisayardan gelen teklifi al, WebRTC'yi kur ve "Cevap" dön
      connection.on("ReceiveOffer", async (offerString) => {
        const offer = JSON.parse(offerString);
        const pc = setupWebRTC();

        pc.onicecandidate = (event) => {
          if (event.candidate) {
            connection.invoke("SendIceCandidate", roomId, JSON.stringify(event.candidate));
          }
        };

        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        connection.invoke("SendAnswer", roomId, JSON.stringify(answer));
      });

      // 3. ADIM (BİLGİSAYAR): Telefondan gelen cevabı kabul et
      connection.on("ReceiveAnswer", async (answerString) => {
        const answer = JSON.parse(answerString);
        if (pcRef.current) {
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
        }
      });

      // 4. ADIM (İKİ CİHAZ DA): Karşıdan gelen ağ yolu (ICE) bilgilerini kendi haritalarına eklesin
      connection.on("ReceiveIceCandidate", async (candidateString) => {
        const candidate = JSON.parse(candidateString);
        if (pcRef.current) {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        }
      });
    }
  }, [connection, roomId]);

  return (
    <div style={{ textAlign: 'center', marginTop: '30px', fontFamily: 'system-ui' }}>
      <h1>LocalShare 🚀</h1>
      <p>Aynı ağdaki cihazlar arası limitsiz dosya aktarımı</p>

      {isConnected ? (
        <div style={{ marginTop: '40px', padding: '20px', background: '#1a1a1a', borderRadius: '15px', display: 'inline-block' }}>
          
          {/* Eğer karşı cihaz bağlandıysa DOSYA SEÇME EKRANI, bağlanmadıysa QR KOD EKRANI göster */}
          {peerConnected ? (
            <div style={{ background: '#4CAF50', padding: '20px', borderRadius: '10px', color: 'white' }}>
              <h2>Bağlantı Kuruldu! 🚀</h2>
              <p>Cihazlar arası köprü hazır. Göndermek istediğiniz dosyayı seçin.</p>
              <input type="file" onChange={handleFileSelect} style={{ marginTop: '15px', background: 'white', color: 'black', padding: '10px', borderRadius: '5px' }} />
              {/* Eğer karşıdan bir dosya geldiyse bu buton ortaya çıksın */}
{downloadUrl && (
  <div style={{ marginTop: '20px', padding: '15px', background: '#2196F3', borderRadius: '10px', color: 'white' }}>
    <h3>🎉 Yeni Dosya Geldi!</h3>
    <a href={downloadUrl} download="gelen_dosya.jpg" style={{ display: 'inline-block', marginTop: '10px', background: 'white', color: '#2196F3', padding: '10px 20px', borderRadius: '5px', textDecoration: 'none', fontWeight: 'bold' }}>
      📥 Dosyayı İndir
    </a>
  </div>
)}
            </div>
          ) : (
            <>
              <h2 style={{ color: '#4CAF50' }}>Oda Kodunuz: {roomId}</h2>
              <p style={{ color: '#ccc' }}>Telefonunuzun kamerasından QR kodu okutun</p>
              
              <div style={{ margin: '20px', padding: '15px', background: 'white', borderRadius: '10px', display: 'inline-block' }}>
                <QRCodeCanvas value={`http://172.20.10.3:5173/?room=${roomId}`} size={200} />
              </div>
            </>
          )}

        </div>
      ) : (
        <h3 style={{ color: '#ff9800' }}>Çöpçatan Sunucuya (Backend) Bağlanılıyor... ⏳</h3>
      )}
    </div>
  );
}

export default App;