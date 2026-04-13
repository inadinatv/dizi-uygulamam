
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
        const id = req.query.id || "diziler";
        const type = req.query.type || "main";
        const page = parseInt(req.query.page) || 1;
        let targetUrl = MAIN_URL;
        if (type === "platform") targetUrl += `/platform/${id}`;
        else if (type === "kategori") targetUrl += `/kategori/${id}`;
        else targetUrl += `/${id}`;
        targetUrl = targetUrl.replace(/\/$/, ""); 
        if (page > 1) targetUrl += `/page/${page}/`;

        const response = await axios.get(targetUrl, { headers });
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

app.get('/api/search', async (req, res) => {
    try {
        const query = encodeURIComponent(req.query.q);
        const response = await axios.get(`${MAIN_URL}/ajax-search?q=${query}`, { headers: { ...headers, "X-Requested-With": "XMLHttpRequest" } });
        let results = [];
        if (response.data && response.data.results) {
            results = response.data.results.map(item => ({ title: item.title, link: item.url, poster: item.poster }));
        }
        res.json({ success: true, data: results });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.get('/api/episodes', async (req, res) => {
    try {
        const url = req.query.url;
        const response = await axios.get(url, { headers });
        const $ = cheerio.load(response.data);
        let episodes = [];
        $('div.detail-episode-item-wrap').each((i, el) => {
            const epName = $(el).find('div.detail-episode-title').text().trim();
            const epSubtitle = $(el).find('div.detail-episode-subtitle').text().trim();
            const link = $(el).find('a.detail-episode-item').attr('href');
            if (link) episodes.push({ name: `${epSubtitle} - ${epName}`, link });
        });
        if (episodes.length === 0) {
            const movieTitle = $('h1').text().trim() || "Filmi İzle";
            episodes.push({ name: `🎬 ${movieTitle} (Tek Parça)`, link: url });
        }
        res.json({ success: true, data: episodes });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.get('/api/video', async (req, res) => {
    try {
        const url = req.query.url;
        const res1 = await axios.get(url, { headers });
        const $ = cheerio.load(res1.data);
        const configToken = $('#videoContainer').attr('data-cfg');
        
        // İŞTE SİLİNEN VE BÜTÜN SİSTEMİ BOZAN O HAYATİ ÇEREZ KODU (GERİ EKLENDİ)
        let cookies = "";
        if (res1.headers['set-cookie']) {
            cookies = res1.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
        }
        
        let embedUrlRaw = null;

        if (configToken) {
            try {
                const res2 = await axios.post(`${MAIN_URL}/ajax-player-config`, `cfg=${encodeURIComponent(configToken)}`, {
                    headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest", "Origin": MAIN_URL, "Referer": url, "Cookie": cookies }
                });
                let configData = typeof res2.data === 'string' ? JSON.parse(res2.data) : res2.data;
                embedUrlRaw = (configData.config && configData.config.v) ? configData.config.v : configData.v;
            } catch(err) {}
        }

        if (!embedUrlRaw) embedUrlRaw = $('#videoContainer iframe').attr('data-src') || $('#videoContainer iframe').attr('src') || $('iframe').attr('src');
        if (!embedUrlRaw) return res.json({ success: false, message: "Token veya Iframe bulunamadı." });

        let embedUrl = embedUrlRaw.replace(/\\\//g, '/').replace(/['"]/g, '').trim();
        try {
            if (embedUrl.startsWith('//')) embedUrl = `https:${embedUrl}`;
            else if (!embedUrl.startsWith('http')) {
                if (embedUrl.startsWith('/')) embedUrl = new URL(url).origin + embedUrl;
                else embedUrl = `https://${embedUrl}`;
            }
        } catch(err) { embedUrl = embedUrlRaw; }

        try {
            // İMAGESTOO VİDEOLARI
            if (embedUrl.includes('imagestoo')) {
                const videoId = embedUrl.split('/').pop();
                const fallbackUrl = `https://imagestoo.com/e/${videoId}`;
                
                try {
                    const res3 = await axios.post(`https://imagestoo.com/player/index.php?data=${videoId}&do=getVideo`, "hash=", { 
                        headers: { "User-Agent": headers["User-Agent"], "X-Requested-With": "XMLHttpRequest", "Content-Type": "application/x-www-form-urlencoded", "Referer": embedUrl } 
                    });
                    const sourceMatch = res3.data.match(/"securedLink"\s*:\s*"([^"]+)"/);
                    if (sourceMatch) return res.json({ success: true, m3u8: sourceMatch[1].replace(/\\\//g, '/'), referer: embedUrl });
                } catch(e) {}
                
                // Vercel başarısız olursa B PLANINA gönder
                return res.json({ success: false, fallback: fallbackUrl });
            } 
            
            // DİĞER NORMAL VİDEOLAR
            const res4 = await axios.get(embedUrl, { headers: { "User-Agent": headers["User-Agent"], "Referer": url } });
            let m3u8Match = res4.data.match(/(https?:\/\/[^\s"'<>`]+?\.m3u8[^\s"'<>`]*)/i);
            if (m3u8Match) return res.json({ success: true, m3u8: m3u8Match[1].replace(/\\\//g, '/'), referer: embedUrl });
            
            return res.json({ success: false, fallback: embedUrl });
        } catch (innerError) {
            return res.json({ success: false, fallback: embedUrl });
        }
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/proxy_m3u8', async (req, res) => {
    try {
        const m3u8Url = req.query.url;
        const referer = req.query.referer || MAIN_URL;
        const response = await axios.get(m3u8Url, { headers: { "Referer": referer, "User-Agent": headers["User-Agent"], "Accept": "*/*" }});
        const baseUrl = new URL(m3u8Url);
        const rewritten = response.data.split('\n').map(line => {
            let trimmed = line.trim();
            if (trimmed === '' || trimmed.startsWith('#EXT-X-STREAM-INF')) return line;
            if (trimmed.startsWith('#EXT')) {
                return trimmed.replace(/URI="([^"]+)"/g, (match, p1) => {
                    if (p1.startsWith('data:')) return match;
                    const targetUrl = new URL(p1, baseUrl).href;
                    if (targetUrl.includes('.m3u8')) return `URI="/api/proxy_m3u8?url=${encodeURIComponent(targetUrl)}&referer=${encodeURIComponent(referer)}"`;
                    else return `URI="/api/proxy_ts?url=${encodeURIComponent(targetUrl)}&referer=${encodeURIComponent(referer)}"`;
                });
            }
            if (trimmed.startsWith('#')) return line;
            const targetUrl = new URL(trimmed, baseUrl).href;
            if (targetUrl.includes('.m3u8')) return `/api/proxy_m3u8?url=${encodeURIComponent(targetUrl)}&referer=${encodeURIComponent(referer)}`;
            else return `/api/proxy_ts?url=${encodeURIComponent(targetUrl)}&referer=${encodeURIComponent(referer)}`;
        }).join('\n');
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.send(rewritten);
    } catch (e) { res.status(500).send("M3U8 Hata"); }
});

app.get('/api/proxy_ts', async (req, res) => {
    try {
        const tsUrl = req.query.url;
        const referer = req.query.referer || MAIN_URL;
        const response = await axios.get(tsUrl, { responseType: 'stream', headers: { "Referer": referer, "User-Agent": headers["User-Agent"], "Accept": "*/*" }});
        res.setHeader('Content-Type', response.headers['content-type'] || 'application/octet-stream');
        res.setHeader('Access-Control-Allow-Origin', '*');
        response.data.pipe(res);
    } catch (e) { res.status(500).send("TS Hata"); }
});

module.exports = app;
