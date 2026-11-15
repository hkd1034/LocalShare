import { useEffect, useState, useRef } from 'react';
import { HubConnectionBuilder } from '@microsoft/signalr';
import { QRCodeCanvas } from 'qrcode.react'; 
import './App.css';

// --- E2EE (End-to-End Encryption) - Custom XOR Cipher ---
// HTTP (yerel IP) bağlantılarında tarayıcı kısıtlamasına takılmamak için 
// Oda Kodunu (Room ID) anahtar kullanan saf JS şifreleme motoru.
const xorCipher = (text, key) => {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return result;
};

const encryptMessage = async (text, roomId) => {
  const encoded = encodeURIComponent(text);
  const encryptedText = xorCipher(encoded, roomId);
  return { data: btoa(encryptedText) };
};

const decryptMessage = async (encryptedObj, roomId) => {
  const decodedBase64 = atob(encryptedObj.data);
  const decryptedText = xorCipher(decodedBase64, roomId);
  return decodeURIComponent(decryptedText);
};

function App() {
  const [roomId, setRoomId] = useState('');
  const roomIdRef = useRef(''); 
  
  const [connection, setConnection] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [peerConnected, setPeerConnected] = useState(false);
  
  const pcRef = useRef(null);
  const activeChannelRef = useRef(null); 
  const receivedBuffersRef = useRef([]); 
  
  const [downloadUrls, setDownloadUrls] = useState([]); 
  const [sentFiles, setSentFiles] = useState([]); 
  
  const [progress, setProgress] = useState(0); 
  const [incomingFileInfo, setIncomingFileInfo] = useState(null); 
  const incomingFileInfoRef = useRef(null); 
  const receivedSizeRef = useRef(0); 

  const [isDragging, setIsDragging] = useState(false);
  const [transferStats, setTransferStats] = useState(null);
  const startTimeRef = useRef(null);
  const fileQueueRef = useRef([]); 
  const currentFileIndexRef = useRef(0);

  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const chatScrollRef = useRef(null);

  useEffect(() => {
    if (chatScrollRef.current) chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
  }, [chatMessages]);

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

  // --- Odayı Sıfırlama (Tam Temizlik ve Sinyalizasyon) ---
  const leaveRoom = async () => {
    // 1. Karşı cihaza odadan çıkıldığı bilgisini fırlat
    if (activeChannelRef.current && activeChannelRef.current.readyState === "open") {
      try {
        activeChannelRef.current.send(JSON.stringify({ type: 'disconnect' }));
      } catch (e) {
        console.warn("Çıkış sinyali gönderilemedi:", e);
      }
    }

    // Mesajın karşıya ulaşması için çok kısa bir süre tanı
    await new Promise(resolve => setTimeout(resolve, 100));

    // 2. Kendi bağlantılarını kopar ve temizle
    if (connection) {
      try { await connection.stop(); } catch (err) { console.error("Bağlantı kapatılamadı:", err); }
    }
    setPeerConnected(false);
    setIsConnected(false);
    window.history.replaceState(null, '', window.location.pathname);
    sessionStorage.removeItem(`chat_${roomIdRef.current}`);
    sessionStorage.removeItem(`sent_${roomIdRef.current}`);
    sessionStorage.removeItem(`downloads_${roomIdRef.current}`);
    window.location.reload();
  };

  const handleDataChannelMessage = async (e, channel) => {
    if (typeof e.data === "string") {
      if (e.data === "EOF") {
        const blob = new Blob(receivedBuffersRef.current);
        const url = URL.createObjectURL(blob);
        const newDownload = { name: incomingFileInfoRef.current.fileName, url: url };
        
        setDownloadUrls(prev => {
          const updated = [...prev, newDownload];
          sessionStorage.setItem(`downloads_${roomIdRef.current}`, JSON.stringify(updated.map(f => ({ name: f.name }))));
          return updated;
        });
        
        setProgress(100);
        channel.send("ACK"); 
        
        if (incomingFileInfoRef.current.currentIdx === incomingFileInfoRef.current.totalFiles) {
          setTransferStats(null); setIncomingFileInfo(null);
        }
      } else if (e.data === "ACK") {
        const currentFile = fileQueueRef.current[currentFileIndexRef.current];
        if (currentFile) {
          setSentFiles(prev => {
            const updated = [...prev, { name: currentFile.name }];
            sessionStorage.setItem(`sent_${roomIdRef.current}`, JSON.stringify(updated));
            return updated;
          });
        }

        const nextIdx = currentFileIndexRef.current + 1;
        if (nextIdx < fileQueueRef.current.length) {
          currentFileIndexRef.current = nextIdx;
          sendFile(fileQueueRef.current[nextIdx], nextIdx + 1, fileQueueRef.current.length);
        } else {
          setProgress(0); setTransferStats(null); setIncomingFileInfo(null); fileQueueRef.current = []; 
        }
      } else {
        try {
          const meta = JSON.parse(e.data);
          
          // Karşı taraf "Odadan Ayrıl" butonuna bastıysa QR'a dön
          if (meta.type === "disconnect") {
            setPeerConnected(false);
            activeChannelRef.current = null;
            return;
          }

          if (meta.type === "chat") {
            const decryptedText = await decryptMessage(meta.payload, roomIdRef.current);
            setChatMessages(prev => {
              const updated = [...prev, { text: decryptedText, sender: 'peer', time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) }];
              sessionStorage.setItem(`chat_${roomIdRef.current}`, JSON.stringify(updated));
              return updated;
            });
          } else if (meta.fileName) {
            incomingFileInfoRef.current = meta; 
            setIncomingFileInfo(meta); 
            receivedBuffersRef.current = []; receivedSizeRef.current = 0; setProgress(0); 
            setTransferStats({ speed: "Hesaplanıyor...", eta: "..." });
            startTimeRef.current = Date.now(); 
          }
        } catch (err) { console.error("Veri ayrıştırma hatası:", err); }
      }
    } else {
      receivedBuffersRef.current.push(e.data);
      receivedSizeRef.current += e.data.byteLength;
      if (incomingFileInfoRef.current) {
        const total = incomingFileInfoRef.current.fileSize;
        setProgress(Math.round((receivedSizeRef.current / total) * 100));
        updateStats(receivedSizeRef.current, total);
      }
    }
  };

  const setupWebRTC = () => {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    pcRef.current = pc;

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed" || pc.iceConnectionState === "closed") {
        if (pcRef.current === pc) {
          activeChannelRef.current = null;
          console.warn("Bağlantı geçici olarak koptu.");
        }
      }
    };

    const channel = pc.createDataChannel("fileTransfer");
    const handleSenderOpen = () => { activeChannelRef.current = channel; };
    if (channel.readyState === 'open') handleSenderOpen();
    else channel.onopen = handleSenderOpen;
    channel.onmessage = (e) => handleDataChannelMessage(e, channel);
    
    pc.ondatachannel = (event) => {
      const receiveChannel = event.channel;
      const handleReceiverOpen = () => { activeChannelRef.current = receiveChannel; };
      if (receiveChannel.readyState === 'open') handleReceiverOpen();
      else receiveChannel.onopen = handleReceiverOpen;
      receiveChannel.onmessage = (e) => handleDataChannelMessage(e, receiveChannel);
    };
    return pc;
  };

  const sendFile = (file, currentIdx, totalFiles) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const fileData = e.target.result;
      const channel = activeChannelRef.current;
      if (channel && channel.readyState === "open") {
        const meta = { fileName: file.name, fileSize: file.size, currentIdx: currentIdx, totalFiles: totalFiles };
        channel.send(JSON.stringify(meta));
        setIncomingFileInfo(meta); startTimeRef.current = Date.now();
        
        const CHUNK_SIZE = 64 * 1024; let offset = 0;
        const sendNextChunk = () => {
          while (offset < fileData.byteLength) {
            if (channel.bufferedAmount > 1024 * 1024) { setTimeout(sendNextChunk, 5); return; }
            channel.send(fileData.slice(offset, offset + CHUNK_SIZE));
            offset += CHUNK_SIZE; 
            setProgress(Math.round((offset / file.size) * 100));
            updateStats(offset, file.size);
          }
          channel.send("EOF"); 
        };
        sendNextChunk(); 
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const sendChatMessage = async () => {
    if (!chatInput.trim() || !activeChannelRef.current || activeChannelRef.current.readyState !== "open") return;
    try {
      const encryptedPayload = await encryptMessage(chatInput, roomIdRef.current);
      activeChannelRef.current.send(JSON.stringify({ type: 'chat', payload: encryptedPayload }));
      setChatMessages(prev => {
        const updated = [...prev, { text: chatInput, sender: 'me', time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) }];
        sessionStorage.setItem(`chat_${roomIdRef.current}`, JSON.stringify(updated));
        return updated;
      });
      setChatInput('');
    } catch (error) { console.error("Şifreleme hatası:", error); }
  };

  const startTransfer = (filesArray) => {
    if (!filesArray || filesArray.length === 0) return;
    fileQueueRef.current = filesArray; currentFileIndexRef.current = 0;
    sendFile(filesArray[0], 1, filesArray.length);
  };

  const handleFileSelect = (e) => startTransfer(Array.from(e.target.files));
  const handleDrop = (e) => { e.preventDefault(); setIsDragging(false); startTransfer(Array.from(e.dataTransfer.files)); };
  const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e) => { e.preventDefault(); setIsDragging(false); };

  const downloadAll = () => {
    if (downloadUrls.length === 0) return;
    if (window.confirm("Tüm dosyaların indirme işlemi başlatılsın mı?")) {
      downloadUrls.forEach((file, index) => {
        if(!file.url) return; 
        setTimeout(() => {
          const a = document.createElement('a'); a.href = file.url; a.download = file.name;
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
        }, index * 300); 
      });
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let urlRoom = params.get("room");
    
    if (!urlRoom) {
      urlRoom = Math.floor(100000 + Math.random() * 900000).toString();
      window.history.replaceState(null, '', `?room=${urlRoom}`);
    } else {
      const savedChat = sessionStorage.getItem(`chat_${urlRoom}`);
      if (savedChat) setChatMessages(JSON.parse(savedChat));
      
      const savedSent = sessionStorage.getItem(`sent_${urlRoom}`);
      if (savedSent) setSentFiles(JSON.parse(savedSent));
      
      const savedDownloads = sessionStorage.getItem(`downloads_${urlRoom}`);
      if (savedDownloads) setDownloadUrls(JSON.parse(savedDownloads));
    }
    
    setRoomId(urlRoom);
    roomIdRef.current = urlRoom; 

    const newConnection = new HubConnectionBuilder()
      .withUrl("https://pvdl389s-7068.eun1.devtunnels.ms/shareHub")
      .withAutomaticReconnect().build();
    setConnection(newConnection);
  }, []);

  useEffect(() => {
    if (connection) {
      connection.start().then(() => {
        setIsConnected(true);
        connection.invoke("JoinRoom", roomIdRef.current);
      }).catch(err => console.error("SignalR Bağlantı Hatası:", err));

      connection.on("UserJoined", async () => {
        setPeerConnected(true); 
        const pc = setupWebRTC();
        pc.onicecandidate = (e) => e.candidate && connection.invoke("SendIceCandidate", roomIdRef.current, JSON.stringify(e.candidate));
        const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
        connection.invoke("SendOffer", roomIdRef.current, JSON.stringify(offer));
      });

      connection.on("ReceiveOffer", async (offerString) => {
        setPeerConnected(true); 
        const pc = setupWebRTC();
        pc.onicecandidate = (e) => e.candidate && connection.invoke("SendIceCandidate", roomIdRef.current, JSON.stringify(e.candidate));
        await pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(offerString)));
        const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
        connection.invoke("SendAnswer", roomIdRef.current, JSON.stringify(answer));
      });

      connection.on("ReceiveAnswer", async (ans) => pcRef.current && await pcRef.current.setRemoteDescription(new RTCSessionDescription(JSON.parse(ans))));
      connection.on("ReceiveIceCandidate", async (can) => pcRef.current && await pcRef.current.addIceCandidate(new RTCIceCandidate(JSON.parse(can))));
    }
  }, [connection]);

  return (
    <div style={{ textAlign: 'center', marginTop: '10px', fontFamily: 'system-ui', padding: '0 15px', maxWidth: '1200px', margin: '0 auto' }}>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px 25px', background: '#1a1a1a', borderRadius: '15px', marginBottom: '20px', marginTop: '20px' }}>
        <div style={{ textAlign: 'left' }}>
          <h1 style={{ margin: 0, color: 'white' }}>LocalShare</h1>
          <p style={{ color: '#aaa', fontSize: '13px', margin: '5px 0 0 0' }}>E2EE P2P Veri Ağı</p>
        </div>
        <button onClick={leaveRoom} style={{ background: '#f44336', border: 'none', color: 'white', padding: '10px 15px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }} title="Mevcut odayı kapatır ve yeni bir kod oluşturur">
          🚪 Odadan Ayrıl
        </button>
      </div>

      {isConnected ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px', justifyContent: 'center', alignItems: 'flex-start' }}>
          
          {peerConnected ? (
            <>
              <div style={{ background: '#1a1a1a', padding: '25px', borderRadius: '15px', flex: '1 1 350px', maxWidth: '500px' }}>
                <h2 style={{ color: '#4CAF50', margin: '0 0 15px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                  <span style={{width: '12px', height: '12px', background: '#4CAF50', borderRadius: '50%', display: 'inline-block'}}></span>
                  Bağlantı Kuruldu
                </h2>
                
                <div 
                  onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={handleDragLeave}
                  style={{
                    padding: '40px 20px', border: isDragging ? '2px solid #4CAF50' : '2px dashed #555',
                    borderRadius: '10px', background: isDragging ? 'rgba(76, 175, 80, 0.1)' : '#2d2d2d',
                    cursor: 'pointer', transition: 'all 0.2s ease'
                  }}
                  onClick={() => document.getElementById('fileInput').click()}
                >
                  <p style={{ margin: 0, color: isDragging ? '#4CAF50' : '#ccc' }}>
                    {isDragging ? "Dosyaları Bırakın" : "Dosyaları Sürükleyin veya Seçin"}
                  </p>
                  <input id="fileInput" type="file" multiple onChange={handleFileSelect} style={{ display: 'none' }} />
                </div>
                
                {incomingFileInfo && progress < 100 && (
                  <div style={{ marginTop: '20px', background: '#111', padding: '15px', borderRadius: '10px', textAlign: 'left' }}>
                    <p style={{ margin: '0 0 10px 0', color: 'white', display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>{incomingFileInfo.fileName}</span>
                      <span style={{ color: '#4CAF50' }}>({incomingFileInfo.currentIdx} / {incomingFileInfo.totalFiles})</span>
                    </p>
                    <div style={{ width: '100%', background: '#444', borderRadius: '5px', height: '15px', overflow: 'hidden' }}>
                      <div style={{ width: `${progress}%`, background: '#4CAF50', height: '100%', transition: 'width 0.2s ease-in-out' }}></div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px', fontSize: '12px', color: '#aaa' }}>
                      <span>{progress}%</span>
                      {transferStats && <div>{transferStats.speed}  |  Kalan: {transferStats.eta}</div>}
                    </div>
                  </div>
                )}

                {sentFiles.length > 0 && (
                  <div style={{ marginTop: '20px', padding: '15px', background: '#2d2d2d', borderRadius: '10px', textAlign: 'left' }}>
                    <h3 style={{ margin: '0 0 15px 0', color: '#2196F3' }}>📤 Gönderilenler ({sentFiles.length})</h3>
                    <div style={{ maxHeight: '150px', overflowY: 'auto', paddingRight: '5px' }}>
                      {sentFiles.map((item, index) => {
                        const isImage = item.name.match(/\.(jpeg|jpg|png|gif|webp)$/i);
                        const isVideo = item.name.match(/\.(mp4|webm|mov|avi|mkv)$/i);
                        return (
                          <div key={index} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#1a1a1a', padding: '10px', margin: '8px 0', borderRadius: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', overflow: 'hidden' }}>
                              <div style={{ width: '30px', height: '30px', background: '#444', borderRadius: '5px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px' }}>
                                {isImage ? "🖼️" : isVideo ? "🎬" : "📄"}
                              </div>
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '160px', fontSize: '13px' }} title={item.name}>
                                {item.name}
                              </span>
                            </div>
                            <span style={{ color: '#4CAF50', fontSize: '13px', fontWeight: 'bold' }}>Gönderildi ✅</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {downloadUrls.length > 0 && (
                  <div style={{ marginTop: '20px', padding: '15px', background: '#2d2d2d', borderRadius: '10px', textAlign: 'left' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                      <h3 style={{ margin: 0, color: '#4CAF50' }}>📥 Alınan Dosyalar ({downloadUrls.length})</h3>
                      {downloadUrls.length > 1 && (
                        <button onClick={downloadAll} style={{ background: '#2196F3', border: 'none', color: 'white', padding: '6px 12px', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}>
                          Hepsini İndir
                        </button>
                      )}
                    </div>
                    <div style={{ maxHeight: '150px', overflowY: 'auto', paddingRight: '5px' }}>
                      {downloadUrls.map((item, index) => {
                        const isImage = item.name.match(/\.(jpeg|jpg|png|gif|webp)$/i);
                        const isVideo = item.name.match(/\.(mp4|webm|mov|avi|mkv)$/i);
                        return (
                          <div key={index} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#1a1a1a', padding: '10px', margin: '8px 0', borderRadius: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', overflow: 'hidden' }}>
                              {item.url && isImage ? (
                                <img src={item.url} alt="preview" style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: '5px', border: '1px solid #4CAF50' }} />
                              ) : item.url && isVideo ? (
                                <video src={`${item.url}#t=0.1`} preload="metadata" style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: '5px', border: '1px solid #4CAF50' }} />
                              ) : (
                                <div style={{ width: '40px', height: '40px', background: '#444', borderRadius: '5px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>📄</div>
                              )}
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '120px', fontSize: '13px' }} title={item.name}>
                                {item.name}
                              </span>
                            </div>
                            {item.url ? (
                              <a href={item.url} download={item.name} style={{ background: '#4CAF50', color: 'white', padding: '6px 12px', borderRadius: '5px', textDecoration: 'none', fontWeight: 'bold', fontSize: '12px' }}>İndir</a>
                            ) : (
                              <span style={{ color: '#888', fontSize: '11px' }}>(Geçmiş İşlem)</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div style={{ background: '#1a1a1a', padding: '25px', borderRadius: '15px', flex: '1 1 350px', maxWidth: '500px', display: 'flex', flexDirection: 'column', height: '450px' }}>
                <h2 style={{ color: '#2196F3', margin: '0 0 15px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                  🔒 Güvenli Sohbet
                </h2>
                
                <div ref={chatScrollRef} style={{ flex: 1, background: '#111', borderRadius: '10px', padding: '15px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {chatMessages.length === 0 ? (
                    <p style={{ color: '#555', margin: 'auto', fontSize: '13px' }}>Bağlantı uçtan uca şifrelenmiştir.<br/>Mesajlar cihaz belleğinde tutulur.</p>
                  ) : (
                    chatMessages.map((msg, idx) => (
                      <div key={idx} style={{ alignSelf: msg.sender === 'me' ? 'flex-end' : 'flex-start', maxWidth: '80%' }}>
                        <div style={{ background: msg.sender === 'me' ? '#2196F3' : '#333', color: 'white', padding: '10px 15px', borderRadius: msg.sender === 'me' ? '15px 15px 0 15px' : '15px 15px 15px 0', fontSize: '14px', wordBreak: 'break-word', textAlign: 'left' }}>
                          {msg.text}
                        </div>
                        <div style={{ fontSize: '10px', color: '#777', marginTop: '4px', textAlign: msg.sender === 'me' ? 'right' : 'left' }}>
                          {msg.time}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div style={{ display: 'flex', gap: '10px', marginTop: '15px' }}>
                  <input 
                    type="text" 
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && sendChatMessage()}
                    placeholder="Mesaj yazın..."
                    style={{ flex: 1, padding: '12px', borderRadius: '8px', border: 'none', background: '#333', color: 'white', outline: 'none' }}
                  />
                  <button onClick={sendChatMessage} style={{ background: '#4CAF50', border: 'none', borderRadius: '8px', padding: '0 20px', color: 'white', cursor: 'pointer', fontWeight: 'bold' }}>
                    Gönder
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div style={{ background: '#1a1a1a', padding: '30px', borderRadius: '15px', maxWidth: '500px', margin: '0 auto' }}>
              <h2 style={{ color: '#4CAF50' }}>Oda Kodunuz: {roomId}</h2>
              <p style={{ color: '#ccc' }}>Cihaz eşleştirmesi için QR kodu okutun</p>
              <div style={{ margin: '20px', padding: '15px', background: 'white', borderRadius: '10px', display: 'inline-block' }}>
                <QRCodeCanvas value={`http://172.20.10.3:5173/?room=${roomId}`} size={200} />
              </div>
            </div>
          )}
        </div>
      ) : (
        <h3 style={{ color: '#ff9800', marginTop: '50px' }}>Sinyal Sunucusuna Bağlanılıyor...</h3>
      )}
    </div>
  );
}

export default App;