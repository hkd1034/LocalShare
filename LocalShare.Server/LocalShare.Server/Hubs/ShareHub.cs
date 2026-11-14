using Microsoft.AspNetCore.SignalR;

namespace LocalShare.Server.Hubs
{
    public class ShareHub : Hub
    {
        // 1. Cihazları odaya bağlayan metot
        public async Task JoinRoom(string roomId)
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
            await Clients.GroupExcept(roomId, Context.ConnectionId).SendAsync("UserJoined");
        }

        // 2. WebRTC "Teklif" kuryesi
        public async Task SendOffer(string roomId, string offer)
        {
            await Clients.GroupExcept(roomId, Context.ConnectionId).SendAsync("ReceiveOffer", offer);
        }

        // 3. WebRTC "Cevap" kuryesi
        public async Task SendAnswer(string roomId, string answer)
        {
            await Clients.GroupExcept(roomId, Context.ConnectionId).SendAsync("ReceiveAnswer", answer);
        }

        // 4. WebRTC "Ağ Yolu" (ICE) kuryesi
        public async Task SendIceCandidate(string roomId, string candidate)
        {
            await Clients.GroupExcept(roomId, Context.ConnectionId).SendAsync("ReceiveIceCandidate", candidate);
        }
    }
}