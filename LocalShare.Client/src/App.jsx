import { useEffect, useState, useRef } from 'react';
import { HubConnectionBuilder } from '@microsoft/signalr';
import { QRCodeCanvas } from 'qrcode.react'; 
import './App.css';

function App() {
  const [roomId, setRoomId] = useState('');
  const [connection, setConnection] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [peerConnected, setPeerConnected] = useState(false);
  const pcRef = useRef(null);
  const channelRef = useRef(null);
  
  const receivedBuffersRef = useRef([]); 
  const [downloadUrls, setDownloadUrls] = useState([]); 
  
  const [progress, setProgress] = useState(0); 
  const [incomingFileInfo, setIncomingFileInfo] = useState(null); 
  const incomingFileInfoRef = useRef(null); 
  const receivedSizeRef = useRef(0); 

  const [isDragging, setIsDragging] = useState(false);
  const [transferStats, setTransferStats] = useState(null);
  const startTimeRef = useRef(null);
  const fileQueueRef = useRef([]); 
  const currentFileIndexRef = useRef(0);

  const updateStats = (receivedBytes, totalBytes) => {
    const elapsedSeconds = (Date.now() - startTimeRef.current) / 1000;
    if (elapsedSeconds > 0.3) { 
      const speedBps = receivedBytes / elapsedSeconds;
      const speedMBps = (speedBps / (1024 * 1024)).toFixed(2);
      const remainingBytes = totalBytes - receivedBytes;
      const etaSeconds = Math.round(remainingBytes / speedBps);
      
      let etaText = `${etaSeconds} sn`;
      if (etaSeconds > 60) etaText = `${Math.floor(etaSeconds / 60)} dk ${etaSeconds % 60} sn`;
      
      setTransferStats({ speed: `${speedMBps} MB/s`, eta: etaText });
    }
  };

  const setupWebRTC = () => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });
    pcRef.current = pc;

    const channel = pc.createDataChannel("fileTransfer");
    channelRef.current = channel;

    channel.onopen = () => console.log("🚀 WebRTC Kanalı Açıldı!");
    
    channel.onmessage = (e) => {
      if (e.data === "ACK") {
        const nextIdx = currentFileIndexRef.current + 1;
        if (nextIdx < fileQueueRef.current.length) {
          currentFileIndexRef.current = nextIdx;
          sendFile(fileQueueRef.current[nextIdx], nextIdx + 1, fileQueueRef.current.length);
        } else {
          alert("Tüm dosyalar ışık hızında fırlatıldı! ⚡");
          setProgress(0);
          setTransferStats(null);
          setIncomingFileInfo(null);
          fileQueueRef.current = []; 
        }
      }
    };
    
    pc.ondatachannel = (event) => {
      const receiveChannel = event.channel;
      
      receiveChannel.onmessage = (e) => {
        if (typeof e.data === "string") {
          if (e.data === "EOF") {
            const blob = new Blob(receivedBuffersRef.current);
            const url = URL.createObjectURL(blob);
            
            setDownloadUrls(prev => [...prev, { 
              name: incomingFileInfoRef.current.fileName, 
              url: url 
            }]);
            
            setProgress(100);
            receiveChannel.send("ACK");
            
            if (incomingFileInfoRef.current.currentIdx === incomingFileInfoRef.current.totalFiles) {
              alert("Tüm dosyalar başarıyla alındı! 🎉");
              setTransferStats(null);
              setIncomingFileInfo(null);
            }
          } else {
            const meta = JSON.parse(e.data);
            incomingFileInfoRef.current = meta; 
            setIncomingFileInfo(meta); 
            receivedBuffersRef.current = [];
            receivedSizeRef.current = 0;
            setProgress(0); 
            setTransferStats({ speed: "Hesaplanıyor...", eta: "..." });
            startTimeRef.current = Date.now(); 
          }
        } else {
          receivedBuffersRef.current.push(e.data);
          receivedSizeRef.current += e.data.byteLength;
          
          if (incomingFileInfoRef.current) {
            const total = incomingFileInfoRef.current.fileSize;
            const percent = Math.round((receivedSizeRef.current / total) * 100);
            setProgress(percent);
            updateStats(receivedSizeRef.current, total);
          }
        }
      };
    };
    return pc;
  };

  const sendFile = (file, currentIdx, totalFiles) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const fileData = e.target.result;
      const channel = channelRef.current;
      
      if (channel && channel.readyState === "open") {
        const meta = { 
          fileName: file.name, 
          fileSize: file.size,
          currentIdx: currentIdx,
          totalFiles: totalFiles
        };
        channel.send(JSON.stringify(meta));
        
        setIncomingFileInfo(meta); 
        startTimeRef.current = Date.now();

        const CHUNK_SIZE = 64 * 1024; 
        let offset = 0;

        const sendNextChunk = () => {
          while (offset < fileData.byteLength) {
            if (channel.bufferedAmount > 1024 * 1024) {
              setTimeout(sendNextChunk, 5);
              return;
            }
            const chunk = fileData.slice(offset, offset + CHUNK_SIZE);
            channel.send(chunk);
            offset += CHUNK_SIZE; 
            
            const percent = Math.round((offset / file.size) * 100);
            setProgress(percent);
            updateStats(offset, file.size);
          }
          channel.send("EOF"); 
        };
        sendNextChunk(); 
      } else {
        alert("Hata: WebRTC kanalı henüz hazır değil.");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const startTransfer = (filesArray) => {
    if (!filesArray || filesArray.length === 0) return;
    fileQueueRef.current = filesArray;
    currentFileIndexRef.current = 0;
    sendFile(filesArray[0], 1, filesArray.length);
  };

  const handleFileSelect = (event) => startTransfer(Array.from(event.target.files));
  
  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    startTransfer(Array.from(e.dataTransfer.files));
  };

  const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e) => { e.preventDefault(); setIsDragging(false); };

  // TÜM DOSYALARI ARKA ARKAYA İNDİRME MOTORU
  const downloadAll = () => {
    if (downloadUrls.length === 0) return;
    
    if (window.confirm("Tarayıcınız birden fazla dosya indirmek için üstte/altta izin isteyebilir, onaylayın. İndirme başlatılsın mı?")) {
      downloadUrls.forEach((file, index) => {
        setTimeout(() => {
          const a = document.createElement('a');
          a.href = file.url;
          a.download = file.name;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }, index * 300); 
      });
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlRoom = params.get("room");
    const currentRoomId = urlRoom ? urlRoom : Math.floor(100000 + Math.random() * 900000).toString();
    setRoomId(currentRoomId);

    const newConnection = new HubConnectionBuilder()
      .withUrl("https://pvdl389s-7068.eun1.devtunnels.ms/shareHub")
      .withAutomaticReconnect()
      .build();

    setConnection(newConnection);
  }, []);

  useEffect(() => {
    if (connection) {
      connection.start().then(() => {
        setIsConnected(true);
        connection.invoke("JoinRoom", roomId).then(() => {
          if (new URLSearchParams(window.location.search).get("room")) setPeerConnected(true);
        });
      }).catch(err => console.error("Bağlantı hatası: ", err));

      connection.on("UserJoined", async () => {
        setPeerConnected(true);
        const pc = setupWebRTC();
        pc.onicecandidate = (e) => e.candidate && connection.invoke("SendIceCandidate", roomId, JSON.stringify(e.candidate));
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        connection.invoke("SendOffer", roomId, JSON.stringify(offer));
      });

      connection.on("ReceiveOffer", async (offerString) => {
        const pc = setupWebRTC();
        pc.onicecandidate = (e) => e.candidate && connection.invoke("SendIceCandidate", roomId, JSON.stringify(e.candidate));
        await pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(offerString)));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        connection.invoke("SendAnswer", roomId, JSON.stringify(answer));
      });

      connection.on("ReceiveAnswer", async (ans) => pcRef.current && await pcRef.current.setRemoteDescription(new RTCSessionDescription(JSON.parse(ans))));
      connection.on("ReceiveIceCandidate", async (can) => pcRef.current && await pcRef.current.addIceCandidate(new RTCIceCandidate(JSON.parse(can))));
    }
  }, [connection, roomId]);

  return (
    <div style={{ textAlign: 'center', marginTop: '30px', fontFamily: 'system-ui' }}>
      <h1>LocalShare 🚀</h1>
      <p>Aynı ağdaki cihazlar arası limitsiz dosya aktarımı</p>

      {isConnected ? (
        <div style={{ marginTop: '40px', padding: '20px', background: '#1a1a1a', borderRadius: '15px', display: 'inline-block', minWidth: '350px' }}>
          
          {peerConnected ? (
            <div style={{ background: '#2d2d2d', padding: '20px', borderRadius: '10px', color: 'white' }}>
              <h2 style={{ color: '#4CAF50' }}>Bağlantı Kuruldu! 🟢</h2>
              
              <div 
                onDrop={handleDrop} 
                onDragOver={handleDragOver} 
                onDragLeave={handleDragLeave}
                style={{
                  marginTop: '20px', padding: '40px 20px', border: isDragging ? '2px solid #4CAF50' : '2px dashed #666',
                  borderRadius: '10px', background: isDragging ? 'rgba(76, 175, 80, 0.1)' : '#1a1a1a',
                  cursor: 'pointer', transition: 'all 0.2s ease'
                }}
                onClick={() => document.getElementById('fileInput').click()}
              >
                <p style={{ margin: 0, fontSize: '16px', color: isDragging ? '#4CAF50' : '#ccc' }}>
                  {isDragging ? "Dosyaları Buraya Bırakın" : "Dosyaları Sürükleyin veya Seçmek İçin Tıklayın"}
                </p>
                <input id="fileInput" type="file" multiple onChange={handleFileSelect} style={{ display: 'none' }} />
              </div>
              
              {incomingFileInfo && progress < 100 && (
                <div style={{ marginTop: '20px', background: '#111', padding: '15px', borderRadius: '10px', textAlign: 'left' }}>
                  <p style={{ margin: '0 0 10px 0', color: 'white', display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>
                      {incomingFileInfo.fileName}
                    </span>
                    <span style={{ color: '#4CAF50' }}>({incomingFileInfo.currentIdx} / {incomingFileInfo.totalFiles})</span>
                  </p>
                  
                  <div style={{ width: '100%', background: '#444', borderRadius: '5px', height: '20px', overflow: 'hidden' }}>
                    <div style={{ width: `${progress}%`, background: '#4CAF50', height: '100%', transition: 'width 0.2s ease-in-out' }}></div>
                  </div>
                  
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px', fontSize: '13px', color: '#aaa' }}>
                    <span>{progress}%</span>
                    {transferStats && (
                      <div style={{ display: 'flex', gap: '15px' }}>
                        <span>🚀 {transferStats.speed}</span>
                        <span>⏳ {transferStats.eta}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {downloadUrls.length > 0 && (
                <div style={{ marginTop: '20px', padding: '15px', background: '#1a1a1a', borderRadius: '10px', border: '1px solid #4CAF50', textAlign: 'left' }}>
                  
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                    <h3 style={{ margin: 0, color: '#4CAF50' }}>📥 Gelen Dosyalar ({downloadUrls.length})</h3>
                    
                    {downloadUrls.length > 1 && (
                      <button 
                        onClick={downloadAll} 
                        style={{ background: '#2196F3', border: 'none', color: 'white', padding: '8px 15px', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold' }}
                      >
                        Hepsini İndir
                      </button>
                    )}
                  </div>

                  <div style={{ maxHeight: '250px', overflowY: 'auto', paddingRight: '5px' }}>
                    {downloadUrls.map((item, index) => (
                      <div key={index} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#2d2d2d', padding: '12px', margin: '8px 0', borderRadius: '8px' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '75%', fontSize: '14px' }} title={item.name}>
                          {item.name}
                        </span>
                        <a href={item.url} download={item.name} style={{ background: '#4CAF50', color: 'white', padding: '6px 12px', borderRadius: '5px', textDecoration: 'none', fontWeight: 'bold', fontSize: '12px' }}>
                          İndir
                        </a>
                      </div>
                    ))}
                  </div>
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