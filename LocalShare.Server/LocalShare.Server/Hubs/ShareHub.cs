using Microsoft.AspNetCore.SignalR;

namespace LocalShare.Server.Hubs
{
    // SignalR Hub sınıfından miras alıyorum ki burası cihazların buluştuğu ana sinyalleşme merkezimiz olsun
    public class ShareHub : Hub
    {
        // 1. Cihazları aynı "Odaya" (örneğin QR koddan gelen 6 haneli kodla) bağladığım yer
        public async Task JoinRoom(string roomId)
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, roomId);

            // Odaya yeni bir cihaz katıldığında, odadaki diğer cihaza haber veriyorum ("Bağlantı geldi!")
            await Clients.GroupExcept(roomId, Context.ConnectionId).SendAsync("UserJoined", Context.ConnectionId);
        }

        // 2. WebRTC "Offer" (P2P Arama başlatma/Teklif) sinyalini diğer cihaza iletiyorum
        public async Task SendOffer(string roomId, object offer)
        {
            await Clients.GroupExcept(roomId, Context.ConnectionId).SendAsync("ReceiveOffer", offer, Context.ConnectionId);
        }

        // 3. WebRTC "Answer" (Aramaya cevap verme) sinyalini karşı tarafa paslıyorum
        public async Task SendAnswer(string roomId, object answer)
        {
            await Clients.GroupExcept(roomId, Context.ConnectionId).SendAsync("ReceiveAnswer", answer, Context.ConnectionId);
        }

        // 4. ICE Candidate (Cihazların kendi yerel/dış IP adreslerini ve ağ yollarını birbirine iletmesi)
        public async Task SendIceCandidate(string roomId, object candidate)
        {
            await Clients.GroupExcept(roomId, Context.ConnectionId).SendAsync("ReceiveIceCandidate", candidate, Context.ConnectionId);
        }
    }
}