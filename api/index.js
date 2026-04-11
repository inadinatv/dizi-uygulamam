const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
app.use(cors());

const MAIN_URL = "https://dizipal2042.com";
const headers = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36" };

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
        const res1 = await axios.get(url, { headers });
        const $ = cheerio.load(res1.data);
        const configToken = $('#videoContainer').attr('data-cfg');
        const cookies = (res1.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');

        if (!configToken) return res.json({ success: false });

        const res2 = await axios.post(`${MAIN_URL}/ajax-player-config`, `cfg=${configToken}`, {
            headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest", "Origin": MAIN_URL, "Referer": url, "Cookie": cookies }
        });

        const configData = typeof res2.data === 'string' ? JSON.parse(res2.data) : res2.data;
        let embedUrl = configData.v.replace(/\\\//g, '/');
        if (!embedUrl.startsWith('http')) embedUrl = `https:${embedUrl}`;

        if (embedUrl.includes('imagestoo')) {
            const videoId = embedUrl.split('/').pop();
            const res3 = await axios.post(`https://imagestoo.com/player/index.php?data=${videoId}&do=getVideo`, "", { headers: { ...headers, "X-Requested-With": "XMLHttpRequest", "Referer": embedUrl }});
            const sourceMatch = res3.data.match(/"securedLink"\s*:\s*"([^"]+)"/);
            if (sourceMatch) return res.json({ success: true, m3u8: sourceMatch[1].replace(/\\\//g, '/') });
        } else {
            const res4 = await axios.get(embedUrl, { headers: { ...headers, "Referer": url } });
            const m3u8Match = res4.data.match(/file\s*:\s*["']([^"']+\.m3u8.*?)["']/);
            if (m3u8Match) return res.json({ success: true, m3u8: m3u8Match[1] });
        }
        res.json({ success: false });
    } catch (e) { res.status(500).json({ success: false }); }
});

module.exports = app;
