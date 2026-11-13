using LocalShare.Server.Hubs;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// WebRTC sinyalleþmesini yönetecek olan SignalR servisini projeme dahil ediyorum
builder.Services.AddSignalR();

// Telefon veya tarayýcýdan (Frontend) gelecek baðlantýlarýn engellenmemesi için CORS kalkanlarýný indiriyorum
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAll", policy =>
    {
        policy.AllowAnyHeader()
              .AllowAnyMethod()
              .SetIsOriginAllowed((host) => true) // Yerel aðdaki tüm IP'lerden gelen isteklere kapýyý aç
              .AllowCredentials(); // SignalR'ýn WebSocket baðlantýsý kurabilmesi için gerekli izin
    });
});

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();

// Az önce yazdýðým esnek CORS politikasýný devreye sokuyorum
app.UseCors("AllowAll");
app.UseAuthorization();
app.MapControllers();

// Cihazlarýn eþleþmek için baðlanacaðý ana odanýn URL rotasýný belirliyorum
app.MapHub<ShareHub>("/shareHub");

app.Run();