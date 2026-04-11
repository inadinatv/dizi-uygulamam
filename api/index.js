const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto'); // Şifre kırmak için eklendi

const app = express();
app.use(cors());

// Senin bulduğun yeni adres
const MAIN_URL = "https://dizipal1547.com"; 
const headers = { 
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8"
};

// 1. Kategorileri Çekme
app.get('/api/category', async (req, res) => {
    try {
        const response = await axios.get(`${MAIN_URL}/kanal/${req.query.name || "netflix"}`, { headers });
        const $ = cheerio.load(response.data);
        let series = [];
        $('div.new-added-list div.bg-\\[\\#22232a\\]').each((i, el) => {
            const title = $(el).find('img').attr('alt');
            const link = $(el).find('a').attr('href');
            const poster = $(el).find('img').attr('data-src') || $(el).find('img').attr('src');
            if (title && link) series.push({ title, link, poster });
        });
        res.json({ success: true, data: series });
    } catch (e) { res.status(500).json({ success: false }); }
});

// 2. Bölümleri Çekme
app.get('/api/episodes', async (req, res) => {
    try {
        const response = await axios.get(req.query.url, { headers });
        const $ = cheerio.load(response.data);
        let episodes = [];
        $('div.relative.w-full.flex.items-start.gap-4').each((i, el) => {
            const linkElement = $(el).find('a[data-dizipal-pageloader]');
            const epName = linkElement.find('h2').text().trim() || "Bölüm";
            const link = linkElement.attr('href');
            const infoText = linkElement.find('div.text-white.text-sm.opacity-80').text().trim();
            if (link) episodes.push({ name: `${infoText} - ${epName}`, link });
        });
        res.json({ success: true, data: episodes });
    } catch (e) { res.status(500).json({ success: false }); }
});

// 3. Şifre Kırma ve Video Linkini Çekme (Senin bulduğun Kotlin mantığı)
app.get('/api/video', async (req, res) => {
    try {
        const url = req.query.url;
        const response = await axios.get(url, { headers });
        const $ = cheerio.load(response.data);
        
        // Şifreli metni sayfadan alıyoruz
        const encryptedText = $('div[data-rm-k=true]').text();
        let iframeUrl = "";

        if (encryptedText) {
            // Şifre kırma işlemi başlıyor
            const passphrase = "3hPn4uCjTVtfYWcjIcoJQ4cL1WWk1qxXI39egLYOmNv6IblA7eKJz68uU3eLzux1biZLCms0quEjTYniGv5z1JcKbNIsDQFSeIZOBZJz4is6pD7UyWDggWWzTLBQbHcQFpBQdClnuQaMNUHtLHTpzCvZy33p6I7wFBvL4fnXBYH84aUIyWGTRvM2G5cfoNf4705tO2kv";
            
            const ctMatch = encryptedText.match(/"ciphertext"\s*:\s*"([^"]+)"/);
            const ivMatch = encryptedText.match(/"iv"\s*:\s*"([^"]+)"/);
            const saltMatch = encryptedText.match(/"salt"\s*:\s*"([^"]+)"/);

            if (ctMatch && ivMatch && saltMatch) {
                const ciphertext = Buffer.from(ctMatch[1], 'base64');
                const iv = Buffer.from(ivMatch[1], 'hex');
                const salt = Buffer.from(saltMatch[1], 'hex');

                // PBKDF2 ile anahtar üretimi (Kotlin'deki 999 iteration, 256 bit)
                const key = crypto.pbkdf2Sync(passphrase, salt, 999, 32, 'sha512');
                
                // AES şifresini çözme
                const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
                let decrypted = decipher.update(ciphertext, undefined, 'utf8');
                decrypted += decipher.final('utf8');
                
                iframeUrl = decrypted.replace(/\\\//g, '/');
                
                if (iframeUrl.startsWith("://")) iframeUrl = "https" + iframeUrl;
                else if (iframeUrl.startsWith("//")) iframeUrl = "https:" + iframeUrl;
                else if (!iframeUrl.startsWith("http")) iframeUrl = "https://" + iframeUrl;
            }
        } else {
            // Şifre yoksa direkt iframe ara
            iframeUrl = $('iframe').attr('src') || "";
        }

        if (iframeUrl) {
            res.json({ success: true, embedUrl: iframeUrl });
        } else {
            res.json({ success: false, message: "Şifre kırılamadı veya iframe bulunamadı." });
        }
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

module.exports = app;
