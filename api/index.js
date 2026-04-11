app.get('/api/category', async (req, res) => {
    try {
        let catName = req.query.name || "netflix";
        
        // Sitenin yeni URL yapısına göre eski isimleri düzeltiyoruz
        if (catName === "disney-plus") catName = "disney";
        if (catName === "blutv") catName = "tod"; 

        const response = await axios.get(`${MAIN_URL}/kanal/${catName}`, { headers });
        
        // Eğer site HTML yerine Cloudflare koruma sayfası verdiyse bize bildirsin
        if (response.data.includes('Just a moment') || response.data.includes('Cloudflare')) {
            return res.json({ success: false, message: "Cloudflare ana sayfayı engelledi." });
        }

        const $ = cheerio.load(response.data);
        let series = [];
        
        // Yeni tasarıma uygun esnek arama (Karmaşık CSS sınıfları yerine direkt link ve resimlere odaklanıyoruz)
        $('div.new-added-list a').each((i, el) => {
            const link = $(el).attr('href');
            const img = $(el).find('img');
            const title = img.attr('alt');
            const poster = img.attr('data-src') || img.attr('src');
            
            // Aynı diziyi birden fazla eklememek ve boş olanları atlamak için kontrol
            if (title && link && poster && !series.find(s => s.link === link)) { 
                series.push({ title, link, poster }); 
            }
        });

        res.json({ success: true, data: series });
    } catch (e) { 
        res.status(500).json({ success: false, message: e.message }); 
    }
});
