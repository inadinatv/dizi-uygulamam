const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
app.use(cors());

const MAIN_URL = "https://dizipal2042.com";
const headers = { 
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7"
};

app.get('/api/category', async (req, res) => {
    try {
        const response = await axios.get(`${MAIN_URL}/platform/${req.query.name || "netflix"}`, { headers });
        const $ = cheerio.load(response.data);
        let series = [];
        $('ul.content-grid > li').each((i, el) => {
            const title = $(el).find('div.card-info h3').text().trim();
            const link = $(el).find('a').attr('href');
            const poster = $(el).find('img').attr('data-src') || $(el).find('img').attr('src');
            if (title && link) series.push({ title, link, poster });
        });
        res.json({ success: true, data: series });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.get('/api/episodes', async (req, res) => {
    try {
        const response = await axios.get(req.query.url, { headers });
        const $ = cheerio.load(response.data);
        let episodes = [];
        $('div.detail-episode-item-wrap').each((i, el) => {
            const epName = $(el).find('div.detail-episode-title').text().trim();
            const epSubtitle = $(el).find('div.detail-episode-subtitle').text().trim();
            const link = $(el).find('a.detail-episode-item').attr('href');
            if (link) episodes.push({ name: `${epSubtitle} - ${epName}`, link });
        });
        res.json({ success: true, data: episodes });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.get('/api/video', async (req, res) => {
    try {
        const url = req.query.url;
        
        // 1. Sayfaya Git
        const res1 = await axios.get(url, { headers });
        const $ = cheerio.load(res1.data);
        const configToken = $('#videoContainer').attr('data-cfg');
        
        // Çerezleri daha güvenli birleştir
        let cookies = "";
        if (res1.headers['set-cookie']) {
            cookies = res1.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
        }

        if (!configToken) return res.json({ success: false, message: "Sayfa koruması (Cloudflare) geçilemedi veya token yok." });

        // 2. Token'i Post Et
        const res2 = await axios.post(`${MAIN_URL}/ajax-player-config`, `cfg=${configToken}`, {
            headers: { 
                ...headers, 
                "Content-Type": "application/x-www-form-urlencoded", 
                "X-Requested-With": "XMLHttpRequest", 
                "Origin": MAIN_URL, 
                "Referer": url, 
                "Cookie": cookies 
            }
        });

        const configData = typeof res2.data === 'string' ? JSON.parse(res2.data) : res2.data;
        if (!configData.v) return res.json({ success: false, message: "Embed linki alınamadı." });

        let embedUrl = configData.v.replace(/\\\//g, '/');
        if (!embedUrl.startsWith('http')) embedUrl = `https:${embedUrl}`;

        // 3. Videoyu Çöz
        if (embedUrl.includes('imagestoo')) {
            const videoId = embedUrl.split('/').pop();
            const res3 = await axios.post(`https://imagestoo.com/player/index.php?data=${videoId}&do=getVideo`, "", { 
                headers: { ...headers, "X-Requested-With": "XMLHttpRequest", "Referer": embedUrl }
            });
            const sourceMatch = res3.data.match(/"securedLink"\s*:\s*"([^"]+)"/);
            if (sourceMatch) {
                return res.json({ success: true, m3u8: sourceMatch[1].replace(/\\\//g, '/') });
            } else {
                return res.json({ success: false, message: "Imagestoo m3u8 linki bulunamadı." });
            }
        } else {
            const res4 = await axios.get(embedUrl, { headers: { ...headers, "Referer": url } });
            const m3u8Match = res4.data.match(/file\s*:\s*["']([^"']+\.m3u8.*?)["']/);
            if (m3u8Match) return res.json({ success: true, m3u8: m3u8Match[1] });
        }
        res.json({ success: false, message: "M3U8 linki bulunamadı." });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

module.exports = app;
