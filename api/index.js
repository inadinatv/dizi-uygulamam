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
        if (page > 1) targetUrl += `/page/${page}`;

        const response = await axios.get(targetUrl, { headers });
        const $ = cheerio.load(response.data);
        let series =[];
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
        let results =[];
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
        let episodes =[];
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
        
        // ÇEREZLER GERİ GELDİ! (Burası silinmişti)
        let cookies = res1.headers['set-cookie'] ? res1.headers['set-cookie'].map(c => c.split(';')[0]).join('; ') : "";
        let embedUrlRaw = null;

        if (configToken) {
            const res2 = await axios.post(`${MAIN_URL}/ajax-player-config`, `cfg=${encodeURIComponent(configToken)}`, {
                headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest", "Origin": MAIN_URL, "Referer": url, "Cookie": cookies }
            });
            let configData = typeof res2.data === 'string' ? JSON.parse(res2.data) : res2.data;
            embedUrlRaw = (configData.config && configData.config.v) ? configData.config.v : configData.v;
        }

        if (!embedUrlRaw) embedUrlRaw = $('#videoContainer iframe').attr('data-src') || $('#videoContainer iframe').attr('src') || $('iframe').attr('src');
        if (!embedUrlRaw) return res.json({ success: false, message: `Video bulunamadı. (Token yok)` });

        let embedUrl = embedUrlRaw.replace(/\\\//g, '/').replace(/['"]/g, '').trim();
        try {
            if (embedUrl.startsWith('//')) embedUrl = `https:${embedUrl}`;
            else if (!embedUrl.startsWith('http')) {
                if (embedUrl.startsWith('/')) embedUrl = new URL(url).origin + embedUrl;
                else embedUrl = `https://${embedUrl}`;
            }
        } catch(err) { embedUrl = embedUrlRaw; }

        try {
            if (embedUrl.includes('imagestoo')) {
                const videoId = embedUrl.split('/').pop();
                const res3 = await axios.post(`https://imagestoo.com/player/index.php?data=${videoId}&do=getVideo`, "hash=", { 
                    headers: { "User-Agent": headers["User-Agent"], "X-Requested-With": "XMLHttpRequest", "Content-Type": "application/x-www-form-urlencoded", "Referer": embedUrl } 
                });
                
                let imagestooCookie = "";
                if (res3.headers['set-cookie']) {
                    imagestooCookie = res3.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
                }

                const sourceMatch = res3.data.match(/"securedLink"\s*:\s*"([^"]+)"/);
                if (sourceMatch) {
                    return res.json({ success: true, m3u8: sourceMatch[1].replace(/\\\//g, '/'), referer: embedUrl, cookie: imagestooCookie });
                }
                const fallbackUrl = `https://imagestoo.com/e/${videoId}`;
                return res.json({ success: false, fallback: fallbackUrl, message: "Imagestoo m3u8 yok." });
            } 
            else {
                const res4 = await axios.get(embedUrl, { headers: { "User-Agent": headers["User-Agent"], "Referer": url } });
                let m3u8Match = res4.data.match(/(?:file|src|source)\s*[:=]\s*["']([^"']+\.m3u8[^"']*)["']/i) || res4.data.match(/(https?:\/\/[^"']+\.m3u8[^"']*)/i);
                if (m3u8Match) return res.json({ success: true, m3u8: m3u8Match[1].replace(/\\\//g, '/'), referer: embedUrl, cookie: "" });
                
                let mp4Match = res4.data.match(/(?:file|src|source)\s*[:=]\s*["']([^"']+\.mp4[^"']*)["']/i);
                if (mp4Match) return res.json({ success: true, m3u8: mp4Match[1].replace(/\\\//g, '/'), referer: embedUrl, cookie: "" });
            }
            return res.json({ success: false, fallback: embedUrl, message: "M3U8 okunamadı." });
        } catch (innerError) {
            return res.json({ success: false, fallback: embedUrl, message: "Sunucu erişimi reddetti (403)." });
        }
    } catch (e) { res.status(500).json({ success: false, message: "Sunucu hatası." }); }
});

// HTML AMELİYAT MASASI (İframe Kısıtlamasını Siler)
app.get('/api/embed_player', async (req, res) => {
    try {
        const url = req.query.url;
        const response = await axios.get(url, { headers: { "Referer": MAIN_URL, "User-Agent": headers["User-Agent"], "Accept": "*/*" }});
        
        let html = response.data;
        // Kısıtlama engellerini siliyoruz
        html = html.replace(/window\.top/g, "window.self");
        html = html.replace(/window\.parent/g, "window.self");
        html = html.replace(/top\.location/g, "self.location");
        
        // CSS/JS dosyaları bozulmasın diye Base href ekliyoruz
        const origin = new URL(url).origin;
        html = html.replace('<head>', `<head><base href="${origin}/">`);
        
        res.send(html);
    } catch (e) {
        // Eğer Vercel bu web sitesine giremezse (Cloudflare vb.), 
        // HTML içinde özel bir hata ve orijinal linki gönderiyoruz
        res.send(`<body style="background:#000;color:#fff;text-align:center;padding:50px;font-family:sans-serif;">
            <h3>Video yüklenirken güvenlik duvarına takıldı.</h3>
            <a href="${req.query.url}" style="color:#e50914;text-decoration:none;font-weight:bold;padding:10px;border:1px solid #e50914;border-radius:5px;display:inline-block;margin-top:20px;">Videoyu Harici Tarayıcıda Aç</a>
        </body>`);
    }
});

app.get('/api/proxy_m3u8', async (req, res) => {
    try {
        const m3u8Url = req.query.url;
        const referer = req.query.referer || MAIN_URL;
        const reqCookie = req.query.cookie || "";
        
        const response = await axios.get(m3u8Url, { headers: { "Referer": referer, "User-Agent": headers["User-Agent"], "Accept": "*/*", "Cookie": reqCookie }});
        const baseUrl = new URL(m3u8Url);
        const rewritten = response.data.split('\n').map(line => {
            let trimmed = line.trim();
            if (trimmed === '') return line;
            if (trimmed.startsWith('#EXT')) {
                return trimmed.replace(/URI="([^"]+)"/g, (match, p1) => {
                    if (p1.startsWith('data:')) return match; 
                    const targetUrl = new URL(p1, baseUrl).href;
                    if (targetUrl.includes('.m3u8')) return `URI="/api/proxy_m3u8?url=${encodeURIComponent(targetUrl)}&referer=${encodeURIComponent(referer)}&cookie=${encodeURIComponent(reqCookie)}"`;
                    else return `URI="/api/proxy_ts?url=${encodeURIComponent(targetUrl)}&referer=${encodeURIComponent(referer)}&cookie=${encodeURIComponent(reqCookie)}"`;
                });
            }
            if (trimmed.startsWith('#')) return line;
            const targetUrl = new URL(trimmed, baseUrl).href;
            if (targetUrl.includes('.m3u8')) return `/api/proxy_m3u8?url=${encodeURIComponent(targetUrl)}&referer=${encodeURIComponent(referer)}&cookie=${encodeURIComponent(reqCookie)}`;
            else return `/api/proxy_ts?url=${encodeURIComponent(targetUrl)}&referer=${encodeURIComponent(referer)}&cookie=${encodeURIComponent(reqCookie)}`;
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
        const reqCookie = req.query.cookie || "";
        
        const response = await axios.get(tsUrl, { responseType: 'stream', headers: { "Referer": referer, "User-Agent": headers["User-Agent"], "Accept": "*/*", "Cookie": reqCookie }});
        const contentType = response.headers['content-type'] || 'application/octet-stream';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Access-Control-Allow-Origin', '*');
        response.data.pipe(res);
    } catch (e) { res.status(500).send("TS Hata"); }
});

module.exports = app;
